import { buildSelectorSource } from './selectorSource.js';
import { chapterIndex } from './chapterIndex.js';
import { settings } from './settings.js';
import { httpGet, httpHead, httpPost } from './browserHttp.js';
import { isUnresolvedMihonSource } from './library.js';
import defaultExtensionIndex from '../../docs/index.json';

const KEY = 'cytlex:extensions:v1';
const EXT_CONFIG_KEY = 'cytlex:ext-config:v1';
const REPO_INDEX_CACHE_KEY = 'cytlex:repo-index-cache:v1';
const REPO_INDEX_FRESH_MS = 24 * 60 * 60 * 1000;
const ADULT_CONTENT_WARNINGS = ['MIXED', 'NSFW'];
export const SOURCE_CONFIG_CHANGE_EVENT = 'cytlex:source-config-changed';
export const EXTENSION_INSTALLED_EVENT = 'cytlex:extension-installed';
export const isRetiredExtension = (id) => id === 'plottwistnofansub' || id === 'yupmanga';
export const isUnavailableMangaSource = (id) => isRetiredExtension(id) || isUnresolvedMihonSource(id);
const NON_INSTALLABLE_EXTENSION_IDS = new Set(defaultExtensionIndex.filter((manifest) => manifest.installable === false).map((manifest) => manifest.id));
export const isExtensionInstallable = (source) => {
  const manifest = source?.manifest || source;
  return manifest?.installable !== false && !NON_INSTALLABLE_EXTENSION_IDS.has(manifest?.id);
};
const keepInstalledExtension = (record) => record?.manifest?.type !== 'builtin'
  && !isUnavailableMangaSource(record?.manifest?.id)
  && isExtensionInstallable(record?.manifest);
let recordsCache = null;
const repoIndexRequests = new Map();

function freshIndexUrl(indexUrl) {
  const url = new URL(indexUrl);
  url.searchParams.set('_cytlex', String(Date.now()));
  return url.href;
}

function parseRepositoryIndex(text, indexUrl) {
  let list;
  try {
    list = JSON.parse(text);
  } catch (error) {
    const position = Number(error?.message?.match(/position\s+(\d+)/i)?.[1]);
    const excerpt = Number.isInteger(position)
      ? text.slice(Math.max(0, position - 45), position + 45).replace(/\s+/g, ' ')
      : text.slice(0, 90).replace(/\s+/g, ' ');
    let displayUrl = indexUrl;
    try {
      const url = new URL(indexUrl);
      url.search = '';
      url.hash = '';
      displayUrl = url.href;
    } catch {}
    throw new Error(`No se pudo leer el índice ${displayUrl}. Respuesta cerca del error: “${excerpt}” (${error.message})`);
  }
  if (!Array.isArray(list)) throw new Error('El índice no es un array JSON');
  return list.filter((manifest) => !isRetiredExtension(manifest?.id));
}

export function isAdultExtension(source) {
  const manifest = source?.manifest || source;
  return ADULT_CONTENT_WARNINGS.includes(String(manifest?.contentWarning || '').toUpperCase());
}

export function isExtensionAllowed(source, showAdultExtensions) {
  const manifest = source?.manifest || source;
  const rating = String(manifest?.contentWarning || '').toUpperCase();
  if (!showAdultExtensions) return rating === 'SAFE';
  return settings.get().adultContentRatings.includes(rating);
}

export function isSourceConfigured(source) {
  const manifest = source?.manifest || source;
  const subSource = manifest?.config?.sources?.find((item) => item.id === manifest.id);
  const languages = manifest?.config?.languages || manifest?.languages || subSource?.languages;
  if (!Array.isArray(languages) || !languages.length) return true;
  try {
    const selected = JSON.parse(localStorage.getItem(EXT_CONFIG_KEY))?.[manifest.id]?.languages;
    return !Array.isArray(selected) || selected.length > 0;
  } catch {
    return true;
  }
}

const read = () => {
  if (recordsCache) return recordsCache;
  let list = [];
  try { list = JSON.parse(localStorage.getItem(KEY)) || []; } catch { list = []; }
  recordsCache = list.filter(keepInstalledExtension);
  if (recordsCache.length !== list.length) {
    for (const record of list.filter((entry) => entry?.manifest?.id && !isExtensionInstallable(entry.manifest))) {
      const id = record.manifest.id;
      clearModule(id);
      for (const sourceId of [id, ...(subSources(record.manifest)?.map((source) => source.id) || [])]) {
        chapterIndex.dropSource(sourceId);
      }
    }
    try { localStorage.setItem(KEY, JSON.stringify(recordsCache)); } catch {}
  }
  return recordsCache;
};
const write = (v) => {
  recordsCache = v.filter(keepInstalledExtension);
  localStorage.setItem(KEY, JSON.stringify(recordsCache));
};

function ctx(manifest = {}) {
  let storedConfig = {};
  try { storedConfig = JSON.parse(localStorage.getItem(EXT_CONFIG_KEY)) || {}; } catch {}
  const languageSelections = Object.fromEntries(Object.entries(storedConfig).map(([id, value]) => [
    id,
    { languages: Array.isArray(value?.languages) ? value.languages.filter((x) => typeof x === 'string') : [] }
  ]));
  return {
    id: manifest.id,
    config: manifest.config,
    languageSelections,
    fetchText: (url, requestId, options) => httpGet(url, requestId, {
      ...options,
      sourceId: manifest.id,
    }),
    parse: (html) => new DOMParser().parseFromString(html, 'text/html'),
    head: (url) => httpHead(url)
  };
}

const MODULE_BOOTSTRAP = `
const channel = 'cytlex-extension';
const pending = new Map();
let nextId = 0;
let source = null;
const errorDetails = (error) => ({
  status: error?.status,
  requestOrigin: error?.requestOrigin,
  reason: error?.reason
});
const restoreError = (message, details) => Object.assign(new Error(String(message || 'Error')), details || {});
const callHost = (method, args) => new Promise((resolve, reject) => {
  const id = 'host-' + (++nextId);
  pending.set(id, { resolve, reject });
  parent.postMessage({ channel, kind: 'host-call', id, method, args }, '*');
});
const describe = (value) => {
  if (typeof value === 'function') return { kind: 'function' };
  if (Array.isArray(value)) return { kind: 'array', items: value.map(describe) };
  if (value && typeof value === 'object') {
    return { kind: 'object', entries: Object.entries(value).map(([key, item]) => [key, describe(item)]) };
  }
  return { kind: 'value', value };
};
addEventListener('message', async (event) => {
  const message = event.data;
  if (message?.channel !== channel) return;
  if (message.kind === 'host-result') {
    const item = pending.get(message.id);
    if (!item) return;
    pending.delete(message.id);
    if (message.error) item.reject(restoreError(message.error, message.errorData));
    else item.resolve(message.value);
    return;
  }
  if (message.kind === 'init') {
    try {
      const url = URL.createObjectURL(new Blob([message.code], { type: 'text/javascript' }));
      let mod;
      try { mod = await import(url); } finally { URL.revokeObjectURL(url); }
      const factory = mod.default || mod.createSource;
      if (typeof factory !== 'function') throw new Error('La extensión no exporta una función (default o createSource)');
      source = await factory({
        id: message.context.id,
        config: message.context.config,
        languageSelections: message.context.languageSelections,
        fetchText: (url, requestId, options) => callHost('fetchText', [url, requestId, options]),
        fetchPostText: (payload, requestId) => callHost('fetchPostText', [payload, requestId]),
        head: (url) => callHost('head', [url]),
        parse: (html) => new DOMParser().parseFromString(html, 'text/html')
      });
      parent.postMessage({ channel, kind: 'ready', description: describe(source) }, '*');
    } catch (error) {
      parent.postMessage({ channel, kind: 'init-error', error: String(error?.message || error) }, '*');
    }
    return;
  }
  if (message.kind === 'call') {
    try {
      let owner = null;
      let value = source;
      for (const key of message.path) {
        owner = value;
        value = value?.[key];
      }
      if (typeof value !== 'function') throw new Error('La extensión no ofrece esta operación');
      const result = await value.apply(owner, message.args || []);
      parent.postMessage({ channel, kind: 'result', id: message.id, value: result }, '*');
    } catch (error) {
      parent.postMessage({
        channel,
        kind: 'result',
        id: message.id,
        error: String(error?.message || error),
        errorData: errorDetails(error)
      }, '*');
    }
  }
});`;

const moduleDisposers = new Map();
const moduleLoads = new Map();
function extensionErrorDetails(error) {
  return {
    status: error?.status,
    requestOrigin: error?.requestOrigin,
    reason: error?.reason
  };
}

function restoreExtensionError(message, details) {
  return Object.assign(new Error(String(message || 'Error')), details || {});
}

async function loadModule(code, manifest) {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('sandbox', 'allow-scripts');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.tabIndex = -1;
  iframe.style.cssText = 'position:fixed;width:0;height:0;border:0;left:-10000px;top:-10000px';
  iframe.srcdoc = `<!doctype html><meta charset="utf-8"><script>${MODULE_BOOTSTRAP}<\/script>`;
  const pending = new Map();
  let nextId = 0;
  let disposed = false;
  let readyResolve;
  let readyReject;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    window.removeEventListener('message', onMessage);
    iframe.remove();
    for (const item of pending.values()) item.reject(new Error('La extensión se cerró'));
    pending.clear();
  };
  const post = (message) => {
    if (!iframe.contentWindow || disposed) throw new Error('No se pudo iniciar la extensión');
    iframe.contentWindow.postMessage({ channel: 'cytlex-extension', ...message }, '*');
  };
  const call = (path, args) => new Promise((resolve, reject) => {
    if (disposed) { reject(new Error('La extensión se cerró')); return; }
    const id = 'app-' + (++nextId);
    pending.set(id, { resolve, reject });
    try { post({ kind: 'call', id, path, args }); }
    catch (error) { pending.delete(id); reject(error); }
  });
  const buildProxy = (description, path = []) => {
    if (description?.kind === 'function') return (...args) => call(path, args);
    if (description?.kind === 'array') return description.items.map((item, index) => buildProxy(item, [...path, String(index)]));
    if (description?.kind === 'object') return Object.fromEntries(
      description.entries.map(([key, item]) => [key, buildProxy(item, [...path, key])])
    );
    return description?.value;
  };
  const onMessage = (event) => {
    if (event.source !== iframe.contentWindow || event.data?.channel !== 'cytlex-extension') return;
    const message = event.data;
    if (message.kind === 'ready') { readyResolve(buildProxy(message.description)); return; }
    if (message.kind === 'init-error') { readyReject(new Error(message.error)); return; }
    if (message.kind === 'result') {
      const item = pending.get(message.id);
      if (!item) return;
      pending.delete(message.id);
      if (message.error) item.reject(restoreExtensionError(message.error, message.errorData));
      else item.resolve(message.value);
      return;
    }
    if (message.kind === 'host-call') {
      const action = message.method === 'fetchText'
        ? (url, requestId, options) => httpGet(url, requestId, {
          ...options,
          sourceId: manifest.id,
        })
        : message.method === 'fetchPostText'
          ? (payload, requestId) => httpPost({
            ...payload,
            responseType: 'text',
            sourceId: manifest.id,
          }, requestId)
        : message.method === 'head'
          ? (url) => httpHead(url)
          : null;
      Promise.resolve().then(() => {
        if (!action) throw new Error('Operación de extensión no permitida');
        return action(...(message.args || []));
      }).then(
        (value) => { if (!disposed) post({ kind: 'host-result', id: message.id, value }); },
        (error) => {
          if (!disposed) post({
            kind: 'host-result',
            id: message.id,
            error: String(error?.message || error),
            errorData: extensionErrorDetails(error)
          });
        }
      );
    }
  };

  window.addEventListener('message', onMessage);
  const loaded = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('La extensión tardó demasiado en iniciar')), 10000);
    iframe.addEventListener('load', () => { clearTimeout(timeout); resolve(); }, { once: true });
    iframe.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('No se pudo iniciar la extensión')); }, { once: true });
  });
  (document.body || document.documentElement).append(iframe);
  try {
    await loaded;
    post({ kind: 'init', code, context: { id: manifest.id, config: manifest.config, languageSelections: ctx(manifest).languageSelections } });
    const source = await Promise.race([
      ready,
      new Promise((_, reject) => setTimeout(() => reject(new Error('La extensión tardó demasiado en iniciar')), 10000))
    ]);
    moduleDisposers.set(manifest.id, dispose);
    return source;
  } catch (error) {
    dispose();
    throw error;
  }
}

const cache = new Map();

function clearModule(id) {
  cache.delete(id);
  moduleDisposers.get(id)?.();
  moduleDisposers.delete(id);
}

const parts = (v) => String(v || '0').split('.').map((n) => parseInt(n, 10) || 0);

export function isNewer(remote, local) {
  const a = parts(remote);
  const b = parts(local);
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const d = (a[i] || 0) - (b[i] || 0);
    if (d > 0) return true;
    if (d < 0) return false;
  }
  return false;
}

const subSources = (manifest) => {
  const subs = manifest?.config?.sources;
  return Array.isArray(subs) && subs.length ? subs : null;
};

const findRecord = (id) => read().find((r) => r.manifest.id === id
  || (r.manifest.config?.sources || []).some((s) => s.id === id));
const normalizeSourceName = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const hostMatches = (url, baseUrl) => {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    const sourceHost = new URL(baseUrl).hostname.toLowerCase().replace(/^www\./, '');
    return host === sourceHost;
  } catch {
    return false;
  }
};

export const extensions = {
  installed() {
    return read().map((r) => ({ manifest: r.manifest }));
  },
  sources() {
    const out = [];
    for (const r of read()) {
      const subs = subSources(r.manifest);
      if (subs) {
        for (const s of subs) {
          out.push({ manifest: { ...r.manifest, ...s, config: { languages: s.languages, default: s.default } }, installedAt: r.installedAt || 0 });
        }
      } else {
        out.push({ manifest: r.manifest, installedAt: r.installedAt || 0 });
      }
    }
    return out;
  },
  manifest(id) {
    if (isRetiredExtension(id)) return {
      id,
      name: id === 'yupmanga' ? 'YupManga' : 'Plot Twist No Fansub',
      contentWarning: 'MIXED'
    };
    const rec = findRecord(id);
    if (!rec) {
      const fallback = defaultExtensionIndex.find((manifest) => manifest.id === id
        || subSources(manifest)?.some((source) => source.id === id));
      if (!fallback) return { id, name: id || 'Fuente' };
      const sub = subSources(fallback)?.find((source) => source.id === id);
      return sub ? { ...fallback, ...sub } : fallback;
    }
      const sub = subSources(rec.manifest)?.find((s) => s.id === id);
      return sub ? { ...rec.manifest, ...sub, icon: sub.icon || rec.manifest.icon } : rec.manifest;
  },
  isInstalled(id) {
    return !!findRecord(id);
  },
  resolveInstalledSource(id, name, url) {
    if (extensions.isInstalled(id)) return id;
    const sources = extensions.sources();
    const normalizedName = normalizeSourceName(name);
    const nameMatches = normalizedName
      ? sources.filter(({ manifest }) => normalizeSourceName(manifest.name) === normalizedName)
      : [];
    if (nameMatches.length === 1) return nameMatches[0].manifest.id;
    const matches = sources.filter(({ manifest }) => hostMatches(url, manifest.baseUrl));
    if (matches.length === 1) return matches[0].manifest.id;
    if (nameMatches.length > 1) {
      const namedHostMatches = nameMatches.filter(({ manifest }) => hostMatches(url, manifest.baseUrl));
      if (namedHostMatches.length === 1) return namedHostMatches[0].manifest.id;
    }
    return '';
  },

  async repoIndex(indexUrl, { refresh = false, maxAgeMs = null } = {}) {
    const url = String(indexUrl || '').trim();
    if (!refresh) {
      try {
        const cached = JSON.parse(localStorage.getItem(REPO_INDEX_CACHE_KEY));
        const age = Date.now() - cached?.at;
        const meetsFreshness = maxAgeMs == null || (age >= 0 && age < maxAgeMs);
        if (cached?.url === url && Array.isArray(cached.repo) && meetsFreshness) {
          return cached.repo;
        }
      } catch {}
    }

    let request = repoIndexRequests.get(url);
    if (!request) {
      request = (async () => {
        const text = await ctx().fetchText(freshIndexUrl(url));
        const repo = parseRepositoryIndex(text, url);
        try { localStorage.setItem(REPO_INDEX_CACHE_KEY, JSON.stringify({ url, at: Date.now(), repo })); } catch {}
        return repo;
      })();
      repoIndexRequests.set(url, request);
    }
    try {
      return await request;
    } finally {
      if (repoIndexRequests.get(url) === request) repoIndexRequests.delete(url);
    }
  },

  async checkUpdates(indexUrl) {
    const repo = await extensions.repoIndex(indexUrl);
    const installed = read();
    for (const r of installed) {
      const remote = repo.find((m) => m.id === r.manifest.id);
      if (!remote || !remote.version) continue;

      const local = r.installedVersion || r.manifest.version || '0';
      if (!r.installedVersion) r.installedVersion = local;
    }

    write(installed);
    return installed.flatMap((r) => {
      const remote = repo.find((m) => m.id === r.manifest.id);
      const local = r.installedVersion || r.manifest.version || '0';
      return remote?.version && isNewer(remote.version, local)
        ? [{ id: r.manifest.id, name: remote.name || r.manifest.name, icon: remote.icon, from: local, to: remote.version }]
        : [];
    });
  },

  async updateAll(indexUrl, ids) {
    const repo = await extensions.repoIndex(indexUrl, { maxAgeMs: REPO_INDEX_FRESH_MS });
    const pendientes = new Set(ids || read().map((r) => r.manifest.id));

    const records = read();
    let ok = 0;
    const fallos = [];
    const actualizadas = [];
    await Promise.all(records.map(async (r) => {
      if (!pendientes.has(r.manifest.id)) return;
      const fresh = repo.find((m) => m.id === r.manifest.id);
      if (!fresh) return;
      const local = r.installedVersion || r.manifest.version || '0';
      if (!fresh.version || !isNewer(fresh.version, local)) return;
      try {
        let code = null;
        if (fresh.type === 'module') {
          if (!fresh.main) throw new Error('La extensión no define "main"');
          const mainUrl = new URL(fresh.main, indexUrl).href;
          code = await ctx().fetchText(freshIndexUrl(mainUrl));
        } else if (fresh.type !== 'selector' || !fresh.baseUrl || !fresh.selectors) {
          throw new Error('La extensión no define una configuración válida');
        }
        r.code = code;
        r.manifest = { ...r.manifest, ...fresh };
        delete r.manifest.adultContent;
        r.installedVersion = fresh.version || r.manifest.version || '0';
        clearModule(r.manifest.id);
        ok += 1;
        actualizadas.push({ id: r.manifest.id, name: fresh.name || r.manifest.name, version: r.installedVersion });
      } catch {
        fallos.push(r.manifest.id);
      }
    }));

    write(records);
    return { ok, fallos, actualizadas };
  },

  async sync(indexUrl) {
    let repo = [];
    try {
      repo = await extensions.repoIndex(indexUrl);
    } catch {}

    const byId = new Map(repo.map((m) => [m.id, m]));
    const records = read().map((r) => {
      const fresh = byId.get(r.manifest.id);
      if (!fresh) return r;
      const installedVersion = r.installedVersion || r.manifest.version || '0';
      const manifest = {
        ...r.manifest,
        contentWarning: fresh.contentWarning,
        version: installedVersion
      };
      delete manifest.adultContent;
      return {
        ...r,
        manifest
      };
    });

    write(records);
    return extensions.installed();
  },

  async available(indexUrl) {
    const installedIds = new Set(extensions.installed().map((e) => e.manifest.id));
    let repo = [];
    try {
      repo = await extensions.repoIndex(indexUrl);
    } catch (e) {
      console.warn('[Cytlex] no se pudo leer el repositorio de extensiones:', e?.message || e);
    }
    return repo.filter((m) => m && m.id && !installedIds.has(m.id));
  },

  async install(manifest, indexUrl, { backfillLibrary = true } = {}) {
    if (isRetiredExtension(manifest.id)) throw new Error('Esta extensión fue retirada.');
    if (!isExtensionInstallable(manifest)) throw new Error('Esta extensión está desactivada temporalmente.');
    let code = null;
    if (manifest.type === 'module') {
      if (!manifest.main) throw new Error('La extensión no define "main"');
      const mainUrl = /^https?:/i.test(manifest.main)
        ? manifest.main
        : new URL(manifest.main, indexUrl).href;
      code = await ctx().fetchText(freshIndexUrl(mainUrl));
    }
    const list = read().filter((r) => r.manifest.id !== manifest.id);
    list.push({ manifest, code, installedVersion: manifest.version || '0', installedAt: Date.now() });
    write(list);
    clearModule(manifest.id);
    for (const sid of [manifest.id, ...(subSources(manifest)?.map((s) => s.id) || [])]) {
      chapterIndex.dropSource(sid);
    }
    if (backfillLibrary) {
      window.dispatchEvent(new CustomEvent(EXTENSION_INSTALLED_EVENT, {
        detail: { sourceIds: [manifest.id, ...(subSources(manifest)?.map((source) => source.id) || [])] }
      }));
    }
  },

  async uninstall(id) {
    const record = findRecord(id);
    const baseId = record?.manifest.id || id;
    if (record?.manifest) {
      try {
        const sourceManifests = new Map([
          [baseId, record.manifest],
          ...(subSources(record.manifest) || []).map((source) => [source.id, { ...record.manifest, ...source }])
        ]);
        const favs = JSON.parse(localStorage.getItem('cytlex:favs') || '[]');
        const enrichedFavs = favs.map((fav) => {
          const source = sourceManifests.get(fav.sourceId || 'leercapitulo');
          if (!source) return fav;
          return {
            ...fav,
            sourceName: fav.sourceName || source.name || baseId,
            sourceIcon: source.icon || record.manifest.icon || fav.sourceIcon || ''
          };
        });
        localStorage.setItem('cytlex:favs', JSON.stringify(enrichedFavs));
      } catch {}
    }
    write(read().filter((r) => r.manifest.id !== baseId));
    clearModule(baseId);
    for (const sid of [baseId, ...(subSources(record?.manifest)?.map((s) => s.id) || [])]) {
      chapterIndex.dropSource(sid);
    }
  },

  invalidate(id) {
    clearModule(findRecord(id)?.manifest.id || id);
  },

  async source(id) {
    const rec = findRecord(id);
    if (!rec) throw new Error('Extensión no instalada: ' + id);
    const baseId = rec.manifest.id;
    if (cache.has(baseId)) return pickSource(cache.get(baseId), id, baseId);
    let pending = moduleLoads.get(baseId);
    if (!pending) {
      pending = Promise.resolve().then(async () => {
        if (rec.manifest.type !== 'module') return buildSelectorSource(rec.manifest, ctx(rec.manifest));
        return loadModule(rec.code, rec.manifest);
      });
      moduleLoads.set(baseId, pending);
    }
    try {
      const src = await pending;
      if (!cache.has(baseId)) cache.set(baseId, src);
      return pickSource(cache.get(baseId), id, baseId);
    } finally {
      if (moduleLoads.get(baseId) === pending) moduleLoads.delete(baseId);
    }
  }
};

function pickSource(src, id, baseId) {
  if (id === baseId) {
    if (src && typeof src === 'object' && !src.catalog && src[baseId]) return src[baseId];
    return src;
  }
  const pick = src?.[id];
  if (!pick) throw new Error('Fuente no encontrada en la extensión: ' + id);
  return pick;
}


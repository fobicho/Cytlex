import { buildSelectorSource } from './selectorSource.js';
import { chapterIndex } from './chapterIndex.js';

const KEY = 'cytlex:extensions:v1';
const EXT_CONFIG_KEY = 'cytlex:ext-config:v1';
const ADULT_CONTENT_WARNINGS = ['MIXED', 'NSFW'];

export function isAdultExtension(source) {
  const manifest = source?.manifest || source;
  return ADULT_CONTENT_WARNINGS.includes(String(manifest?.contentWarning || '').toUpperCase());
}

const read = () => {
  let list = [];
  try { list = JSON.parse(localStorage.getItem(KEY)) || []; } catch { list = []; }
  return list.filter((r) => r?.manifest?.type !== 'builtin');
};
const write = (v) => localStorage.setItem(KEY, JSON.stringify(v));

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
    fetchText: (url) => {
      if (typeof window === 'undefined' || !window.cytlex?.httpGet) {
        throw new Error('Sin puente Electron para hacer peticiones');
      }
      return window.cytlex.httpGet(url);
    },
    parse: (html) => new DOMParser().parseFromString(html, 'text/html'),
    head: async (url) => {
      if (typeof window === 'undefined' || !window.cytlex?.httpHead) return { ok: false, status: 0, length: 0, type: '' };
      return window.cytlex.httpHead(url);
    }
  };
}

const MODULE_BOOTSTRAP = `
const channel = 'cytlex-extension';
const pending = new Map();
let nextId = 0;
let source = null;
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
    if (message.error) item.reject(new Error(message.error));
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
        fetchText: (url) => callHost('fetchText', [url]),
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
      parent.postMessage({ channel, kind: 'result', id: message.id, error: String(error?.message || error) }, '*');
    }
  }
});`;

const moduleDisposers = new Map();
const moduleLoads = new Map();

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
      if (message.error) item.reject(new Error(message.error));
      else item.resolve(message.value);
      return;
    }
    if (message.kind === 'host-call') {
      const action = message.method === 'fetchText'
        ? (url) => window.cytlex.httpGet(url)
        : message.method === 'head'
          ? (url) => window.cytlex.httpHead(url)
          : null;
      Promise.resolve().then(() => {
        if (!action) throw new Error('Operación de extensión no permitida');
        return action(...(message.args || []));
      }).then(
        (value) => { if (!disposed) post({ kind: 'host-result', id: message.id, value }); },
        (error) => { if (!disposed) post({ kind: 'host-result', id: message.id, error: String(error?.message || error) }); }
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
          out.push({ manifest: { ...r.manifest, ...s, config: { languages: s.languages, default: s.default } } });
        }
      } else {
        out.push({ manifest: r.manifest });
      }
    }
    return out;
  },
  manifest(id) {
    const rec = findRecord(id);
    if (!rec) return { id, name: id || 'Fuente' };
    const sub = subSources(rec.manifest)?.find((s) => s.id === id);
    return sub ? { ...rec.manifest, ...sub } : rec.manifest;
  },
  isInstalled(id) {
    return !!findRecord(id);
  },

  async repoIndex(indexUrl) {
    const text = await ctx().fetchText(indexUrl);
    const list = JSON.parse(text);
    if (!Array.isArray(list)) throw new Error('El índice no es un array JSON');
    return list;
  },

  async checkUpdates(indexUrl) {
    const repo = await extensions.repoIndex(indexUrl);
    const installed = read();
    await Promise.all(installed.map(async (r) => {
        const remote = repo.find((m) => m.id === r.manifest.id);
        if (!remote || !remote.version) return;

        let local = r.installedVersion || r.manifest.version || '0';
        if (!r.installedVersion && remote.type === 'module' && local === remote.version && remote.main) {
          try {
            const mainUrl = /^https?:/i.test(remote.main)
              ? remote.main
              : new URL(remote.main, indexUrl).href;
            const remoteCode = await ctx().fetchText(mainUrl);
            if (remoteCode === r.code) {
              r.installedVersion = remote.version;
              local = remote.version;
            } else {
              local = '0';
            }
          } catch {
            local = '0';
          }
          r.installedVersion = local;
          r.manifest = { ...r.manifest, version: local };
        } else if (!r.installedVersion) {
          r.installedVersion = local;
        }
      }));

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
    const repo = await extensions.repoIndex(indexUrl);
    const pendientes = new Set(ids || read().map((r) => r.manifest.id));

    const records = read();
    let ok = 0;
    const fallos = [];
    await Promise.all(records.map(async (r) => {
      if (!pendientes.has(r.manifest.id)) return;
      const fresh = repo.find((m) => m.id === r.manifest.id);
      if (!fresh || fresh.type !== 'module' || !fresh.main) return;
      const local = r.installedVersion || r.manifest.version || '0';
      if (!fresh.version || !isNewer(fresh.version, local)) return;
      try {
        const mainUrl = /^https?:/i.test(fresh.main)
          ? fresh.main
          : new URL(fresh.main, indexUrl).href;
        const code = await ctx().fetchText(mainUrl);
        r.code = code;
        r.manifest = { ...r.manifest, ...fresh };
        delete r.manifest.adultContent;
        r.installedVersion = fresh.version || r.manifest.version || '0';
        clearModule(r.manifest.id);
        ok += 1;
      } catch {
        fallos.push(r.manifest.id);
      }
    }));

    write(records);
    return { ok, fallos };
  },

  async sync(indexUrl) {
    let repo = [];
    try {
      const text = await ctx().fetchText(indexUrl);
      const list = JSON.parse(text);
      if (Array.isArray(list)) repo = list;
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
      const text = await ctx().fetchText(indexUrl);
      const list = JSON.parse(text);
      if (!Array.isArray(list)) throw new Error('El índice no es un array JSON');
      repo = list;
    } catch (e) {
      console.warn('[Cytlex] no se pudo leer el repositorio de extensiones:', e?.message || e);
    }
    return repo.filter((m) => m && m.id && !installedIds.has(m.id));
  },

  async install(manifest, indexUrl) {
    let code = null;
    if (manifest.type === 'module') {
      if (!manifest.main) throw new Error('La extensión no define "main"');
      const mainUrl = /^https?:/i.test(manifest.main)
        ? manifest.main
        : new URL(manifest.main, indexUrl).href;
      code = await ctx().fetchText(mainUrl);
    }
    const list = read().filter((r) => r.manifest.id !== manifest.id);
    list.push({ manifest, code, installedVersion: manifest.version || '0', installedAt: Date.now() });
    write(list);
    clearModule(manifest.id);
    for (const sid of [manifest.id, ...(subSources(manifest)?.map((s) => s.id) || [])]) {
      chapterIndex.dropSource(sid);
    }
  },

  async uninstall(id) {
    const record = findRecord(id);
    const baseId = record?.manifest.id || id;
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
      pending = Promise.resolve().then(() => rec.manifest.type === 'module'
        ? loadModule(rec.code, rec.manifest)
        : buildSelectorSource(rec.manifest, ctx(rec.manifest)));
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


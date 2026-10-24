import { buildSelectorSource } from './selectorSource.js';
import { chapterIndex } from './chapterIndex.js';

const KEY = 'cytlex:extensions:v1';
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
  return {
    id: manifest.id,
    config: manifest.config,
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

async function loadModule(code, manifest) {
  const blob = new Blob([code], { type: 'text/javascript' });
  const blobUrl = URL.createObjectURL(blob);
  try {
    const mod = await import(/* @vite-ignore */ blobUrl);
    const factory = mod.default || mod.createSource;
    if (typeof factory !== 'function') {
      throw new Error('La extensión no exporta una función (default o createSource)');
    }
    return await factory(ctx(manifest));
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

const cache = new Map();

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
        cache.delete(r.manifest.id);
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
    cache.delete(manifest.id);
    for (const sid of [manifest.id, ...(subSources(manifest)?.map((s) => s.id) || [])]) {
      chapterIndex.dropSource(sid);
    }
  },

  async uninstall(id) {
    write(read().filter((r) => r.manifest.id !== id));
    cache.delete(id);
    for (const sid of [id, ...(subSources(read().find((r) => r.manifest.id === id)?.manifest)?.map((s) => s.id) || [])]) {
      chapterIndex.dropSource(sid);
    }
  },

  invalidate(id) {
    cache.delete(findRecord(id)?.manifest.id || id);
  },

  async source(id) {
    const rec = findRecord(id);
    if (!rec) throw new Error('Extensión no instalada: ' + id);
    const baseId = rec.manifest.id;
    if (cache.has(baseId)) return pickSource(cache.get(baseId), id, baseId);
    const src = rec.manifest.type === 'module'
      ? await loadModule(rec.code, rec.manifest)
      : buildSelectorSource(rec.manifest, ctx(rec.manifest));

    cache.set(baseId, src);
    return pickSource(src, id, baseId);
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


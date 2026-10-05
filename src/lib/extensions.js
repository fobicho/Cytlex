import { buildSelectorSource } from './selectorSource.js';

const KEY = 'cytlex:extensions:v1';

export const DEFAULT_INDEX_URL = 'https://fobicho.github.io/Cytlex/index.json';


const read = () => {
  try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; }
};
const write = (v) => localStorage.setItem(KEY, JSON.stringify(v));

export const BUILTIN = [
  {
    id: 'leercapitulo',
    name: 'LeerCapitulo',
    lang: 'es',
    version: '0.1',
    type: 'builtin',
    desc: 'Manga en español · fuente integrada',
    icon: 'https://www.google.com/s2/favicons?domain=leercapitulo.co&sz=128',
    url: 'https://leercapitulo.co'
  }
];

function ctx() {
  return {
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

function builtinSource(m) {
  const b = window.cytlex;
  return {
    id: m.id,
    name: m.name,
    catalog: (args) => b.catalog(args),
    detail: (url) => b.detail(url),
    chapter: (url) => b.chapter(url),
    home: () => b.home()
  };
}

async function loadModule(code) {
  const blob = new Blob([code], { type: 'text/javascript' });
  const blobUrl = URL.createObjectURL(blob);
  try {
    const mod = await import(/* @vite-ignore */ blobUrl);
    const factory = mod.default || mod.createSource;
    if (typeof factory !== 'function') {
      throw new Error('La extensión no exporta una función (default o createSource)');
    }
    return await factory(ctx());
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

export const extensions = {
  installed() {
    return read().map((r) => {
      const b = BUILTIN.find((m) => m.id === r.manifest.id);
      return { manifest: b ? { ...r.manifest, ...b } : r.manifest, builtin: !!b };
    });
  },
  isNative(id) {
    return BUILTIN.some((m) => m.id === id);
  },
  manifest(id) {
    const b = BUILTIN.find((m) => m.id === id);
    if (b) return b;
    const rec = read().find((r) => r.manifest.id === id);
    return rec?.manifest || { id, name: id || 'Fuente' };
  },
  isInstalled(id) {
    return read().some((r) => r.manifest.id === id);
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
    return installed
      .map((r) => {
        const remote = repo.find((m) => m.id === r.manifest.id);
        if (!remote || !remote.version) return null;
        const local = r.manifest.version || '0';
        return isNewer(remote.version, local)
          ? { id: r.manifest.id, name: remote.name || r.manifest.name, icon: remote.icon, from: local, to: remote.version }
          : null;
      })
      .filter(Boolean);
  },

  async updateAll(indexUrl, ids) {
    const repo = await extensions.repoIndex(indexUrl);
    const lista = ids || read().map((r) => r.manifest.id);
    const pendientes = new Set(lista);

    const records = read().map((r) => {
      const fresh = repo.find((m) => m.id === r.manifest.id);
      return fresh ? { ...r, manifest: { ...r.manifest, ...fresh } } : r;
    });

    let ok = 0;
    const fallos = [];
    await Promise.all(records.map(async (r) => {
      if (!pendientes.has(r.manifest.id)) return;
      if (r.manifest.type !== 'module' || !r.manifest.main) return;
      try {
        const mainUrl = /^https?:/i.test(r.manifest.main)
          ? r.manifest.main
          : new URL(r.manifest.main, indexUrl).href;
        const code = await ctx().fetchText(mainUrl);
        r.code = code;
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
    const byId = new Map([...repo, ...BUILTIN].map((m) => [m.id, m]));

    const records = read().map((r) => {
      const fresh = byId.get(r.manifest.id);
      if (!fresh) return r;
      return { ...r, manifest: { ...fresh, ...r.manifest } };
    });

    await Promise.all(records.map(async (r) => {
      if (r.manifest.type !== 'module' || !r.manifest.main) return;
      try {
        const mainUrl = /^https?:/i.test(r.manifest.main)
          ? r.manifest.main
          : new URL(r.manifest.main, indexUrl).href;
        r.code = await ctx().fetchText(mainUrl);
        cache.delete(r.manifest.id);
      } catch {}
    }));

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
    return [...repo, ...BUILTIN].filter((m) => m && m.id && !installedIds.has(m.id));
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
    list.push({ manifest, code, installedAt: Date.now() });
    write(list);
    cache.delete(manifest.id);
  },

  async uninstall(id) {
    write(read().filter((r) => r.manifest.id !== id));
    cache.delete(id);
  },

  async source(id) {
    if (cache.has(id)) return cache.get(id);

    let src;
    const builtin = BUILTIN.find((m) => m.id === id);
    if (builtin) {
      src = builtinSource(builtin);
    } else {
      const rec = read().find((r) => r.manifest.id === id);
      if (!rec) throw new Error('Extensión no instalada: ' + id);
      src = rec.manifest.type === 'module'
        ? await loadModule(rec.code)
        : rec.manifest.type === 'builtin'
          ? builtinSource(rec.manifest)
          : buildSelectorSource(rec.manifest, ctx());
    }

    cache.set(id, src);
    return src;
  }
};


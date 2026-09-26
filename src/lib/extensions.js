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
    name: 'leercapitulo.co',
    lang: 'es',
    version: '0.1',
    type: 'builtin',
    desc: 'Manga en español · fuente integrada',
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
    parse: (html) => new DOMParser().parseFromString(html, 'text/html')
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

export const extensions = {
  builtins() {
    return BUILTIN.map((m) => ({ manifest: m, builtin: true }));
  },
  externals() {
    return read().map((r) => ({ manifest: r.manifest, builtin: false }));
  },
  installed() {
    return [...extensions.builtins(), ...extensions.externals()];
  },
  isInstalled(id) {
    return extensions.installed().some((e) => e.manifest.id === id);
  },

  async available(indexUrl) {
    const text = await ctx().fetchText(indexUrl);
    const list = JSON.parse(text);
    if (!Array.isArray(list)) throw new Error('El índice no es un array JSON');
    return list.filter((m) => m && m.id && !extensions.isInstalled(m.id));
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
        : buildSelectorSource(rec.manifest, ctx());
    }

    cache.set(id, src);
    return src;
  }
};

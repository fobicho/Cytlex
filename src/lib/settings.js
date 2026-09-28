import { THEME_IDS, MODE_IDS } from './themes.js';
import { DEFAULT_INDEX_URL } from './extensions.js';

// Ajustes persistentes estilo Mihon (todo local)
const KEY = 'cytlex:settings:v1';

const defaults = {
  theme: 'default', // default | beige
  mode: 'dark', // dark | light
  readerMode: 'vertical', // vertical | paginado
  readerZoom: 100,
  libraryView: 'grid', // grid | list
  sidebarCollapsed: false,
  sourceUrl: 'https://leercapitulo.co',
  extIndexUrl: DEFAULT_INDEX_URL,
  anilistSynopsisLang: 'romaji'
};

function normalize(s) {
  let { theme, mode } = s;
  // Migración desde el esquema antiguo (theme: dark | light | beige)
  if (theme === 'dark') theme = 'default';
  else if (theme === 'light') { theme = 'default'; mode = 'light'; }
  if (!THEME_IDS.includes(theme)) theme = 'default';
  if (!MODE_IDS.includes(mode)) mode = 'dark';
  // El Client ID y el Secret ya no son ajustes: el Client ID va embebido en el
  // proceso principal y AniList usa Implicit Grant.
  const { anilistClientSecret, anilistClientId, ...rest } = s;
  return { ...rest, theme, mode };
}

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...defaults };
    const stored = JSON.parse(raw);
    if (stored.mode === undefined) {
      stored.mode = stored.theme === 'light' || stored.theme === 'beige' ? 'light' : 'dark';
    }
    return normalize({ ...defaults, ...stored });
  } catch {
    return { ...defaults };
  }
}

let cache = read();

export const settings = {
  get() { return { ...cache }; },
  set(patch) {
    cache = normalize({ ...cache, ...patch });
    try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch {}
    // Tema/modo en vivo
    if (patch.theme) document.documentElement.setAttribute('data-theme', cache.theme);
    if (patch.mode) document.documentElement.setAttribute('data-mode', cache.mode);
    window.dispatchEvent(new CustomEvent('cytlex:settings', { detail: { ...cache } }));
    return { ...cache };
  },
  subscribe(fn) {
    const h = (e) => fn(e.detail);
    window.addEventListener('cytlex:settings', h);
    return () => window.removeEventListener('cytlex:settings', h);
  }
};

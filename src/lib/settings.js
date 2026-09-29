import { THEME_IDS, MODE_IDS } from './themes.js';
import { DEFAULT_INDEX_URL } from './extensions.js';

const KEY = 'cytlex:settings:v1';

const defaults = {
  theme: 'default',
  mode: 'dark',
  readerMode: 'vertical',
  readerZoom: 100,
  libraryView: 'grid',
  sidebarCollapsed: false,
  sourceUrl: 'https://leercapitulo.co',
  extIndexUrl: DEFAULT_INDEX_URL,
  anilistSynopsisLang: 'romaji',
  libraryCategory: ''
};

function normalize(s) {
  let { theme, mode } = s;
  if (theme === 'dark') theme = 'default';
  else if (theme === 'light') { theme = 'default'; mode = 'light'; }
  if (!THEME_IDS.includes(theme)) theme = 'default';
  if (!MODE_IDS.includes(mode)) mode = 'dark';
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


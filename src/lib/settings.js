import { THEME_IDS, MODE_IDS } from './themes.js';

const KEY = 'cytlex:settings:v1';

const defaults = {
  theme: 'default',
  mode: 'light',
  readerMode: 'paginado',
  readerZoom: 100,
  readerDoublePage: false,
  libraryView: 'grid',
  libraryCoverSize: 160,
  libraryShowUnread: true,
  chaptersPerRow: 1,
  sidebarCollapsed: false,
  uiScale: 1,
  extIndexUrl: '',
  anilistSynopsisLang: 'romaji',
  anilistCover: false,
  notifyEnabled: false,
  notifyHours: 6,
  notifyBackground: false,
  extUpdateNotify: false,
  notifyBaseline: {},
  tutorialSeen: false,
  donationSeen: false
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
    const applyDom = () => {
      if (patch.theme) document.documentElement.setAttribute('data-theme', cache.theme);
      if (patch.mode) document.documentElement.setAttribute('data-mode', cache.mode);
    };
    applyDom();
    if ((patch.theme || patch.mode) && typeof window !== 'undefined' && window.cytlex?.saveTheme) {
      window.cytlex.saveTheme({ theme: cache.theme, mode: cache.mode });
    }
    window.dispatchEvent(new CustomEvent('cytlex:settings', { detail: { ...cache } }));
    return { ...cache };
  },
  subscribe(fn) {
    const h = (e) => fn(e.detail);
    window.addEventListener('cytlex:settings', h);
    return () => window.removeEventListener('cytlex:settings', h);
  }
};

if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', (e) => {
    document.documentElement.style.setProperty('--vt-x', `${e.clientX}px`);
    document.documentElement.style.setProperty('--vt-y', `${e.clientY}px`);
  }, { passive: true });
}


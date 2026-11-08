import { THEME_IDS, MODE_IDS } from './themes.js';

const KEY = 'cytlex:settings:v1';
export const CONTENT_WARNING_RATINGS = ['SAFE', 'MIXED', 'NSFW'];
export const SIDEBAR_WIDTH = { default: 196, min: 150, max: 360, collapsed: 72 };

export function resolveMode(mode) {
  if (mode !== 'system') return mode;
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

const defaults = {
  theme: 'default',
  mode: 'light',
  readerMode: 'paginado',
  readerZoom: 100,
  readerDoublePage: false,
  libraryView: 'grid',
  coverSize: 160,
  libraryShowUnread: true,
  showAdultExtensions: false,
  adultContentRatings: CONTENT_WARNING_RATINGS,
  chaptersPerRow: 1,
  sidebarCollapsed: false,
  sidebarWidth: SIDEBAR_WIDTH.default,
  extIndexUrl: '',
  anilistSynopsisLang: 'romaji',
  anilistCover: false,
  notifyEnabled: false,
  notifyHours: 12,
  notifyBackground: false,
  extUpdateNotify: false,
  notifyBaseline: {},
  tutorialSeen: false,
  donationSeen: false
};

function normalize(s) {
  let { theme, mode } = s;
  const { showAdultManga, anilistClientSecret, anilistClientId, uiScale, libraryCoverSize, ...rest } = s;
  rest.coverSize = Math.min(Math.max(Math.round(Number(rest.coverSize ?? libraryCoverSize) || 160), 100), 240);
  rest.sidebarWidth = Math.min(Math.max(Math.round(Number(rest.sidebarWidth) || SIDEBAR_WIDTH.default), SIDEBAR_WIDTH.min), SIDEBAR_WIDTH.max);
  rest.adultContentRatings = Array.isArray(rest.adultContentRatings)
    ? [...new Set(rest.adultContentRatings.map((rating) => String(rating).toUpperCase()).filter((rating) => CONTENT_WARNING_RATINGS.includes(rating)))]
    : [...CONTENT_WARNING_RATINGS];
  if (rest.showAdultExtensions === undefined && showAdultManga !== undefined) {
    rest.showAdultExtensions = showAdultManga;
  }
  if (theme === 'dark') theme = 'default';
  else if (theme === 'light') { theme = 'default'; mode = 'light'; }
  if (!THEME_IDS.includes(theme)) theme = 'default';
  if (!MODE_IDS.includes(mode)) mode = 'dark';
  return { ...rest, theme, mode };
}

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...defaults };
    const stored = JSON.parse(raw);
    if (stored.coverSize === undefined && stored.libraryCoverSize !== undefined) {
      stored.coverSize = stored.libraryCoverSize;
    }
    delete stored.libraryCoverSize;
    if (stored.showAdultExtensions === undefined && stored.showAdultManga !== undefined) {
      stored.showAdultExtensions = stored.showAdultManga;
    }
    delete stored.showAdultManga;
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
      if (patch.theme || patch.mode) document.documentElement.setAttribute('data-mode', resolveMode(cache.mode));
    };
    applyDom();
    if ((patch.theme || patch.mode) && typeof window !== 'undefined' && window.cytlex?.saveTheme) {
      window.cytlex.saveTheme({ theme: cache.theme, mode: cache.mode, effectiveMode: resolveMode(cache.mode) });
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

  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
    if (cache.mode !== 'system') return;
    const mode = resolveMode(cache.mode);
    document.documentElement.setAttribute('data-mode', mode);
    window.cytlex?.saveTheme?.({ theme: cache.theme, mode: cache.mode, effectiveMode: mode });
    window.dispatchEvent(new CustomEvent('cytlex:settings', { detail: { ...cache } }));
  });
}


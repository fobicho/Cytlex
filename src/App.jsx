import { useEffect, useLayoutEffect, useState, useCallback, useRef, Component } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import Sidebar from './components/Sidebar.jsx';
import BrowserMobileNav from './components/BrowserMobileNav.jsx';
import TitleBar from './components/TitleBar.jsx';
import Library from './pages/Library.jsx';
import Catalog from './pages/Catalog.jsx';
import Results from './pages/Results.jsx';
import Detail from './pages/Detail.jsx';
import Reader from './pages/Reader.jsx';
import Settings from './pages/Settings.jsx';
import Tracking from './pages/Tracking.jsx';
import { resolveMode, settings } from './lib/settings.js';
import { extensions } from './lib/extensions.js';
import { lastSearch, resultsScroll, catalogScroll, sourceCatalogState } from './lib/searchState.js';
import { useToast } from './components/Toast.jsx';
import { appWindow } from './lib/appWindow.js';
import { px, useScale } from './lib/useScale.js';
import { Search } from 'lucide-react';
import { Input } from './components/ui/input.jsx';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useI18n } from './lib/i18n.js';

function quickSearchPosition(x, y, scale = 1) {
  const width = Math.min(420 * scale, Math.max(0, window.innerWidth - 32 * scale));
  const halfWidth = width / 2;
  return {
    x: Math.max(halfWidth + 16 * scale, Math.min(x, window.innerWidth - halfWidth - 16 * scale)),
    y: Math.max(96 * scale, Math.min(y - 8 * scale, window.innerHeight - 16 * scale))
  };
}

class PageBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="p-6">
        <p className="text-sm text-destructive">
          {String(this.state.error?.message || this.state.error)}
        </p>
      </div>
    );
  }
}

export const RESET_PAGE_EVENT = 'cytlex:reset-page';
const DETAIL_ORIGINS = ['biblioteca', 'explorar', 'fuentes', 'resultados'];

function detailOrigin(location) {
  const from = new URLSearchParams(location.search).get('from');
  return DETAIL_ORIGINS.includes(from) ? from : 'biblioteca';
}

function useResetPage(onReset) {
  useEffect(() => {
    window.addEventListener(RESET_PAGE_EVENT, onReset);
    return () => window.removeEventListener(RESET_PAGE_EVENT, onReset);
  }, [onReset]);
}

export default function App({ tutorialMode = false }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [theme, setTheme] = useState(() => settings.get().theme);
  const [mode, setMode] = useState(() => resolveMode(settings.get().mode));
  const [isFullscreen, setIsFullscreen] = useState(false);
  const scale = useScale();
  const [resetTick, setResetTick] = useState(0);
  const [retainedDetailLocations, setRetainedDetailLocations] = useState({});
  const [retainedExploreLocation, setRetainedExploreLocation] = useState(null);
  const [hasVisitedLibrary, setHasVisitedLibrary] = useState(() => window.location.hash.includes('/biblioteca'));
  const [quickSearchOpen, setQuickSearchOpen] = useState(false);
  const [quickSearchQuery, setQuickSearchQuery] = useState('');
  const [quickSearchPoint, setQuickSearchPoint] = useState(() => quickSearchPosition(window.innerWidth / 2, window.innerHeight / 2, scale));
  const quickSearchInput = useRef(null);
  const quickSearchPanel = useRef(null);
  const pointerPosition = useRef({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
  const reduceMotion = useReducedMotion();
  const location = useLocation();
  const navigate = useNavigate();
  const previousLocation = useRef(location);
  const isReader = location.pathname.startsWith('/leer');
  const isElectronApp = typeof window !== 'undefined' && !!window.cytlex;
  const isMangaPage = location.pathname.startsWith('/manga');
  const isResultsPage = location.pathname === '/resultados';
  const isMigrationSearchPage = isMangaPage && new URLSearchParams(location.search).get('migrationSearch') === '1';
  const mainRef = useRef(null);
  const [detailScrollbarWidth, setDetailScrollbarWidth] = useState(0);
  useLayoutEffect(() => {
    const main = mainRef.current;
    if (!isMangaPage || isMigrationSearchPage || !main) return undefined;
    const measure = () => setDetailScrollbarWidth(main.offsetWidth - main.clientWidth);
    const observer = new ResizeObserver(measure);
    observer.observe(main);
    const detail = main.querySelector('[data-active-detail="true"]');
    if (detail) observer.observe(detail);
    measure();
    return () => observer.disconnect();
  }, [isMangaPage, isMigrationSearchPage, location.pathname, location.search]);
  const isExplorePage = location.pathname === '/explorar';
  const isSettingsPage = location.pathname === '/ajustes';
  const currentDetailOrigin = isMangaPage ? detailOrigin(location) : '';
  const detailActivityRefs = useRef(Object.fromEntries(DETAIL_ORIGINS.map((origin) => [origin, { current: false }])));
  DETAIL_ORIGINS.forEach((origin) => {
    detailActivityRefs.current[origin].current = isMangaPage && currentDetailOrigin === origin;
  });
  useEffect(() => {
    if (!isMangaPage) return;
    setRetainedDetailLocations((current) => current[currentDetailOrigin] === location
      ? current
      : { ...current, [currentDetailOrigin]: location });
  }, [isMangaPage, currentDetailOrigin, location.pathname, location.search]);
  useEffect(() => {
    if (isExplorePage) setRetainedExploreLocation(location);
  }, [isExplorePage, location.pathname, location.search]);
  const catalogLocation = isExplorePage ? location : retainedExploreLocation;
  const isLibraryPage = location.pathname === '/biblioteca';
  const isLibraryDetail = isMangaPage && new URLSearchParams(location.search).get('from') === 'biblioteca';
  const tutorialPreview = tutorialMode;

  useLayoutEffect(() => {
    const previous = previousLocation.current;
    previousLocation.current = location;
    const tab = new URLSearchParams(location.search).get('tab');
    if (previous.pathname !== '/manga' || !isExplorePage || tab !== 'fuentes') return undefined;
    const main = document.querySelector('main');
    if (!main) return undefined;
    const savedScrollTop = sourceCatalogState.getScrollTop();
    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        main.scrollTop = Math.min(savedScrollTop, Math.max(0, main.scrollHeight - main.clientHeight));
      });
    });
    return () => {
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
    };
  }, [location.pathname, location.search, isExplorePage]);
  const shouldMountLibrary = hasVisitedLibrary || isLibraryPage || isLibraryDetail;
  useEffect(() => {
    if (isLibraryPage || isLibraryDetail) setHasVisitedLibrary(true);
  }, [isLibraryPage, isLibraryDetail]);
  const resetPage = useCallback(() => {
    setResetTick((t) => t + 1);
    lastSearch.q = '';
    lastSearch.genre = '';
    lastSearch.results = null;
    resultsScroll.clear();
    catalogScroll.clear();
    const main = document.querySelector('main');
    if (main) main.scrollTop = 0;
  }, []);
  useResetPage(resetPage);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.setAttribute('data-mode', mode);
  }, [theme, mode]);

  useEffect(
    () =>
      settings.subscribe((s) => {
        setTheme(s.theme);
        setMode(resolveMode(s.mode));
      }),
    []
  );

  useEffect(() => {
    appWindow.isFullscreen().then(setIsFullscreen);
  }, []);

  useEffect(() => {
    if (!quickSearchOpen) return undefined;
    const frame = requestAnimationFrame(() => quickSearchInput.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [quickSearchOpen]);

  useEffect(() => {
    if (!quickSearchOpen) return undefined;
    const closeOnOutsidePointer = (event) => {
      if (!quickSearchPanel.current?.contains(event.target)) setQuickSearchOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer, true);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer, true);
  }, [quickSearchOpen]);

  useEffect(() => {
    const onMove = (e) => {
      pointerPosition.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'F11') {
        e.preventDefault();
        appWindow.toggleFullscreen().then(setIsFullscreen);
        return;
      }

      if (tutorialMode || isReader) return;

      if (quickSearchOpen && e.key === 'Escape') {
        e.preventDefault();
        setQuickSearchOpen(false);
        return;
      }

      if (e.ctrlKey && !e.altKey && !e.metaKey && e.code === 'Space') {
        e.preventDefault();
        if (quickSearchOpen) {
          setQuickSearchOpen(false);
        } else if (extensions.installed().length > 0) {
          setQuickSearchQuery('');
          setQuickSearchPoint(quickSearchPosition(pointerPosition.current.x, pointerPosition.current.y, scale));
          setQuickSearchOpen(true);
        }
        return;
      }

    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isReader, location.pathname, navigate, quickSearchOpen, scale, tutorialMode]);

  const submitQuickSearch = (e) => {
    e.preventDefault();
    const query = quickSearchQuery.trim();
    if (!query || !extensions.installed().length) return;
    const params = new URLSearchParams({ tab: 'mangas', q: query, quick: String(Date.now()) });
    setQuickSearchOpen(false);
    navigate(`/explorar?${params}`);
  };

  return (
    <div className={`app-shell flex flex-col overflow-hidden${isElectronApp ? '' : ' app-shell--web'}`}>
      {isElectronApp && !isFullscreen && <div inert={tutorialMode}><TitleBar /></div>}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {!isReader && <div className={isElectronApp ? 'flex shrink-0' : 'hidden shrink-0 md:flex'}><Sidebar tutorialNavOnly={tutorialMode} /></div>}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <main
            ref={mainRef}
            inert={tutorialMode}
            className={`min-h-0 min-w-0 flex-1 overflow-y-auto [overflow-anchor:none]${isMangaPage && !isMigrationSearchPage ? ' detail-main [scrollbar-gutter:stable]' : ''}${isElectronApp && isLibraryPage ? ' no-scrollbar' : ''}${isElectronApp && isMigrationSearchPage ? ' browser-main--subroutes' : ''}${isReader || isSettingsPage || isExplorePage || isLibraryPage || isMangaPage ? '' : ' [scrollbar-gutter:stable]'}${isElectronApp ? '' : ` browser-main${isReader ? ' browser-main--reader' : ''}${isSettingsPage ? ' browser-main--settings' : ''}${isExplorePage || isLibraryPage || isMigrationSearchPage ? ' browser-main--subroutes' : ''}`}`}
            style={isReader
              ? { display: 'flex', flexDirection: 'column', overflow: 'hidden' }
              : isMigrationSearchPage
              ? { padding: 0, overflowY: 'hidden', '--web-page-padding': `${Math.max(14, Math.round(24 * scale))}px` }
              : isElectronApp
              ? { padding: `${isMangaPage || isResultsPage ? Math.max(12, Math.round(16 * scale)) : Math.max(16, Math.round(24 * scale))}px`, ...((isMangaPage || isResultsPage) ? { paddingTop: 0 } : {}), ...(isMangaPage ? { paddingRight: `${Math.max(0, Math.max(12, Math.round(16 * scale)) - detailScrollbarWidth)}px`, '--detail-right-padding': `${Math.max(0, Math.max(12, Math.round(16 * scale)) - detailScrollbarWidth)}px` } : {}) }
              : isSettingsPage || isExplorePage || isLibraryPage
                ? {
                    padding: 0,
                    overflowY: 'hidden',
                    ...(isExplorePage || isLibraryPage
                      ? { '--web-page-padding': `${Math.max(14, Math.round(24 * scale))}px` }
                      : {})
                  }
              : {
                  '--web-page-padding': `${isMangaPage || isResultsPage ? Math.max(12, Math.round(16 * scale)) : Math.max(14, Math.round(24 * scale))}px`,
                  ...((isMangaPage || isResultsPage) ? { paddingTop: 0 } : {}),
                  ...(isMangaPage ? { paddingRight: `${Math.max(0, Math.max(12, Math.round(16 * scale)) - detailScrollbarWidth)}px`, '--detail-right-padding': `${Math.max(0, Math.max(12, Math.round(16 * scale)) - detailScrollbarWidth)}px` } : {}),
                }}
          >
            <PageBoundary>
              {catalogLocation && (
                <div className={isExplorePage ? 'flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden' : 'hidden'} aria-hidden={!isExplorePage} inert={!isExplorePage}>
                  <Catalog key={`cat-${resetTick}`} locationOverride={catalogLocation} tutorialPreview={tutorialPreview} active={isExplorePage} />
                </div>
              )}
              {DETAIL_ORIGINS.map((origin) => {
                const active = isMangaPage && currentDetailOrigin === origin;
                const detailLocation = active ? location : retainedDetailLocations[origin];
                if (!detailLocation) return null;
                return (
                  <div key={origin} data-active-detail={active ? 'true' : undefined} className={active ? (isMigrationSearchPage ? 'flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden' : '') : 'hidden'} aria-hidden={!active} inert={!active}>
                    <Detail
                      key={`${detailLocation.pathname}${detailLocation.search}`}
                      locationOverride={detailLocation}
                      active={active}
                      activeRef={detailActivityRefs.current[origin]}
                    />
                  </div>
                );
              })}
              {shouldMountLibrary && (
                <div className={isLibraryPage ? 'flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden' : 'hidden'} aria-hidden={!isLibraryPage} inert={!isLibraryPage}>
                  <Library key={`lib-${resetTick}`} active={isLibraryPage} tutorialPreview={tutorialPreview} />
                </div>
              )}
              <Routes>
                <Route path="/" element={<Navigate to="/biblioteca" replace />} />
                <Route path="/biblioteca" element={null} />
                <Route path="/explorar" element={null} />
                <Route path="/resultados" element={<Results />} />
                <Route path="/catalogo" element={<Navigate to="/explorar" replace />} />
                <Route
                  path="/ajustes"
                  element={<Settings key={`set-${resetTick}`} tutorialPreview={tutorialPreview} />}
                />
                <Route path="/seguimiento" element={<Tracking />} />
                <Route path="/manga/*" element={null} />
                <Route path="/leer/*" element={<Reader />} />
              </Routes>
            </PageBoundary>
          </main>
        </div>
      </div>
      {!tutorialMode && !isElectronApp && !isReader && <BrowserMobileNav />}
      <AnimatePresence>
        {quickSearchOpen && (
          <div
            className="fixed left-0 top-0 z-[100] pointer-events-none"
            style={{ transform: `translate3d(${quickSearchPoint.x}px, ${quickSearchPoint.y}px, 0)` }}
          >
            <div style={{ transform: 'translate(-50%, calc(-100% - 8px))' }}>
              <motion.div
                ref={quickSearchPanel}
                role="search"
                aria-label={t('Búsqueda rápida de mangas')}
                initial={{ opacity: 0, transform: reduceMotion ? 'scale(1)' : 'scale(.94)' }}
                animate={{ opacity: 1, transform: 'scale(1)' }}
                exit={{ opacity: 0, transform: reduceMotion ? 'scale(1)' : 'scale(.94)' }}
                transition={reduceMotion
                  ? { duration: 0.1 }
                  : { duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
                className="pointer-events-auto rounded-xl border border-border bg-card p-1.5 shadow-lg"
                style={{ transformOrigin: 'center', width: `min(${px(420, scale, 336)}, calc(100vw - ${px(32, scale, 26)}))` }}
              >
                <form onSubmit={submitQuickSearch} className="flex items-center gap-3 pl-1">
                  <Search className="shrink-0 text-muted-foreground" aria-hidden="true" style={{ width: px(18, scale, 15), height: px(18, scale, 15) }} />
                  <Input
                    ref={quickSearchInput}
                    value={quickSearchQuery}
                    onChange={(e) => setQuickSearchQuery(e.target.value)}
                    placeholder={t('Buscar un manga...')}
                    aria-label={t('Buscar un manga')}
                    autoComplete="off"
                    className="h-7 min-w-0 border-0 bg-transparent px-0 py-1 shadow-none focus:border-0"
                  />
                </form>
              </motion.div>
            </div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}


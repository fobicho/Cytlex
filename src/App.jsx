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
import { startNotifier, onNotifyClick, checkLibrary } from './lib/notify.js';
import { announceExtUpdates } from './lib/extUpdates.js';
import { useToast } from './components/Toast.jsx';
import { appWindow } from './lib/appWindow.js';
import { px, useScale } from './lib/useScale.js';
import { ArrowUpCircle, Search } from 'lucide-react';
import { Input } from './components/ui/input.jsx';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';

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
export const GO_EXTENSIONS_EVENT = 'cytlex:go-extensions';
const DETAIL_ORIGINS = ['biblioteca', 'explorar', 'fuentes', 'resultados'];

function detailOrigin(location) {
  const from = new URLSearchParams(location.search).get('from');
  return DETAIL_ORIGINS.includes(from) ? from : 'biblioteca';
}

export function goToExtensions() {
  window.location.hash = '#/explorar?tab=extensiones';
  window.dispatchEvent(new CustomEvent(GO_EXTENSIONS_EVENT));
}

function useResetPage(onReset) {
  useEffect(() => {
    window.addEventListener(RESET_PAGE_EVENT, onReset);
    return () => window.removeEventListener(RESET_PAGE_EVENT, onReset);
  }, [onReset]);
}

export default function App({ isVisible = true, tutorialMode = false }) {
  const { toast } = useToast();
  const [theme, setTheme] = useState(() => settings.get().theme);
  const [mode, setMode] = useState(() => resolveMode(settings.get().mode));
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [extensionMetadataRevision, setExtensionMetadataRevision] = useState(0);
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
  const initialLibraryCheck = useRef(false);
  const location = useLocation();
  const navigate = useNavigate();
  const previousLocation = useRef(location);
  const isReader = location.pathname.startsWith('/leer');
  const isElectronApp = typeof window !== 'undefined' && !!window.cytlex;
  const isMangaPage = location.pathname.startsWith('/manga');
  const isExplorePage = location.pathname === '/explorar';
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
    const indexUrl = (settings.get().extIndexUrl || '').trim();
    if (!indexUrl || !extensions.installed().length) return;
    extensions.sync(indexUrl).then(() => setExtensionMetadataRevision((revision) => revision + 1)).catch(() => {});
  }, []);

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

  useEffect(() => startNotifier(), []);

  useEffect(() => {
    if (!isVisible || initialLibraryCheck.current || !settings.get().notifyEnabled) return;
    initialLibraryCheck.current = true;
    let cancelled = false;
    Promise.resolve(window.cytlex?.isBackground?.()).then((background) => {
      if (background || cancelled) return;
      checkLibrary({ silent: true, force: true, notifyFound: false }).then((found) => {
        if (cancelled || !found.length) return;
        const chapterCount = found.reduce((sum, item) => sum + item.count, 0);
        toast({
          title: found.length === 1 ? '1 obra actualizada' : `${found.length} obras actualizadas`,
          description: `${chapterCount} ${chapterCount === 1 ? 'capítulo nuevo disponible' : 'capítulos nuevos disponibles'}.`,
          variant: 'info'
        });
      }).catch(() => {});
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [isVisible, toast]);

  useEffect(() => {
    const t = setTimeout(() => {
      if (!settings.get().extUpdateNotify) return;
      announceExtUpdates(({ updates, count }) => {
        if (!settings.get().extUpdateNotify) return;
        const description = count === 1
          ? `Ya puedes instalar la versión ${updates[0].to}.`
          : `${updates.slice(0, 3).map((update) => `${update.name} ${update.to}`).join(' · ')}${count > 3 ? ` y ${count - 3} más` : ''}`;
        toast({
          icon: ArrowUpCircle,
          title: count === 1 ? `${updates[0].name} tiene una actualización` : `${count} extensiones tienen actualizaciones`,
          description,
          variant: 'info',
          duration: 9000,
          action: { label: 'Ver extensiones', onClick: goToExtensions }
        });
      });
    }, 2600);
    return () => clearTimeout(t);
  }, []);

  useEffect(
    () =>
      onNotifyClick((payload) => {
        if (payload?.tipo === 'extensiones') {
          goToExtensions();
          return;
        }
        if (payload?.tipo === 'biblioteca') {
          window.location.hash = '#/biblioteca';
          return;
        }
        const url = payload?.url;
        if (!url) return;
        window.location.hash = `#/manga?u=${encodeURIComponent(url)}&s=${encodeURIComponent(payload.sourceId || 'leercapitulo')}&from=biblioteca`;
      }),
    []
  );

  const toggleFullscreen = () => {
    appWindow.toggleFullscreen().then(setIsFullscreen);
  };

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
    <div className={`app-shell flex flex-col overflow-hidden${isElectronApp ? '' : ' app-shell--web'}`} data-extension-metadata-revision={extensionMetadataRevision}>
      {isElectronApp && !isFullscreen && <div inert={tutorialMode}><TitleBar /></div>}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {!isReader && <div className={isElectronApp ? 'flex shrink-0' : 'hidden shrink-0 md:flex'}><Sidebar tutorialNavOnly={tutorialMode} /></div>}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <main
            inert={tutorialMode}
            className={`min-h-0 flex-1 overflow-y-auto [overflow-anchor:none]${isReader ? '' : ' [scrollbar-gutter:stable]'}${isElectronApp ? '' : ` browser-main${isReader ? ' browser-main--reader' : ''}`}`}
            style={isReader ? undefined : isElectronApp
              ? { padding: `${Math.max(16, Math.round(24 * scale))}px` }
              : { '--web-page-padding': `${Math.max(14, Math.round(24 * scale))}px` }}
          >
            <PageBoundary>
              {catalogLocation && (
                <div className={isExplorePage ? '' : 'hidden'} aria-hidden={!isExplorePage} inert={!isExplorePage}>
                  <Catalog key={`cat-${resetTick}`} locationOverride={catalogLocation} tutorialPreview={tutorialMode} active={isExplorePage} />
                </div>
              )}
              {DETAIL_ORIGINS.map((origin) => {
                const active = isMangaPage && currentDetailOrigin === origin;
                const detailLocation = active ? location : retainedDetailLocations[origin];
                if (!detailLocation) return null;
                return (
                  <div key={origin} className={active ? '' : 'hidden'} aria-hidden={!active} inert={!active}>
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
                <div className={isLibraryPage ? '' : 'hidden'} aria-hidden={!isLibraryPage} inert={!isLibraryPage}>
                  <Library key={`lib-${resetTick}`} active={isLibraryPage} />
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
                  element={<Settings key={`set-${resetTick}`} tutorialPreview={tutorialMode} />}
                />
                <Route path="/seguimiento" element={<Tracking />} />
                <Route path="/manga/*" element={null} />
                <Route path="/leer/*" element={<Reader isFullscreen={isFullscreen} onToggleFullscreen={toggleFullscreen} />} />
              </Routes>
            </PageBoundary>
          </main>
        </div>
      </div>
      {!isElectronApp && !isReader && <BrowserMobileNav />}
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
                aria-label="Búsqueda rápida de mangas"
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
                    placeholder="Buscar un manga..."
                    aria-label="Buscar un manga"
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


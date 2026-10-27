import { useEffect, useState, useCallback, useRef, Component } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import Sidebar from './components/Sidebar.jsx';
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
import { lastSearch, resultsScroll, catalogScroll } from './lib/searchState.js';
import { startNotifier, onNotifyClick, checkLibrary } from './lib/notify.js';
import { announceExtUpdates } from './lib/extUpdates.js';
import { useToast } from './components/Toast.jsx';
import { appWindow } from './lib/appWindow.js';
import { px, useScale } from './lib/useScale.js';
import { ArrowUpCircle, Search } from 'lucide-react';
import { Input } from './components/ui/input.jsx';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';

function quickSearchPosition(x, y) {
  const width = Math.min(420, Math.max(0, window.innerWidth - 32));
  const halfWidth = width / 2;
  return {
    x: Math.max(halfWidth + 16, Math.min(x, window.innerWidth - halfWidth - 16)),
    y: Math.max(96, Math.min(y - 8, window.innerHeight - 16))
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
  const [quickSearchOpen, setQuickSearchOpen] = useState(false);
  const [quickSearchQuery, setQuickSearchQuery] = useState('');
  const [quickSearchPoint, setQuickSearchPoint] = useState(() => quickSearchPosition(window.innerWidth / 2, window.innerHeight / 2));
  const quickSearchInput = useRef(null);
  const pointerPosition = useRef({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
  const reduceMotion = useReducedMotion();
  const initialLibraryCheck = useRef(false);
  const location = useLocation();
  const navigate = useNavigate();
  const isReader = location.pathname.startsWith('/leer');
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
          setQuickSearchPoint(quickSearchPosition(pointerPosition.current.x, pointerPosition.current.y));
          setQuickSearchOpen(true);
        }
        return;
      }

    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isReader, location.pathname, navigate, quickSearchOpen, tutorialMode]);

  const submitQuickSearch = (e) => {
    e.preventDefault();
    const query = quickSearchQuery.trim();
    if (!query || !extensions.installed().length) return;
    const params = new URLSearchParams({ tab: 'mangas', q: query, quick: String(Date.now()) });
    setQuickSearchOpen(false);
    navigate(`/explorar?${params}`);
  };

  return (
    <div className="flex flex-col h-screen overflow-hidden" data-extension-metadata-revision={extensionMetadataRevision}>
      {!isFullscreen && <div inert={tutorialMode}><TitleBar /></div>}
      <div className="flex flex-1 overflow-hidden">
        {!isReader && <Sidebar tutorialNavOnly={tutorialMode} />}
        <div className="flex-1 flex flex-col overflow-hidden">
          <main
            inert={tutorialMode}
            className={isReader ? 'min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable] [overflow-anchor:none]' : 'flex-1 overflow-y-auto [scrollbar-gutter:stable] [overflow-anchor:none]'}
            style={isReader ? undefined : { padding: `${Math.max(16, Math.round(24 * scale))}px` }}
          >
            <PageBoundary>
              <Routes>
                <Route path="/" element={<Navigate to="/biblioteca" replace />} />
                <Route path="/biblioteca" element={<Library key={`lib-${resetTick}`} />} />
                <Route path="/explorar" element={<Catalog key={`cat-${resetTick}`} tutorialPreview={tutorialMode} />} />
                <Route path="/resultados" element={<Results />} />
                <Route path="/catalogo" element={<Navigate to="/explorar" replace />} />
                <Route
                  path="/ajustes"
                  element={<Settings key={`set-${resetTick}`} tutorialPreview={tutorialMode} />}
                />
                <Route path="/seguimiento" element={<Tracking />} />
                <Route path="/manga/*" element={<Detail />} />
                <Route path="/leer/*" element={<Reader isFullscreen={isFullscreen} onToggleFullscreen={toggleFullscreen} />} />
              </Routes>
            </PageBoundary>
          </main>
        </div>
      </div>
      <AnimatePresence>
        {quickSearchOpen && (
          <div
            className="fixed left-0 top-0 z-[100] pointer-events-none"
            style={{ transform: `translate3d(${quickSearchPoint.x}px, ${quickSearchPoint.y}px, 0)` }}
          >
            <div style={{ transform: 'translate(-50%, calc(-100% - 8px))' }}>
              <motion.div
                role="search"
                aria-label="Búsqueda rápida de mangas"
                initial={{ opacity: 0, transform: reduceMotion ? 'scale(1)' : 'scale(.94)' }}
                animate={{ opacity: 1, transform: 'scale(1)' }}
                exit={{ opacity: 0, transform: reduceMotion ? 'scale(1)' : 'scale(.94)' }}
                transition={reduceMotion
                  ? { duration: 0.1 }
                  : { duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
                className="pointer-events-auto w-[min(420px,calc(100vw-32px))] rounded-xl border border-border bg-card p-1.5 shadow-lg"
                style={{ transformOrigin: 'center' }}
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


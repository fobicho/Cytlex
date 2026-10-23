import { useEffect, useState, useCallback, useRef, Component } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
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
import { useScale } from './lib/useScale.js';
import { ArrowUpCircle } from 'lucide-react';

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

export default function App({ isVisible = true }) {
  const { toast } = useToast();
  const [theme, setTheme] = useState(() => settings.get().theme);
  const [mode, setMode] = useState(() => resolveMode(settings.get().mode));
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [extensionMetadataRevision, setExtensionMetadataRevision] = useState(0);
  const scale = useScale();
  const [resetTick, setResetTick] = useState(0);
  const initialLibraryCheck = useRef(false);
  const location = useLocation();
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
      announceExtUpdates(({ updates, count }) => {
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
    const onKey = (e) => {
      if (e.key === 'F11') {
        e.preventDefault();
        appWindow.toggleFullscreen().then(setIsFullscreen);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="flex flex-col h-screen overflow-hidden" data-extension-metadata-revision={extensionMetadataRevision}>
      {!isFullscreen && <TitleBar />}
      <div className="flex flex-1 overflow-hidden">
        {!isReader && <Sidebar />}
        <div className="flex-1 flex flex-col overflow-hidden">
          <main
            className={isReader ? 'min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable] [overflow-anchor:none]' : 'flex-1 overflow-y-auto [scrollbar-gutter:stable] [overflow-anchor:none]'}
            style={isReader ? undefined : { padding: `${Math.max(16, Math.round(24 * scale))}px` }}
          >
            <PageBoundary>
              <Routes>
                <Route path="/" element={<Navigate to="/biblioteca" replace />} />
                <Route path="/biblioteca" element={<Library key={`lib-${resetTick}`} />} />
                <Route path="/explorar" element={<Catalog key={`cat-${resetTick}`} />} />
                <Route path="/resultados" element={<Results />} />
                <Route path="/catalogo" element={<Navigate to="/explorar" replace />} />
                <Route
                  path="/ajustes"
                  element={<Settings key={`set-${resetTick}`} isFullscreen={isFullscreen} onToggleFullscreen={toggleFullscreen} />}
                />
                <Route path="/seguimiento" element={<Tracking />} />
                <Route path="/manga/*" element={<Detail />} />
                <Route path="/leer/*" element={<Reader isFullscreen={isFullscreen} onToggleFullscreen={toggleFullscreen} />} />
              </Routes>
            </PageBoundary>
          </main>
        </div>
      </div>
    </div>
  );
}


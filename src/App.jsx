import { useEffect, useState, useCallback, Component } from 'react';
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
import { settings } from './lib/settings.js';
import { lastSearch } from './lib/searchState.js';
import { appWindow } from './lib/appWindow.js';

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

function useResetPage(onReset) {
  useEffect(() => {
    window.addEventListener(RESET_PAGE_EVENT, onReset);
    return () => window.removeEventListener(RESET_PAGE_EVENT, onReset);
  }, [onReset]);
}

export default function App() {
  const [theme, setTheme] = useState(() => settings.get().theme);
  const [mode, setMode] = useState(() => settings.get().mode);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [resetTick, setResetTick] = useState(0);
  const location = useLocation();
  const isReader = location.pathname.startsWith('/leer');
  const resetPage = useCallback(() => {
    setResetTick((t) => t + 1);
    lastSearch.q = '';
    lastSearch.genre = '';
    lastSearch.results = null;
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
        setMode(s.mode);
      }),
    []
  );

  useEffect(() => {
    appWindow.isFullscreen().then(setIsFullscreen);
  }, []);

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
    <div className="flex flex-col h-screen overflow-hidden">
      {!isFullscreen && <TitleBar />}
      <div className="flex flex-1 overflow-hidden">
        {!isReader && <Sidebar />}
        <div className="flex-1 flex flex-col overflow-hidden">
          <main className={isReader ? 'flex-1 overflow-y-auto [scrollbar-gutter:stable] [overflow-anchor:none]' : 'flex-1 overflow-y-auto [scrollbar-gutter:stable] [overflow-anchor:none] p-6 xl:p-7'}>
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


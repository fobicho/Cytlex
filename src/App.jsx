import { useEffect, useState } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Sidebar from './components/Sidebar.jsx';
import TitleBar from './components/TitleBar.jsx';
import Library from './pages/Library.jsx';
import Catalog from './pages/Catalog.jsx';
import Results from './pages/Results.jsx';
import Detail from './pages/Detail.jsx';
import Reader from './pages/Reader.jsx';
import Settings from './pages/Settings.jsx';
import { settings } from './lib/settings.js';
import { appWindow } from './lib/appWindow.js';

export default function App() {
  const [theme, setTheme] = useState(() => settings.get().theme);
  const [mode, setMode] = useState(() => settings.get().mode);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const location = useLocation();
  const isReader = location.pathname.startsWith('/leer');

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
          <main className={isReader ? 'flex-1 overflow-y-auto [scrollbar-gutter:stable]' : 'flex-1 overflow-y-auto [scrollbar-gutter:stable] p-6 xl:p-7'}>
            <Routes>
              <Route path="/" element={<Navigate to="/biblioteca" replace />} />
              <Route path="/biblioteca" element={<Library />} />
              <Route path="/explorar" element={<Catalog />} />
              <Route path="/resultados" element={<Results />} />
              <Route path="/catalogo" element={<Navigate to="/explorar" replace />} />
              <Route
                path="/ajustes"
                element={<Settings isFullscreen={isFullscreen} onToggleFullscreen={toggleFullscreen} />}
              />
              <Route path="/manga/*" element={<Detail />} />
              <Route path="/leer/*" element={<Reader isFullscreen={isFullscreen} onToggleFullscreen={toggleFullscreen} />} />
            </Routes>
          </main>
        </div>
      </div>
    </div>
  );
}

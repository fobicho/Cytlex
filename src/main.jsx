import React, { useState, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App.jsx';
import Splash from './components/Splash.jsx';
import Onboarding from './components/Onboarding.jsx';
import { ToastProvider } from './components/Toast.jsx';
import { migrateLegacyStorage } from './lib/migrate.js';
import { resolveMode, settings } from './lib/settings.js';
import './index.css';

migrateLegacyStorage();

const boot = settings.get();
document.documentElement.setAttribute('data-theme', boot.theme);
document.documentElement.setAttribute('data-mode', resolveMode(boot.mode));
if (window.cytlex?.saveTheme) window.cytlex.saveTheme({ theme: boot.theme, mode: boot.mode, effectiveMode: resolveMode(boot.mode) });

function Root() {
  const [splashDone, setSplashDone] = useState(false);
  const [splashExiting, setSplashExiting] = useState(false);
  const [showTutorial, setShowTutorial] = useState(() => !settings.get().tutorialSeen);
  const [appVisible, setAppVisible] = useState(false);
  const handleSplashDone = useCallback(() => {
    setSplashDone(true);
    if (settings.get().tutorialSeen) setAppVisible(true);
  }, []);
  const handleSplashExitStart = useCallback(() => {
    setSplashExiting(true);
    if (settings.get().tutorialSeen) setAppVisible(true);
  }, []);
  const handleTutorialDone = useCallback(() => { setAppVisible(true); setShowTutorial(false); }, []);
  const handleTutorialExitStart = useCallback(() => setAppVisible(true), []);
  return (
    <HashRouter>
      <ToastProvider>
        <div style={{ visibility: appVisible ? 'visible' : 'hidden' }}>
          <App isVisible={appVisible} />
        </div>
        {!splashDone && <Splash onDone={handleSplashDone} onExitStart={handleSplashExitStart} />}
        {showTutorial && (splashExiting || splashDone) && (
          <Onboarding
            onDone={handleTutorialDone}
            onExitStart={handleTutorialExitStart}
            onRevealApp={() => setAppVisible(true)}
            onHideApp={() => {}}
            enteringWithSplash={!splashDone}
          />
        )}
      </ToastProvider>
    </HashRouter>
  );
}

createRoot(document.getElementById('root')).render(<Root />);

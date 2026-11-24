import React, { useState, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { motion } from 'framer-motion';
import { HashRouter } from 'react-router-dom';
import App from './App.jsx';
import Splash from './components/Splash.jsx';
import Onboarding from './components/Onboarding.jsx';
import { ToastProvider } from './components/Toast.jsx';
import { migrateLegacyStorage } from './lib/migrate.js';
import { resolveMode, settings } from './lib/settings.js';
import { consumeBrowserOAuthCallback } from './lib/session.js';
import './index.css';

consumeBrowserOAuthCallback();
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
  const [appMounted, setAppMounted] = useState(false);
  const revealApp = useCallback(() => {
    setAppMounted(true);
    setAppVisible(true);
  }, []);
  const hideApp = useCallback(() => setAppVisible(false), []);
  const handleSplashDone = useCallback(() => {
    setSplashDone(true);
    if (settings.get().tutorialSeen) revealApp();
  }, [revealApp]);
  const handleSplashExitStart = useCallback(() => {
    setSplashExiting(true);
    if (settings.get().tutorialSeen) revealApp();
  }, [revealApp]);
  const handleTutorialDone = useCallback(() => {
    revealApp();
    setShowTutorial(false);
  }, [revealApp]);
  const handleTutorialExitStart = revealApp;
  return (
    <HashRouter>
      <ToastProvider>
        <motion.div
          initial={false}
          animate={{ opacity: appVisible ? 1 : 0 }}
          transition={{ duration: showTutorial && appMounted ? 0.2 : 0, ease: 'easeOut' }}
          onAnimationComplete={() => { if (!appVisible) setAppMounted(false); }}
          style={{ visibility: appMounted ? 'visible' : 'hidden' }}
          inert={!appVisible}
          aria-hidden={!appVisible}
        >
          <App tutorialMode={showTutorial} />
        </motion.div>
        {!splashDone && <Splash onDone={handleSplashDone} onExitStart={handleSplashExitStart} />}
        {showTutorial && (splashExiting || splashDone) && (
          <Onboarding
            onDone={handleTutorialDone}
            onExitStart={handleTutorialExitStart}
            onRevealApp={revealApp}
            onHideApp={hideApp}
            enteringWithSplash={!splashDone}
          />
        )}
      </ToastProvider>
    </HashRouter>
  );
}

createRoot(document.getElementById('root')).render(<Root />);

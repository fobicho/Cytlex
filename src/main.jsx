import React, { useState, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { MotionConfig, motion } from 'framer-motion';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import App from './App.jsx';
import Splash from './components/Splash.jsx';
import Onboarding from './components/Onboarding.jsx';
import BrowserMobileNav from './components/BrowserMobileNav.jsx';
import { ToastProvider } from './components/Toast.jsx';
import { migrateLegacyStorage } from './lib/migrate.js';
import { resolveMode, settings } from './lib/settings.js';
import { applyPerformanceMode } from './lib/performanceMode.js';
import { consumeBrowserOAuthCallback } from './lib/session.js';
import { I18nProvider } from './lib/i18n.js';
import './index.css';

const Router = window.location.protocol === 'file:' ? HashRouter : BrowserRouter;

function normalizeLegacyHashRoute() {
  const route = window.location.hash.slice(1);
  if (!route.startsWith('/')) return false;
  window.history.replaceState(window.history.state, '', route);
  return true;
}

if (Router === BrowserRouter) {
  normalizeLegacyHashRoute();
  const normalizeOnNavigation = (event) => {
    if (normalizeLegacyHashRoute() && event.type === 'hashchange') {
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  };
  window.addEventListener('hashchange', normalizeOnNavigation);
  window.addEventListener('popstate', normalizeOnNavigation);
}

consumeBrowserOAuthCallback();
migrateLegacyStorage();

const boot = settings.get();
document.documentElement.setAttribute('data-theme', boot.theme);
document.documentElement.setAttribute('data-mode', resolveMode(boot.mode));
applyPerformanceMode(boot.performanceMode);
if (window.cytlex?.saveTheme) window.cytlex.saveTheme({ theme: boot.theme, mode: boot.mode, effectiveMode: resolveMode(boot.mode) });

function Root() {
  const [splashDone, setSplashDone] = useState(false);
  const [splashExiting, setSplashExiting] = useState(false);
  const [showTutorial, setShowTutorial] = useState(() => !settings.get().tutorialSeen);
  const [tutorialLanguage, setTutorialLanguage] = useState('es');
  const [tutorialImportBusy, setTutorialImportBusy] = useState(false);
  const [tutorialImportProgress, setTutorialImportProgress] = useState(null);
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
    <MotionConfig reducedMotion="never">
      <Router>
        <I18nProvider languageOverride={showTutorial ? tutorialLanguage : null}>
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
            {showTutorial && !tutorialImportBusy && appVisible && (
              <BrowserMobileNav tutorialNavOnly />
            )}
            {!splashDone && <Splash onDone={handleSplashDone} onExitStart={handleSplashExitStart} />}
            {showTutorial && (splashExiting || splashDone) && (
              <Onboarding
                onDone={handleTutorialDone}
                onExitStart={handleTutorialExitStart}
                onRevealApp={revealApp}
                onHideApp={hideApp}
                onTutorialImportBusyChange={setTutorialImportBusy}
                onTutorialImportProgressChange={setTutorialImportProgress}
                tutorialImportBusy={tutorialImportBusy}
                tutorialImportProgress={tutorialImportProgress}
                enteringWithSplash={!splashDone}
                language={tutorialLanguage}
                onLanguageChange={setTutorialLanguage}
              />
            )}
          </ToastProvider>
        </I18nProvider>
      </Router>
    </MotionConfig>
  );
}

createRoot(document.getElementById('root')).render(<Root />);

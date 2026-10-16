import React, { useState, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App.jsx';
import Splash from './components/Splash.jsx';
import Onboarding from './components/Onboarding.jsx';
import { ToastProvider } from './components/Toast.jsx';
import { migrateLegacyStorage } from './lib/migrate.js';
import { settings } from './lib/settings.js';
import './index.css';

migrateLegacyStorage();

const boot = settings.get();
document.documentElement.setAttribute('data-theme', boot.theme);
document.documentElement.setAttribute('data-mode', boot.mode);

function Root() {
  const [splashDone, setSplashDone] = useState(false);
  const [showTutorial, setShowTutorial] = useState(() => !settings.get().tutorialSeen);
  const handleSplashDone = useCallback(() => setSplashDone(true), []);
  const handleTutorialDone = useCallback(() => setShowTutorial(false), []);
  return (
    <HashRouter>
      <ToastProvider>
        <div style={{ visibility: showTutorial ? 'hidden' : 'visible' }}>
          <App />
        </div>
        {!splashDone && <Splash onDone={handleSplashDone} />}
        {splashDone && showTutorial && <Onboarding onDone={handleTutorialDone} />}
      </ToastProvider>
    </HashRouter>
  );
}

createRoot(document.getElementById('root')).render(<Root />);
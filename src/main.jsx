import React from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App.jsx';
import Splash from './components/Splash.jsx';
import { ToastProvider } from './components/Toast.jsx';
import { migrateLegacyStorage } from './lib/migrate.js';
import { settings } from './lib/settings.js';
import './index.css';

migrateLegacyStorage();

const boot = settings.get();
document.documentElement.setAttribute('data-theme', boot.theme);
document.documentElement.setAttribute('data-mode', boot.mode);

createRoot(document.getElementById('root')).render(
  <HashRouter>
    <ToastProvider>
      <Splash />
      <App />
    </ToastProvider>
  </HashRouter>
);
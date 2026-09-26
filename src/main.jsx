import React from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App.jsx';
import { migrateLegacyStorage } from './lib/migrate.js';
import './index.css';

migrateLegacyStorage();

createRoot(document.getElementById('root')).render(
  <HashRouter><App /></HashRouter>
);

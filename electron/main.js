import { app, BrowserWindow, ipcMain, session } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchHome, fetchCatalog, fetchDetail, fetchChapter } from './scraper.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.env.NODE_ENV !== 'production' && !app.isPackaged;

function createWindow() {
  const win = new BrowserWindow({
    width: 980,
    height: 680,
    minWidth: 860,
    minHeight: 560,
    autoHideMenuBar: true,
    backgroundColor: '#09090b',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.maximize();

  if (isDev) {
    win.loadURL('http://localhost:5173');
    if (process.env.OPEN_DEVTOOLS === '1') {
      win.webContents.openDevTools({ mode: 'detach' });
    }
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

// Referer + UA para que los CDN de imágenes no bloqueen el hotlink
function hookImageHeaders() {
  const rules = [
    { urls: ['*://*.t34798ndc.com/*', '*://leercapitulo.co/*'], referer: 'https://leercapitulo.co/' },
    { urls: ['*://mangalect.org/*', '*://*.mangalect.org/*'], referer: 'https://mangalect.org/' },
    { urls: ['*://onfmangas.com/*', '*://*.onfmangas.com/*'], referer: 'https://onfmangas.com/' },
    { urls: ['*://*.imagesolymp.xyz/*', '*://olympusxyz.com/*'], referer: 'https://olympusxyz.com/' }
  ];
  for (const rule of rules) {
    session.defaultSession.webRequest.onBeforeSendHeaders({ urls: rule.urls }, (details, callback) => {
      details.requestHeaders['Referer'] = rule.referer;
      details.requestHeaders['User-Agent'] = details.requestHeaders['User-Agent'] || 'Mozilla/5.0 Cytlex/0.1';
      callback({ requestHeaders: details.requestHeaders });
    });
  }
}

app.whenReady().then(() => {
  hookImageHeaders();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Fetch genérico para extensiones (evita CORS en el renderer)
ipcMain.handle('http:get', async (_e, url) => {
  // Muchos sitios exigen que el Referer sea de su propio dominio.
  let referer = 'https://leercapitulo.co/';
  try { referer = new URL(url).origin + '/'; } catch {}
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Cytlex/0.1',
      Referer: referer
    }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} al pedir ${url}`);
  return await res.text();
});

ipcMain.handle('window:toggle-fullscreen', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win) return false;
  const next = !win.isFullScreen();
  win.setFullScreen(next);
  return next;
});

ipcMain.handle('window:is-fullscreen', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  return win ? win.isFullScreen() : false;
});

ipcMain.handle('manga:home', async () => {
  try {
    const r = await fetchHome();
    console.log('[cytlex] home ok:', r.trending?.length, 'trending,', r.latestChapters?.length, 'latest');
    return r;
  } catch (e) {
    console.error('[cytlex] home FAIL:', e.message);
    throw e;
  }
});
ipcMain.handle('manga:catalog', async (_e, args) => {
  try {
    const r = await fetchCatalog(args || {});
    console.log('[cytlex] catalog ok:', r.items?.length, 'items,', JSON.stringify(args));
    return r;
  } catch (e) {
    console.error('[cytlex] catalog FAIL:', e.message, JSON.stringify(args));
    throw e;
  }
});
ipcMain.handle('manga:detail', async (_e, url) => {
  try {
    return await fetchDetail(url);
  } catch (e) {
    console.error('[cytlex] detail FAIL:', url, e.message);
    throw e;
  }
});
ipcMain.handle('manga:chapter', async (_e, url) => {
  try {
    return await fetchChapter(url);
  } catch (e) {
    console.error('[cytlex] chapter FAIL:', url, e.message);
    throw e;
  }
});

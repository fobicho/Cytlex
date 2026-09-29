import { app, BrowserWindow, ipcMain, session, Menu, dialog } from 'electron';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { fetchHome, fetchCatalog, fetchDetail, fetchChapter } from './scraper.js';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const auth = require('./auth.cjs');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.env.NODE_ENV !== 'production' && !app.isPackaged;

function createWindow() {
  const win = new BrowserWindow({
    width: 980,
    height: 680,
    minWidth: 860,
    minHeight: 560,
    frame: false,
    backgroundColor: '#09090b',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.maximize();

  const emitMaximized = () => {
    if (!win.isDestroyed()) win.webContents.send('window:maximized-changed', win.isMaximized());
  };
  win.on('maximize', emitMaximized);
  win.on('unmaximize', emitMaximized);

  if (isDev) {
    win.loadURL('http://localhost:5173');
    if (process.env.OPEN_DEVTOOLS === '1') {
      win.webContents.openDevTools({ mode: 'detach' });
    }
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  win.webContents.on('before-input-event', (event, input) => {
    if (input.control && input.shift && input.key.toLowerCase() === 'i') {
      event.preventDefault();
      win.webContents.toggleDevTools();
    }
  });
}

// Referer + UA para que los CDN de imágenes no bloqueen el hotlink
function hookImageHeaders() {
  const rules = [
    { urls: ['*://*.t34798ndc.com/*', '*://leercapitulo.co/*'], referer: 'https://leercapitulo.co/' },
    { urls: ['*://mangalect.org/*', '*://*.mangalect.org/*'], referer: 'https://mangalect.org/' },
    { urls: ['*://onfmangas.com/*', '*://*.onfmangas.com/*'], referer: 'https://onfmangas.com/' },
    { urls: ['*://*.imagesolymp.xyz/*', '*://olympusxyz.com/*'], referer: 'https://olympusxyz.com/' },
    { urls: ['*://zonatmo.org/*', '*://*.zonatmo.org/*'], referer: 'https://zonatmo.org/' },
    { urls: ['*://media.imagesolymp.xyz/*', '*://oni.ntr-files.online/*'], referer: 'https://manga-oni.com/' }
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
  Menu.setApplicationMenu(null);
  hookImageHeaders();
  auth.register();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('http:get', async (_e, url) => {
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

ipcMain.handle('http:head', async (_e, url) => {
  let referer = 'https://leercapitulo.co/';
  try { referer = new URL(url).origin + '/'; } catch {}
  const res = await fetch(url, {
    method: 'HEAD',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Cytlex/0.1',
      Referer: referer
    }
  });
  return { ok: res.ok, status: res.status, length: Number(res.headers.get('content-length')) || 0, type: res.headers.get('content-type') || '' };
});

ipcMain.handle('http:post', async (_e, payload = {}) => {
  const { url, body, headers } = payload;
  if (!url) throw new Error('Falta la URL de la petición POST');
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Cytlex/0.1',
      ...headers
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} al pedir ${url}`);
  return await res.json();
});

ipcMain.handle('image:fetch', async (_e, url) => {
  if (!url) return null;
  try {
    const u = new URL(url);
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Cytlex/0.1',
        Referer: u.origin + '/'
      }
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return { mime: res.headers.get('content-type') || 'application/octet-stream', base64: buf.toString('base64') };
  } catch {
    return null;
  }
});

ipcMain.handle('image:download', async (e, payload = {}) => {
  const { url, suggested } = payload;
  if (!url) return { ok: false };
  try {
    const u = new URL(url);
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Cytlex/0.1',
        Referer: u.origin + '/'
      }
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const buf = Buffer.from(await res.arrayBuffer());

    const ext = (u.pathname.match(/\.(jpe?g|png|webp|gif|avif)$/i)?.[1] || 'jpg').toLowerCase();
    const safe = String(suggested || '').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'panel';
    const defaultPath = /\.[a-z0-9]+$/i.test(safe) ? safe : `${safe}.${ext}`;

    const win = BrowserWindow.fromWebContents(e.sender);
    const opts = { defaultPath, filters: [{ name: 'Imagen', extensions: [ext] }] };
    const { canceled, filePath } = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
    if (canceled || !filePath) return { ok: false, canceled: true };

    await writeFile(filePath, buf);
    return { ok: true, path: filePath };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
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

ipcMain.handle('window:minimize', (e) => {
  BrowserWindow.fromWebContents(e.sender)?.minimize();
});

ipcMain.handle('window:toggle-maximize', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win) return false;
  if (win.isMaximized()) win.unmaximize();
  else win.maximize();
  return win.isMaximized();
});

ipcMain.handle('window:is-maximized', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  return win ? win.isMaximized() : false;
});

ipcMain.handle('window:close', (e) => {
  BrowserWindow.fromWebContents(e.sender)?.close();
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


import { app, BrowserWindow, ipcMain, session, Menu, dialog, Notification, shell } from 'electron';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { fetchHome, fetchCatalog, fetchDetail, fetchChapter } from './scraper.js';
import { createRequire } from 'node:module';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const auth = require('./auth.cjs');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.env.NODE_ENV !== 'production' && !app.isPackaged;
const devUrl = process.env.CYTLEX_DEV_URL || 'http://localhost:5173';
const launchedInBackground = process.argv.includes('--background');

let mainWindow = null;

function createWindow() {
  const win = new BrowserWindow({
    width: 980,
    height: 680,
    minWidth: 860,
    minHeight: 560,
    frame: false,
    show: !launchedInBackground,
    backgroundColor: '#09090b',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow = win;
  if (!launchedInBackground) win.maximize();

  if (launchedInBackground) {
    const bail = setTimeout(() => {
      if (!win.isDestroyed()) app.quit();
    }, 30000);
    win.webContents.on('did-finish-load', () => clearTimeout(bail));
    win.webContents.on('did-fail-load', () => { clearTimeout(bail); app.quit(); });
  }

  win.on('close', () => { if (mainWindow === win) mainWindow = null; });
  win.on('closed', () => { if (mainWindow === win) mainWindow = null; });

  const emitMaximized = () => {
    if (!win.isDestroyed()) win.webContents.send('window:maximized-changed', win.isMaximized());
  };
  win.on('maximize', emitMaximized);
  win.on('unmaximize', emitMaximized);

  if (isDev) {
    win.loadURL(devUrl);
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

  return win;
}

const REFERER_RULES = [
  { hosts: ['t34798ndc.com'], referer: 'https://leercapitulo.co/' },
  { hosts: ['leercapitulo.co'], referer: 'https://leercapitulo.co/' },
  { hosts: ['mangalect.org'], referer: 'https://mangalect.org/' },
  { hosts: ['onfmangas.com'], referer: 'https://onfmangas.com/' },
  { hosts: ['imagesolymp.xyz', 'olympusxyz.com'], referer: 'https://olympusxyz.com/' },
  { hosts: ['zonatmo.org'], referer: 'https://zonatmo.org/' },
  { hosts: ['ntr-files.online'], referer: 'https://manga-oni.com/' }
];

function hookImageHeaders() {
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ['<all_urls>'] },
    (details, callback) => {
      const { requestHeaders } = details;
      let host = '';
      try {
        host = new URL(details.url).hostname.toLowerCase();
      } catch {
        callback({ requestHeaders });
        return;
      }

      const rule = REFERER_RULES.find((r) => r.hosts.some((h) => host === h || host.endsWith(`.${h}`)));
      if (!rule) {
        callback({ requestHeaders });
        return;
      }

      requestHeaders['referer'] = rule.referer;
      requestHeaders['user-agent'] = requestHeaders['user-agent'] || 'Mozilla/5.0 Cytlex/0.1';
      callback({ requestHeaders });
    }
  );
}

const TASK_NAME = 'Cytlex';

const lastNotifiedAt = new Map();
let pendingClick = null;

ipcMain.handle('app:background', () => launchedInBackground);

ipcMain.handle('app:exit', () => {
  if (launchedInBackground) app.quit();
  return true;
});

ipcMain.handle('notify:supported', () => Notification.isSupported());

ipcMain.handle('notify:show', (_e, payload = {}) => {
  if (!Notification.isSupported()) {
    console.log('[notify] no soportado');
    return false;
  }
  // Anti-flood por tema, no global: si no, la aviso de "biblioteca al día"
  // pisaba el de extensiones en la misma pasada y se perdía.
  const bucket = payload.key || payload.tipo || payload.title || 'cytlex';
  const last = lastNotifiedAt.get(bucket) || 0;
  if (Date.now() - last < 30000) {
    console.log('[notify] descartado por anti-flood:', payload.title);
    return false;
  }
  lastNotifiedAt.set(bucket, Date.now());
  const n = new Notification({
    title: payload.title || 'Cytlex',
    body: payload.body || '',
    silent: false
  });
  n.on('show', () => console.log('[notify] mostrada:', payload.title));
  n.on('failed', (_ev, err) => console.log('[notify] fallo:', err, payload.title));
  n.on('close', () => {
    console.log('[notify] cerrada:', payload.title);
    if (launchedInBackground) app.quit();
  });
  n.on('click', () => {
    pendingClick = payload;
    const win = mainWindow;
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      if (launchedInBackground && !win.isMaximized()) win.maximize();
      win.show();
      win.focus();
      win.webContents.send('notify:click', payload);
    }
  });
  n.show();
  return true;
});

ipcMain.handle('notify:confirm', async (e) => {
  const r = await dialog.showMessageBox(BrowserWindow.fromWebContents(e.sender), {
    type: 'question',
    buttons: ['Cancelar', 'Permitir'],
    defaultId: 0,
    cancelId: 0,
    title: 'Notificaciones en segundo plano',
    message: '¿Permitir que Cytlex revise tu biblioteca aunque esté cerrado?',
    detail:
      'Se creará una tarea programada de Windows que ejecuta Cytlex en segundo plano. ' +
      'Puedes desactivarlo cuando quieras desde Ajustes.'
  });
  return r.response === 1;
});

const TASK_HOURS = { 6: ['00', '06', '12', '18'], 12: ['00', '12'], 24: ['12'] };

function taskName(hh) {
  return hh === '00' ? TASK_NAME : `${TASK_NAME}-${hh}`;
}

async function removeTasks() {
  for (const hh of ['00', '06', '12', '18']) {
    try {
      await execFileAsync('schtasks', ['/Delete', '/F', '/TN', taskName(hh)]);
    } catch (e) {
      const raw = `${e?.message || ''} ${e?.stderr || ''}`;
      if (!/no puede encontrar|no se encuentra|not found|cannot find/i.test(raw)) throw e;
    }
  }
}

ipcMain.handle('notify:background', async (_e, on, hours = 6) => {
  if (process.platform !== 'win32') return { ok: false, error: 'Solo disponible en Windows' };
  const tr = `"${process.execPath}" ${isDev ? `"${app.getAppPath()}" ` : ''}--background`;
  const list = TASK_HOURS[hours] || TASK_HOURS[6];
  try {
    if (!on) {
      await removeTasks();
      return { ok: true };
    }
    await removeTasks();
    for (const hh of list) {
      await execFileAsync('schtasks', [
        '/Create', '/F', '/TN', taskName(hh), '/TR', tr, '/SC', 'DAILY', '/ST', `${hh}:00`
      ]);
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e?.stderr || e?.message || e) };
  }
});

app.setAppUserModelId('com.fobicho.cytlex');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    if (pendingClick) {
      const payload = pendingClick;
      pendingClick = null;
      mainWindow.webContents.send('notify:click', payload);
    }
  });
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  hookImageHeaders();
  auth.register();
  const win = createWindow();
  if (launchedInBackground) {
    win.once('ready-to-show', () => {});
  }
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


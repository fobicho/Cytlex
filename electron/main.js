import { app, BrowserWindow, ipcMain, session, Menu, dialog, Notification, shell, screen } from 'electron';
import path from 'node:path';
import { writeFile, readFile } from 'node:fs/promises';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const auth = require('./auth.cjs');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.env.NODE_ENV !== 'production' && !app.isPackaged;
const devUrl = process.env.CYTLEX_DEV_URL || 'http://localhost:5174';
const launchedInBackground = process.argv.includes('--background');

let mainWindow = null;
let devServer = null;
let pageUrl = null;
let backgroundBail = null;

function liberarFondo() {
  if (backgroundBail) { clearTimeout(backgroundBail); backgroundBail = null; }
}

async function ensureDevServer() {
  if (!isDev) return null;
  if (!launchedInBackground) return devUrl;
  try {
    const { createServer } = await import('vite');
    const server = await createServer({
      configFile: path.join(__dirname, '../vite.config.js'),
      logLevel: 'silent'
    });
    await server.listen();
    devServer = server;
    return server.resolvedUrls?.local?.[0] || devUrl;
  } catch {
    return devUrl;
  }
}

function themeBg() {
  const map = {
    default: { dark: '#09090b', light: '#ffffff' },
    beige: { dark: '#241d14', light: '#f7f1e6' },
    esmeralda: { dark: '#131b18', light: '#f2f8f5' },
    violeta: { dark: '#16121c', light: '#f7f4fa' },
    rosa: { dark: '#1b1317', light: '#fbf4f7' },
    oceano: { dark: '#11191d', light: '#f0f7f9' }
  };
  try {
    const t = JSON.parse(readFileSync(path.join(app.getPath('userData'), 'theme.json'), 'utf8'));
    const theme = t?.theme || 'default';
    const mode = t?.mode || 'dark';
    return (map[theme] || map.default)[mode] || (mode === 'dark' ? '#09090b' : '#ffffff');
  } catch {
    return '#09090b';
  }
}

function createWindow(startBounds = null, startMaximized = false) {
  const bounds = startBounds || {
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT
  };

  const win = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    frame: false,
    roundedCorners: true,
    fullscreenable: true,
    show: !launchedInBackground,
    backgroundColor: themeBg(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow = win;
  if (startMaximized && !launchedInBackground) win.maximize();
  trackWindowState(win);

  if (launchedInBackground) {
    backgroundBail = setTimeout(() => {
      if (!win.isDestroyed()) app.quit();
    }, 90000);
    win.webContents.on('did-fail-load', () => { liberarFondo(); app.quit(); });
  }

  win.on('close', () => { if (mainWindow === win) mainWindow = null; });
  win.on('closed', () => { if (mainWindow === win) mainWindow = null; });

  const emitMaximized = () => {
    if (!win.isDestroyed()) win.webContents.send('window:maximized-changed', win.isMaximized());
  };
  win.on('maximize', emitMaximized);
  win.on('unmaximize', emitMaximized);

  if (pageUrl) {
    win.loadURL(pageUrl);
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

const ALLOWED_PROTOCOLS = ['http:', 'https:'];

function validateUrl(url) {
  if (typeof url !== 'string' || url.length === 0) {
    throw new Error('Invalid URL: must be a non-empty string');
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Invalid URL: malformed');
  }
  if (!ALLOWED_PROTOCOLS.includes(parsed.protocol)) {
    throw new Error(`Disallowed protocol: ${parsed.protocol}`);
  }
  if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
    if (!isDev) {
      throw new Error('Localhost access is not allowed in production');
    }
  }
  return parsed;
}

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

const MIN_WIDTH = 860;
const MIN_HEIGHT = 560;
const DEFAULT_WIDTH = 1200;
const DEFAULT_HEIGHT = 680;

let saveStateTimer = null;

function stateFile() {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function clampSize(size, area) {
  return {
    width: Math.max(MIN_WIDTH, Math.min(Math.round(size.width), area.width)),
    height: Math.max(MIN_HEIGHT, Math.min(Math.round(size.height), area.height))
  };
}

async function readWindowState() {
  try {
    const s = JSON.parse(await readFile(stateFile(), 'utf8'));
    if (!Number.isFinite(s.width) || !Number.isFinite(s.height)) return null;
    return { width: s.width, height: s.height, maximized: !!s.maximized };
  } catch {
    return null;
  }
}

function persistWindowState(win) {
  if (!win || win.isDestroyed()) return;
  const normal = win.isMaximized() || win.isFullScreen() ? win.getNormalBounds() : win.getBounds();
  const payload = JSON.stringify({
    width: normal.width,
    height: normal.height,
    maximized: win.isMaximized()
  });
  writeFile(stateFile(), payload).catch(() => {});
}

function trackWindowState(win) {
  const schedule = () => {
    if (saveStateTimer) clearTimeout(saveStateTimer);
    saveStateTimer = setTimeout(() => persistWindowState(win), 400);
  };
  win.on('resize', schedule);
  win.on('move', schedule);
  win.on('maximize', schedule);
  win.on('unmaximize', schedule);
  win.on('close', () => {
    if (saveStateTimer) { clearTimeout(saveStateTimer); saveStateTimer = null; }
    persistWindowState(win);
  });
}

async function initialBounds() {
  const area = screen.getPrimaryDisplay().workArea;
  const saved = await readWindowState();
  const size = saved
    ? clampSize(saved, area)
    : clampSize({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT }, area);
  return {
    bounds: {
      ...size,
      x: Math.round(area.x + (area.width - size.width) / 2),
      y: Math.round(area.y + (area.height - size.height) / 2)
    },
    maximized: saved ? saved.maximized : false
  };
}

const lastNotifiedAt = new Map();
let pendingClick = null;

ipcMain.handle('app:background', () => launchedInBackground);

ipcMain.handle('theme:save', (_e, mode) => {
  try {
    writeFileSync(path.join(app.getPath('userData'), 'theme.json'), JSON.stringify({ mode }));
  } catch {}
  return true;
});

ipcMain.handle('notify:supported', () => Notification.isSupported());

ipcMain.handle('notify:show', (_e, payload = {}) => {
  if (!Notification.isSupported()) {
    console.log('[notify] no soportado');
    return false;
  }
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
    liberarFondo();
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

const psQuote = (s) => `'${String(s).replace(/'/g, "''")}'`;

const taskScript = (hh, tr) => `
$ErrorActionPreference = 'Stop'
$a = New-ScheduledTaskAction -Execute ${psQuote(process.execPath)} -Argument ${psQuote(tr)} -WorkingDirectory ${psQuote(app.getAppPath())}
$s = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
$p = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
$t = New-ScheduledTaskTrigger -Daily -At '${hh}:00'
Register-ScheduledTask -TaskName ${psQuote(taskName(hh))} -Action $a -Trigger $t -Settings $s -Principal $p -Force | Out-Null
`;

ipcMain.handle('notify:background', async (_e, on, hours = 6) => {
  if (process.platform !== 'win32') return { ok: false, error: 'Solo disponible en Windows' };
  const arg = isDev ? `"${app.getAppPath()}" --background` : '--background';
  const list = TASK_HOURS[hours] || TASK_HOURS[6];
  try {
    if (!on) {
      await removeTasks();
      return { ok: true };
    }
    await removeTasks();
    for (const hh of list) {
      await execFileAsync('powershell', [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-Command', taskScript(hh, arg)
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
    liberarFondo();
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

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  hookImageHeaders();
  auth.register();
  pageUrl = await ensureDevServer();
  const start = await initialBounds();
  const win = createWindow(start.bounds, start.maximized);
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

app.on('quit', () => {
  liberarFondo();
  if (devServer) devServer.close().catch(() => {});
});

const refererFor = (url) => {
  try {
    const host = new URL(url).hostname.toLowerCase();
    const rule = REFERER_RULES.find((r) => r.hosts.some((h) => host === h || host.endsWith(`.${h}`)));
    if (rule) return rule.referer;
  } catch {}
  try { return new URL(url).origin + '/'; } catch { return 'https://leercapitulo.co/'; }
};

ipcMain.handle('http:get', async (_e, url) => {
  const parsed = validateUrl(url);
  const res = await fetch(parsed.toString(), {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Cytlex/0.1',
      Referer: refererFor(parsed.toString())
    }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} al pedir ${parsed.toString()}`);
  return await res.text();
});

ipcMain.handle('http:head', async (_e, url) => {
  const parsed = validateUrl(url);
  const urlStr = parsed.toString();
  const res = await fetch(urlStr, {
    method: 'HEAD',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Cytlex/0.1',
      Referer: refererFor(urlStr)
    }
  });
  return { ok: res.ok, status: res.status, length: Number(res.headers.get('content-length')) || 0, type: res.headers.get('content-type') || '' };
});

ipcMain.handle('http:post', async (_e, payload = {}) => {
  const { url, body, headers } = payload;
  if (!url) throw new Error('Falta la URL de la petición POST');
  const parsed = validateUrl(url);
  const urlStr = parsed.toString();
  const res = await fetch(urlStr, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Cytlex/0.1',
      ...headers
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} al pedir ${urlStr}`);
  return await res.json();
});

ipcMain.handle('image:fetch', async (_e, url) => {
  if (!url) return null;
  try {
    const parsed = validateUrl(url);
    const urlStr = parsed.toString();
    const res = await fetch(urlStr, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Cytlex/0.1',
        Referer: parsed.origin + '/'
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
    const parsed = validateUrl(url);
    const urlStr = parsed.toString();
    const res = await fetch(urlStr, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Cytlex/0.1',
        Referer: parsed.origin + '/'
      }
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const buf = Buffer.from(await res.arrayBuffer());

    const ext = (parsed.pathname.match(/\.(jpe?g|png|webp|gif|avif)$/i)?.[1] || 'jpg').toLowerCase();
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


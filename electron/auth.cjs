const { BrowserWindow, safeStorage, ipcMain, app } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const CLIENT_ID = process.env.ANILIST_CLIENT_ID || '52189';
const AUTH_URL = 'https://anilist.co/api/v2/oauth/authorize';
const REDIRECT_URI = 'https://anilist.co/api/v2/oauth/authorize/callback';
const TOKEN_TTL_MS = 365 * 24 * 60 * 60 * 1000;

const file = () => path.join(app.getPath('userData'), 'session.bin');

const CANCELLED = Symbol('cancelled');

function read() {
  try {
    const raw = fs.readFileSync(file());
    const enc = safeStorage.isEncryptionAvailable();
    const buf = enc ? safeStorage.decryptString(raw) : raw.toString('utf8');
    return JSON.parse(buf);
  } catch {
    return null;
  }
}

function write(data) {
  try {
    const enc = safeStorage.isEncryptionAvailable();
    const payload = enc
      ? Buffer.from(safeStorage.encryptString(JSON.stringify(data)))
      : Buffer.from(JSON.stringify(data), 'utf8');
    fs.writeFileSync(file(), payload);
  } catch (e) {
    console.error('[cytlex] no se pudo guardar la sesión:', e.message);
  }
}

function clear() {
  try { fs.unlinkSync(file()); } catch {}
}

function valid() {
  const s = read();
  if (!s?.accessToken) return null;
  if (Date.now() > (s.expiresAt || 0)) return null;
  return s;
}

function login(parent) {
  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      width: 520,
      height: 700,
      parent,
      modal: false,
      autoHideMenuBar: true,
      title: 'Conectar con AniList',
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
    });

    let settled = false;
    const done = (err, data) => {
      if (settled) return;
      settled = true;
      if (!win.isDestroyed()) win.destroy();
      if (err === CANCELLED) resolve({ cancelled: true });
      else if (err) reject(err);
      else resolve(data);
    };

    const auth = new URL(AUTH_URL);
    auth.searchParams.set('client_id', CLIENT_ID);
    auth.searchParams.set('response_type', 'token');
    win.loadURL(auth.toString());

    const onNavigate = (event, url) => {
      if (!url.startsWith(REDIRECT_URI)) return;
      event.preventDefault();

      const params = new URLSearchParams(new URL(url).hash.replace(/^#/, ''));
      const accessToken = params.get('access_token');

      if (params.get('error')) {
        done(new Error(`AniList denegó el acceso: ${params.get('error_description') || params.get('error')}`));
        return;
      }
      if (!accessToken) {
        done(new Error('AniList no devolvió un token de acceso.'));
        return;
      }

      const session = { accessToken, expiresAt: Date.now() + TOKEN_TTL_MS };
      write(session);
      done(null, { connected: true, expiresAt: session.expiresAt });
    };

    win.webContents.on('will-redirect', onNavigate);
    win.webContents.on('will-navigate', onNavigate);
    win.on('closed', () => done(CANCELLED));
  });
}

function register() {
  ipcMain.handle('auth:login', async (e) => {
    const host = BrowserWindow.fromWebContents(e.sender);
    const r = await login(host);
    // Cerrar la ventana es una decisión del usuario, no un fallo.
    if (r?.cancelled) return { connected: false, cancelled: true };
    return r;
  });

  ipcMain.handle('auth:logout', () => {
    clear();
    return { connected: false };
  });

  ipcMain.handle('auth:status', () => {
    const s = valid();
    if (!s) {
      const stale = read();
      clear();
      return { connected: false, expired: !!stale?.accessToken };
    }
    return { connected: true, expiresAt: s.expiresAt };
  });

  ipcMain.handle('auth:gql', async (_e, { query, variables } = {}) => {
    const s = valid();
    if (!s) throw new Error('La sesión de AniList no está activa o ha caducado.');
    const res = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${s.accessToken}`
      },
      body: JSON.stringify({ query, variables })
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      let detail = '';
      try {
        const parsed = JSON.parse(body);
        detail = parsed?.errors?.[0]?.message || parsed?.message || '';
      } catch {
        detail = body.slice(0, 200);
      }
      throw new Error(`AniList respondió HTTP ${res.status}${detail ? `: ${detail}` : ''}`);
    }
    return await res.json();
  });
}

module.exports = { register };

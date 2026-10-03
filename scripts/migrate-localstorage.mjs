import { app, BrowserWindow, session } from 'electron';
import http from 'node:http';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = 'http://localhost:5173';
const DST = 'http://localhost:5174';

const PAGE = '<!doctype html><meta charset="utf-8"><title>migrate</title><body>';

app.setPath('userData', path.join(process.env.APPDATA, 'cytlex'));

function serve(port) {
  return new Promise((resolve, reject) => {
    const s = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(PAGE);
    });
    s.on('error', reject);
    s.listen(port, '127.0.0.1', () => resolve(s));
  });
}

const keysAt = (win) =>
  win.webContents.executeJavaScript(
    `JSON.stringify(Object.keys(localStorage).filter(k => k.startsWith('cytlex:')))`
  );

async function readAt(win, url) {
  await win.loadURL(url);
  return JSON.parse(await keysAt(win));
}

async function getValues(win, keys) {
  const out = {};
  for (const k of keys) {
    out[k] = await win.webContents.executeJavaScript(`localStorage.getItem(${JSON.stringify(k)})`);
  }
  return out;
}

app.whenReady().then(async () => {
  const servers = [];
  for (const p of [5173, 5174]) {
    try {
      servers.push(await serve(p));
    } catch (e) {
      console.error('No se pudo servir en el puerto', p, '->', e.message);
      console.error('Cierra el dev server que ocupe ese puerto y reintenta.');
      for (const s of servers) s.close();
      app.exit(1);
      return;
    }
  }

  const dstServer = servers[1];

  session.defaultSession.webRequest.onBeforeRequest((details, cb) => {
    const url = details.url;
    if (url.startsWith(SRC) || url.startsWith(DST) || url.startsWith('devtools')) {
      return cb({ cancel: false });
    }
    cb({ cancel: true });
  });

  const win = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  });

  try {
    const srcKeys = await readAt(win, SRC);
    console.log('Origen 5173, claves cytlex:', srcKeys.join(', '));

    const data = await getValues(win, srcKeys);

    const out = path.join(__dirname, 'cytlex-localstorage-5173.json');
    writeFileSync(out, JSON.stringify(data, null, 2), 'utf8');

    let total = 0;
    for (const [k, v] of Object.entries(data)) {
      const n = String(v ?? '').length;
      total += n;
      console.log(`  ${k}: ${n} chars`);
    }
    console.log(`Total: ${total} chars -> ${out}`);

    const dstKeysBefore = await readAt(win, DST);
    console.log('Destino 5174, claves antes:', dstKeysBefore.join(', ') || '(vacio)');

    for (const [k, v] of Object.entries(data)) {
      await win.webContents.executeJavaScript(
        `localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(v)})`
      );
    }

    const dstKeysAfter = await readAt(win, DST);
    console.log('Destino 5174, claves despues:', dstKeysAfter.join(', '));

    const favs = await win.webContents.executeJavaScript(
      `JSON.parse(localStorage.getItem('cytlex:favs') || '[]').length`
    );
    console.log('Mangas en cytlex:favs ->', favs);
  } catch (e) {
    console.error('FALLO:', e.message);
    dstServer.close();
    app.exit(1);
    return;
  }

  for (const s of servers) s.close();
  app.exit(0);
});
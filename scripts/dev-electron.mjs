import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import process from 'node:process';
import electronPath from 'electron';

const isWindows = process.platform === 'win32';

const server = await createServer({ configFile: 'vite.config.js' });
await server.listen();

const url = server.resolvedUrls?.local?.[0];
if (!url) {
  console.error('No se pudo resolver la URL del dev server.');
  await server.close();
  process.exit(1);
}

const base = url.replace(/\/$/, '');
console.log(`Dev server en ${base}`);

let electron = null;
let closing = false;

async function waitForServer(target, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(target, { method: 'HEAD' });
      if (res.ok || res.status === 404) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

function stopAll() {
  if (closing) return;
  closing = true;
  if (electron && !electron.killed) electron.kill();
  server.close().finally(() => process.exit(0));
}

process.on('SIGINT', stopAll);
process.on('SIGTERM', stopAll);

if (!(await waitForServer(base))) {
  console.error('El dev server no respondio a tiempo.');
  await server.close();
  process.exit(1);
}

electron = spawn(electronPath, ['.'], {
  stdio: 'inherit',
  env: { ...process.env, CYTLEX_DEV_URL: base }
});

electron.on('exit', (code) => {
  if (closing) return;
  closing = true;
  server.close().finally(() => process.exit(code ?? 0));
});
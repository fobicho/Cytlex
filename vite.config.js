import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { setDefaultResultOrder } from 'node:dns';
import { Readable } from 'node:stream';
import { onRequest as handleWebProxy } from './functions/api/proxy.js';

setDefaultResultOrder('ipv4first');

function webProxyDevMiddleware() {
  return {
    name: 'cytlex-web-proxy-dev',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/proxy')) return next();
        try {
          const headers = new Headers();
          for (const [name, value] of Object.entries(req.headers)) {
            if (value) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
          }
          const method = (req.method || 'GET').toUpperCase();
          const chunks = [];
          if (method === 'POST') {
            for await (const chunk of req) chunks.push(chunk);
          }
          const body = method === 'POST' ? Buffer.concat(chunks) : undefined;
          const controller = new AbortController();
          res.once('close', () => controller.abort());
          const request = new Request(new URL(req.url, `http://${req.headers.host || 'localhost'}`), {
            method,
            headers,
            signal: controller.signal,
            ...(body ? { body } : {})
          });
          const response = await handleWebProxy({ request });
          if (res.destroyed) {
            await response.body?.cancel();
            return;
          }
          res.statusCode = response.status;
          response.headers.forEach((value, name) => res.setHeader(name, value));
          if (!response.body) return res.end();
          const stream = Readable.fromWeb(response.body);
          res.once('close', () => stream.destroy());
          stream.once('error', (error) => res.destroy(error));
          stream.pipe(res);
        } catch (error) {
          next(error);
        }
      });
    }
  };
}

export default defineConfig({
  plugins: [react(), webProxyDevMiddleware()],
  base: './',
  server: { port: 5174, strictPort: true },
  build: { outDir: 'dist' }
});

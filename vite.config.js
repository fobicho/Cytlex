import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import dns, { setDefaultResultOrder } from 'node:dns';
import { Readable } from 'node:stream';
import { onRequest as handleWebProxy } from './functions/api/proxy.js';

setDefaultResultOrder('verbatim');

function configureLocalMangaDexDns() {
  if (process.env.CYTLEX_DEV_MANGADEX_DNS !== '1') return;
  const resolver = new dns.Resolver();
  resolver.setServers(['1.1.1.1']);
  const systemLookup = dns.lookup;
  dns.lookup = function (hostname, options, callback) {
    if (hostname !== 'api.mangadex.org' && hostname !== 'uploads.mangadex.org'
      && !hostname.endsWith('.mangadex.network')) return systemLookup.apply(this, arguments);
    if (typeof options === 'function') { callback = options; options = {}; }
    resolver.resolve4(hostname, (error, addresses) => {
      if (error || !addresses?.length) return systemLookup(hostname, options, callback);
      if (options?.all) callback(null, addresses.map((address) => ({ address, family: 4 })));
      else callback(null, addresses[0], 4);
    });
  };
}

function configureWebProxy(server) {
  configureLocalMangaDexDns();
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
        let size = 0;
        for await (const chunk of req.iterator({ destroyOnReturn: false })) {
          size += chunk.length;
          if (size > 1_000_000) {
            res.writeHead(413, { connection: 'close', 'cache-control': 'no-store' });
            return res.end('Request body is too large');
          }
          chunks.push(chunk);
        }
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
      const handleProxy = typeof server.ssrLoadModule === 'function'
        ? (await server.ssrLoadModule('/functions/api/proxy.js')).onRequest
        : handleWebProxy;
      const response = await handleProxy({ request });
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

export default defineConfig({
  plugins: [react(), {
    name: 'cytlex-web-proxy',
    configureServer: (server) => configureWebProxy(server),
    configurePreviewServer: (server) => configureWebProxy(server)
  }],
  base: './',
  server: { port: 5174, strictPort: true },
  build: { outDir: 'dist' }
});

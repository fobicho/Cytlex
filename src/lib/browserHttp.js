const electronBridge = () => (typeof window !== 'undefined' ? window.cytlex : null);
let onfCookieJar = '';
const HTTP_GET_CACHE_TTL_MS = 20 * 1000;
const HTTP_GET_CACHE_MAX = 160;
const HTTP_GET_BATCH_WINDOW_MS = 250;
const HTTP_CATALOG_BATCH_WINDOW_MS = 500;
const HTTP_GET_BATCH_MAX = 50;
const PROXY_IMAGE_BATCH_WINDOW_MS = 30;
const PROXY_IMAGE_BATCH_MAX = 40;
const PROXY_IMAGE_ITEM_MAX_BYTES = 8 * 1024 * 1024;
const PROXY_CHAPTER_IMAGE_BATCH_MAX = 40;
const ACHY_CATALOG_MAX_IMAGES = 49;
const ACHY_CATALOG_METADATA_MAX_BYTES = 64 * 1024 * 1024;
const httpGetCache = new Map();
const httpGetRequests = new Map();
const httpGetBatchQueue = [];
const proxyImageBatchQueue = [];
const mangaDexCatalogImages = new Map();
let httpGetBatchTimer;
let proxyImageBatchTimer;
let httpGetBatchWindowMs = HTTP_GET_BATCH_WINDOW_MS;
const catalogImageKey = (value) => {
  try {
    const url = new URL(value);
    if (url.hostname === 'cdn.achymanga.online') url.searchParams.delete('v');
    url.hash = '';
    return url.href;
  } catch { return value; }
};
const batchHeaderNames = new Set([
  'accept', 'content-type', 'x-requested-with', 'user-agent', 'accept-language',
  'x-cytlex-upstream-origin', 'x-cytlex-upstream-referer'
]);

function mergeCookiePairs(...values) {
  const cookies = new Map();
  for (const value of values) {
    for (const part of String(value || '').split(';')) {
      const pair = part.trim();
      const separator = pair.indexOf('=');
      if (separator <= 0 || /[\r\n;]/.test(pair)) continue;
      const name = pair.slice(0, separator).trim();
      if (!/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(name)) continue;
      cookies.set(name, pair);
    }
  }
  return [...cookies.values()].join('; ').slice(0, 4096);
}

function proxyUrl(targetUrl, referer = '') {
  const configuredProxy = import.meta.env.VITE_CYTLEX_PROXY_URL;
  const endpoint = configuredProxy || '/api/proxy';
  const proxy = new URL(endpoint, window.location.href);
  proxy.searchParams.set('url', targetUrl);
  if (referer) proxy.searchParams.set('referer', referer);
  return proxy.href;
}

export function browserImageUrl(url, referer = '') {
  if (electronBridge()?.fetchImage) return url;
  try {
    const { hostname } = new URL(url);
    const onfCdn = hostname === 'd33y4i2dmzjqjh.cloudfront.net';
    const mangaDexImage = hostname === 'uploads.mangadex.org' || hostname.endsWith('.mangadex.network');
    const sourceImage = hostname === 'images.mangalect.org' || hostname === 'mangalect.org'
      || hostname === 'cdn.achymanga.online'
      || hostname === 'images.komiwa.net' || hostname === 'blogger.googleusercontent.com' || hostname === 's.imgfi.com' || hostname === 'media.mangavault.lat'
      || hostname === 'cdnlxd.xyz' || hostname.endsWith('.cdnlxd.xyz')
      || hostname === 'imagesolymp.xyz' || hostname === 'media.imagesolymp.xyz'
      || hostname === 'olympusxyz.com' || hostname.endsWith('.olympusxyz.com')
      || hostname === 'ntr-files.online' || hostname.endsWith('.ntr-files.online')
      || hostname === 'www.leercapitulo.co' || hostname === 'leercapitulo.co' || hostname.endsWith('.t34798ndc.com')
      || hostname === 'zonatmo.org' || hostname.endsWith('.zonatmo.org');
    if (hostname === 'intomanga.com' || hostname.endsWith('.intomanga.com') || onfCdn || mangaDexImage || sourceImage || (hostname === 'onfmangas.com' && referer)) {
      const proxy = new URL(proxyUrl(url));
      if (referer || onfCdn) proxy.searchParams.set('referer', referer || 'https://onfmangas.com/');
      return proxy.href;
    }
  } catch {}
  return url;
}

function proxyRequestOptions(url, options, onfCookie = '') {
  const headers = new Headers(options.headers || {});
  const proxyHeaders = new Headers(headers);
  const target = new URL(url);
  const requestedOrigin = headers.get('origin');
  const requestedReferer = headers.get('referer');

  proxyHeaders.delete('origin');
  proxyHeaders.delete('referer');

  if (requestedOrigin && new URL(requestedOrigin).origin === target.origin) {
    proxyHeaders.set('x-cytlex-upstream-origin', target.origin);
  }
  if (requestedReferer && new URL(requestedReferer).origin === target.origin) {
    proxyHeaders.set('x-cytlex-upstream-referer', requestedReferer);
  }
  if (target.origin === 'https://onfmangas.com') {
    const cookie = mergeCookiePairs(onfCookie, options.onfCookie);
    if (cookie) proxyHeaders.set('x-cytlex-onf-cookie', cookie);
  }

  return { ...options, headers: proxyHeaders };
}

function proxyRefererFor(target, onfReferer = '') {
  const isOnf = target.origin === 'https://onfmangas.com';
  const isCdnlxdImage = target.hostname === 'cdnlxd.xyz' || target.hostname.endsWith('.cdnlxd.xyz');
  const isKomiwaImage = ['images.komiwa.net', 's.imgfi.com', 'media.mangavault.lat'].includes(target.hostname);
  const isT34798Image = target.hostname === 't34798ndc.com' || target.hostname.endsWith('.t34798ndc.com');
  const isAchyImage = target.hostname === 'cdn.achymanga.online';
  return isOnf || isCdnlxdImage || isKomiwaImage || isT34798Image || isAchyImage
    ? onfReferer || (isAchyImage ? 'https://achymanga.online/' : '')
    : '';
}

function assertProxyResponse(response, target, url, usedProxy, proxyDeniedTarget) {
  if (response.ok) return response;
  const requestOrigin = usedProxy ? response.headers.get('x-cytlex-error-origin')
    : target.origin !== window.location.origin ? 'source' : 'cytlex';
  const reason = usedProxy ? response.headers.get('x-cytlex-upstream-error') : '';
  const retryAfter = response.headers.get('retry-after');
  const resource = target.pathname.startsWith('/reader_image.php/') ? `${target.origin}${target.pathname}` : url;
  const message = reason === 'dns-not-found' ? `DNS ENOTFOUND: Cytlex no pudo resolver ${target.hostname}.`
    : `HTTP ${response.status} al pedir ${resource}${retryAfter ? ` (Retry-After: ${retryAfter})` : ''}`;
  throw Object.assign(new Error(message), {
    status: response.status,
    requestOrigin: proxyDeniedTarget ? 'cytlex' : requestOrigin,
    reason
  });
}

function batchDescriptor({ url, options }) {
  const target = new URL(url);
  const method = (options.method || 'GET').toUpperCase();
  const requestHeaders = new Headers(options.headers || {});
  const forwarded = proxyRequestOptions(url, { ...options, headers: requestHeaders }).headers;
  const headers = Object.fromEntries([...forwarded].filter(([name]) => batchHeaderNames.has(name)));
  const onfCookie = target.hostname === 'onfmangas.com'
    ? mergeCookiePairs(onfCookieJar, options.onfCookie)
    : '';
  return {
    url: target.href,
    method,
    ...(method === 'POST' ? { body: options.body } : {}),
    referer: proxyRefererFor(target, options.onfReferer),
    headers,
    ...(onfCookie ? { onfCookie } : {})
  };
}

function responseFromBatchResult(result) {
  const status = Number(result?.status);
  if (!Number.isInteger(status) || status < 200 || status > 599) return null;
  const headers = new Headers({ 'x-cytlex-proxy': '1' });
  if (result.url) headers.set('x-cytlex-final-url', result.url);
  if (result.contentType) headers.set('content-type', result.contentType);
  if (result.retryAfter) headers.set('retry-after', result.retryAfter);
  if (result.errorOrigin) headers.set('x-cytlex-error-origin', result.errorOrigin);
  if (result.upstreamError) headers.set('x-cytlex-upstream-error', result.upstreamError);
  if (result.proxyDenied) headers.set('x-cytlex-proxy-denied', '1');
  if (result.onfCookie) headers.set('x-cytlex-onf-cookie', result.onfCookie);
  return new Response([204, 205, 304].includes(status) ? null : result.text || '', { status, headers });
}

function preferDirectRequest(target, method) {
  return (method === 'GET' && target.origin === 'https://fobicho.github.io' && target.pathname.startsWith('/Cytlex/'))
    || (method === 'POST' && target.origin === 'https://graphql.anilist.co' && target.pathname === '/');
}

async function runProxyBatch(entries) {
  const resolveEntry = (entry, value) => {
    if (entry.settled) return;
    entry.settled = true;
    entry.resolve(value);
  };
  const rejectEntry = (entry, error) => {
    if (entry.settled) return;
    entry.settled = true;
    entry.reject(error);
  };
  const runIndividually = (pending = entries.filter((entry) => !entry.settled)) => Promise.all(pending.map(async (entry) => {
    try {
      const response = entry.catalog
        ? await fetchMangaDexCatalogRequest(entry.url, entry.options)
        : await browserRequest(entry.url, entry.options);
      resolveEntry(entry, entry.catalog ? await parseMangaDexCatalogResponse(response) : response);
    }
    catch (error) { rejectEntry(entry, error); }
  }));

  const catalogEntries = entries.filter((entry) => entry.catalog);

  const catalogImageBatches = new Map();
  const fallbackTasks = [];
  const fallbackEntry = (entry) => fallbackTasks.push(runIndividually([entry]));
  try {
    const response = await fetch(searchBatchProxyUrl(), {
      method: 'POST',
      credentials: 'omit',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        requests: entries.filter((entry) => !entry.catalog).map(batchDescriptor),
        ...(catalogEntries.length ? { catalogs: catalogEntries.map((entry) => ({ url: entry.url })) } : {})
      })
    });
    if (!response.ok || response.headers.get('x-cytlex-search-batch') !== '1' || !response.body) throw new Error('Proxy batch unavailable');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pendingText = '';
    const processMessage = async (message) => {
      if (!message || message.type === 'start') return;
      if (message.type === 'result') {
        const entry = entries.filter((item) => !item.catalog)[message.index];
        if (!entry || entry.settled) return;
        if (message.result?.fallback) { fallbackEntry(entry); return; }
        const proxied = responseFromBatchResult(message.result);
        if (!proxied) { fallbackEntry(entry); return; }
        const receivedCookie = proxied.headers.get('x-cytlex-onf-cookie') || '';
        if (receivedCookie) onfCookieJar = mergeCookiePairs(onfCookieJar, receivedCookie);
        try {
          resolveEntry(entry, assertProxyResponse(proxied, new URL(entry.url), entry.url,
            proxied.headers.get('x-cytlex-proxy') === '1', proxied.headers.get('x-cytlex-proxy-denied') === '1'));
        } catch (error) { rejectEntry(entry, error); }
        return;
      }
      if (message.type === 'catalog') {
        const catalogIndex = Number(message.index) || 0;
        const entry = catalogEntries[catalogIndex];
        if (!entry || entry.settled) return;
        const headers = new Headers({ 'x-cytlex-proxy': '1', 'content-type': message.contentType || '' });
        if (message.errorOrigin) headers.set('x-cytlex-error-origin', message.errorOrigin);
        if (message.upstreamError) headers.set('x-cytlex-upstream-error', message.upstreamError);
        const response = new Response(null, { status: Number(message.status) || 502, headers });
        try { assertProxyResponse(response, new URL(entry.url), entry.url, true, false); }
        catch (error) { rejectEntry(entry, error); return; }
        if (typeof message.catalog !== 'string' || !Array.isArray(message.images) || message.images.length > 40) {
          rejectEntry(entry, new Error('Respuesta de catálogo no válida.'));
          return;
        }
        const images = message.images.map((imageUrl) => {
          let resolve;
          const promise = new Promise((done) => { resolve = done; });
          const imageEntry = { imageUrl, promise, resolve, done: false };
          mangaDexCatalogImages.set(imageUrl, promise);
          return imageEntry;
        });
        resolveEntry(entry, message.catalog);
        catalogImageBatches.set(catalogIndex, images);
        return;
      }
      if (message.type === 'catalog-image') {
        const images = catalogImageBatches.get(Number(message.catalogIndex) || 0);
        const image = images?.[message.index];
        if (!image || image.done) return;
        image.done = true;
        try {
          const bytes = Uint8Array.from(atob(message.body || ''), (character) => character.charCodeAt(0));
          image.resolve(message.status === 200 && bytes.length <= PROXY_IMAGE_ITEM_MAX_BYTES
            ? new Blob([bytes], { type: message.contentType || '' }) : null);
        } catch { image.resolve(null); }
        return;
      }
    };
    while (true) {
      const { value, done: streamDone } = await reader.read();
      pendingText += decoder.decode(value || new Uint8Array(), { stream: !streamDone });
      let newline;
      while ((newline = pendingText.indexOf('\n')) !== -1) {
        const line = pendingText.slice(0, newline);
        pendingText = pendingText.slice(newline + 1);
        if (line) await processMessage(JSON.parse(line));
      }
      if (streamDone) break;
    }
    if (pendingText.trim()) await processMessage(JSON.parse(pendingText));
    await Promise.all(fallbackTasks);
    await runIndividually();
  } catch {
    await Promise.all(fallbackTasks);
    await runIndividually();
  } finally {
    catalogImageBatches.forEach((images) => images.forEach((image) => {
      if (!image.done) image.resolve(null);
      setTimeout(() => { if (mangaDexCatalogImages.get(image.imageUrl) === image.promise) mangaDexCatalogImages.delete(image.imageUrl); }, 60000);
    }));
  }
}

function flushProxyGetQueue() {
  httpGetBatchTimer = null;
  const entries = httpGetBatchQueue.splice(0, HTTP_GET_BATCH_MAX);
  void runProxyBatch(entries);
  if (httpGetBatchQueue.length) {
    const delay = httpGetBatchQueue.length >= HTTP_GET_BATCH_MAX ? 0 : httpGetBatchWindowMs;
    httpGetBatchTimer = setTimeout(flushProxyGetQueue, delay);
  }
}

function queueProxyGet(entry) {
  httpGetBatchQueue.push(entry);
  if (httpGetBatchQueue.length >= HTTP_GET_BATCH_MAX) {
    clearTimeout(httpGetBatchTimer);
    httpGetBatchTimer = setTimeout(flushProxyGetQueue, 0);
  } else if (!httpGetBatchTimer) {
    const delay = Math.max(httpGetBatchWindowMs, httpGetBatchQueue.some((item) => item.catalog) ? HTTP_CATALOG_BATCH_WINDOW_MS : 0);
    httpGetBatchTimer = setTimeout(flushProxyGetQueue, delay);
  }
}

export function setHttpGetBatchWindow(duration) {
  const previous = httpGetBatchWindowMs;
  httpGetBatchWindowMs = Math.max(0, Number(duration) || 0);
  return () => { httpGetBatchWindowMs = previous; };
}

function scheduleProxyRequest(url, options) {
  const target = new URL(url);
  const configuredProxy = import.meta.env.VITE_CYTLEX_PROXY_URL;
  const proxyEndpoint = new URL(configuredProxy || '/api/proxy', window.location.href);
  const method = (options.method || 'GET').toUpperCase();
  if (preferDirectRequest(target, method)) {
    return browserRequest(url, options);
  }
  const supportedOptions = new Set(['headers', 'onfReferer', 'onfCookie', 'method', 'body', 'sourceId', 'search']);
  if (target.origin === window.location.origin || proxyEndpoint.origin !== window.location.origin || !['GET', 'POST'].includes(method) || options.signal
    || (method === 'POST' && typeof options.body !== 'string')
    || Object.keys(options).some((key) => !supportedOptions.has(key))
    || target.hostname.endsWith('.onfmangas.com')) {
    return browserRequest(url, options);
  }

  return new Promise((resolve, reject) => {
    queueProxyGet({ url, options, resolve, reject });
  });
}

function searchBatchProxyUrl() {
  const configuredProxy = import.meta.env.VITE_CYTLEX_PROXY_URL;
  const endpoint = new URL(configuredProxy || '/api/proxy', window.location.href);
  endpoint.searchParams.delete('url');
  endpoint.searchParams.delete('referer');
  endpoint.searchParams.set('batch', 'search');
  return endpoint.href;
}

function batchImageProxyUrl() {
  const configuredProxy = import.meta.env.VITE_CYTLEX_PROXY_URL;
  const endpoint = new URL(configuredProxy || '/api/proxy', window.location.href);
  endpoint.searchParams.delete('url');
  endpoint.searchParams.delete('referer');
  endpoint.searchParams.set('batch', 'images');
  return endpoint.href;
}

function imageBatchEligible(url, referer, onfCookie, allowOnf = false) {
  try {
    const target = new URL(url);
    const proxyEndpoint = new URL(import.meta.env.VITE_CYTLEX_PROXY_URL || '/api/proxy', window.location.href);
    return proxyEndpoint.origin === window.location.origin
      && target.origin !== window.location.origin
      && (allowOnf || (target.origin !== 'https://onfmangas.com' && !target.hostname.endsWith('.onfmangas.com')))
      && (allowOnf || !onfCookie)
      && browserImageUrl(url, referer) !== url;
  } catch {
    return false;
  }
}

function proxyImageReferer(url, referer) {
  const proxiedUrl = new URL(browserImageUrl(url, referer), window.location.href);
  return proxiedUrl.searchParams.get('referer') || proxyRefererFor(new URL(url), referer);
}

function abortError(signal) {
  if (signal?.reason) return signal.reason;
  const error = new Error('The operation was aborted');
  error.name = 'AbortError';
  return error;
}

function settleProxyImageEntry(entry, method, value) {
  if (entry.settled) return;
  entry.settled = true;
  entry.signal?.removeEventListener('abort', entry.abortListener);
  entry[method](value);
}

function responseFromImageBatchResult(result, payload, dataStart) {
  const status = Number(result?.status);
  const offset = Number(result?.offset);
  const length = Number(result?.length);
  if (!Number.isInteger(status) || status < 200 || status > 599
    || !Number.isSafeInteger(offset) || offset < 0
    || !Number.isSafeInteger(length) || length < 0
    || dataStart + offset + length > payload.size) return null;

  const headers = new Headers({ 'x-cytlex-proxy': '1' });
  if (result.url) headers.set('x-cytlex-final-url', result.url);
  if (result.contentType) headers.set('content-type', result.contentType);
  if (result.retryAfter) headers.set('retry-after', result.retryAfter);
  if (result.errorOrigin) headers.set('x-cytlex-error-origin', result.errorOrigin);
  if (result.upstreamError) headers.set('x-cytlex-upstream-error', result.upstreamError);
  if (result.proxyDenied) headers.set('x-cytlex-proxy-denied', '1');
  if (result.onfCookie) headers.set('x-cytlex-onf-cookie', result.onfCookie.slice(0, 4096));
  const body = [204, 205, 304].includes(status)
    ? null
    : payload.slice(dataStart + offset, dataStart + offset + length, result.contentType || '');
  return new Response(body, { status, headers });
}

export async function fetchImageBlobBatch(entries, signal, onResult) {
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > PROXY_CHAPTER_IMAGE_BATCH_MAX) {
    throw new Error(`El capítulo supera el límite de ${PROXY_CHAPTER_IMAGE_BATCH_MAX} paneles por lote.`);
  }

  const images = entries.map(({ url, referer = '', cookie = '' }) => {
    const requestCookie = mergeCookiePairs(onfCookieJar, cookie);
    if (!imageBatchEligible(url, referer, requestCookie, true)) throw new Error('La imagen no puede incluirse en el lote del capítulo.');
    return {
      url: new URL(url).href,
      referer: proxyImageReferer(url, referer),
      onfCookie: requestCookie
    };
  });
  const response = await fetch(batchImageProxyUrl(), {
    method: 'POST',
    credentials: 'omit',
    signal,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ images, stream: true })
  });
  if (!response.ok || response.headers.get('x-cytlex-image-batch') !== 'stream' || !response.body) {
    throw Object.assign(new Error('No se pudo cargar el lote de imágenes del capítulo.'), { status: response.status });
  }

  const reader = response.body.getReader();
  let buffer = new Uint8Array();
  const readBytes = async (size) => {
    while (buffer.length < size) {
      const { value, done } = await reader.read();
      if (done) throw new Error('La respuesta del lote de imágenes está incompleta.');
      const joined = new Uint8Array(buffer.length + value.length);
      joined.set(buffer); joined.set(value, buffer.length); buffer = joined;
    }
    const result = buffer.slice(0, size);
    buffer = buffer.slice(size);
    return result;
  };
  const seen = new Set();
  for (let count = 0; count < entries.length; count++) {
    const prefix = await readBytes(4);
    const metadataLength = new DataView(prefix.buffer).getUint32(0);
    if (!metadataLength || metadataLength > 512_000) throw new Error('Metadatos de imagen no válidos.');
    const metadata = JSON.parse(new TextDecoder().decode(await readBytes(metadataLength)));
    const { index, length } = metadata;
    if (!Number.isInteger(index) || index < 0 || index >= entries.length || seen.has(index)
      || !Number.isInteger(length) || length < 0 || length > PROXY_IMAGE_ITEM_MAX_BYTES) throw new Error('Respuesta de imagen no válida.');
    seen.add(index);
    const bytes = await readBytes(length);
    const entry = entries[index];
    const target = new URL(entry.url);
    const proxied = responseFromImageBatchResult({ ...metadata, offset: 0 }, new Blob([bytes]), 0);
    if (!proxied) throw new Error('Respuesta de imagen no válida.');
    const denied = proxied.headers.get('x-cytlex-proxy-denied') === '1';
    const receivedCookie = proxied.headers.get('x-cytlex-onf-cookie') || '';
    if (receivedCookie) onfCookieJar = mergeCookiePairs(onfCookieJar, receivedCookie);
    try {
      const checked = assertProxyResponse(proxied, target, entry.url, true, denied);
      const blob = await readImageBlob(checked);
      if (!blob) throw new Error('La fuente no devolvió una imagen válida.');
      await onResult({ blob, error: null }, index);
    } catch (error) {
      await onResult({ blob: null, error }, index);
    }
  }
}

export async function fetchSearchCoverBlobBatch(entries, signal, onResult) {
  const catalogImages = [];
  const remoteImages = [];
  entries.forEach((entry, index) => {
    const catalogImage = mangaDexCatalogImages.get(catalogImageKey(entry.url));
    if (catalogImage) catalogImages.push({ promise: catalogImage, index });
    else remoteImages.push({ ...entry, index });
  });

  const catalogTasks = catalogImages.map(async ({ promise, index }) => {
    try {
      const blob = await promise;
      const validBlob = blob ? await readImageBlob(new Response(blob)) : null;
      await onResult(validBlob ? { blob: validBlob, error: null } : { blob: null, error: new Error('No se pudo cargar la portada.') }, index);
    } catch (error) {
      await onResult({ blob: null, error }, index);
    }
  });
  const remoteTask = remoteImages.length
    ? fetchImageBlobBatch(remoteImages, signal, (result, index) => onResult(result, remoteImages[index].index))
    : Promise.resolve();
  await Promise.all([remoteTask, ...catalogTasks]);
}

async function fetchCombinedChapter(url, signal, chapterType, referer = url) {
  const endpoint = new URL(proxyUrl(url, url));
  endpoint.searchParams.set('chapter', chapterType);
  const headers = new Headers();
  if (chapterType === 'onf' && onfCookieJar) headers.set('x-cytlex-onf-cookie', onfCookieJar);
  const response = await fetch(endpoint, { signal, headers, credentials: 'omit' });
  if (!response.ok || !response.body || !response.headers.get('content-type')?.includes('application/vnd.cytlex.chapter-stream')) {
    const sourceName = { onf: 'ONF', inmanga: 'InManga', mangaoni: 'MangaOni', zonatmo: 'ZonaTMO' }[chapterType] || chapterType;
    throw new Error(`No se pudo usar la carga combinada de ${sourceName}.`);
  }
  const reader = response.body.getReader();
  let buffer = new Uint8Array();
  const read = async (size) => {
    while (buffer.length < size) {
      const { value, done } = await reader.read();
      if (done) throw new Error('La respuesta del capítulo está incompleta.');
      const joined = new Uint8Array(buffer.length + value.length); joined.set(buffer); joined.set(value, buffer.length); buffer = joined;
    }
    const result = buffer.slice(0, size); buffer = buffer.slice(size); return result;
  };
  const metadata = async () => {
    const prefix = await read(4); const size = new DataView(prefix.buffer).getUint32(0);
    if (!size || size > (chapterType === 'achymanga' ? 3 * 1024 * 1024 : 512_000)) throw new Error('Metadatos del capítulo no válidos.');
    return JSON.parse(new TextDecoder().decode(await read(size)));
  };
  const chapter = await metadata();
  if (!Array.isArray(chapter.pages) || !chapter.pages.length || chapter.pages.length > 1000) throw new Error('Lista de páginas no válida.');
  if (chapter.imageCookie) onfCookieJar = mergeCookiePairs(onfCookieJar, chapter.imageCookie);
  const entries = chapter.pages.slice(0, 40).map(() => {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve, done: false };
  });
  void (async () => {
    try {
      for (let i = 0; i < entries.length; i++) {
        const item = await metadata();
        if (!Number.isInteger(item.index) || !entries[item.index] || entries[item.index].done
          || !Number.isInteger(item.length) || item.length < 0 || item.length > PROXY_IMAGE_ITEM_MAX_BYTES) throw new Error('Panel no válido.');
        const bytes = await read(item.length);
        const entry = entries[item.index]; entry.done = true;
        entry.resolve(item.status === 200 && item.length ? new Blob([bytes], { type: item.contentType }) : null);
      }
    } catch {} finally { entries.forEach((entry) => { if (!entry.done) entry.resolve(null); }); }
  })();
  return {
    ...chapter,
    label: chapter.label || '',
    mangaUrl: chapter.mangaUrl || '',
    imageReferer: chapter.imageReferer || referer,
    combinedImages: entries.map((entry) => entry.promise),
    options: chapter.options || [],
    prev: chapter.prev || null,
    next: chapter.next || null
  };
}

export function fetchAchyChapter(url, signal) {
  return fetchCombinedChapter(url, signal, 'achymanga', url);
}

export function fetchOnfChapter(url, signal) {
  return fetchCombinedChapter(url, signal, 'onf', url);
}

export function fetchZonaTmoChapter(url, signal) {
  return fetchCombinedChapter(url, signal, 'zonatmo', 'https://zonatmo.org/');
}

export function fetchInmangaChapter(url, signal) {
  return fetchCombinedChapter(url, signal, 'inmanga', 'https://inmanga.com/');
}

export function fetchMangaOniChapter(url, signal) {
  return fetchCombinedChapter(url, signal, 'mangaoni', url);
}

export async function fetchMangaLectChapter(url, signal) {
  const endpoint = new URL(proxyUrl(url, url));
  endpoint.searchParams.set('chapter', 'mangalect');
  const response = await fetch(endpoint, { signal, credentials: 'omit' });
  if (!response.ok || !response.body || !response.headers.get('content-type')?.includes('application/vnd.cytlex.chapter-stream')) {
    throw new Error('No se pudo usar la carga combinada de MangaLect.');
  }
  const reader = response.body.getReader();
  let buffer = new Uint8Array();
  const read = async (size) => {
    while (buffer.length < size) {
      const { value, done } = await reader.read();
      if (done) throw new Error('La respuesta del capítulo está incompleta.');
      const joined = new Uint8Array(buffer.length + value.length);
      joined.set(buffer); joined.set(value, buffer.length); buffer = joined;
    }
    const value = buffer.slice(0, size);
    buffer = buffer.slice(size);
    return value;
  };
  const metadata = async () => {
    const prefix = await read(4);
    const size = new DataView(prefix.buffer).getUint32(0);
    if (!size || size > 3 * 1024 * 1024) throw new Error('Metadatos del capítulo no válidos.');
    return JSON.parse(new TextDecoder().decode(await read(size)));
  };
  const first = await metadata();
  if (typeof first.html !== 'string' || !Array.isArray(first.pages) || !first.pages.length || first.pages.length > 1000) {
    throw new Error('Lista de páginas de MangaLect no válida.');
  }
  const doc = new DOMParser().parseFromString(first.html, 'text/html');
  const slug = (new URL(url).pathname.match(/\/lectura\/([^/]+)\//) || [])[1] || '';
  const href = (selector) => {
    const value = doc.querySelector(selector)?.getAttribute('href') || '';
    try { return value ? new URL(value, url).href : ''; } catch { return ''; }
  };
  const entries = first.pages.slice(0, 40).map(() => {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve, done: false };
  });
  void (async () => {
    try {
      for (let i = 0; i < entries.length; i++) {
        const item = await metadata();
        if (!Number.isInteger(item.index) || !entries[item.index] || entries[item.index].done
          || !Number.isInteger(item.length) || item.length < 0 || item.length > PROXY_IMAGE_ITEM_MAX_BYTES) throw new Error('Panel de MangaLect no válido.');
        const bytes = await read(item.length);
        const entry = entries[item.index];
        entry.done = true;
        entry.resolve(item.status === 200 && item.length ? new Blob([bytes], { type: item.contentType }) : null);
      }
    } catch {} finally { entries.forEach((entry) => { if (!entry.done) entry.resolve(null); }); }
  })();
  const previous = href('a.prev-button');
  const next = href('a.next-button');
  return {
    label: doc.querySelector('h1')?.textContent?.replace(/\s+/g, ' ').trim() || '',
    mangaUrl: slug ? new URL(`/info/${slug}/`, url).href : '',
    pages: first.pages,
    combinedImages: entries.map((entry) => entry.promise),
    options: [],
    prev: previous ? { title: 'Anterior', url: previous } : null,
    next: next ? { title: 'Siguiente', url: next } : null
  };
}

async function runProxyImageBatch(entries) {
  const fallbackIndividually = async () => Promise.all(entries.map(async (entry) => {
    if (entry.cancelled || entry.settled) return;
    try { settleProxyImageEntry(entry, 'resolve', await browserRequest(entry.url, entry.options)); }
    catch (error) { settleProxyImageEntry(entry, 'reject', error); }
  }));

  const controller = new AbortController();
  const batchState = { controller, entries };
  entries.forEach((entry) => { entry.dispatched = true; entry.batchState = batchState; });
  try {
    await fetchImageBlobBatch(entries, controller.signal, async ({ blob, error }, index) => {
      const entry = entries[index];
      if (entry.cancelled || entry.settled) return;
      if (error) {
        if (error.status && error.status !== 413) {
          settleProxyImageEntry(entry, 'reject', error);
          return;
        }
        try { settleProxyImageEntry(entry, 'resolve', await browserRequest(entry.url, entry.options)); }
        catch (error) { settleProxyImageEntry(entry, 'reject', error); }
        return;
      }
      settleProxyImageEntry(entry, 'resolve', new Response(blob, { status: 200, headers: { 'content-type': blob.type } }));
    });
  } catch {
    await fallbackIndividually();
  }
}

function flushProxyImageQueue() {
  proxyImageBatchTimer = null;
  const entries = proxyImageBatchQueue.splice(0, PROXY_IMAGE_BATCH_MAX).filter((entry) => !entry.cancelled && !entry.settled);
  if (entries.length) void runProxyImageBatch(entries);
  if (proxyImageBatchQueue.length) proxyImageBatchTimer = setTimeout(flushProxyImageQueue, PROXY_IMAGE_BATCH_WINDOW_MS);
}

function scheduleProxyImageRequest(url, signal, referer, onfCookie) {
  if (!imageBatchEligible(url, referer, onfCookie)) return browserRequest(url, { signal, onfReferer: referer, onfCookie });
  return new Promise((resolve, reject) => {
    const entry = { url, signal, referer, options: { signal, onfReferer: referer, onfCookie }, resolve, reject, settled: false, dispatched: false, cancelled: false };
    entry.abortListener = () => {
      entry.cancelled = true;
      if (!entry.dispatched) {
        const index = proxyImageBatchQueue.indexOf(entry);
        if (index !== -1) proxyImageBatchQueue.splice(index, 1);
      }
      settleProxyImageEntry(entry, 'reject', abortError(signal));
      if (entry.batchState?.entries.every((batchEntry) => batchEntry.cancelled || batchEntry.settled)) {
        entry.batchState.controller.abort();
      }
    };
    if (signal?.aborted) {
      entry.abortListener();
      return;
    }
    signal?.addEventListener('abort', entry.abortListener, { once: true });
    proxyImageBatchQueue.push(entry);
    if (proxyImageBatchQueue.length >= PROXY_IMAGE_BATCH_MAX) {
      clearTimeout(proxyImageBatchTimer);
      proxyImageBatchTimer = setTimeout(flushProxyImageQueue, 0);
    } else if (!proxyImageBatchTimer) {
      proxyImageBatchTimer = setTimeout(flushProxyImageQueue, PROXY_IMAGE_BATCH_WINDOW_MS);
    }
  });
}

function requestImage(url, signal, referer = '', onfCookie = '') {
  const catalogImage = mangaDexCatalogImages.get(catalogImageKey(url));
  if (catalogImage) return catalogImage.then((blob) => {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (!blob) throw new Error('No se pudo cargar la portada de MangaDex.');
    return new Response(blob, { status: 200, headers: { 'content-type': blob.type } });
  });
  return scheduleProxyImageRequest(url, signal, referer, onfCookie);
}

export function getCatalogImageBlob(url) {
  return mangaDexCatalogImages.get(catalogImageKey(url)) || null;
}

async function fetchMangaDexCatalogRequest(url, options) {
  const endpoint = new URL(proxyUrl(url), window.location.href);
  endpoint.searchParams.set('catalog', 'mangadex');
  const response = await fetch(endpoint.href, proxyRequestOptions(url, { credentials: 'omit', ...options }));
  assertProxyResponse(response, new URL(url), url, true, false);
  return response;
}

async function fetchAchyCatalogRequest(url, options) {
  const endpoint = new URL(proxyUrl(url), window.location.href);
  endpoint.searchParams.set('catalog', 'achymanga');
  const response = await fetch(endpoint.href, proxyRequestOptions(url, { credentials: 'omit', ...options }));
  assertProxyResponse(response, new URL(url), url, true, false);
  return response;
}

async function fetchOlympusDetailRequest(url, options) {
  const endpoint = new URL(proxyUrl(url), window.location.href);
  endpoint.searchParams.set('detail', 'olympus');
  const response = await fetch(endpoint.href, proxyRequestOptions(url, { credentials: 'omit', ...options }));
  assertProxyResponse(response, new URL(url), url, true, false);
  return response.text();
}

async function fetchOnfDetailRequest(url, options) {
  const endpoint = new URL(proxyUrl(url), window.location.href);
  endpoint.searchParams.set('detail', 'onf');
  const response = await fetch(endpoint.href, proxyRequestOptions(url, { credentials: 'omit', ...options }));
  assertProxyResponse(response, new URL(url), url, true, false);
  const payload = await response.json();
  if (typeof payload.html !== 'string') throw new Error('Respuesta de detalle de ONF no válida.');
  if (payload.cover?.url && payload.cover?.base64 && payload.cover?.contentType) {
    try {
      const bytes = Uint8Array.from(atob(payload.cover.base64), (character) => character.charCodeAt(0));
      if (bytes.length <= PROXY_IMAGE_ITEM_MAX_BYTES) {
        const promise = Promise.resolve(new Blob([bytes], { type: payload.cover.contentType }));
        const key = catalogImageKey(payload.cover.url);
        mangaDexCatalogImages.set(key, promise);
        setTimeout(() => { if (mangaDexCatalogImages.get(key) === promise) mangaDexCatalogImages.delete(key); }, 60000);
      }
    } catch {}
  }
  return payload.html;
}

async function fetchMangaDexFeedRequest(url, options) {
  const endpoint = new URL(proxyUrl(url), window.location.href);
  endpoint.searchParams.set('detail', 'mangadex-feed');
  const response = await fetch(endpoint.href, proxyRequestOptions(url, { credentials: 'omit', ...options }));
  assertProxyResponse(response, new URL(url), url, true, false);
  return response.text();
}

async function fetchMangaDexDetailRequest(url, options) {
  const endpoint = new URL(proxyUrl(url), window.location.href);
  endpoint.searchParams.set('detail', 'mangadex-detail');
  const response = await fetch(endpoint.href, proxyRequestOptions(url, { credentials: 'omit', ...options }));
  assertProxyResponse(response, new URL(url), url, true, false);
  return response.text();
}

function mangaDexCatalogRequest(url, options) {
  return new Promise((resolve, reject) => {
    queueProxyGet({ url, options, resolve, reject, catalog: true });
  });
}

async function parseMangaDexCatalogResponse(response) {
  if (!response.body || !response.headers.get('content-type')?.includes('application/vnd.cytlex.catalog-stream')) throw new Error('Respuesta de catálogo no válida.');
  const reader = response.body.getReader();
  let buffer = new Uint8Array();
  const read = async (size) => {
    while (buffer.length < size) {
      const { value, done } = await reader.read();
      if (done) throw new Error('Respuesta de catálogo incompleta.');
      const joined = new Uint8Array(buffer.length + value.length);
      joined.set(buffer); joined.set(value, buffer.length); buffer = joined;
    }
    const value = buffer.slice(0, size); buffer = buffer.slice(size); return value;
  };
  const metadata = async () => {
    const prefix = await read(4);
    const size = new DataView(prefix.buffer).getUint32(0);
    if (!size || size > 3 * 1024 * 1024) throw new Error('Metadatos de catálogo no válidos.');
    return JSON.parse(new TextDecoder().decode(await read(size)));
  };
  const first = await metadata();
  if (typeof first.catalog !== 'string' || !Array.isArray(first.images) || first.images.length > 40) throw new Error('Catálogo no válido.');
  const entries = first.images.map((imageUrl) => {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    mangaDexCatalogImages.set(imageUrl, promise);
    return { imageUrl, promise, resolve, done: false };
  });
  void (async () => {
    try {
      for (let i = 0; i < entries.length; i++) {
        const result = await metadata();
        if (!Number.isInteger(result.index) || !entries[result.index] || entries[result.index].done
          || !Number.isInteger(result.length) || result.length < 0 || result.length > PROXY_IMAGE_ITEM_MAX_BYTES) throw new Error('Portada no válida.');
        const bytes = await read(result.length);
        const entry = entries[result.index]; entry.done = true;
        entry.resolve(result.status === 200 && result.length ? new Blob([bytes], { type: result.contentType }) : null);
      }
    } catch {} finally {
      entries.forEach((entry) => {
        if (!entry.done) entry.resolve(null);
        setTimeout(() => { if (mangaDexCatalogImages.get(entry.imageUrl) === entry.promise) mangaDexCatalogImages.delete(entry.imageUrl); }, 60000);
      });
    }
  })();
  return first.catalog;
}

async function parseAchyCatalogResponse(response) {
  if (!response.body || !response.headers.get('content-type')?.includes('application/vnd.cytlex.catalog-stream')) throw new Error('Respuesta de catálogo de AchyManga no válida.');
  const reader = response.body.getReader();
  let buffer = new Uint8Array();
  const read = async (size) => {
    while (buffer.length < size) {
      const { value, done } = await reader.read();
      if (done) throw new Error('Respuesta de catálogo de AchyManga incompleta.');
      const joined = new Uint8Array(buffer.length + value.length);
      joined.set(buffer); joined.set(value, buffer.length); buffer = joined;
    }
    const value = buffer.slice(0, size); buffer = buffer.slice(size); return value;
  };
  const metadata = async () => {
    const prefix = await read(4);
    const size = new DataView(prefix.buffer).getUint32(0);
    if (!size || size > ACHY_CATALOG_METADATA_MAX_BYTES) throw new Error('Metadatos de catálogo no válidos.');
    return JSON.parse(new TextDecoder().decode(await read(size)));
  };
  const first = await metadata();
  if (typeof first.catalog !== 'string' || !Array.isArray(first.images) || first.images.length > ACHY_CATALOG_MAX_IMAGES) throw new Error('Catálogo no válido.');
  const entries = first.images.map((imageUrl) => {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    mangaDexCatalogImages.set(catalogImageKey(imageUrl), promise);
    return { imageUrl, promise, resolve, done: false };
  });
  void (async () => {
    try {
      for (let i = 0; i < entries.length; i++) {
        const result = await metadata();
        if (!Number.isInteger(result.index) || !entries[result.index] || entries[result.index].done
          || !Number.isInteger(result.length) || result.length < 0 || result.length > PROXY_IMAGE_ITEM_MAX_BYTES) throw new Error('Portada no válida.');
        const bytes = await read(result.length);
        const entry = entries[result.index]; entry.done = true;
        entry.resolve(result.status === 200 && result.length ? new Blob([bytes], { type: result.contentType }) : null);
      }
    } catch {} finally {
      entries.forEach((entry) => {
        if (!entry.done) entry.resolve(null);
        setTimeout(() => { if (mangaDexCatalogImages.get(catalogImageKey(entry.imageUrl)) === entry.promise) mangaDexCatalogImages.delete(catalogImageKey(entry.imageUrl)); }, 60000);
      });
    }
  })();
  return first.catalog;
}

async function browserRequest(url, options = {}) {
  const target = new URL(url);
  const { onfCookie = '', onfReferer = '', ...fetchOptions } = options;
  const requestHeaders = new Headers(fetchOptions.headers || {});
  const isOnf = target.origin === 'https://onfmangas.com';
  const proxyReferer = proxyRefererFor(target, onfReferer);
  const requestCookie = isOnf ? mergeCookiePairs(onfCookieJar, onfCookie) : '';
  if (isOnf && requestCookie) requestHeaders.set('x-cytlex-onf-cookie', requestCookie);
  let response;
  let proxyDeniedTarget = false;
  let usedProxy = false;
  const requestOptions = { credentials: 'omit', redirect: 'follow', ...fetchOptions, headers: requestHeaders };
  const directOptions = { ...fetchOptions, headers: new Headers(fetchOptions.headers || {}) };

  if (target.origin === window.location.origin) {
    response = await fetch(url, directOptions);
  } else if ((fetchOptions.method || 'GET').toUpperCase() === 'GET'
    && target.origin === 'https://fobicho.github.io' && target.pathname.startsWith('/Cytlex/')) {
    response = await fetch(url, { credentials: 'omit', ...directOptions });
  } else if (preferDirectRequest(target, (fetchOptions.method || 'GET').toUpperCase())) {
    try {
      response = await fetch(url, { credentials: 'omit', ...directOptions });
    } catch (error) {
      if (requestOptions.signal?.aborted) throw error;
      const proxied = await fetch(proxyUrl(url), proxyRequestOptions(url, requestOptions));
      usedProxy = proxied.headers.get('x-cytlex-proxy') === '1';
      proxyDeniedTarget = proxied.headers.get('x-cytlex-proxy-denied') === '1';
      response = proxied;
    }
  } else {
    try {
      let proxied = await fetch(proxyUrl(url, proxyReferer), proxyRequestOptions(url, requestOptions, requestCookie));
      const proxyIsLive = proxied.headers.get('x-cytlex-proxy') === '1';
      proxyDeniedTarget = proxied.headers.get('x-cytlex-proxy-denied') === '1';
      usedProxy = proxyIsLive && !proxyDeniedTarget;
      response = usedProxy ? proxied : await fetch(url, directOptions);
      if (isOnf && usedProxy) {
        const receivedCookie = proxied.headers.get('x-cytlex-onf-cookie') || '';
        const nextCookie = mergeCookiePairs(requestCookie, receivedCookie);
        if (receivedCookie) onfCookieJar = nextCookie;
        if (nextCookie && nextCookie !== requestCookie && (fetchOptions.method || 'GET').toUpperCase() === 'GET') {
          try { await proxied.body?.cancel(); } catch {}
          proxied = await fetch(proxyUrl(url, proxyReferer), proxyRequestOptions(url, requestOptions, nextCookie));
          const refreshedCookie = proxied.headers.get('x-cytlex-onf-cookie') || '';
          if (refreshedCookie) onfCookieJar = mergeCookiePairs(nextCookie, refreshedCookie);
          response = proxied;
        }
      }
    } catch (error) {
      if (requestOptions.signal?.aborted) throw error;
      throw Object.assign(new Error('No se pudo conectar con la fuente.'), {
        requestOrigin: proxyDeniedTarget ? 'cytlex' : 'connection',
        status: proxyDeniedTarget ? 403 : undefined
      });
    }
  }
  return assertProxyResponse(response, target, url, usedProxy, proxyDeniedTarget);
}

export function sourceErrorMessage(error, name, fallback = '') {
  const message = String(error?.message || error || '');
  const status = error?.status || message.match(/\bHTTP (\d{3})\b/)?.[1];
  const code = status ? ` (HTTP ${status})` : '';
  const sourceName = name || 'La fuente';
  if (error?.reason === 'cloudflare') {
    return `${sourceName} respondió con una verificación de Cloudflare${code}. Cytlex no pudo obtener el contenido.`;
  }
  if (String(sourceName).toLowerCase() === 'lectorxd' && Number(status) === 403) {
    return 'LectorXD respondió con una verificación de Cloudflare (HTTP 403). Cytlex no pudo obtener los capítulos.';
  }
  if (error?.requestOrigin === 'cytlex') {
    if (status === 403) return 'Cytlex bloqueó la solicitud porque la dirección no está permitida (HTTP 403).';
    if (status === 508) return 'Cytlex detuvo la solicitud por demasiadas redirecciones (HTTP 508).';
    return `La solicitud falló dentro de Cytlex${code}.`;
  }
  if (error?.requestOrigin === 'connection') {
    if (error.reason === 'timeout') return `Cytlex no recibió a tiempo una respuesta de ${name || 'la fuente'}${code}.`;
    if (error.reason === 'dns-not-found') return `Cytlex no pudo encontrar el servidor de ${name || 'la fuente'}${code}.`;
    return `Cytlex no pudo conectarse con ${name || 'la fuente'}${code}.`;
  }
  if (error?.requestOrigin === 'source') {
    if (status === 403) return `${sourceName} rechazó la solicitud${code}.`;
    if (status === 404) return `${sourceName} no encontró el contenido solicitado${code}.`;
    if (status === 429) return `${sourceName} limitó temporalmente las solicitudes${code}.`;
    return `${sourceName} devolvió un error${code}.`;
  }
  if (status) return `La solicitud falló${code}. No se pudo determinar el origen del error.`;
  return message || fallback;
}

export async function httpGet(url, requestId, options = {}) {
  const bridge = electronBridge();
  if (bridge?.httpGet) return bridge.httpGet(url, requestId, options);
  const { includeUrl, ...requestOptions } = options;
  const target = new URL(url);
  if (requestOptions.onfMangaDetail === true && target.origin === 'https://onfmangas.com'
    && /^\/manga\/\d+\/[^/]+\/?$/.test(target.pathname)) {
    const detailOptions = { ...requestOptions };
    delete detailOptions.onfMangaDetail;
    const key = `onf-detail:${target.href}`;
    let request = httpGetRequests.get(key);
    if (!request) {
      request = fetchOnfDetailRequest(url, detailOptions);
      httpGetRequests.set(key, request);
    }
    try {
      const text = await request;
      return includeUrl ? { text, url } : text;
    } finally {
      if (httpGetRequests.get(key) === request) httpGetRequests.delete(key);
    }
  }
  if (requestOptions.mangaDexDetail === true && target.origin === 'https://api.mangadex.org'
    && /^\/manga\/[0-9a-f-]{36}\/feed$/i.test(target.pathname)
    && target.searchParams.get('limit') === '500') {
    const detailOptions = { ...requestOptions };
    delete detailOptions.mangaDexDetail;
    const key = `mangadex-detail:${target.href}`;
    let request = httpGetRequests.get(key);
    if (!request) {
      request = fetchMangaDexDetailRequest(url, detailOptions);
      httpGetRequests.set(key, request);
    }
    try {
      const text = await request;
      return includeUrl ? { text, url } : text;
    } finally {
      if (httpGetRequests.get(key) === request) httpGetRequests.delete(key);
    }
  }
  if (requestOptions.achyCatalog === true && target.origin === 'https://achymanga.online' && target.pathname === '/catalogo') {
    const catalogOptions = { ...requestOptions };
    delete catalogOptions.achyCatalog;
    const key = `achymanga-catalog:${target.href}`;
    let request = httpGetRequests.get(key);
    if (!request) {
      request = fetchAchyCatalogRequest(url, catalogOptions).then(parseAchyCatalogResponse);
      httpGetRequests.set(key, request);
    }
    try {
      const text = await request;
      return includeUrl ? { text, url } : text;
    } finally {
      if (httpGetRequests.get(key) === request) httpGetRequests.delete(key);
    }
  }
  if (requestOptions.olympusDetail === true && target.origin === 'https://olympusxyz.com'
    && /^\/api\/series\/[^/]+$/.test(target.pathname)) {
    const detailOptions = { ...requestOptions };
    delete detailOptions.olympusDetail;
    const key = `olympus-detail:${target.href}`;
    let request = httpGetRequests.get(key);
    if (!request) {
      request = fetchOlympusDetailRequest(url, detailOptions);
      httpGetRequests.set(key, request);
    }
    try {
      const text = await request;
      return includeUrl ? { text, url } : text;
    } finally {
      if (httpGetRequests.get(key) === request) httpGetRequests.delete(key);
    }
  }
  if (target.origin === 'https://api.mangadex.org'
    && /^\/manga\/[0-9a-f-]{36}\/feed$/i.test(target.pathname)
    && target.searchParams.get('limit') === '500') {
    const key = `mangadex-feed:${target.href}`;
    let request = httpGetRequests.get(key);
    if (!request) {
      request = fetchMangaDexFeedRequest(url, requestOptions);
      httpGetRequests.set(key, request);
    }
    try {
      const text = await request;
      return includeUrl ? { text, url } : text;
    } finally {
      if (httpGetRequests.get(key) === request) httpGetRequests.delete(key);
    }
  }
  if (target.origin === 'https://api.mangadex.org' && target.pathname === '/manga'
    && target.searchParams.get('limit') === '40' && target.searchParams.getAll('includes[]').includes('cover_art')) {
    const key = `mangadex-catalog:${target.href}`;
    let request = httpGetRequests.get(key);
    if (!request) {
      request = mangaDexCatalogRequest(url, requestOptions);
      httpGetRequests.set(key, request);
    }
    try {
      const text = await request;
      return includeUrl ? { text, url } : text;
    } finally {
      if (httpGetRequests.get(key) === request) httpGetRequests.delete(key);
    }
  }
  const headers = new Headers(requestOptions.headers || {});
  const canCache = !requestOptions.signal
    && requestOptions.search !== true
    && requestOptions.cache !== 'no-store'
    && requestOptions.cache !== 'no-cache'
    && (!requestOptions.method || requestOptions.method.toUpperCase() === 'GET')
    && !/\b(?:no-cache|no-store)\b/i.test(headers.get('cache-control') || '')
    && !headers.has('authorization')
    && !headers.has('cookie')
    && target.hostname !== 'onfmangas.com'
    && !target.hostname.endsWith('.onfmangas.com');

  if (!canCache) {
    const response = await scheduleProxyRequest(url, requestOptions);
    const text = await response.text();
    if (!includeUrl) return text;
    const finalUrl = response.headers.get('x-cytlex-final-url') || response.url || url;
    return { text, url: finalUrl };
  }

  const headerKey = [...headers.entries()].sort(([a], [b]) => a.localeCompare(b));
  const key = JSON.stringify([target.href, requestOptions.onfReferer || '', requestOptions.redirect || 'follow', headerKey]);
  const cached = httpGetCache.get(key);
  if (cached && Date.now() - cached.at < HTTP_GET_CACHE_TTL_MS) {
    httpGetCache.delete(key);
    httpGetCache.set(key, cached);
    return includeUrl ? { text: cached.text, url: cached.url } : cached.text;
  }
  if (cached) httpGetCache.delete(key);

  let request = httpGetRequests.get(key);
  if (!request) {
    request = (async () => {
      const response = await scheduleProxyRequest(url, requestOptions);
      const text = await response.text();
      const finalUrl = response.headers.get('x-cytlex-final-url') || response.url || url;
      const entry = { at: Date.now(), text, url: finalUrl };
      httpGetCache.set(key, entry);
      while (httpGetCache.size > HTTP_GET_CACHE_MAX) httpGetCache.delete(httpGetCache.keys().next().value);
      return entry;
    })();
    httpGetRequests.set(key, request);
  }

  try {
    const entry = await request;
    return includeUrl ? { text: entry.text, url: entry.url } : entry.text;
  } finally {
    if (httpGetRequests.get(key) === request) httpGetRequests.delete(key);
  }
}

export async function httpHead(url) {
  const bridge = electronBridge();
  if (bridge?.httpHead) return bridge.httpHead(url);
  const response = await browserRequest(url, { method: 'HEAD' });
  return {
    ok: true,
    status: response.status,
    length: Number(response.headers.get('content-length')) || 0,
    type: response.headers.get('content-type') || ''
  };
}

export async function httpPost(payload, requestId) {
  const bridge = electronBridge();
  if (bridge?.httpPost) return bridge.httpPost(payload, requestId);
  const response = await scheduleProxyRequest(payload.url, {
    method: 'POST',
    ...(payload.search === true && typeof payload.sourceId === 'string' ? { search: true, sourceId: payload.sourceId } : {}),
    onfReferer: payload.onfReferer,
    onfCookie: payload.onfCookie,
    headers: { 'Content-Type': 'application/json', ...payload.headers },
    body: typeof payload.body === 'string' ? payload.body : JSON.stringify(payload.body)
  });
  const text = await response.text();
  return payload.responseType === 'text' ? text : JSON.parse(text);
}

function imageMimeFromBytes(bytes, contentType = '') {
  const ascii = (start, length) => String.fromCharCode(...bytes.subarray(start, start + length));
  if (!bytes.length) return '';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (ascii(0, 8) === '\x89PNG\r\n\x1a\n') return 'image/png';
  if (ascii(0, 4) === 'GIF8') return 'image/gif';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return 'image/webp';
  if (ascii(4, 4) === 'ftyp' && /(?:avif|avis)/.test(ascii(8, Math.min(bytes.length - 8, 64)))) return 'image/avif';
  if (ascii(0, 2) === 'BM') return 'image/bmp';
  const prefix = new TextDecoder().decode(bytes.subarray(0, 512)).replace(/^\uFEFF/, '').trimStart();
  if (/^(?:<\?xml[^>]*>\s*)?<svg[\s>]/i.test(prefix)) return 'image/svg+xml';
  // ONF may return an image format with a brand or container not covered by
  // the signatures above. Trust an image content type only after rejecting
  // recognizable HTML/JSON challenge bodies.
  if (/^(?:<!doctype\s+html|<html[\s>]|<head[\s>]|<body[\s>]|<script[\s>]|\{\s*["']|\[\s*\{)/i.test(prefix)) return '';
  const declaredMime = String(contentType).split(';', 1)[0].trim().toLowerCase();
  if (declaredMime.startsWith('image/')) return declaredMime === 'image/jpg' ? 'image/jpeg' : declaredMime;
  return '';
}

function validImageResult(bytes, contentType = '') {
  const mime = imageMimeFromBytes(bytes, contentType);
  if (!mime) return null;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return { mime, base64: btoa(binary) };
}

export async function fetchCoverBlob(url, signal) {
  const response = await requestImage(url, signal);
  return readImageBlob(response);
}

async function readImageBlob(response) {
  const blob = await response.blob();
  const prefix = new Uint8Array(await blob.slice(0, 512).arrayBuffer());
  const mime = imageMimeFromBytes(prefix, blob.type);
  return mime ? blob.slice(0, blob.size, mime) : null;
}

export async function fetchImageBlob(url, signal, referer = '', onfCookie = '') {
  const bridge = electronBridge();
  for (let attempt = 0; ; attempt += 1) {
    try {
      if (bridge?.fetchImage) {
        const image = await bridge.fetchImage(url, referer, onfCookie);
        if (signal?.aborted || !image?.base64) return null;
        const binary = atob(image.base64);
        const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
        const mime = imageMimeFromBytes(bytes, image.mime);
        return mime ? new Blob([bytes], { type: mime }) : null;
      }
      return readImageBlob(await requestImage(url, signal, referer, onfCookie));
    } catch (error) {
      if (signal?.aborted || error?.status || attempt >= 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
    }
  }
}

function imageFromBase64(image) {
  if (!image?.base64) return null;
  try {
    const binary = atob(image.base64);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return validImageResult(bytes, image.mime);
  } catch {
    return null;
  }
}

export async function fetchImage(url, signal, referer = '', onfCookie = '') {
  const bridge = electronBridge();
  if (bridge?.fetchImage) {
    const image = await bridge.fetchImage(url, referer, onfCookie);
    return signal?.aborted ? null : imageFromBase64(image);
  }
  const response = await requestImage(url, signal, referer, onfCookie);
  const blob = await response.blob();
  return validImageResult(new Uint8Array(await blob.arrayBuffer()), blob.type || response.headers.get('content-type') || '');
}

const electronBridge = () => (typeof window !== 'undefined' ? window.cytlex : null);
let onfCookieJar = '';
const HTTP_GET_CACHE_TTL_MS = 20 * 1000;
const HTTP_GET_CACHE_MAX = 160;
const HTTP_GET_BATCH_WINDOW_MS = 30;
const HTTP_GET_BATCH_MAX = 12;
const PROXY_IMAGE_BATCH_WINDOW_MS = 30;
const PROXY_IMAGE_BATCH_MAX = 4;
const PROXY_CHAPTER_IMAGE_BATCH_MAX = 40;
const PROXY_CHAPTER_IMAGE_BATCH_MAX_BYTES = 80 * 1024 * 1024;
const httpGetCache = new Map();
const httpGetRequests = new Map();
const httpGetBatchQueue = [];
const proxyImageBatchQueue = [];
let httpGetBatchTimer;
let proxyImageBatchTimer;
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
  const requestHeaders = new Headers(options.headers || {});
  const forwarded = proxyRequestOptions(url, { ...options, headers: requestHeaders }).headers;
  const headers = Object.fromEntries([...forwarded].filter(([name]) => batchHeaderNames.has(name)));
  return { url: target.href, referer: proxyRefererFor(target, options.onfReferer), headers };
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
  return new Response([204, 205, 304].includes(status) ? null : result.text || '', { status, headers });
}

async function runProxyBatch(entries) {
  const runIndividually = () => Promise.all(entries.map(async (entry) => {
    try { entry.resolve(await browserRequest(entry.url, entry.options)); }
    catch (error) { entry.reject(error); }
  }));

  if (entries.length < 2) {
    await runIndividually();
    return;
  }

  try {
    const response = await fetch(batchProxyUrl(), {
      method: 'POST',
      credentials: 'omit',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requests: entries.map(batchDescriptor) })
    });
    if (!response.ok || response.headers.get('x-cytlex-proxy-batch') !== '1') throw new Error('Proxy batch unavailable');
    const payload = await response.json();
    if (!Array.isArray(payload?.results) || payload.results.length !== entries.length) throw new Error('Invalid proxy batch response');
    await Promise.all(entries.map(async (entry, index) => {
      const result = payload.results[index];
      if (result?.fallback) {
        try { entry.resolve(await browserRequest(entry.url, entry.options)); }
        catch (error) { entry.reject(error); }
        return;
      }
      const proxied = responseFromBatchResult(result);
      if (!proxied) {
        try { entry.resolve(await browserRequest(entry.url, entry.options)); }
        catch (error) { entry.reject(error); }
        return;
      }
      const target = new URL(entry.url);
      const usedProxy = proxied.headers.get('x-cytlex-proxy') === '1';
      const denied = proxied.headers.get('x-cytlex-proxy-denied') === '1';
      try { entry.resolve(assertProxyResponse(proxied, target, entry.url, usedProxy, denied)); }
      catch (error) { entry.reject(error); }
    }));
  } catch {
    await runIndividually();
  }
}

function flushProxyGetQueue() {
  httpGetBatchTimer = null;
  const entries = httpGetBatchQueue.splice(0, HTTP_GET_BATCH_MAX);
  void runProxyBatch(entries);
  if (httpGetBatchQueue.length) httpGetBatchTimer = setTimeout(flushProxyGetQueue, HTTP_GET_BATCH_WINDOW_MS);
}

function scheduleProxyGet(url, options) {
  const target = new URL(url);
  const configuredProxy = import.meta.env.VITE_CYTLEX_PROXY_URL;
  const proxyEndpoint = new URL(configuredProxy || '/api/proxy', window.location.href);
  const method = (options.method || 'GET').toUpperCase();
  const supportedOptions = new Set(['headers', 'onfReferer']);
  if (target.origin === window.location.origin || proxyEndpoint.origin !== window.location.origin || method !== 'GET' || options.signal
    || Object.keys(options).some((key) => !supportedOptions.has(key))
    || target.hostname === 'onfmangas.com' || target.hostname.endsWith('.onfmangas.com')) {
    return browserRequest(url, options);
  }

  return new Promise((resolve, reject) => {
    httpGetBatchQueue.push({ url, options, resolve, reject });
    if (httpGetBatchQueue.length >= HTTP_GET_BATCH_MAX) {
      clearTimeout(httpGetBatchTimer);
      httpGetBatchTimer = setTimeout(flushProxyGetQueue, 0);
    } else if (!httpGetBatchTimer) {
      httpGetBatchTimer = setTimeout(flushProxyGetQueue, HTTP_GET_BATCH_WINDOW_MS);
    }
  });
}

function batchProxyUrl() {
  const configuredProxy = import.meta.env.VITE_CYTLEX_PROXY_URL;
  const endpoint = new URL(configuredProxy || '/api/proxy', window.location.href);
  endpoint.searchParams.delete('url');
  endpoint.searchParams.delete('referer');
  endpoint.searchParams.set('batch', '1');
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

async function unpackImageBatch(response, expectedCount) {
  if (!response.ok || response.headers.get('x-cytlex-image-batch') !== '1') return null;
  const payload = await response.blob();
  if (payload.size < 4 || payload.size > PROXY_CHAPTER_IMAGE_BATCH_MAX_BYTES + 512_004) return null;
  const prefix = new DataView(await payload.slice(0, 4).arrayBuffer());
  const metadataLength = prefix.getUint32(0);
  if (!metadataLength || metadataLength > 512_000 || 4 + metadataLength > payload.size) return null;

  let metadata;
  try { metadata = JSON.parse(await payload.slice(4, 4 + metadataLength).text()); }
  catch { return null; }
  if (!Array.isArray(metadata?.results) || metadata.results.length !== expectedCount) return null;

  const dataStart = 4 + metadataLength;
  const results = metadata.results.map((result) => result?.fallback
    ? { fallback: true }
    : { response: responseFromImageBatchResult(result, payload, dataStart) });
  return results.every((result) => result.fallback || result.response) ? results : null;
}

export async function fetchImageBlobBatch(entries, signal) {
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
    body: JSON.stringify({ images })
  });
  if (!response.ok || response.headers.get('x-cytlex-image-batch') !== '1') {
    throw Object.assign(new Error('No se pudo cargar el lote de imágenes del capítulo.'), { status: response.status });
  }

  const results = await unpackImageBatch(response, entries.length);
  if (!results) throw new Error('La respuesta del lote de imágenes no es válida.');

  return Promise.all(results.map(async (result, index) => {
    if (result.fallback) return { blob: null, error: new Error('La fuente devolvió una imagen demasiado grande.') };
    const entry = entries[index];
    const target = new URL(entry.url);
    const proxied = result.response;
    const denied = proxied.headers.get('x-cytlex-proxy-denied') === '1';
    const receivedCookie = proxied.headers.get('x-cytlex-onf-cookie') || '';
    if (receivedCookie) onfCookieJar = mergeCookiePairs(onfCookieJar, receivedCookie);
    try {
      const checked = assertProxyResponse(proxied, target, entry.url, true, denied);
      const blob = await readImageBlob(checked);
      if (!blob) throw new Error('La fuente no devolvió una imagen válida.');
      return { blob, error: null };
    } catch (error) {
      return { blob: null, error };
    }
  }));
}

async function runProxyImageBatch(entries) {
  const fallbackIndividually = async () => Promise.all(entries.map(async (entry) => {
    if (entry.cancelled || entry.settled) return;
    try { settleProxyImageEntry(entry, 'resolve', await browserRequest(entry.url, entry.options)); }
    catch (error) { settleProxyImageEntry(entry, 'reject', error); }
  }));

  if (entries.length < 2) {
    await fallbackIndividually();
    return;
  }

  const controller = new AbortController();
  const batchState = { controller, entries };
  entries.forEach((entry) => { entry.dispatched = true; entry.batchState = batchState; });
  try {
    const response = await fetch(batchImageProxyUrl(), {
      method: 'POST',
      credentials: 'omit',
      signal: controller.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ images: entries.map((entry) => ({
        url: new URL(entry.url).href,
        referer: proxyImageReferer(entry.url, entry.referer)
      })) })
    });
    const results = await unpackImageBatch(response, entries.length);
    if (!results) throw new Error('Invalid proxy image batch response');
    await Promise.all(entries.map(async (entry, index) => {
      if (entry.cancelled || entry.settled) return;
      const result = results[index];
      if (result.fallback) {
        try { settleProxyImageEntry(entry, 'resolve', await browserRequest(entry.url, entry.options)); }
        catch (error) { settleProxyImageEntry(entry, 'reject', error); }
        return;
      }
      const target = new URL(entry.url);
      const proxied = result.response;
      const denied = proxied.headers.get('x-cytlex-proxy-denied') === '1';
      try { settleProxyImageEntry(entry, 'resolve', assertProxyResponse(proxied, target, entry.url, true, denied)); }
      catch (error) { settleProxyImageEntry(entry, 'reject', error); }
    }));
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
    } else if (proxyImageBatchQueue.length > 1) {
      clearTimeout(proxyImageBatchTimer);
      proxyImageBatchTimer = setTimeout(flushProxyImageQueue, 0);
    } else if (!proxyImageBatchTimer) {
      proxyImageBatchTimer = setTimeout(flushProxyImageQueue, PROXY_IMAGE_BATCH_WINDOW_MS);
    }
  });
}

function requestImage(url, signal, referer = '', onfCookie = '') {
  return scheduleProxyImageRequest(url, signal, referer, onfCookie);
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
  const headers = new Headers(requestOptions.headers || {});
  const canCache = !requestOptions.signal
    && requestOptions.cache !== 'no-store'
    && requestOptions.cache !== 'no-cache'
    && (!requestOptions.method || requestOptions.method.toUpperCase() === 'GET')
    && !/\b(?:no-cache|no-store)\b/i.test(headers.get('cache-control') || '')
    && !headers.has('authorization')
    && !headers.has('cookie')
    && target.hostname !== 'onfmangas.com'
    && !target.hostname.endsWith('.onfmangas.com');

  if (!canCache) {
    const response = await scheduleProxyGet(url, requestOptions);
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
      const response = await scheduleProxyGet(url, requestOptions);
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
  const response = await browserRequest(payload.url, {
    method: 'POST',
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

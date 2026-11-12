const electronBridge = () => (typeof window !== 'undefined' ? window.cytlex : null);
let onfCookieJar = '';

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

async function browserRequest(url, options = {}) {
  const target = new URL(url);
  const { onfCookie = '', onfReferer = '', ...fetchOptions } = options;
  const requestHeaders = new Headers(fetchOptions.headers || {});
  const isOnf = target.origin === 'https://onfmangas.com';
  const requestCookie = isOnf ? mergeCookiePairs(onfCookieJar, onfCookie) : '';
  if (isOnf && requestCookie) requestHeaders.set('x-cytlex-onf-cookie', requestCookie);
  let response;
  const requestOptions = { credentials: 'omit', redirect: 'follow', ...fetchOptions, headers: requestHeaders };
  const directOptions = { ...fetchOptions, headers: new Headers(fetchOptions.headers || {}) };

  if (target.origin === window.location.origin) {
    response = await fetch(url, directOptions);
  } else {
    try {
      let proxied = await fetch(proxyUrl(url, isOnf ? onfReferer : ''), proxyRequestOptions(url, requestOptions, requestCookie));
      const proxyIsLive = proxied.headers.get('x-cytlex-proxy') === '1';
      const proxyDeniedTarget = proxied.headers.get('x-cytlex-proxy-denied') === '1';
      response = proxyIsLive && !proxyDeniedTarget ? proxied : await fetch(url, directOptions);
      if (isOnf && proxyIsLive && !proxyDeniedTarget) {
        const receivedCookie = proxied.headers.get('x-cytlex-onf-cookie') || '';
        const nextCookie = mergeCookiePairs(requestCookie, receivedCookie);
        if (receivedCookie) onfCookieJar = nextCookie;
        if (nextCookie && nextCookie !== requestCookie && (fetchOptions.method || 'GET').toUpperCase() === 'GET') {
          try { await proxied.body?.cancel(); } catch {}
          proxied = await fetch(proxyUrl(url, onfReferer), proxyRequestOptions(url, requestOptions, nextCookie));
          const refreshedCookie = proxied.headers.get('x-cytlex-onf-cookie') || '';
          if (refreshedCookie) onfCookieJar = mergeCookiePairs(nextCookie, refreshedCookie);
          response = proxied;
        }
      }
    } catch (error) {
      if (requestOptions.signal?.aborted) throw error;
      throw new Error('El navegador bloqueó la conexión a esta fuente. Para fuentes sin acceso CORS, publica Cytlex con su proxy web habilitado.');
    }
  }
  if (!response.ok) {
    if (response.status === 502 && response.headers.get('x-cytlex-proxy') === '1'
      && response.headers.get('x-cytlex-upstream-error') === 'dns-not-found') {
      throw new Error(`DNS ENOTFOUND: Cytlex no pudo resolver ${target.hostname}. Comprueba tu conexión y vuelve a intentar.`);
    }
    const retryAfter = response.headers.get('retry-after');
    throw new Error(`HTTP ${response.status} al pedir ${url}${retryAfter ? ` (Retry-After: ${retryAfter})` : ''}`);
  }
  return response;
}

export async function httpGet(url, requestId, options = {}) {
  const bridge = electronBridge();
  if (bridge?.httpGet) return bridge.httpGet(url, requestId, options);
  return (await browserRequest(url, options)).text();
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
  const response = await browserRequest(url, { signal, onfReferer: referer, onfCookie });
  const blob = await response.blob();
  return validImageResult(new Uint8Array(await blob.arrayBuffer()), blob.type || response.headers.get('content-type') || '');
}

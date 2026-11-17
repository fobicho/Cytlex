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
      || hostname === 'images.komiwa.net' || hostname === 'media.mangavault.lat'
      || hostname === 'cdnlxd.xyz' || hostname.endsWith('.cdnlxd.xyz')
      || hostname === 'imagesolymp.xyz' || hostname === 'media.imagesolymp.xyz'
      || hostname === 'olympusxyz.com' || hostname.endsWith('.olympusxyz.com')
      || hostname === 'ntr-files.online' || hostname.endsWith('.ntr-files.online')
      || hostname === 'www.leercapitulo.co' || hostname === 'leercapitulo.co' || hostname.endsWith('.t34798ndc.com')
      || hostname === 'www.yupmanga.com' || hostname === 'yupmanga.com'
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
  let proxyDeniedTarget = false;
  let usedProxy = false;
  const requestOptions = { credentials: 'omit', redirect: 'follow', ...fetchOptions, headers: requestHeaders };
  const directOptions = { ...fetchOptions, headers: new Headers(fetchOptions.headers || {}) };

  if (target.origin === window.location.origin) {
    response = await fetch(url, directOptions);
  } else {
    try {
      let proxied = await fetch(proxyUrl(url, isOnf ? onfReferer : ''), proxyRequestOptions(url, requestOptions, requestCookie));
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
          proxied = await fetch(proxyUrl(url, onfReferer), proxyRequestOptions(url, requestOptions, nextCookie));
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
  if (!response.ok) {
    const requestOrigin = usedProxy ? response.headers.get('x-cytlex-error-origin')
      : target.origin !== window.location.origin ? 'source' : 'cytlex';
    const reason = usedProxy ? response.headers.get('x-cytlex-upstream-error') : '';
    const retryAfter = response.headers.get('retry-after');
    const resource = target.pathname.startsWith('/reader_image.php/') ? `${target.origin}${target.pathname}` : url;
    const message = reason === 'dns-not-found' ? `DNS ENOTFOUND: Cytlex no pudo resolver ${target.hostname}.`
      : `HTTP ${response.status} al pedir ${resource}${retryAfter ? ` (Retry-After: ${retryAfter})` : ''}`;
    throw Object.assign(new Error(message), {
      status: response.status,
      requestOrigin,
      reason
    });
  }
  return response;
}

export function sourceErrorMessage(error, name, fallback = '') {
  const message = String(error?.message || error || '');
  const status = error?.status || message.match(/\bHTTP (\d{3})\b/)?.[1];
  const code = status ? ` (HTTP ${status})` : '';
  const sourceName = name || 'La fuente';
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
  const response = await browserRequest(url, requestOptions);
  const text = await response.text();
  if (!includeUrl) return text;
  const finalUrl = response.headers.get('x-cytlex-final-url') || response.url || url;
  return { text, url: finalUrl };
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
  const response = await browserRequest(url, { signal });
  return readImageBlob(response);
}

async function readImageBlob(response) {
  const blob = await response.blob();
  const prefix = new Uint8Array(await blob.slice(0, 512).arrayBuffer());
  const mime = imageMimeFromBytes(prefix, blob.type);
  return mime ? blob.slice(0, blob.size, mime) : null;
}

function imageRequestOptions(url, signal, referer, onfCookie) {
  let isYupManga = false;
  try {
    const { hostname } = new URL(url);
    isYupManga = hostname === 'www.yupmanga.com' || hostname === 'yupmanga.com';
  } catch {}
  return {
    signal,
    onfReferer: referer,
    onfCookie,
    ...(isYupManga && referer ? { headers: { Referer: referer } } : {})
  };
}

export async function fetchImageBlob(url, signal, referer = '', onfCookie = '') {
  const bridge = electronBridge();
  if (bridge?.fetchImage) {
    const image = await bridge.fetchImage(url, referer, onfCookie);
    if (signal?.aborted || !image?.base64) return null;
    const binary = atob(image.base64);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const mime = imageMimeFromBytes(bytes, image.mime);
    return mime ? new Blob([bytes], { type: mime }) : null;
  }
  return readImageBlob(await browserRequest(url, imageRequestOptions(url, signal, referer, onfCookie)));
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
  const response = await browserRequest(url, imageRequestOptions(url, signal, referer, onfCookie));
  const blob = await response.blob();
  return validImageResult(new Uint8Array(await blob.arrayBuffer()), blob.type || response.headers.get('content-type') || '');
}

const ALLOWED_HOSTS = new Set([
  'api.anilist.co',
  'api.mangadex.org',
  'achymanga.online',
  'b78sk.komiwa.net',
  'blogger.googleusercontent.com',
  'cdn.achymanga.online',
  'cdn1.intomanga.com',
  'd33y4i2dmzjqjh.cloudfront.net',
  'fobicho.github.io',
  'h9s2.komiwa.net',
  'images.mangalect.org',
  'images.komiwa.net',
  'imagesolymp.xyz',
  'inmanga.com',
  'intomanga.com',
  'jumpg-assets.tokyo-cdn.com',
  'lectorxd.com',
  'manga-oni.com',
  'media.mangavault.lat',
  'mangalect.org',
  'mangadex.org',
  'media.imagesolymp.xyz',
  'n7t9.komiwa.net',
  'olympusxyz.com',
  'onfmangas.com',
  'panel.olympusxyz.com',
  'pack-yak.intomanga.com',
  's.imgfi.com',
  'uploads.mangadex.org',
  'www.leercapitulo.co',
  'www.komiwa.net',
  'www.lectorxd.com',
  'zonatmo.org'
]);

const ALLOWED_SUFFIXES = ['t34798ndc.com', 'mangadex.network', 'ntr-files.online', 'cdnlxd.xyz'];
const REDIRECT_LIMIT = 5;
const UPSTREAM_RETRIES = 2;
const PROXY_RESPONSE_MAX_BYTES = 64 * 1024 * 1024;
const PROXY_ACHY_CATALOG_MAX_BYTES = 64 * 1024 * 1024;
const PROXY_BATCH_MAX_REQUESTS = 50;
const PROXY_MANGADEX_DETAIL_BATCH_MAX = 20;
const PROXY_BATCH_RESPONSE_MAX_BYTES = 8 * 1024 * 1024;
const PROXY_BATCH_ITEM_RESPONSE_MAX_BYTES = 8 * 1024 * 1024;
const PROXY_BATCH_TOTAL_RESPONSE_MAX_BYTES = 64 * 1024 * 1024;
const PROXY_BATCH_CONCURRENCY = 6;
const PROXY_IMAGE_BATCH_MAX_REQUESTS = 50;
const PROXY_CHAPTER_IMAGE_BATCH_MAX_REQUESTS = 40;
const PROXY_IMAGE_BATCH_ITEM_MAX_BYTES = 8 * 1024 * 1024;
const PROXY_IMAGE_BATCH_TOTAL_MAX_BYTES = 128 * 1024 * 1024;
const PROXY_IMAGE_BATCH_MAX_SUBREQUESTS = 50;
const PROXY_ACHY_CATALOG_MAX_IMAGES = PROXY_IMAGE_BATCH_MAX_SUBREQUESTS - 1;
const PROXY_IMAGE_BATCH_CONCURRENCY = 6;
const MANGADEX_REQUEST_INTERVAL_MS = 200;
const ONF_COOKIE_PAIR = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+=[^;\r\n]{1,2048}$/;
const PROXY_BATCH_HEADERS = new Set([
  'accept', 'content-type', 'x-requested-with', 'user-agent', 'accept-language',
  'x-cytlex-upstream-origin', 'x-cytlex-upstream-referer'
]);
let mangaDexRequestQueue = Promise.resolve();
let mangaDexLastRequestAt = 0;
function waitForMangaDexRequestSlot() {
  const slot = mangaDexRequestQueue.then(async () => {
    const wait = MANGADEX_REQUEST_INTERVAL_MS - (Date.now() - mangaDexLastRequestAt);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    mangaDexLastRequestAt = Date.now();
  });
  mangaDexRequestQueue = slot.catch(() => {});
  return slot;
}

function limitResponseBody(body, maxBytes, onFinish, abortUpstream) {
  const reader = body.getReader();
  let received = 0;
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    onFinish();
  };

  return new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          finish();
          return;
        }
        received += value.byteLength;
        if (received > maxBytes) {
          const error = new Error('Upstream response is too large');
          abortUpstream();
          try { await reader.cancel(error); } catch {}
          controller.error(error);
          finish();
          return;
        }
        controller.enqueue(value);
      } catch (error) {
        controller.error(error);
        finish();
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason);
      } finally {
        abortUpstream();
        finish();
      }
    }
  });
}

function onfCookiePairs(request) {
  const raw = request.headers.get('x-cytlex-onf-cookie') || '';
  return raw.split(';').map((part) => part.trim()).filter((part) => ONF_COOKIE_PAIR.test(part)).slice(0, 20);
}

function responseOnfCookies(response) {
  const values = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie') || ''];
  const cookies = new Map();
  for (const value of values) {
    const pair = value.split(';', 1)[0].trim();
    if (!ONF_COOKIE_PAIR.test(pair)) continue;
    cookies.set(pair.slice(0, pair.indexOf('=')), pair);
  }
  return [...cookies.values()];
}

function isAllowedHost(hostname) {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return ALLOWED_HOSTS.has(host)
    || /^i[0-3]\.wp\.com$/.test(host)
    || /^cdn\d+\.intomanga\.com$/.test(host)
    || /^storage\d*\.zonatmo\.org$/.test(host)
    || ALLOWED_SUFFIXES.some(suffix => host.endsWith(`.${suffix}`) || host === suffix);
}

function validateTarget(value) {
  let target;
  try {
    target = new URL(value);
  } catch {
    return null;
  }

  if (
    target.protocol !== 'https:' ||
    target.username ||
    target.password ||
    (target.port && target.port !== '443') ||
    !isAllowedHost(target.hostname)
  ) return null;

  return target;
}

function errorResponse(message, status, deniedTarget = false, upstreamError = '') {
  const headers = { 'cache-control': 'no-store', 'x-cytlex-proxy': '1' };
  headers['x-cytlex-error-origin'] = upstreamError ? 'connection' : 'cytlex';
  if (deniedTarget) headers['x-cytlex-proxy-denied'] = '1';
  if (upstreamError) headers['x-cytlex-upstream-error'] = upstreamError;
  return Response.json({ error: message }, {
    status,
    headers
  });
}

function inmangaReferer(request) {
  const value = new URL(request.url).searchParams.get('referer');
  if (value) {
    try {
      const referer = new URL(value);
      if (referer.origin === 'https://inmanga.com' && referer.pathname.startsWith('/ver/manga/')) return referer.href;
    } catch {}
  }
  return 'https://inmanga.com/';
}

function onfReferer(request) {
  const value = new URL(request.url).searchParams.get('referer');
  if (value) {
    try {
      const referer = new URL(value);
      if (referer.origin === 'https://onfmangas.com' && referer.pathname.startsWith('/lector/')) return referer.href;
    } catch {}
  }
  return 'https://onfmangas.com/';
}

function komiwaChapterReferer(request) {
  const value = new URL(request.url).searchParams.get('referer');
  if (!value) return '';
  try {
    const referer = new URL(value);
    if (referer.origin === 'https://www.komiwa.net' && referer.pathname.startsWith('/chapter/')) return referer.href;
  } catch {}
  return '';
}

function cdnlxdReferer(request, target) {
  const komiwaReferer = komiwaChapterReferer(request);
  if (komiwaReferer) return komiwaReferer;
  const value = new URL(request.url).searchParams.get('referer');
  if (value) {
    try {
      const referer = new URL(value);
      if (
        ['https://lectorxd.com', 'https://www.lectorxd.com'].includes(referer.origin)
        && /^\/(?:manga|manhwa|manhua|doujinshi|one-shot)\/[^/]+\/leer\/[^/]+\/?$/.test(referer.pathname)
      ) return referer.href;
    } catch {}
  }
  return target.pathname.startsWith('/manga/covers/') ? 'https://lectorxd.com/' : 'https://www.komiwa.net/';
}

function t34798Referer(request) {
  return komiwaChapterReferer(request) || 'https://www.leercapitulo.co/';
}

function komiwaImageReferer(request) {
  return komiwaChapterReferer(request) || 'https://www.komiwa.net/';
}

function achyMangaReferer(request) {
  const value = new URL(request.url).searchParams.get('referer');
  if (value) {
    try {
      const referer = new URL(value);
      if (referer.origin === 'https://achymanga.online' && /^\/manga\/[^/]+\/[^/]+\/capitulo-[^/]+\/?$/.test(referer.pathname)) return referer.href;
    } catch {}
  }
  return 'https://achymanga.online/';
}

function forwardedHeaders(request, target) {
  const headers = new Headers();
  const isMangaDexApi = target.hostname === 'api.mangadex.org';
  const isMangaDexImage = target.hostname === 'uploads.mangadex.org' || target.hostname.endsWith('.mangadex.network');
  for (const name of ['accept', 'content-type', 'x-requested-with', 'user-agent', 'accept-language']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  const upstreamOrigin = request.headers.get('x-cytlex-upstream-origin');
  if (upstreamOrigin === target.origin) headers.set('origin', target.origin);

  const upstreamReferer = request.headers.get('x-cytlex-upstream-referer');
  if (upstreamReferer) {
    try {
      const referer = new URL(upstreamReferer);
      if (referer.origin === target.origin && referer.protocol === 'https:') {
        headers.set('referer', referer.href);
      }
    } catch {}
  }

  const onfCookies = target.hostname === 'onfmangas.com' ? onfCookiePairs(request) : [];
  if (onfCookies.length) {
    headers.set('cookie', onfCookies.join('; ').slice(0, 4096));
  }

  if (target.hostname === 'achymanga.online') {
    headers.set('referer', 'https://achymanga.online/');
  }

  if (isMangaDexApi) {
    headers.set('accept', 'application/json');
    headers.set('user-agent', 'Cytlex/0.1.0 (+https://github.com/fobicho/Cytlex)');
    headers.set('origin', 'https://mangadex.org');
    headers.set('referer', 'https://mangadex.org/');
  }
  if (isMangaDexImage) {
    headers.set('accept', 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8');
    headers.set('user-agent', 'Cytlex/0.1.0 (+https://github.com/fobicho/Cytlex)');
    headers.set('referer', 'https://mangadex.org/');
  }
  if (target.hostname === 'images.mangalect.org' || target.hostname === 'mangalect.org') {
    headers.set('referer', 'https://mangalect.org/');
  }
  if (target.hostname === 'cdn.achymanga.online') {
    headers.set('referer', achyMangaReferer(request));
  }
  if (target.hostname === 'h9s2.komiwa.net' || target.hostname === 'n7t9.komiwa.net' || target.hostname === 'images.komiwa.net' || target.hostname === 's.imgfi.com' || target.hostname === 'media.mangavault.lat') {
    headers.set('referer', komiwaImageReferer(request));
  }
  if (target.hostname === 'cdnlxd.xyz' || target.hostname.endsWith('.cdnlxd.xyz')) {
    headers.set('referer', cdnlxdReferer(request, target));
  }
  if (target.hostname === 'lectorxd.com' || target.hostname === 'www.lectorxd.com') {
    if (!headers.has('referer')) headers.set('referer', 'https://lectorxd.com/');
  }
  if (target.hostname === 'imagesolymp.xyz' || target.hostname === 'olympusxyz.com' || target.hostname.endsWith('.olympusxyz.com')) {
    headers.set('referer', 'https://olympusxyz.com/');
  }
  if (target.hostname === 'ntr-files.online' || target.hostname.endsWith('.ntr-files.online')) {
    headers.set('referer', 'https://manga-oni.com/');
  }
  if (target.hostname === 'www.leercapitulo.co' || target.hostname === 'leercapitulo.co') {
    headers.set('referer', 'https://www.leercapitulo.co/');
  }
  if (target.hostname === 't34798ndc.com' || target.hostname.endsWith('.t34798ndc.com')) {
    headers.set('referer', t34798Referer(request));
  }
  if (target.hostname === 'zonatmo.org' || target.hostname.endsWith('.zonatmo.org')) {
    headers.set('referer', 'https://zonatmo.org/');
  }

  if (target.hostname === 'intomanga.com' || target.hostname.endsWith('.intomanga.com')) {
    headers.set('referer', inmangaReferer(request));
  }
  if (target.hostname === 'onfmangas.com') {
    headers.set('user-agent', request.headers.get('user-agent') || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
    headers.set('accept-language', 'es-419,es;q=0.9,en;q=0.8');
    headers.set('sec-fetch-site', 'same-origin');
    headers.set('referer', onfReferer(request));
    if (request.method.toUpperCase() === 'POST') {
      headers.set('origin', target.origin);
      headers.set('accept', 'application/json, text/plain, */*');
      headers.set('sec-fetch-dest', 'empty');
      headers.set('sec-fetch-mode', 'cors');
    } else if (target.pathname.startsWith('/reader_image.php/')) {
      headers.set('accept', 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8');
      headers.set('sec-fetch-dest', 'image');
      headers.set('sec-fetch-mode', 'no-cors');
    } else {
      headers.set('accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8');
      headers.set('sec-fetch-dest', 'document');
      headers.set('sec-fetch-mode', 'navigate');
      headers.set('upgrade-insecure-requests', '1');
    }
  }
  if (target.hostname === 'd33y4i2dmzjqjh.cloudfront.net') {
    headers.set('referer', onfReferer(request));
    headers.set('accept', 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8');
    headers.set('user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Cytlex/0.1');
  }
  return headers;
}

function isDnsFailure(error) {
  return ['ENOTFOUND', 'EAI_AGAIN'].includes(error?.cause?.code || error?.code);
}

async function fetchTarget(initialTarget, method, headers, body, signal, options = {}) {
  let target = initialTarget;
  let currentMethod = method;
  let currentBody = body;
  let currentHeaders = headers;
  const retryableMethod = currentMethod === 'GET' || currentMethod === 'HEAD';

  for (let redirects = 0; redirects <= REDIRECT_LIMIT; redirects += 1) {
    let response;
    const mangaDexApi = target.hostname === 'api.mangadex.org';
    const retries = options.retries ?? (mangaDexApi ? 1 : target.hostname === 'd33y4i2dmzjqjh.cloudfront.net' ? 4 : UPSTREAM_RETRIES);
    for (let attempt = 0; ; attempt += 1) {
      signal.throwIfAborted();
      if (options.subrequestBudget) {
        if (redirects === 0 && attempt === 0) options.subrequestBudget.takeInitial();
        else options.subrequestBudget.takeAdditional();
      }
      const firstMangaRequest = attempt === 0 && currentMethod === 'GET'
        && target.hostname === 'www.leercapitulo.co' && target.pathname.startsWith('/manga/');
      const attemptSignal = firstMangaRequest ? AbortSignal.any([signal, AbortSignal.timeout(5000)]) : signal;
      try {
        if (mangaDexApi) await waitForMangaDexRequestSlot();
        signal.throwIfAborted();
        response = await fetch(target, {
          method: currentMethod,
          headers: currentHeaders,
          body: currentMethod === 'GET' || currentMethod === 'HEAD' ? undefined : currentBody,
          redirect: 'manual',
          signal: attemptSignal
        });
      } catch (error) {
        if (signal.aborted || isDnsFailure(error) || !retryableMethod || attempt >= retries) throw error;
        await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
        continue;
      }
      if (!retryableMethod || ![502, 503, 504].includes(response.status) || attempt >= retries) break;
      try { await response.body?.cancel(); } catch {}
      await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
    }

    if (![301, 302, 303, 307, 308].includes(response.status)) return { upstream: response, finalUrl: target.href };
    const location = response.headers.get('location');
    if (!location) return { upstream: response, finalUrl: target.href };
    if (redirects === REDIRECT_LIMIT) return { proxyError: errorResponse('Too many redirects', 508) };

    const nextTarget = validateTarget(new URL(location, target).href);
    if (!nextTarget) return { proxyError: errorResponse('Redirect target is not allowed', 403) };

    if (nextTarget.origin !== target.origin && currentHeaders.has('cookie')) {
      currentHeaders = new Headers(currentHeaders);
      currentHeaders.delete('cookie');
    }

    if (response.status === 303 || ((response.status === 301 || response.status === 302) && currentMethod === 'POST')) {
      currentMethod = 'GET';
      currentBody = undefined;
    }
    target = nextTarget;
  }
}

async function fetchBatchItem(item, request) {
  const target = validateTarget(item?.url);
  if (!target) {
    return { status: 403, text: JSON.stringify({ error: 'Target is not allowed' }), proxyDenied: true, errorOrigin: 'cytlex' };
  }
  const method = String(item?.method || 'GET').toUpperCase();
  if (!['GET', 'POST'].includes(method) || (method === 'POST' && typeof item?.body !== 'string')) {
    return { status: 400, text: JSON.stringify({ error: 'Invalid batch request' }), errorOrigin: 'cytlex' };
  }

  const requestHeaders = new Headers();
  let headerBytes = 0;
  for (const [name, value] of Object.entries(item.headers || {})) {
    const key = name.toLowerCase();
    if (!PROXY_BATCH_HEADERS.has(key) || typeof value !== 'string' || value.length > 4096) continue;
    headerBytes += key.length + value.length;
    if (headerBytes > 12_000) return { status: 400, text: JSON.stringify({ error: 'Request headers are too large' }), errorOrigin: 'cytlex' };
    requestHeaders.set(key, value);
  }
  for (const name of ['accept', 'user-agent', 'accept-language']) {
    if (!requestHeaders.has(name) && request.headers.has(name)) requestHeaders.set(name, request.headers.get(name));
  }
  if (target.hostname === 'onfmangas.com' && typeof item.onfCookie === 'string') {
    requestHeaders.set('x-cytlex-onf-cookie', item.onfCookie.slice(0, 4096));
  }

  const metadataUrl = new URL(request.url);
  metadataUrl.searchParams.delete('url');
  metadataUrl.searchParams.delete('batch');
  metadataUrl.searchParams.delete('referer');
  if (typeof item.referer === 'string' && item.referer.length <= 2048) {
    metadataUrl.searchParams.set('referer', item.referer);
  }
  const metadataRequest = new Request(metadataUrl, { method, headers: requestHeaders });

  const deadline = new AbortController();
  const timeout = setTimeout(() => deadline.abort(), 12000);
  const signal = AbortSignal.any([request.signal, deadline.signal]);
  let streaming = false;
  let responseTooLarge = false;
  try {
    const { upstream, proxyError, finalUrl } = await fetchTarget(
      target,
      method,
      forwardedHeaders(metadataRequest, target),
      method === 'POST' ? item.body : undefined,
      signal
    );
    if (proxyError) {
      return {
        status: proxyError.status,
        text: await proxyError.text(),
        url: finalUrl || target.href,
        errorOrigin: proxyError.headers.get('x-cytlex-error-origin') || 'cytlex',
        upstreamError: proxyError.headers.get('x-cytlex-upstream-error') || '',
        proxyDenied: proxyError.headers.get('x-cytlex-proxy-denied') === '1'
      };
    }

    const contentLength = Number(upstream.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > PROXY_BATCH_ITEM_RESPONSE_MAX_BYTES) {
      await upstream.body?.cancel();
      return { fallback: true };
    }

    const responseBody = upstream.body ? limitResponseBody(
      upstream.body,
      PROXY_BATCH_ITEM_RESPONSE_MAX_BYTES,
      () => clearTimeout(timeout),
      () => { responseTooLarge = true; deadline.abort(); }
    ) : null;
    streaming = Boolean(responseBody);
    const text = responseBody ? await new Response(responseBody).text() : '';
    const onfCookie = target.hostname === 'onfmangas.com'
      ? responseOnfCookies(upstream).join('; ').slice(0, 4096)
      : '';
    return {
      status: upstream.status,
      text,
      url: finalUrl || target.href,
      contentType: upstream.headers.get('content-type') || '',
      retryAfter: upstream.headers.get('retry-after') || '',
      errorOrigin: upstream.ok ? '' : 'source',
      ...(onfCookie ? { onfCookie } : {})
    };
  } catch (error) {
    if (responseTooLarge) return { fallback: true };
    const timedOut = deadline.signal.aborted && !request.signal.aborted;
    return {
      status: timedOut ? 504 : 502,
      text: JSON.stringify({ error: timedOut ? 'The source took too long to respond' : 'The source could not be reached' }),
      url: target.href,
      errorOrigin: 'connection',
      upstreamError: timedOut ? 'timeout' : isDnsFailure(error) ? 'dns-not-found' : 'unreachable'
    };
  } finally {
    if (!streaming) clearTimeout(timeout);
  }
}

async function mapConcurrent(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await mapper(items[index]);
    }
  }));
  return results;
}

async function handleBatchRequest(request) {
  const contentLength = Number(request.headers.get('content-length')) || 0;
  if (contentLength > 1_000_000) return errorResponse('Request body is too large', 413);

  let payload;
  try {
    const body = await request.arrayBuffer();
    if (body.byteLength > 1_000_000) return errorResponse('Request body is too large', 413);
    payload = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return errorResponse('Invalid batch payload', 400);
  }

  if (!Array.isArray(payload?.requests) || payload.requests.length < 2 || payload.requests.length > PROXY_BATCH_MAX_REQUESTS) {
    return errorResponse('Invalid batch size', 400);
  }

  const results = await mapConcurrent(payload.requests, PROXY_BATCH_CONCURRENCY, (item) => fetchBatchItem(item, request));
  const encoder = new TextEncoder();
  const resultSizes = results.map((result) => encoder.encode(result?.text || '').byteLength);
  let totalResponseBytes = resultSizes.reduce((total, size) => total + size, 0);
  const largestFirst = resultSizes.map((size, index) => ({ size, index })).sort((a, b) => b.size - a.size);
  for (const { size, index } of largestFirst) {
    if (totalResponseBytes <= PROXY_BATCH_TOTAL_RESPONSE_MAX_BYTES) break;
    if (!size) continue;
    results[index] = { fallback: true };
    totalResponseBytes -= size;
  }
  return Response.json({ results }, {
    headers: { 'cache-control': 'no-store', 'x-cytlex-proxy-batch': '1' }
  });
}

function bytesToBase64(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function catalogImageCandidates(text, contentType, sourceId, pageUrl, limit) {
  const candidates = new Set();
  const imageKey = /cover|portada|poster|thumbnail|thumb|image|imagen|img/i;
  const imageAttributes = (tag) => new Map([...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)]
    .map((match) => [match[1].toLowerCase(), match[2] ?? match[3] ?? match[4] ?? '']));
  const srcsetUrl = (values) => values.flatMap((value) => value.split(',').map((candidate) => {
    const [url, descriptor = ''] = candidate.trim().split(/\s+/);
    const amount = Number.parseFloat(descriptor);
    const score = descriptor.endsWith('w') ? amount : descriptor.endsWith('x') ? amount * 1000 : 0;
    return { url, score };
  })).sort((a, b) => b.score - a.score)[0]?.url;
  const lastSrcsetUrl = (value) => value.split(',').map((candidate) => candidate.trim().split(/\s+/)[0]).filter(Boolean).at(-1) || '';
  const add = (value, key = '') => {
    if (typeof value !== 'string' || (!imageKey.test(key) && !/^\s*(?:https?:|\/\/|\/)/i.test(value))) return;
    const normalized = value.trim().replace(/&amp;/gi, '&');
    const raw = (sourceId === 'olympusscanlation' ? normalized : normalized.split(/\s+/)[0]).replace(/["'<>),]+$/, '');
    if (!raw || /^(?:data:|blob:|javascript:)/i.test(raw)) return;
    try {
      const value = sourceId === 'mangalect' && !/^https?:/i.test(raw) && !raw.startsWith('//') ? raw.replace(/^\/+/, '') : raw;
      const base = sourceId === 'mangalect' && !/^https?:/i.test(raw) && !raw.startsWith('//')
        ? 'https://images.mangalect.org/file/leermangaesp/'
        : sourceId === 'leercapitulo' ? 'https://www.leercapitulo.co/'
          : sourceId === 'komiwa' ? 'https://www.komiwa.net/' : pageUrl;
      const url = new URL(value, base);
      if (sourceId === 'leercapitulo' && url.hostname === 'leercapitulo.co') url.hostname = 'www.leercapitulo.co';
      if (sourceId === 'olympusscanlation') url.pathname = url.pathname.replace(/-xl\.(jpe?g|png|webp|avif)$/i, '-m.$1');
      if (!/^https?:$/.test(url.protocol) || /(?:\/logo|\/avatar|\/icon|placeholder)/i.test(url.pathname)) return;
      candidates.add(url.href);
    } catch {}
  };
  const scanHtml = (html) => {
    const pictureBlocks = sourceId === 'leercapitulo'
      ? [...html.matchAll(/<picture\b[^>]*>[\s\S]*?<\/picture>/gi)].map((match) => ({ start: match.index, end: match.index + match[0].length, html: match[0] }))
      : [];
    for (const tag of html.matchAll(/<a\b[^>]*>/gi)) {
      const href = tag[0].match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
      const value = href?.[1] ?? href?.[2] ?? href?.[3] ?? '';
      if (/\.(?:avif|gif|jpe?g|png|webp)(?:[?#]|$)/i.test(value)) add(value, 'cover');
      if (candidates.size >= limit) break;
    }
    for (const tag of html.matchAll(/<[a-z][^>]*>/gi)) {
      const tagName = tag[0].match(/^<([a-z]+)/i)?.[1]?.toLowerCase();
      if (sourceId === 'mangaoni' && tagName !== 'img') continue;
      const attrs = imageAttributes(tag[0]);
      const className = attrs.get('class') || '';
      if (sourceId === 'leercapitulo' && tagName === 'source') continue;
      if (sourceId === 'leercapitulo' && tagName !== 'img') continue;
      const picture = sourceId === 'leercapitulo' && tagName === 'img'
        ? pictureBlocks.find((block) => tag.index >= block.start && tag.index < block.end)?.html
        : '';
      const imgAttrs = picture ? imageAttributes(picture.match(/<img\b[^>]*>/i)?.[0] || tag[0]) : attrs;
      const original = sourceId === 'leercapitulo'
        ? ['data-original', 'data-full', 'data-zoom-image', 'data-large', 'data-src', 'data-lazy-src'].map((name) => imgAttrs.get(name)).find(Boolean)
        : '';
      const srcsets = sourceId === 'leercapitulo'
        ? [...(picture || tag[0]).matchAll(/<(?:source|img)\b[^>]*>/gi)].flatMap((match) => {
          const values = imageAttributes(match[0]);
          return [values.get('srcset'), values.get('data-srcset')].filter(Boolean);
        })
        : [];
      let selected = '';
      if (sourceId === 'leercapitulo') {
        selected = original || (srcsets.length ? srcsetUrl(srcsets) : imgAttrs.get('src'));
      } else {
        const imageAttributesForSource = sourceId === 'mangaoni'
          ? ['data-src', 'src']
          : sourceId === 'zonatmo'
            ? ['data-srcset', 'data-src', 'data-lazy-src', 'data-original', 'data-url', 'data-bg', 'src', 'content', 'srcset']
          : ['data-original', 'data-original-src', 'data-full', 'data-zoom-image', 'data-large', 'data-src', 'data-lazy-src', 'data-url', 'data-cfsrc', 'data-srcset', 'srcset', 'data-bg', 'data-image', 'data-cover', 'data-thumbnail', 'src'];
        const selectedAttr = imageAttributesForSource
          .map((name) => [name, attrs.get(name)])
          .find(([, value]) => value);
        selected = selectedAttr?.[0].includes('srcset')
          ? sourceId === 'zonatmo' ? lastSrcsetUrl(selectedAttr[1]) : srcsetUrl([selectedAttr[1]])
          : selectedAttr?.[0] === 'data-bg' ? selectedAttr[1]?.match(/url\(\s*(["']?)(.*?)\1\s*\)/i)?.[2]
          : selectedAttr?.[1]
          || (attrs.has('data-url') && /cover|thumbnail|element|manga|comic/i.test(className) ? attrs.get('data-url') : null)
          || attrs.get('style')?.match(/url\(["']?([^"')]+)["']?\)/i)?.[1];
      }
      if (selected) add(selected, 'cover');
      if (candidates.size >= limit) break;
    }
  };
  const scanLeerCapituloCards = (html) => {
    const tags = [...html.matchAll(/<\/?([a-z][\w:-]*)\b[^>]*>/gi)];
    for (let index = 0; index < tags.length && candidates.size < limit; index += 1) {
      const opening = tags[index];
      if (opening[0][1] === '/' || !imageAttributes(opening[0]).get('class')?.split(/\s+/).includes('lc-card')) continue;
      const tagName = opening[1].toLowerCase();
      let depth = 1;
      let end = html.length;
      for (let cursor = index + 1; cursor < tags.length; cursor += 1) {
        if (tags[cursor][1].toLowerCase() !== tagName) continue;
        if (tags[cursor][0][1] === '/') depth -= 1;
        else if (!/\/\s*>$/.test(tags[cursor][0])) depth += 1;
        if (!depth) { end = tags[cursor].index + tags[cursor][0].length; break; }
      }
      const card = html.slice(opening.index, end);
      const image = card.match(/<img\b[^>]*>/i);
      if (!image) continue;
      const attrs = imageAttributes(image[0]);
      let linkedImage = '';
      const anchorStack = [];
      for (const tag of card.slice(0, image.index).matchAll(/<\/?a\b[^>]*>/gi)) {
        if (tag[0][1] === '/') anchorStack.pop();
        else anchorStack.push(imageAttributes(tag[0]).get('href') || '');
      }
      if (/\.(?:avif|gif|jpe?g|png|webp)(?:[?#]|$)/i.test(anchorStack.at(-1) || '')) {
        linkedImage = anchorStack.at(-1);
      }
      const original = ['data-original', 'data-full', 'data-zoom-image', 'data-large', 'data-src', 'data-lazy-src']
        .map((name) => attrs.get(name)).find(Boolean);
      const picture = [...card.matchAll(/<picture\b[^>]*>[\s\S]*?<\/picture>/gi)]
        .map((match) => match[0]).find((block) => block.includes(image[0]));
      const srcsets = picture
        ? [...picture.matchAll(/<(?:source|img)\b[^>]*>/gi)].flatMap((match) => {
          const values = imageAttributes(match[0]);
          return [values.get('srcset'), values.get('data-srcset')].filter(Boolean);
        })
        : [attrs.get('srcset'), attrs.get('data-srcset')].filter(Boolean);
      const selected = linkedImage || original || (srcsets.length ? srcsetUrl(srcsets) : attrs.get('src'));
      if (selected) add(selected, 'cover');
      index = tags.findIndex((tag, tagIndex) => tagIndex > index && tag.index + tag[0].length === end);
      if (index < 0) break;
    }
  };
  const scanJson = (value, key = '', depth = 0) => {
    if (depth > 6 || candidates.size >= limit) return;
    if (typeof value === 'string') {
      if (imageKey.test(key) && !(sourceId === 'olympusscanlation' && /srcset/i.test(key))) add(value, key);
      if (/<(?:img|source)\b/i.test(value)) scanHtml(value);
      if (/^[\s\[{]/.test(value)) {
        try { scanJson(JSON.parse(value), key, depth + 1); } catch {}
      }
    } else if (Array.isArray(value)) value.forEach((item) => scanJson(item, key, depth + 1));
    else if (value && typeof value === 'object') Object.entries(value).forEach(([name, item]) => scanJson(item, name, depth + 1));
  };

  const scanLinkedCoverImages = (html) => {
    for (const anchor of html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a\s*>/gi)) {
      if (candidates.size >= limit) return;
      const href = imageAttributes(anchor[0].match(/^<a\b[^>]*>/i)?.[0] || '').get('href') || '';
      let path = '';
      try { path = new URL(href, pageUrl).pathname; } catch {}
      if (!path || path === '/' || /\.(?:avif|gif|jpe?g|png|webp)$/i.test(path)) continue;
      const image = anchor[1].match(/<img\b[^>]*>/i);
      if (!image) continue;
      const attrs = imageAttributes(image[0]);
      if (!attrs.get('alt')?.trim()) continue;
      const attributes = sourceId === 'onfmangas'
        ? ['data-src', 'data-lazy-src', 'data-original', 'data-original-src', 'data-srcset', 'srcset', 'src']
        : ['data-original', 'data-full', 'data-zoom-image', 'data-large', 'data-src', 'data-lazy-src', 'src'];
      const attribute = attributes.find((name) => attrs.get(name));
      let raw = attribute ? attrs.get(attribute) : '';
      if (sourceId === 'onfmangas' && ['data-srcset', 'srcset'].includes(attribute)) raw = lastSrcsetUrl(raw);
      if (raw) add(raw, 'cover');
    }
  };

  const scanMangaOniCards = (html) => {
    const cards = [...html.matchAll(/<div\b[^>]*>/gi)]
      .filter((tag) => imageAttributes(tag[0]).get('class')?.split(/\s+/).includes('_135yj'));
    for (let index = 0; index < cards.length && candidates.size < limit; index += 1) {
      const card = html.slice(cards[index].index, cards[index + 1]?.index ?? html.length);
      const href = [...card.matchAll(/<a\b[^>]*>/gi)]
        .map((tag) => imageAttributes(tag[0]).get('href') || '')
        .find((value) => value.startsWith('https://manga-oni.com/') || value.startsWith('/'));
      let readable = false;
      try {
        const url = new URL(href, 'https://manga-oni.com');
        readable = url.origin === 'https://manga-oni.com' && /^\/(?:manga|manhwa|manhua)\//i.test(url.pathname);
      } catch {}
      const image = [...card.matchAll(/<img\b[^>]*>/gi)]
        .find((tag) => {
          const attrs = imageAttributes(tag[0]);
          return attrs.has('data-src') || attrs.get('class')?.split(/\s+/).includes('cover-bg-img');
        });
      const attrs = image && imageAttributes(image[0]);
      const raw = attrs?.get('data-src') || attrs?.get('src') || '';
      if (readable && attrs?.get('alt')?.trim() && raw && !/default\.gif/i.test(raw)) add(raw, 'cover');
    }
    const articleRoot = [...html.matchAll(/<div\b[^>]*>/gi)]
      .find((tag) => imageAttributes(tag[0]).get('id') === 'article-div');
    if (!articleRoot || candidates.size >= limit) return;
    const tags = [...html.slice(articleRoot.index).matchAll(/<\/?div\b[^>]*>/gi)];
    let depth = 0;
    let end = html.length;
    for (const tag of tags) {
      if (tag[0][1] === '/') depth -= 1;
      else if (!/\/\s*>$/.test(tag[0])) depth += 1;
      if (depth === 0) { end = articleRoot.index + tag.index + tag[0].length; break; }
    }
    scanHtml(html.slice(articleRoot.index, end));
  };

  const cardSegments = (html, className) => {
    const starts = [...html.matchAll(/<[a-z][^>]*>/gi)]
      .filter((tag) => imageAttributes(tag[0]).get('class')?.split(/\s+/).includes(className));
    return starts.map((tag, index) => html.slice(tag.index, starts[index + 1]?.index ?? html.length));
  };

  const scanOnfCards = (html) => {
    // Keep this order in sync with ONF's imageElementUrl() in onfmangas.js.
    // Selecting a different srcset candidate leaves the card's actual cover
    // out of the combined search response and makes the client fetch it again.
    const imageAttributesForSource = ['data-src', 'data-lazy-src', 'data-original', 'data-original-src', 'data-srcset', 'srcset', 'src'];
    const cards = cardSegments(html, 'manga-card');
    const images = cards.map((segment) => segment.match(/<img\b[^>]*>/i)?.[0]).filter(Boolean);
    for (const image of images) {
      const attrs = imageAttributes(image);
      for (const name of imageAttributesForSource) {
        let raw = (attrs.get(name) || '').trim();
        if (name === 'data-srcset' || name === 'srcset') raw = lastSrcsetUrl(raw);
        if (!raw || /^(?:data:|javascript:|about:|#)/i.test(raw)
          || /(?:placeholder|default|blank|spacer|pixel)\.(?:gif|png)(?:[?#]|$)/i.test(raw)) continue;
        try {
          const imageUrl = new URL(raw, pageUrl);
          if (!['http:', 'https:'].includes(imageUrl.protocol)) continue;
          add(raw, 'cover');
        } catch {}
        break;
      }
      if (candidates.size >= limit) return;
    }
  };

  const scanZonaTmoCards = (html) => {
    const cards = cardSegments(html, 'element');
    for (const card of cards) {
      const href = [...card.matchAll(/<a\b[^>]*>/gi)]
        .map((tag) => imageAttributes(tag[0]).get('href') || '')
        .find((value) => value.includes('/library/'));
      let readable = false;
      try { readable = /^\/library\/(?:manga|manhwa|manhua)\//i.test(new URL(href, pageUrl).pathname); } catch {}
      if (!readable) continue;

      const tags = [...card.matchAll(/<[a-z][^>]*>/gi)];
      const imageTag = tags.find((tag) => tag[0].match(/^<img\b/i))
        || tags.find((tag) => {
          const attrs = imageAttributes(tag[0]);
          return attrs.get('class')?.split(/\s+/).includes('lazy-cover') || attrs.has('data-bg');
        });
      if (!imageTag) continue;
      const attrs = imageAttributes(imageTag[0]);
      const rawSrcset = attrs.get('data-srcset') || '';
      let raw = rawSrcset ? lastSrcsetUrl(rawSrcset) : '';
      if (!raw) {
        for (const name of ['data-src', 'data-lazy-src', 'data-original', 'data-url', 'data-bg', 'src', 'content']) {
          raw = attrs.get(name) || '';
          if (name === 'data-bg') raw = raw.match(/url\(\s*(["']?)(.*?)\1\s*\)/i)?.[2] || raw;
          if (raw.trim()) break;
        }
      }
      if (!raw) raw = attrs.get('style')?.match(/background(?:-image)?\s*:[^;]*?url\(\s*(["']?)(.*?)\1\s*\)/i)?.[2] || '';
      if (!raw) raw = lastSrcsetUrl(attrs.get('srcset') || '');
      add(raw, 'cover');
      if (candidates.size >= limit) return;
    }
  };

  if (/json/i.test(contentType) || /^[\[{]/.test(text.trimStart())) {
    try { scanJson(JSON.parse(text)); } catch { scanHtml(text); }
  } else if (sourceId === 'leercapitulo') {
    scanLeerCapituloCards(text);
  } else if (sourceId === 'mangaoni') {
    scanMangaOniCards(text);
  } else if (sourceId === 'onfmangas') {
    scanOnfCards(text);
  } else if (sourceId === 'zonatmo') {
    if (cardSegments(text, 'element').length) scanZonaTmoCards(text);
    else scanLinkedCoverImages(text);
  } else {
    scanLinkedCoverImages(text);
  }
  if (candidates.size < limit && !['onfmangas', 'zonatmo'].includes(sourceId)) scanHtml(text);
  return [...candidates].slice(0, limit);
}

async function handleCombinedSearchRequest(request) {
  const contentLength = Number(request.headers.get('content-length')) || 0;
  if (contentLength > 1_000_000) return errorResponse('Request body is too large', 413);
  let payload;
  try {
    const body = await request.arrayBuffer();
    if (body.byteLength > 1_000_000) return errorResponse('Request body is too large', 413);
    payload = JSON.parse(new TextDecoder().decode(body));
  } catch { return errorResponse('Invalid combined search payload', 400); }

  const requests = payload?.requests;
  const catalogUrls = Array.isArray(payload?.catalogs)
    ? payload.catalogs.map((entry) => entry?.url)
    : payload?.catalog?.url ? [payload.catalog.url] : [];
  if (!Array.isArray(requests) || requests.length + catalogUrls.length < 1
    || requests.length + catalogUrls.length > PROXY_BATCH_MAX_REQUESTS) return errorResponse('Invalid batch size', 400);
  const catalogTargets = catalogUrls.map((url) => validateTarget(url));
  if (catalogUrls.some((url, index) => !catalogTargets[index] || catalogTargets[index].origin !== 'https://api.mangadex.org'
    || catalogTargets[index].pathname !== '/manga' || Number(catalogTargets[index].searchParams.get('limit')) !== 40
    || !catalogTargets[index].searchParams.getAll('includes[]').includes('cover_art'))) return errorResponse('Invalid MangaDex catalog request', 400);
  const encoder = new TextEncoder();
  let stopped = false;
  const body = new ReadableStream({
    async start(controller) {
      const send = (value) => { if (!stopped) controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`)); };
      try {
        send({ type: 'start' });
        let totalResponseBytes = 0;
        const catalogImageUrls = new Set();
        const imageSubrequestLimit = Math.max(0, PROXY_IMAGE_BATCH_MAX_SUBREQUESTS - requests.length);
        const imageByteBudget = createImageByteBudget();
        const catalogCoverJobs = [];
        let imageSubrequests = 0;
        const takeImageSubrequest = () => {
          if (imageSubrequests >= imageSubrequestLimit) throw new Error('Image batch subrequest limit reached');
          imageSubrequests += 1;
        };
        const imageSubrequestBudget = { takeInitial: takeImageSubrequest, takeAdditional: takeImageSubrequest };
        const olympusDetails = new Map();
        let olympusListRequest;
        const mangaDexCount = requests.filter((item) => item?.detail === 'mangadex').length;
        let reservedMangaDex = requests.filter((item) => item?.detail === 'mangadex' && item.includeManga !== false).length;
        const olympusCount = requests.filter((item) => {
          const target = validateTarget(item?.url);
          return item?.detail === 'olympus'
            || (item?.sourceId === 'olympusscanlation' && target?.origin === 'https://olympusxyz.com'
              && /^\/api\/series\/[\w-]+$/.test(target.pathname) && target.searchParams.get('type') === 'comic');
        }).length;
        const detailCount = mangaDexCount + olympusCount;
        const reservedOlympus = new Set(requests.flatMap((item) => {
          const target = validateTarget(item?.url);
          return target?.origin === 'https://olympusxyz.com'
            && /^\/api\/series\/[\w-]+$/.test(target.pathname)
            && target.searchParams.get('type') === 'comic'
            && (item?.detail === 'olympus' || item?.sourceId === 'olympusscanlation') ? [target.href] : [];
        }));
        const reservedKomiwaRequests = new Set(requests.filter((item) => item?.komiwaPrefetch === true
          && item?.sourceId === 'komiwa' && item.method === 'POST'
          && validateTarget(item.url)?.href === 'https://b78sk.komiwa.net/manga/search'));
        let reservedKomiwa = reservedKomiwaRequests.size * 2;
        const releaseKomiwaReservation = (item) => {
          if (reservedKomiwaRequests.delete(item)) reservedKomiwa -= 2;
        };
        const detailBudget = {
          used: 0,
          limit: Math.max(0, PROXY_BATCH_MAX_REQUESTS - catalogUrls.length - (requests.length - detailCount)),
          take() { if (this.used >= this.limit) return false; this.used += 1; return true; },
          get remaining() { return this.limit - this.used; }
        };
        let activeOlympusDetails = 0;
        const olympusDetailWaiters = [];
        const withOlympusDetailSlot = async (run) => {
          if (activeOlympusDetails >= 1) await new Promise((resolve) => olympusDetailWaiters.push(resolve));
          else activeOlympusDetails += 1;
          try { return await run(); }
          finally {
            const next = olympusDetailWaiters.shift();
            if (next) next();
            else activeOlympusDetails -= 1;
          }
        };
        const sourceResults = requests.map(async (item) => {
          const target = validateTarget(item?.url);
          if (item?.detail === 'mangadex') {
            if (!target || target.origin !== 'https://api.mangadex.org'
              || !/^\/manga\/[0-9a-f-]{36}\/feed$/i.test(target.pathname)
              || Number(target.searchParams.get('limit')) !== 500) {
              return { status: 400, text: 'Invalid MangaDex detail URL', errorOrigin: 'cytlex' };
            }
            let reserved = item.includeManga !== false;
            const release = () => { if (reserved) { reserved = false; reservedMangaDex -= 1; } };
            const mangaDexBudget = {
              take() { return detailBudget.remaining > reservedKomiwa && detailBudget.take(); },
              get remaining() { return Math.max(0, detailBudget.remaining - reservedKomiwa); }
            };
            let response;
            try { response = await handleMangaDexFeed(request, target, item.includeManga !== false, mangaDexBudget, release); }
            finally { release(); }
            return { status: response.status, text: await response.text(), url: target.href,
              contentType: response.headers.get('content-type') || '',
              errorOrigin: response.headers.get('x-cytlex-error-origin') || (response.ok ? '' : 'source') };
          }
          const isOlympusDetail = item?.detail === 'olympus'
            || (item?.sourceId === 'olympusscanlation' && target?.origin === 'https://olympusxyz.com'
              && /^\/api\/series\/[\w-]+$/.test(target.pathname)
              && target.searchParams.get('type') === 'comic');
          if (!isOlympusDetail) {
            const validKomiwa = item?.komiwaPrefetch === true && item?.sourceId === 'komiwa'
              && target?.href === 'https://b78sk.komiwa.net/manga/search' && item.method === 'POST';
            const otherReservations = () => reservedMangaDex + reservedOlympus.size
              + reservedKomiwa - (reservedKomiwaRequests.has(item) ? 2 : 0);
            let titleBody = '';
            if (validKomiwa && typeof item.komiwaFallbackTitle === 'string' && item.komiwaFallbackTitle.trim()
              && item.komiwaFallbackTitle.length <= 500) {
              titleBody = JSON.stringify({ q: item.komiwaFallbackTitle, limit: 40 });
            }
            let result = await fetchBatchItem(titleBody ? { ...item, body: titleBody } : item, request);
            if (titleBody && result.status !== 200) return { fallback: true };
            if (item?.komiwaPrefetch !== true || item?.sourceId !== 'komiwa'
              || target?.href !== 'https://b78sk.komiwa.net/manga/search'
              || item.method !== 'POST' || result.status !== 200) return result;
            try {
              let query = JSON.parse(titleBody || item.body)?.q;
              let data = JSON.parse(result.text);
              const normalize = (value) => String(value || '').normalize('NFKC').normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
              let expected = normalize(query);
              let matches = (data?.data?.items || []).filter((entry) => typeof entry?.slug === 'string'
                && expected && [entry.slug, entry.title].some((value) => normalize(value) === expected));
              const prefetched = [];
              if (titleBody && matches.length === 1) {
                prefetched.push({ ...result, method: 'POST', body: titleBody });
              } else if (titleBody && !matches.length && detailBudget.remaining < 3 + otherReservations()) {
                return { fallback: true };
              } else if (titleBody && !matches.length) {
                detailBudget.take();
                result = await fetchBatchItem(item, request);
                if (result.status !== 200) return result;
                query = JSON.parse(item.body)?.q;
                expected = normalize(query);
                data = JSON.parse(result.text);
                matches = (data?.data?.items || []).filter((entry) => typeof entry?.slug === 'string'
                  && expected && [entry.slug, entry.title].some((value) => normalize(value) === expected));
              }
              const manga = matches.length === 1 ? matches[0] : null;
              if (!manga?.id || !/^[a-z0-9-]+$/i.test(manga.slug)
                || !/^[a-z0-9-]+$/i.test(String(manga.id))) {
                if (prefetched.length) result.prefetched = prefetched;
                return result;
              }
              if (detailBudget.remaining < 2 + otherReservations()) {
                if (prefetched.length) result.prefetched = prefetched;
                return result;
              }
              releaseKomiwaReservation(item);
              detailBudget.take();
              detailBudget.take();
              const urls = [
                `https://b78sk.komiwa.net/manga/${encodeURIComponent(manga.id)}/chapters?page=1&limit=99999&sort=desc`,
                `https://www.komiwa.net/manga/${encodeURIComponent(manga.slug)}`
              ];
              const fetched = await Promise.all(urls.map((url) => fetchBatchItem({ url, method: 'GET' }, request)));
              const valid = [...prefetched, ...fetched.filter((entry) => entry.status === 200 && typeof entry.text === 'string')];
              const size = encoder.encode(result.text).byteLength + valid.reduce((sum, entry) => sum + encoder.encode(entry.text).byteLength, 0);
              if (size <= PROXY_BATCH_ITEM_RESPONSE_MAX_BYTES) result.prefetched = valid;
            } catch {}
            return result;
          }
          if (target?.origin !== 'https://olympusxyz.com'
            || !/^\/api\/series\/[\w-]+$/.test(target.pathname)
            || target.searchParams.get('type') !== 'comic') {
            return { status: 400, text: JSON.stringify({ error: 'Invalid Olympus detail request' }), errorOrigin: 'cytlex' };
          }
          let result = olympusDetails.get(target.href);
          if (!result) {
            result = withOlympusDetailSlot(async () => {
              let response;
              let olympusBasePending = true;
              const olympusBudget = {
                take() {
                  const ownReservation = olympusBasePending ? 1 : 0;
                  const reserved = reservedMangaDex + reservedOlympus.size + reservedKomiwa - ownReservation;
                  if (detailBudget.remaining <= reserved || !detailBudget.take()) return false;
                  olympusBasePending = false;
                  return true;
                }
              };
              try { response = await handleOlympusDetail(request, target, olympusBudget, 200, () => reservedOlympus.delete(target.href)); }
              finally { reservedOlympus.delete(target.href); }
              const detailResult = {
                status: response.status,
                text: await response.text(),
                url: target.href,
                contentType: response.headers.get('content-type') || '',
                errorOrigin: response.headers.get('x-cytlex-error-origin') || (response.ok ? '' : 'source'),
                upstreamError: response.headers.get('x-cytlex-upstream-error') || '',
                proxyDenied: response.headers.get('x-cytlex-proxy-denied') === '1'
              };
              if (response.status === 404 && (olympusListRequest || detailBudget.remaining > reservedMangaDex + reservedOlympus.size + reservedKomiwa)) {
                if (!olympusListRequest) {
                  if (detailBudget.remaining > reservedMangaDex + reservedOlympus.size + reservedKomiwa) detailBudget.take();
                  olympusListRequest = fetchBatchItem({ url: 'https://olympusxyz.com/api/series/list', method: 'GET' }, request);
                }
                const list = await olympusListRequest;
                if (list.status === 200 && encoder.encode(detailResult.text).byteLength + encoder.encode(list.text).byteLength <= PROXY_BATCH_ITEM_RESPONSE_MAX_BYTES) {
                  detailResult.prefetched = [list];
                  try {
                    const oldSlug = target.pathname.split('/').pop();
                    const baseSlug = oldSlug.replace(/-\d{8}-\d+$/, '');
                    const matches = (JSON.parse(list.text)?.data || []).filter((series) =>
                      typeof series?.slug === 'string' && /^[\w-]+$/.test(series.slug)
                      && series.slug !== oldSlug && series.slug.replace(/-\d{8}-\d+$/, '') === baseSlug);
                    if (baseSlug !== oldSlug && matches.length === 1 && detailBudget.remaining >= 2 + reservedMangaDex + reservedOlympus.size + reservedKomiwa) {
                      const newTarget = new URL(`/api/series/${matches[0].slug}?type=comic`, target.origin);
                      const recoveryBudget = {
                        take() { return detailBudget.remaining > reservedMangaDex + reservedOlympus.size + reservedKomiwa && detailBudget.take(); },
                        get remaining() { return Math.max(0, detailBudget.remaining - reservedMangaDex - reservedOlympus.size - reservedKomiwa); }
                      };
                      const recovered = await handleOlympusDetail(request, newTarget, recoveryBudget, 200);
                      if (recovered.ok) {
                        const text = await recovered.text();
                        if (encoder.encode(detailResult.text).byteLength + encoder.encode(list.text).byteLength + encoder.encode(text).byteLength <= PROXY_BATCH_ITEM_RESPONSE_MAX_BYTES) {
                          detailResult.prefetched.push({ url: newTarget.href, status: 200, text, detail: 'olympus' });
                        }
                      }
                    }
                  } catch {}
                }
              }
              return detailResult;
            });
            olympusDetails.set(target.href, result);
          }
          return result;
        });
        const processSourceResult = async (index) => {
          const item = requests[index];
          let result;
          try { result = await sourceResults[index]; }
          finally { releaseKomiwaReservation(item); }
          if (stopped) return;
          totalResponseBytes += encoder.encode(result?.text || '').byteLength
            + (result?.prefetched || []).reduce((sum, entry) => sum + encoder.encode(entry.text || '').byteLength, 0);
          const target = validateTarget(item.url);
          const sourceId = typeof item.sourceId === 'string' ? item.sourceId : '';
          const onfCatalog = target?.origin === 'https://onfmangas.com'
            && ['/mangas.php', '/buscar.php'].includes(target.pathname);
          const onfDetail = item?.detail === 'onf'
            && target?.origin === 'https://onfmangas.com'
            && /^\/manga\/\d+\/[^/]+\/?$/.test(target.pathname);
          const leerCapituloCatalog = ['www.leercapitulo.co', 'leercapitulo.co'].includes(target?.hostname)
            && target.pathname === '/manga/';
          const mangaOniCatalog = sourceId === 'mangaoni'
            && target?.origin === 'https://manga-oni.com'
            && ['/directorio', '/buscar'].includes(target.pathname);
          const catalogCoverRequest = item?.catalogCovers === true
            && (sourceId !== 'leercapitulo' || leerCapituloCatalog);
          const olympusCatalog = item?.catalogCovers === true && sourceId === 'olympusscanlation' && target?.origin === 'https://olympusxyz.com'
            && ['/api/rankings', '/api/series/list'].includes(target.pathname);
          if ((catalogCoverRequest || onfCatalog || olympusCatalog || onfDetail || leerCapituloCatalog || mangaOniCatalog)
            && Number(result.status) >= 200 && Number(result.status) < 300 && !result.fallback) {
            const remaining = Math.max(0, imageSubrequestLimit - catalogImageUrls.size);
            const detailCover = onfDetail ? onfMangaCover(result.text || '', result.url || target.href) : '';
            const imageSourceId = leerCapituloCatalog ? 'leercapitulo' : sourceId;
            const queuedCoverUrls = (onfCatalog || catalogCoverRequest || mangaOniCatalog) && Array.isArray(item.catalogCoverUrls)
              ? [...new Set(item.catalogCoverUrls.map((url) => validateTarget(url)?.href).filter(Boolean))]
                .filter((url) => !catalogImageUrls.has(url))
                .slice(0, remaining)
              : [];
            const scanLimit = Math.max(0, remaining - queuedCoverUrls.length);
            const scannedCoverUrls = target && scanLimit && !detailCover
              ? catalogImageCandidates(result.text || '', result.contentType || '', imageSourceId, result.url || target.href, scanLimit)
                .filter((url) => !catalogImageUrls.has(url) && !queuedCoverUrls.includes(url))
              : [];
            const urls = target && remaining
              ? (detailCover ? [detailCover] : [...queuedCoverUrls, ...scannedCoverUrls]).slice(0, remaining)
              : [];
            urls.forEach((url) => catalogImageUrls.add(url));
            send({ type: 'result', index, result: totalResponseBytes <= PROXY_BATCH_TOTAL_RESPONSE_MAX_BYTES
              ? { ...result, ...(urls.length ? { catalogImages: urls } : {}) }
              : { fallback: true } });
            if (urls.length && totalResponseBytes <= PROXY_BATCH_TOTAL_RESPONSE_MAX_BYTES) {
              urls.forEach((url, imageIndex) => catalogCoverJobs.push({
                requestIndex: index,
                sourceId,
                imageIndex,
                image: { url, referer: result.url || target.href, sourceId }
              }));
            }
          } else {
            send({ type: 'result', index, result: totalResponseBytes <= PROXY_BATCH_TOTAL_RESPONSE_MAX_BYTES ? result : { fallback: true } });
          }
        };
        if (detailCount && !requests.some((item) => item?.catalogCovers === true)) {
          await Promise.all(sourceResults.map((_, index) => processSourceResult(index)));
        } else {
          for (let index = 0; index < sourceResults.length && !stopped; index += 1) {
            await processSourceResult(index);
          }
        }
        const catalogTasks = catalogTargets.map(async (catalogTarget, catalogIndex) => {
          const response = await handleMangaDexCatalog(request, catalogTarget);
          const contentType = response.headers.get('content-type') || '';
          if (!response.ok || !contentType.includes('application/vnd.cytlex.catalog-stream') || !response.body) {
            send({ type: 'catalog', index: catalogIndex, status: response.status, contentType, errorOrigin: response.headers.get('x-cytlex-error-origin') || 'source', upstreamError: response.headers.get('x-cytlex-upstream-error') || '' });
            return;
          }
          const reader = response.body.getReader();
          let buffer = new Uint8Array();
          const read = async (size, allowEnd = false) => {
            while (buffer.length < size) {
              const { value, done } = await reader.read();
              if (done) {
                if (allowEnd && !buffer.length) return null;
                throw new Error('Incomplete MangaDex catalog stream');
              }
              const joined = new Uint8Array(buffer.length + value.length);
              joined.set(buffer); joined.set(value, buffer.length); buffer = joined;
            }
            const value = buffer.slice(0, size); buffer = buffer.slice(size); return value;
          };
          const frame = async (allowEnd = false) => {
            const prefix = await read(4, allowEnd);
            if (!prefix) return null;
            const size = new DataView(prefix.buffer).getUint32(0);
            if (!size || size > 3 * 1024 * 1024) throw new Error('Invalid MangaDex catalog frame');
            return JSON.parse(new TextDecoder().decode(await read(size)));
          };
          const first = await frame();
          if (typeof first?.catalog !== 'string' || !Array.isArray(first.images) || first.images.length > 40) throw new Error('Invalid MangaDex catalog metadata');
          send({ type: 'catalog', index: catalogIndex, status: response.status, contentType, catalog: first.catalog, images: first.images });
          while (!stopped) {
            const image = await frame(true);
            if (!image) break;
            if (!Number.isInteger(image.index) || !Number.isInteger(image.length) || image.length < 0 || image.length > PROXY_IMAGE_BATCH_ITEM_MAX_BYTES) throw new Error('Invalid MangaDex cover frame');
            const bytes = await read(image.length);
            send({ type: 'catalog-image', catalogIndex, index: image.index, status: image.status, contentType: image.contentType || '', body: bytesToBase64(bytes) });
          }
        });
        await Promise.all(catalogTasks);
        await mapConcurrent(catalogCoverJobs, PROXY_IMAGE_BATCH_CONCURRENCY, async ({ requestIndex, imageIndex, image }) => {
          try {
            let result = await fetchImageBatchItem(image, request, imageSubrequestBudget, imageByteBudget, 1);
            if (result.status === 200 && result.body?.size === 0) {
              result = await fetchImageBatchItem(image, request, imageSubrequestBudget, imageByteBudget, 1);
            }
            const bytes = result.body ? new Uint8Array(await result.body.arrayBuffer()) : new Uint8Array();
            send({ type: 'catalog-image', requestIndex, index: imageIndex, status: result.status, contentType: result.contentType || '', body: bytesToBase64(bytes) });
          } catch {
            send({ type: 'catalog-image', requestIndex, index: imageIndex, status: 502, contentType: '', body: '' });
          }
        });
        if (!stopped) controller.close();
      } catch (error) {
        if (!stopped) controller.error(error);
      }
    },
    cancel() {
      stopped = true;
      coverQueue.splice(0).forEach((job) => job.resolve());
    }
  });
  return new Response(body, { headers: { 'cache-control': 'no-store', 'content-type': 'application/x-ndjson; charset=utf-8', 'x-cytlex-search-batch': '1' } });
}

function createImageSubrequestBudget(total, limit = PROXY_IMAGE_BATCH_MAX_SUBREQUESTS) {
  let used = 0;
  let pendingInitial = total;
  return {
    takeInitial() {
      pendingInitial -= 1;
      if (used >= limit) throw new Error('Image batch subrequest limit reached');
      used += 1;
    },
    takeAdditional() {
      if (used >= limit - pendingInitial) {
        throw new Error('Image batch subrequest limit reached');
      }
      used += 1;
    }
  };
}

function createImageByteBudget() {
  let used = 0;
  return {
    reserve(bytes) {
      if (used + bytes > PROXY_IMAGE_BATCH_TOTAL_MAX_BYTES) return false;
      used += bytes;
      return true;
    }
  };
}

async function fetchImageBatchItem(item, request, subrequestBudget, byteBudget, retries = 0) {
  const target = validateTarget(item?.url);
  if (!target) return { status: 403, proxyDenied: true, errorOrigin: 'cytlex' };

  const metadataUrl = new URL(request.url);
  metadataUrl.searchParams.delete('url');
  metadataUrl.searchParams.delete('batch');
  metadataUrl.searchParams.delete('referer');
  if (typeof item.referer === 'string' && item.referer.length <= 2048) {
    metadataUrl.searchParams.set('referer', item.referer);
  }
  const metadataHeaders = new Headers({
    accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
    ...(request.headers.get('user-agent') ? { 'user-agent': request.headers.get('user-agent') } : {}),
    ...(request.headers.get('accept-language') ? { 'accept-language': request.headers.get('accept-language') } : {})
  });
  if (target.hostname === 'onfmangas.com' && typeof item.onfCookie === 'string') {
    metadataHeaders.set('x-cytlex-onf-cookie', item.onfCookie.slice(0, 4096));
  }
  const metadataRequest = new Request(metadataUrl, { headers: metadataHeaders });

  const deadline = new AbortController();
  const timeout = setTimeout(() => deadline.abort(), 12000);
  const signal = AbortSignal.any([request.signal, deadline.signal]);
  let streaming = false;
  let responseTooLarge = false;
  try {
    const { upstream, proxyError, finalUrl } = await fetchTarget(
      target,
      'GET',
      forwardedHeaders(metadataRequest, target),
      undefined,
      signal,
      { subrequestBudget, retries }
    );
    if (proxyError) {
      await proxyError.body?.cancel();
      return {
        status: proxyError.status,
        url: finalUrl || target.href,
        errorOrigin: proxyError.headers.get('x-cytlex-error-origin') || 'cytlex',
        upstreamError: proxyError.headers.get('x-cytlex-upstream-error') || '',
        proxyDenied: proxyError.headers.get('x-cytlex-proxy-denied') === '1'
      };
    }

    const contentType = upstream.headers.get('content-type') || '';
    const result = {
      status: upstream.status,
      url: finalUrl || target.href,
      contentType,
      retryAfter: upstream.headers.get('retry-after') || '',
      onfCookie: target.hostname === 'onfmangas.com' ? responseOnfCookies(upstream).join('; ').slice(0, 4096) : '',
      errorOrigin: upstream.ok ? '' : 'source'
    };
    if (!upstream.ok) {
      await upstream.body?.cancel();
      return result;
    }

    const contentLength = Number(upstream.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > PROXY_IMAGE_BATCH_ITEM_MAX_BYTES) {
      await upstream.body?.cancel();
      return { status: 413, errorOrigin: 'cytlex', upstreamError: 'response-too-large' };
    }

    if (!upstream.body) return { ...result, body: new Blob() };
    const body = limitResponseBody(
      upstream.body,
      PROXY_IMAGE_BATCH_ITEM_MAX_BYTES,
      () => clearTimeout(timeout),
      () => { responseTooLarge = true; deadline.abort(); }
    );
    streaming = true;
    const image = await new Response(body).blob();
    if (!byteBudget.reserve(image.size)) {
      return { status: 413, errorOrigin: 'cytlex', upstreamError: 'batch-response-too-large' };
    }
    return { ...result, body: image };
  } catch (error) {
    if (responseTooLarge) return { status: 413, errorOrigin: 'cytlex', upstreamError: 'response-too-large' };
    const timedOut = deadline.signal.aborted && !request.signal.aborted;
    return {
      status: timedOut ? 504 : 502,
      url: target.href,
      errorOrigin: 'connection',
      upstreamError: timedOut ? 'timeout' : isDnsFailure(error) ? 'dns-not-found' : error?.message?.includes('subrequest limit') ? 'subrequest-limit' : 'unreachable'
    };
  } finally {
    if (!streaming) clearTimeout(timeout);
  }
}

async function handleImageBatchRequest(request) {
  const contentLength = Number(request.headers.get('content-length')) || 0;
  if (contentLength > 1_000_000) return errorResponse('Request body is too large', 413);

  let payload;
  try {
    const body = await request.arrayBuffer();
    if (body.byteLength > 1_000_000) return errorResponse('Request body is too large', 413);
    payload = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return errorResponse('Invalid image batch payload', 400);
  }
  if (!Array.isArray(payload?.images) || payload.images.length < 1 || payload.images.length > PROXY_IMAGE_BATCH_MAX_REQUESTS) {
    return errorResponse('Invalid image batch size', 400);
  }

  const subrequestBudget = createImageSubrequestBudget(payload.images.length);
  const byteBudget = createImageByteBudget();
  if (payload.stream === true) {
    let next = 0;
    let stopped = false;
    const body = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        try {
          await Promise.all(Array.from({ length: Math.min(PROXY_IMAGE_BATCH_CONCURRENCY, payload.images.length) }, async () => {
            while (!stopped && next < payload.images.length) {
              const index = next++;
              const item = payload.images[index];
              const result = await fetchImageBatchItem(item, request, subrequestBudget, byteBudget, 1);
              if (stopped) return;
              const bytes = result.body ? new Uint8Array(await result.body.arrayBuffer()) : new Uint8Array();
              if (stopped) return;
              const metadata = encoder.encode(JSON.stringify({ ...result, body: undefined, index, length: bytes.length }));
              const prefix = new Uint8Array(4);
              new DataView(prefix.buffer).setUint32(0, metadata.length);
              controller.enqueue(prefix);
              controller.enqueue(metadata);
              if (bytes.length) controller.enqueue(bytes);
            }
          }));
          if (!stopped) controller.close();
        } catch (error) {
          if (!stopped) controller.error(error);
        }
      },
      cancel() { stopped = true; }
    });
    return new Response(body, { headers: { 'cache-control': 'no-store', 'content-type': 'application/vnd.cytlex.image-stream', 'x-cytlex-image-batch': 'stream' } });
  }
  const results = new Array(payload.images.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(PROXY_IMAGE_BATCH_CONCURRENCY, payload.images.length) }, async () => {
    while (next < payload.images.length) {
      const index = next;
      next += 1;
      const item = payload.images[index];
      results[index] = await fetchImageBatchItem(item, request, subrequestBudget, byteBudget, 1);
    }
  }));
  let offset = 0;
  const responseResults = results.map((result) => {
    const body = result.body;
    const metadata = { ...result, body: undefined, offset, length: body?.size || 0 };
    offset += metadata.length;
    return metadata;
  });
  const metadataBytes = new TextEncoder().encode(JSON.stringify({ results: responseResults }));
  if (metadataBytes.byteLength > 512_000) return errorResponse('Image batch metadata is too large', 502);
  const prefix = new Uint8Array(4);
  new DataView(prefix.buffer).setUint32(0, metadataBytes.length);
  let streamStage = 0;
  let resultIndex = 0;
  let bodyReader = null;
  const body = new ReadableStream({
    async pull(controller) {
      try {
        if (streamStage === 0) {
          streamStage = 1;
          controller.enqueue(prefix);
          return;
        }
        if (streamStage === 1) {
          streamStage = 2;
          controller.enqueue(metadataBytes);
          return;
        }
        while (resultIndex < results.length) {
          const result = results[resultIndex];
          if (!result.body?.size) {
            resultIndex += 1;
            continue;
          }
          if (!bodyReader) bodyReader = result.body.stream().getReader();
          const { done, value } = await bodyReader.read();
          if (done) {
            bodyReader = null;
            resultIndex += 1;
            continue;
          }
          controller.enqueue(value);
          return;
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel(reason) {
      if (bodyReader) await bodyReader.cancel(reason);
    }
  });
  return new Response(body, {
    headers: { 'cache-control': 'no-store', 'content-type': 'application/vnd.cytlex.image-batch', 'x-cytlex-image-batch': '1' }
  });
}

async function handleMangaDexCatalog(request, target) {
  if (target.origin !== 'https://api.mangadex.org' || target.pathname !== '/manga'
    || Number(target.searchParams.get('limit')) !== 40 || !target.searchParams.getAll('includes[]').includes('cover_art')) {
    return errorResponse('Invalid MangaDex catalog request', 400);
  }
  const deadline = new AbortController();
  const timeout = setTimeout(() => deadline.abort(), 12000);
  let upstream;
  try {
    const result = await fetchTarget(target, 'GET', forwardedHeaders(request, target), undefined,
      AbortSignal.any([request.signal, deadline.signal]), { retries: 0 });
    if (result.proxyError) return result.proxyError;
    upstream = result.upstream;
    if (!upstream.ok) return new Response(upstream.body, { status: upstream.status, headers: { 'x-cytlex-proxy': '1', 'x-cytlex-error-origin': 'source' } });
    const length = Number(upstream.headers.get('content-length'));
    if (length > PROXY_BATCH_RESPONSE_MAX_BYTES) return errorResponse('Catalog response too large', 502);
    const raw = await new Response(limitResponseBody(upstream.body, PROXY_BATCH_RESPONSE_MAX_BYTES, () => {}, () => deadline.abort())).text();
    const data = JSON.parse(raw);
    const images = (data.data || []).slice(0, 40).flatMap((item) => {
      const file = item.relationships?.find((rel) => rel.type === 'cover_art')?.attributes?.fileName;
      if (!/^[0-9a-f-]{36}$/i.test(item.id || '') || !/^[0-9a-f-]{36}\.(jpg|png|webp|jpeg)$/i.test(file || '')) return [];
      return [`https://uploads.mangadex.org/covers/${item.id}/${file}.256.jpg`];
    });
    const subrequestBudget = createImageSubrequestBudget(images.length, PROXY_IMAGE_BATCH_MAX_SUBREQUESTS - 1);
    const byteBudget = createImageByteBudget();
    let stopped = false;
    let next = 0;
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      async start(controller) {
        const write = (metadata, bytes = new Uint8Array()) => {
          const encoded = encoder.encode(JSON.stringify(metadata));
          const prefix = new Uint8Array(4);
          new DataView(prefix.buffer).setUint32(0, encoded.length);
          controller.enqueue(prefix); controller.enqueue(encoded);
          if (bytes.length) controller.enqueue(bytes);
        };
        try {
          write({ catalog: raw, images });
          await Promise.all(Array.from({ length: Math.min(PROXY_IMAGE_BATCH_CONCURRENCY, images.length) }, async () => {
            while (!stopped && next < images.length) {
              const index = next++;
              const result = await fetchImageBatchItem({ url: images[index], sourceId: 'mangadex' }, request, subrequestBudget, byteBudget, 1);
              if (stopped) return;
              const bytes = result.body ? new Uint8Array(await result.body.arrayBuffer()) : new Uint8Array();
              write({ index, length: bytes.length, status: result.status, contentType: result.contentType || '' }, bytes);
            }
          }));
          if (!stopped) controller.close();
        } catch (error) { if (!stopped) controller.error(error); }
      },
      cancel() { stopped = true; }
    });
    return new Response(body, { headers: { 'cache-control': 'no-store', 'content-type': 'application/vnd.cytlex.catalog-stream', 'x-cytlex-proxy': '1' } });
  } catch (error) {
    return errorResponse('The source could not be reached', deadline.signal.aborted ? 504 : 502, false, deadline.signal.aborted ? 'timeout' : isDnsFailure(error) ? 'dns-not-found' : 'unreachable');
  } finally { clearTimeout(timeout); }
}

function decodeHtmlAttribute(value) {
  return value.replace(/&(?:amp|quot|apos|#39|lt|gt);|&#\d+;|&#x[\da-f]+;/gi, (entity) => {
    const named = { '&amp;': '&', '&quot;': '"', '&apos;': "'", '&#39;': "'", '&lt;': '<', '&gt;': '>' };
    if (named[entity.toLowerCase()]) return named[entity.toLowerCase()];
    const numeric = entity.match(/^&#(x[\da-f]+|\d+);$/i)?.[1];
    const codePoint = numeric ? (numeric[0].toLowerCase() === 'x' ? parseInt(numeric.slice(1), 16) : parseInt(numeric, 10)) : NaN;
    return Number.isFinite(codePoint) && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : entity;
  });
}

function komiwaChapterPageUrls(html, chapterUrl, chapterNumber = '') {
  const source = String(html || '');
  const serialized = source.replace(/\\+u002f/gi, '/').replace(/\\+\//g, '/').replace(/\\+"/g, '"');
  const pages = [];
  const attrsOf = (tag) => new Map([...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)]
    .map((match) => [match[1].toLowerCase(), decodeHtmlAttribute(match[2] ?? match[3] ?? match[4] ?? '')]));
  const collect = (value, depth = 0) => {
    if (depth > 10 || value == null) return;
    if (typeof value === 'string') { add(value); return; }
    if (Array.isArray(value)) { value.slice(0, 2000).forEach((item) => collect(item, depth + 1)); return; }
    if (typeof value === 'object') Object.values(value).slice(0, 2000).forEach((item) => collect(item, depth + 1));
  };
  const add = (raw) => {
    try {
      if (raw && typeof raw === 'object') raw = raw.url || raw.src || raw.imageUrl || raw.image || raw.path || '';
      const page = new URL(decodeHtmlAttribute(raw), chapterUrl);
      const host = page.hostname.toLowerCase();
      if (page.protocol !== 'https:' || !validateTarget(page.href)
        || (host === 'images.komiwa.net' && (/^\/komiwa-images\/covers\//.test(page.pathname) || /^\/komiwa-images\/_mihon\//.test(page.pathname)))) return;
      if (host === 'blogger.googleusercontent.com' || host === 's.imgfi.com'
        || host === 'media.mangavault.lat' || host === 'images.komiwa.net'
        || host === 'h9s2.komiwa.net' || host === 'n7t9.komiwa.net'
        || host === 'cdnlxd.xyz' || host.endsWith('.cdnlxd.xyz')
        || host === 't34798ndc.com' || host.endsWith('.t34798ndc.com')) pages.push(page.href);
    } catch {}
  };
  const flightStream = [...source.matchAll(/self\.__next_f\.push\(\[1,\s*("(?:\\.|[^"\\])*")\]\)/g)]
    .map(([, chunk]) => { try { return JSON.parse(chunk); } catch { return ''; } }).join('');
  let packedPageList = false;
  const key = source.match(/--rk:\s*\\?"([^"\\]+)\\?"/)?.[1];
  if (key) {
    const keyBytes = new TextEncoder().encode(key);
    const references = new Set([...flightStream.matchAll(/"__r"\s*:\s*"\$L?([0-9a-z]+)"/gi)].map(([, id]) => id));
    for (const reference of references) {
      const row = flightStream.match(new RegExp(`(?:^|\\n)${reference}:T([0-9a-f]+),`, 'i'));
      if (!row) continue;
      const length = Number.parseInt(row[1], 16);
      const start = row.index + row[0].length;
      const encoded = flightStream.slice(start, start + length);
      if (!length || encoded.length !== length || !/^[A-Za-z0-9_-]+$/.test(encoded) || length % 4 === 1) continue;
      try {
        const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - encoded.length % 4) % 4);
        const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
        for (let i = 0; i < bytes.length; i++) bytes[i] ^= keyBytes[i % keyBytes.length] ^ (255 & i);
        const value = JSON.parse(new TextDecoder().decode(bytes));
        collect(value);
      } catch {}
    }
  }
  // Current Komiwa pages keep the complete page list in an obfuscated React Flight row.
  try {
    const seed = 'komiwa-r1-2026-11';
    const hash36 = (value) => {
      let hash = 0x811c9dc5;
      for (let i = 0; i < value.length; i++) {
        hash ^= value.charCodeAt(i);
        hash = Math.imul(hash, 0x1000193) >>> 0;
      }
      return hash.toString(36);
    };
    const packField = `_${hash36(`pack|${seed}`).slice(0, 4)}`;
    const keyField = `_${hash36(`key|${seed}`).slice(0, 4)}`;
    const packReference = flightStream.match(new RegExp(`"${packField}"\\s*:\\s*"\\$L?([0-9a-z]+)"`, 'i'))?.[1];
    const maskedKey = flightStream.match(new RegExp(`"${keyField}"\\s*:\\s*"([A-Za-z0-9_-]+)"`, 'i'))?.[1];
    const chapterId = new URL(chapterUrl).pathname.match(/\/chapter\/([\da-f-]{36})/i)?.[1];
    const embeddedNumber = chapterId
      ? flightStream.match(new RegExp(`"id":"${chapterId}","number":(?:"([^"]+)"|(-?[\\d.]+))`, 'i'))
      : null;
    const number = String(embeddedNumber?.[1] ?? embeddedNumber?.[2] ?? chapterNumber ?? '');
    if (packReference && maskedKey && chapterId && number) {
      const row = flightStream.match(new RegExp(`(?:^|\\n)${packReference}:T([0-9a-f]+),`, 'i'));
      if (row) {
        const length = Number.parseInt(row[1], 16);
        const start = row.index + row[0].length;
        const encoded = flightStream.slice(start, start + length);
        if (length && encoded.length === length && /^[A-Za-z0-9_-]+$/.test(encoded) && length % 4 !== 1) {
          const decodeBase64Url = (value) => {
            const base64 = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
            return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
          };
          const unmaskedBytes = decodeBase64Url(maskedKey);
          const seedBytes = new TextEncoder().encode(seed);
          for (let i = 0; i < unmaskedBytes.length; i++) {
            unmaskedBytes[i] ^= (seedBytes[i % seedBytes.length] ^ (31 * i + 131)) & 255;
          }
          const chapterKey = new TextDecoder().decode(unmaskedBytes);
          const keyInput = `${seed}\x01${chapterKey}\x01${chapterId}|${number}`;
          let hash = 0x811c9dc5, derivedKey = '';
          for (let round = 0; round < 32 && derivedKey.length < 43; round++) {
            for (let i = 0; i < keyInput.length; i++) {
              hash ^= keyInput.charCodeAt(i);
              hash = Math.imul(hash, 0x1000193) >>> 0;
            }
            hash ^= round;
            hash = Math.imul(hash, 0x1000193) >>> 0;
            derivedKey += hash.toString(36);
          }
          const keyBytes = new TextEncoder().encode((derivedKey + 'komiwa').slice(0, 43));
          const packedBytes = decodeBase64Url(encoded);
          for (let i = 0; i < packedBytes.length; i++) packedBytes[i] ^= keyBytes[i % keyBytes.length] ^ (255 & i);
          const decoded = JSON.parse(new TextDecoder().decode(packedBytes));
          if (Array.isArray(decoded?.p) && decoded.p.length) {
            pages.length = 0;
            collect(decoded.p);
            packedPageList = pages.length > 0;
          }
        }
      }
    }
  } catch {}
  if (!packedPageList) {
    const marker = serialized.match(/"imageSigs"\s*:\s*\{/);
    if (marker) {
      const start = marker.index + marker[0].length - 1;
      let depth = 0, quoted = false, escaped = false, end = -1;
      for (let i = start; i < serialized.length; i++) {
        const char = serialized[i];
        if (quoted) {
          if (escaped) escaped = false;
          else if (char === '\\') escaped = true;
          else if (char === '"') quoted = false;
        } else if (char === '"') quoted = true;
        else if (char === '{') depth++;
        else if (char === '}' && --depth === 0) { end = i + 1; break; }
      }
      if (end > start) {
        try { Object.keys(JSON.parse(serialized.slice(start, end))).forEach(add); } catch {}
      }
    }
    for (const match of serialized.matchAll(/https?:\/\/[^\s"'<>\\]+/gi)) add(match[0]);
    for (const tag of source.match(/<img\b[^>]*>/gi) || []) {
      const attrs = attrsOf(tag);
      add(attrs.get('data-src') || attrs.get('data-lazy-src') || attrs.get('data-original') || attrs.get('src') || '');
    }
  }
  return [...new Set(pages)];
}

function achyCatalogImages(html, catalogUrl) {
  const images = new Set();
  const covers = html.matchAll(/\bdata-cover\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi);
  for (const match of covers) {
    const cover = match[1] ?? match[2] ?? match[3] ?? '';
    if (!cover) continue;
    try {
      const target = new URL(decodeHtmlAttribute(cover), catalogUrl);
      if (target.protocol === 'https:' && target.hostname === 'cdn.achymanga.online') images.add(target.href);
    } catch {}
    if (images.size >= PROXY_ACHY_CATALOG_MAX_IMAGES) break;
  }
  return [...images];
}

function onfMangaCover(html, mangaUrl) {
  for (const tag of html.match(/<img\b[^>]*>/gi) || []) {
    const className = tag.match(/\bclass\s*=\s*(["'])(.*?)\1/i)?.[2] || '';
    if (!className.split(/\s+/).includes('manga-poster')) continue;
    for (const name of ['data-src', 'data-lazy-src', 'data-original', 'data-original-src', 'data-srcset', 'srcset', 'src']) {
      const raw = tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i'))?.[2]?.trim() || '';
      const value = ['data-srcset', 'srcset'].includes(name)
        ? raw.split(',').map((candidate) => candidate.trim().split(/\s+/)[0]).filter(Boolean).at(-1) || ''
        : raw;
      if (!value || /^(?:data:|javascript:|about:|#)/i.test(value)) continue;
      try {
        const image = new URL(decodeHtmlAttribute(value), mangaUrl);
        if (image.protocol === 'https:' && image.hostname === 'd33y4i2dmzjqjh.cloudfront.net') return image.href;
      } catch {}
    }
  }
  return '';
}

async function handleOnfMangaDetail(request, target) {
  if (target.origin !== 'https://onfmangas.com' || !/^\/manga\/\d+\/[^/]+\/?$/.test(target.pathname)) {
    return errorResponse('Invalid ONF manga detail request', 400);
  }
  const deadline = new AbortController();
  const timeout = setTimeout(() => deadline.abort(), 12000);
  const signal = AbortSignal.any([request.signal, deadline.signal]);
  try {
    const result = await fetchTarget(target, 'GET', forwardedHeaders(request, target), undefined, signal, { retries: 0 });
    if (result.proxyError) return result.proxyError;
    if (!result.upstream.ok) return new Response(null, { status: result.upstream.status, headers: { 'x-cytlex-proxy': '1', 'x-cytlex-error-origin': 'source' } });
    const html = await new Response(limitResponseBody(result.upstream.body, PROXY_BATCH_RESPONSE_MAX_BYTES, () => {}, () => deadline.abort())).text();
    const coverUrl = onfMangaCover(html, target.href);
    let cover = null;
    if (coverUrl) {
      const subrequestBudget = createImageSubrequestBudget(1, PROXY_IMAGE_BATCH_MAX_SUBREQUESTS - 1);
      const imageRequest = new Request(request.url, { method: 'GET', headers: request.headers, signal });
      const image = await fetchImageBatchItem({ url: coverUrl, referer: 'https://onfmangas.com/' }, imageRequest, subrequestBudget, createImageByteBudget());
      if (image.status === 200 && image.body?.size <= PROXY_IMAGE_BATCH_ITEM_MAX_BYTES) {
        cover = { url: coverUrl, contentType: image.contentType || '', base64: bytesToBase64(new Uint8Array(await image.body.arrayBuffer())) };
      }
    }
    return Response.json({ html, cover }, { headers: { 'cache-control': 'no-store', 'x-cytlex-proxy': '1' } });
  } catch (error) {
    return errorResponse('ONF manga detail unavailable', deadline.signal.aborted ? 504 : 502, false,
      deadline.signal.aborted ? 'timeout' : isDnsFailure(error) ? 'dns-not-found' : 'unreachable');
  } finally { clearTimeout(timeout); }
}

function achyChapterData(html, chapterUrl) {
  const manifestText = html.match(/<[^>]+\bid=["']datos-manifiesto-d["'][^>]*>([\s\S]*?)<\/[^>]+>/i)?.[1] || '{}';
  const manifest = JSON.parse(decodeHtmlAttribute(manifestText));
  const script = [...html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script\s*>/gi)]
    .map(([, value]) => value)
    .find((value) => value.includes('function decryptD') && value.includes('CLAVE_XOR')) || '';
  const key = script.match(/\bconst\s+CLAVE_XOR\s*=\s*(["'])(.*?)\1/s)?.[2];
  if (!manifest.d || !key) throw new Error('AchyManga page list unavailable');

  let encoded = String(manifest.d).replace(/-/g, '+').replace(/_/g, '/');
  encoded += '='.repeat((4 - encoded.length % 4) % 4);
  const binary = atob(encoded);
  const keyBytes = new TextEncoder().encode(key);
  const decoded = Uint8Array.from(binary, (character, index) => character.charCodeAt(0) ^ keyBytes[index % keyBytes.length]);
  const pages = JSON.parse(new TextDecoder().decode(decoded));
  if (!Array.isArray(pages) || !pages.length || pages.length > 1000) throw new Error('Invalid AchyManga page list');
  const pageUrls = pages.map((value) => {
    const image = validateTarget(new URL(value, chapterUrl).href);
    if (!image || image.hostname !== 'cdn.achymanga.online') throw new Error('Invalid AchyManga image URL');
    return image.href;
  });

  const manga = new URL(chapterUrl);
  manga.pathname = manga.pathname.replace(/\/capitulo-[^/]+\/?$/, '');
  manga.search = '';
  manga.hash = '';
  const prefix = `${manga.origin}${manga.pathname.replace(/\/+$/, '')}/capitulo-`;
  const seen = new Set();
  const options = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)].flatMap(([, attrs, content]) => {
    const id = attrs.match(/\bid\s*=\s*(["'])(.*?)\1/i)?.[2] || '';
    const rawHref = attrs.match(/\bhref\s*=\s*(["'])(.*?)\1/i)?.[2] || '';
    let href = '';
    try { href = rawHref ? new URL(decodeHtmlAttribute(rawHref), chapterUrl).href : ''; } catch {}
    if (!href.startsWith(prefix) || id === 'btn-leer' || seen.has(href)) return [];
    const markup = content.match(/<span\b[^>]*>([\s\S]*?)<\/span\s*>/i)?.[1] || content;
    const label = decodeHtmlAttribute(markup.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ')).trim();
    if (/^leer desde el cap[ií]tulo\b/i.test(label)) return [];
    seen.add(href);
    const dataNum = attrs.match(/\bdata-num\s*=\s*(["'])(.*?)\1/i)?.[2];
    const num = Number(dataNum || label.match(/[\d.]+/)?.[0] || href.match(/capitulo-([\d.]+)/)?.[1]);
    return [{ url: href, title: label || `Capítulo ${num}`, num }];
  }).sort((a, b) => (Number.isFinite(a.num) ? a.num : Infinity) - (Number.isFinite(b.num) ? b.num : Infinity));
  const currentPath = new URL(chapterUrl);
  currentPath.pathname = currentPath.pathname.replace(/\/+$/, '');
  const currentIndex = options.findIndex((option) => {
    const optionUrl = new URL(option.url);
    optionUrl.pathname = optionUrl.pathname.replace(/\/+$/, '');
    return optionUrl.href === currentPath.href;
  });
  const current = currentIndex >= 0 ? options[currentIndex] : null;
  const previous = currentIndex > 0 ? options[currentIndex - 1] : null;
  const next = currentIndex >= 0 ? options[currentIndex + 1] || null : null;
  return {
    label: current?.title || `Capítulo ${chapterUrl.match(/capitulo-([\d.]+)/)?.[1] || ''}`,
    mangaUrl: manga.href,
    pages: pageUrls,
    pageTransforms: pageUrls.map((page) => (/[?&]s=1\b|_s\.webp/i.test(page) ? 'scramble-4x4' : '')),
    imageReferer: chapterUrl,
    options: options.map(({ url, title }) => ({ url, title })),
    prev: previous ? { title: previous.title, url: previous.url } : null,
    next: next ? { title: next.title, url: next.url } : null
  };
}

async function handleAchyChapter(request, target) {
  if (target.origin !== 'https://achymanga.online' || !/^\/manga\/[^/]+\/[^/]+\/capitulo-[^/]+\/?$/.test(target.pathname)) {
    return errorResponse('Invalid AchyManga chapter', 400);
  }
  const deadline = new AbortController();
  const timeout = setTimeout(() => deadline.abort(), 12000);
  const signal = AbortSignal.any([request.signal, deadline.signal]);
  try {
    const result = await fetchTarget(target, 'GET', forwardedHeaders(request, target), undefined, signal, { retries: 0 });
    if (result.proxyError) return result.proxyError;
    if (!result.upstream.ok) return new Response(null, { status: result.upstream.status, headers: { 'x-cytlex-proxy': '1', 'x-cytlex-error-origin': 'source' } });
    const html = await new Response(limitResponseBody(result.upstream.body, PROXY_BATCH_RESPONSE_MAX_BYTES, () => {}, () => deadline.abort())).text();
    const chapter = achyChapterData(html, target.href);
    const initial = chapter.pages.slice(0, PROXY_CHAPTER_IMAGE_BATCH_MAX_REQUESTS);
    const subrequestBudget = createImageSubrequestBudget(initial.length, PROXY_IMAGE_BATCH_MAX_SUBREQUESTS - 1);
    const byteBudget = createImageByteBudget();
    let stopped = false;
    let next = 0;
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      async start(controller) {
        const write = (metadata, bytes = new Uint8Array()) => {
          const data = encoder.encode(JSON.stringify(metadata));
          const prefix = new Uint8Array(4);
          new DataView(prefix.buffer).setUint32(0, data.length);
          controller.enqueue(prefix); controller.enqueue(data);
          if (bytes.length) controller.enqueue(bytes);
        };
        try {
          write(chapter);
          await Promise.all(Array.from({ length: Math.min(PROXY_IMAGE_BATCH_CONCURRENCY, initial.length) }, async () => {
            while (!stopped && next < initial.length) {
              const index = next++;
              const image = await fetchImageBatchItem({ url: initial[index], referer: target.href }, request, subrequestBudget, byteBudget);
              if (stopped) return;
              const bytes = image.body ? new Uint8Array(await image.body.arrayBuffer()) : new Uint8Array();
              write({ index, length: bytes.length, status: image.status, contentType: image.contentType || '' }, bytes);
            }
          }));
          if (!stopped) controller.close();
        } catch (error) { if (!stopped) controller.error(error); }
      },
      cancel() { stopped = true; }
    });
    return new Response(body, { headers: { 'cache-control': 'no-store', 'content-type': 'application/vnd.cytlex.chapter-stream', 'x-cytlex-proxy': '1' } });
  } catch (error) {
    return errorResponse('AchyManga chapter unavailable', deadline.signal.aborted ? 504 : 422);
  } finally { clearTimeout(timeout); }
}

async function handleAchyCatalog(request, target) {
  if (target.origin !== 'https://achymanga.online' || target.pathname !== '/catalogo') {
    return errorResponse('Invalid AchyManga catalog request', 400);
  }
  const deadline = new AbortController();
  const timeout = setTimeout(() => deadline.abort(), 12000);
  try {
    const result = await fetchTarget(target, 'GET', forwardedHeaders(request, target), undefined,
      AbortSignal.any([request.signal, deadline.signal]), { retries: 0 });
    if (result.proxyError) return result.proxyError;
    if (!result.upstream.ok) return new Response(result.upstream.body, { status: result.upstream.status, headers: { 'x-cytlex-proxy': '1', 'x-cytlex-error-origin': 'source' } });
    const length = Number(result.upstream.headers.get('content-length'));
    if (length > PROXY_ACHY_CATALOG_MAX_BYTES) return errorResponse('Catalog response too large', 502);
    const raw = await new Response(limitResponseBody(result.upstream.body, PROXY_ACHY_CATALOG_MAX_BYTES, () => {}, () => deadline.abort())).text();
    const images = achyCatalogImages(raw, target.href);
    const subrequestBudget = createImageSubrequestBudget(images.length, PROXY_IMAGE_BATCH_MAX_SUBREQUESTS - 1);
    const byteBudget = createImageByteBudget();
    let stopped = false;
    let next = 0;
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      async start(controller) {
        const write = (metadata, bytes = new Uint8Array()) => {
          const encoded = encoder.encode(JSON.stringify(metadata));
          const prefix = new Uint8Array(4);
          new DataView(prefix.buffer).setUint32(0, encoded.length);
          controller.enqueue(prefix); controller.enqueue(encoded);
          if (bytes.length) controller.enqueue(bytes);
        };
        try {
          write({ catalog: raw, images });
          await Promise.all(Array.from({ length: Math.min(PROXY_IMAGE_BATCH_CONCURRENCY, images.length) }, async () => {
            while (!stopped && next < images.length) {
              const index = next++;
              const image = await fetchImageBatchItem({ url: images[index], referer: target.href }, request, subrequestBudget, byteBudget, 1);
              if (stopped) return;
              const bytes = image.body ? new Uint8Array(await image.body.arrayBuffer()) : new Uint8Array();
              write({ index, length: bytes.length, status: image.status, contentType: image.contentType || '' }, bytes);
            }
          }));
          if (!stopped) controller.close();
        } catch (error) { if (!stopped) controller.error(error); }
      },
      cancel() { stopped = true; }
    });
    return new Response(body, { headers: { 'cache-control': 'no-store', 'content-type': 'application/vnd.cytlex.catalog-stream', 'x-cytlex-proxy': '1' } });
  } catch (error) {
    return errorResponse('AchyManga catalog unavailable', deadline.signal.aborted ? 504 : 502, false,
      deadline.signal.aborted ? 'timeout' : isDnsFailure(error) ? 'dns-not-found' : 'unreachable');
  } finally { clearTimeout(timeout); }
}

async function handleOlympusDetail(request, target, sharedBudget = null, maxChapterPages = 12, onChaptersStart = () => {}) {
  const slug = target.pathname.match(/^\/api\/series\/([\w-]+)$/)?.[1] || '';
  if (target.origin !== 'https://olympusxyz.com' || !slug || target.searchParams.get('type') !== 'comic') {
    return errorResponse('Invalid Olympus detail request', 400);
  }
  let timedOut = false;
  const readJson = async (url, budgetReserved = false) => {
    if (!budgetReserved && sharedBudget && !sharedBudget.take()) throw new Error('Olympus batch subrequest limit reached');
    const page = validateTarget(url);
    const deadline = new AbortController();
    const timeout = setTimeout(() => { timedOut = true; deadline.abort(); }, 12000);
    const signal = AbortSignal.any([request.signal, deadline.signal]);
    try {
    const result = await fetchTarget(page, 'GET', forwardedHeaders(request, page), undefined, signal, { retries: 0 });
    if (result.proxyError) throw { response: result.proxyError };
    if (!result.upstream.ok) {
      throw { response: new Response(result.upstream.body, {
        status: result.upstream.status,
        headers: { 'x-cytlex-proxy': '1', 'x-cytlex-error-origin': 'source' }
      }) };
    }
    const raw = await new Response(limitResponseBody(result.upstream.body, PROXY_BATCH_ITEM_RESPONSE_MAX_BYTES,
      () => {}, () => deadline.abort())).text();
    return JSON.parse(raw);
    } finally { clearTimeout(timeout); }
  };
  try {
    const series = await readJson(target.href);
    onChaptersStart();
    let first;
    try {
      first = await readJson(`https://olympusxyz.com/api/series/${slug}/chapters?page=1&direction=desc&type=comic`);
    } catch (error) {
      if (request.signal.aborted) throw error;
      return Response.json(series, { headers: { 'cache-control': 'no-store', 'x-cytlex-proxy': '1' } });
    }
    const lastPage = Math.min(Math.max(Number(first?.meta?.last_page) || 1, 1), 200);
    const pageLimit = Math.min(lastPage, Math.max(1, maxChapterPages));
    const results = [first];
    let fetchedPages = 1;
    for (let page = 2; page <= pageLimit;) {
      const count = Math.min(6, pageLimit - page + 1);
      const pageUrls = [];
      for (let index = 0; index < count; index += 1) {
        if (sharedBudget && !sharedBudget.take()) break;
        pageUrls.push(`https://olympusxyz.com/api/series/${slug}/chapters?page=${page + index}&direction=desc&type=comic`);
      }
      if (!pageUrls.length) break;
      const pageResults = await Promise.allSettled(pageUrls.map((url) => readJson(url, true)));
      let batchFailed = false;
      for (const pageResult of pageResults) {
        if (pageResult.status === 'rejected') { batchFailed = true; break; }
        results.push(pageResult.value);
        fetchedPages += 1;
      }
      if (batchFailed) break;
      page += pageUrls.length;
    }
    return Response.json({ ...series, chapters: results.flatMap((result) => result?.data || []), chaptersLastPage: lastPage, chaptersFetchedPages: fetchedPages }, {
      headers: { 'cache-control': 'no-store', 'x-cytlex-proxy': '1' }
    });
  } catch (error) {
    if (error?.response) return error.response;
    return errorResponse('Olympus detail unavailable', timedOut ? 504 : 502, false,
      timedOut ? 'timeout' : isDnsFailure(error) ? 'dns-not-found' : 'unreachable');
  }
}

async function handleOlympusChapter(request, target) {
  const match = target.pathname.match(/^\/api\/capitulo\/([\w-]+)\/(-?\d+(?:\.\d+)?)$/);
  if (target.origin !== 'https://olympusxyz.com' || !match) return errorResponse('Invalid Olympus chapter', 400);
  const [, slug] = match;
  const deadline = new AbortController();
  const timeout = setTimeout(() => deadline.abort(), 12000);
  const signal = AbortSignal.any([request.signal, deadline.signal]);
  try {
    const response = await fetchTarget(target, 'GET', forwardedHeaders(request, target), undefined, signal, { retries: 0 });
    if (response.proxyError) return response.proxyError;
    if (!response.upstream.ok) return new Response(null, { status: response.upstream.status, headers: { 'x-cytlex-proxy': '1', 'x-cytlex-error-origin': 'source' } });
    const raw = await new Response(limitResponseBody(response.upstream.body, PROXY_BATCH_ITEM_RESPONSE_MAX_BYTES, () => {}, () => deadline.abort())).text();
    const data = JSON.parse(raw);
    const chapter = data?.chapter || {};
    const pages = (chapter.pages || []).filter((url) => typeof url === 'string' && validateTarget(url));
    if (!pages.length || pages.length > 1000 || pages.length !== chapter.pages?.length) return errorResponse('Olympus chapter has invalid pages', 422);

    const initial = pages.slice(0, PROXY_CHAPTER_IMAGE_BATCH_MAX_REQUESTS);
    const subrequestBudget = createImageSubrequestBudget(initial.length, PROXY_IMAGE_BATCH_MAX_SUBREQUESTS - 1);
    const byteBudget = createImageByteBudget();
    let stopped = false;
    let next = 0;
    const encoder = new TextEncoder();
    const imageReferer = 'https://olympusxyz.com/';
    const body = new ReadableStream({
      async start(controller) {
        const write = (metadata, bytes = new Uint8Array()) => {
          const encoded = encoder.encode(JSON.stringify(metadata));
          const prefix = new Uint8Array(4);
          new DataView(prefix.buffer).setUint32(0, encoded.length);
          controller.enqueue(prefix); controller.enqueue(encoded);
          if (bytes.length) controller.enqueue(bytes);
        };
        try {
          write({ label: chapter.name ? `Capítulo ${chapter.name}` : '', mangaUrl: `https://olympusxyz.com/series/${slug}`, pages, imageReferer });
          await Promise.all(Array.from({ length: Math.min(PROXY_IMAGE_BATCH_CONCURRENCY, initial.length) }, async () => {
            while (!stopped && next < initial.length) {
              const index = next++;
              const image = await fetchImageBatchItem({ url: initial[index], referer: imageReferer }, request, subrequestBudget, byteBudget);
              if (stopped) return;
              const bytes = image.body ? new Uint8Array(await image.body.arrayBuffer()) : new Uint8Array();
              write({ index, length: bytes.length, status: image.status, contentType: image.contentType || '' }, bytes);
            }
          }));
          if (!stopped) controller.close();
        } catch (error) { if (!stopped) controller.error(error); }
      },
      cancel() { stopped = true; }
    });
    return new Response(body, { headers: { 'cache-control': 'no-store', 'content-type': 'application/vnd.cytlex.chapter-stream', 'x-cytlex-proxy': '1' } });
  } catch (error) {
    if (error?.response) return error.response;
    return errorResponse('Olympus chapter unavailable', deadline.signal.aborted ? 504 : 422, false,
      deadline.signal.aborted ? 'timeout' : isDnsFailure(error) ? 'dns-not-found' : 'unreachable');
  } finally { clearTimeout(timeout); }
}

async function handleMangaDexFeed(request, target, includeManga = false, sharedBudget = null, onFeedStart = () => {}) {
  if (target.origin !== 'https://api.mangadex.org'
    || !/^\/manga\/[0-9a-f-]{36}\/feed$/i.test(target.pathname)
    || Number(target.searchParams.get('limit')) !== 500) {
    return errorResponse('Invalid MangaDex feed request', 400);
  }
  const deadline = new AbortController();
  const timeout = setTimeout(() => deadline.abort(), 12000);
  const signal = AbortSignal.any([request.signal, deadline.signal]);
  let requestsFetched = 0;
  const readPage = async (url) => {
    if (requestsFetched >= PROXY_BATCH_MAX_REQUESTS) throw new Error('MangaDex page limit reached');
    if (sharedBudget && !sharedBudget.take()) throw new Error('MangaDex batch subrequest limit reached');
    requestsFetched += 1;
    const page = validateTarget(url);
    const result = await fetchTarget(page, 'GET', forwardedHeaders(request, page), undefined, signal, { retries: 0 });
    if (result.proxyError) throw { response: result.proxyError };
    if (!result.upstream.ok) throw { response: new Response(result.upstream.body, {
      status: result.upstream.status,
      headers: { 'x-cytlex-proxy': '1', 'x-cytlex-error-origin': 'source' }
    }) };
    const raw = await new Response(limitResponseBody(result.upstream.body, PROXY_BATCH_ITEM_RESPONSE_MAX_BYTES,
      () => {}, () => deadline.abort())).text();
    return JSON.parse(raw);
  };
  try {
    let manga = null;
    let mangaBytes = 0;
    if (includeManga) {
      const mangaId = target.pathname.match(/^\/manga\/([0-9a-f-]{36})\/feed$/i)?.[1];
      const mangaUrl = new URL(`/manga/${mangaId}`, target.origin);
      mangaUrl.searchParams.append('includes[]', 'cover_art');
      mangaUrl.searchParams.append('includes[]', 'author');
      mangaUrl.searchParams.append('includes[]', 'artist');
      manga = await readPage(mangaUrl.href);
      if (!manga?.data?.attributes) return errorResponse('Invalid MangaDex manga response', 502, false, 'invalid-response');
      mangaBytes = new TextEncoder().encode(JSON.stringify(manga)).byteLength;
      if (mangaBytes >= PROXY_BATCH_TOTAL_RESPONSE_MAX_BYTES) return errorResponse('MangaDex detail response too large', 502);
    }
    const collectFeed = async (feedUrl) => {
      const first = await readPage(feedUrl);
      if (!Array.isArray(first?.data)) throw new Error('Invalid MangaDex feed response');
      const offset = Math.max(0, Number(new URL(feedUrl).searchParams.get('offset')) || 0);
      const chapters = [...first.data];
      const total = Math.max(Number(first.total) || 0, chapters.length);
      let responseBytes = new TextEncoder().encode(JSON.stringify(first)).byteLength;
      while (offset + chapters.length < total && requestsFetched < PROXY_BATCH_MAX_REQUESTS
        && (!sharedBudget || sharedBudget.remaining > 0)) {
        const nextUrl = new URL(feedUrl);
        nextUrl.searchParams.set('offset', String(offset + chapters.length));
        const page = await readPage(nextUrl.href);
        if (!Array.isArray(page?.data) || !page.data.length) break;
        const pageBytes = new TextEncoder().encode(JSON.stringify(page)).byteLength;
        if (responseBytes + pageBytes + mangaBytes > PROXY_BATCH_TOTAL_RESPONSE_MAX_BYTES) break;
        chapters.push(...page.data);
        responseBytes += pageBytes;
      }
      return { first, chapters };
    };
    onFeedStart();
    let feed = await collectFeed(target.href);
    if (includeManga && (!sharedBudget || sharedBudget.remaining > 0)
      && target.searchParams.getAll('translatedLanguage[]').length
      && !feed.chapters.some((chapter) => !chapter.attributes?.externalUrl)) {
      const fallbackUrl = new URL(target.href);
      fallbackUrl.searchParams.delete('translatedLanguage[]');
      fallbackUrl.searchParams.set('offset', '0');
      feed = await collectFeed(fallbackUrl.href);
    }
    if (includeManga) return Response.json({ result: 'ok', manga: manga.data, chapters: feed.chapters }, {
      headers: { 'cache-control': 'no-store', 'x-cytlex-proxy': '1' }
    });
    return Response.json({ ...feed.first, data: feed.chapters }, {
      headers: { 'cache-control': 'no-store', 'x-cytlex-proxy': '1' }
    });
  } catch (error) {
    if (error?.response) return error.response;
    return errorResponse('MangaDex feed unavailable', deadline.signal.aborted ? 504 : 502, false,
      deadline.signal.aborted ? 'timeout' : isDnsFailure(error) ? 'dns-not-found' : 'unreachable');
  } finally { clearTimeout(timeout); }
}

async function handleMangaDexDetailBatch(request) {
  const contentLength = Number(request.headers.get('content-length')) || 0;
  if (contentLength > 1_000_000) return errorResponse('Request body is too large', 413);
  let payload;
  try {
    const body = await request.arrayBuffer();
    if (body.byteLength > 1_000_000) return errorResponse('Request body is too large', 413);
    payload = JSON.parse(new TextDecoder().decode(body));
  } catch { return errorResponse('Invalid MangaDex detail batch payload', 400); }

  const details = payload?.details;
  if (!Array.isArray(details) || details.length < 1 || details.length > PROXY_MANGADEX_DETAIL_BATCH_MAX) {
    return errorResponse('Invalid MangaDex detail batch size', 400);
  }
  const detailBudget = {
    used: 0,
    limit: PROXY_BATCH_MAX_REQUESTS,
    take() { if (this.used >= this.limit) return false; this.used += 1; return true; },
    get remaining() { return this.limit - this.used; }
  };
  const results = new Array(details.length);
  let next = 0;
  let totalBytes = 0;
  await Promise.all(Array.from({ length: Math.min(PROXY_BATCH_CONCURRENCY, details.length) }, async () => {
    while (next < details.length) {
      const index = next++;
      const detail = details[index];
      const url = typeof detail === 'string' ? detail : detail?.url;
      const includeManga = typeof detail === 'string' || detail?.includeManga !== false;
      const target = validateTarget(url);
      if (!target || target.origin !== 'https://api.mangadex.org'
        || !/^\/manga\/[0-9a-f-]{36}\/feed$/i.test(target.pathname)
        || Number(target.searchParams.get('limit')) !== 500) {
        results[index] = { ok: false, status: 400, error: 'Invalid MangaDex detail URL' };
        continue;
      }
      try {
        const response = await handleMangaDexFeed(request, target, includeManga, detailBudget);
        const body = await response.text();
        const size = new TextEncoder().encode(body).byteLength;
        if (totalBytes + size > PROXY_BATCH_TOTAL_RESPONSE_MAX_BYTES) {
          results[index] = { ok: false, status: 502, error: 'MangaDex detail batch response too large' };
          continue;
        }
        totalBytes += size;
        results[index] = response.ok
          ? { ok: true, status: response.status, body }
          : { ok: false, status: response.status, error: body.slice(0, 2000) };
      } catch {
        results[index] = { ok: false, status: 502, error: 'MangaDex detail unavailable' };
      }
    }
  }));
  return Response.json({ results }, {
    headers: { 'cache-control': 'no-store', 'x-cytlex-mangadex-detail-batch': '1' }
  });
}

async function handleMangaDexChapter(request, target) {
  if (target.origin !== 'https://mangadex.org' || !/^\/chapter\/[0-9a-f-]{36}\/?$/i.test(target.pathname)) {
    return errorResponse('Invalid MangaDex chapter', 400);
  }
  const chapterId = target.pathname.match(/\/chapter\/([0-9a-f-]{36})/i)?.[1];
  const mangaId = target.searchParams.get('manga') || '';
  if (mangaId && !/^[0-9a-f-]{36}$/i.test(mangaId)) return errorResponse('Invalid MangaDex manga identifier', 400);
  const deadline = new AbortController();
  const timeout = setTimeout(() => deadline.abort(), 12000);
  const signal = AbortSignal.any([request.signal, deadline.signal]);
  try {
    const atHomeUrl = new URL(`/at-home/server/${chapterId}`, 'https://api.mangadex.org');
    const atHome = await fetchTarget(atHomeUrl, 'GET', forwardedHeaders(request, atHomeUrl), undefined, signal, { retries: 0 });
    if (atHome.proxyError) return atHome.proxyError;
    if (!atHome.upstream.ok) return new Response(atHome.upstream.body, { status: atHome.upstream.status, headers: { 'x-cytlex-proxy': '1', 'x-cytlex-error-origin': 'source' } });
    const raw = await new Response(limitResponseBody(atHome.upstream.body, PROXY_BATCH_ITEM_RESPONSE_MAX_BYTES, () => {}, () => deadline.abort())).text();
    const data = JSON.parse(raw);
    const chapter = data.chapter || {};
    const baseUrl = String(data.baseUrl || '').replace(/\/$/, '');
    if (!/^https:\/\//i.test(baseUrl) || !/^[0-9a-f]{32}$/i.test(chapter.hash || '') || !Array.isArray(chapter.data) || !chapter.data.length) {
      return errorResponse('Invalid MangaDex at-home response', 502, false, 'invalid-response');
    }
    const pages = chapter.data.map((file) => `${baseUrl}/data/${chapter.hash}/${encodeURIComponent(file)}`);
    const fallbacks = (Array.isArray(chapter.dataSaver) ? chapter.dataSaver : [])
      .map((file) => `${baseUrl}/data-saver/${chapter.hash}/${encodeURIComponent(file)}`);
    if (pages.some((url) => !validateTarget(url)) || fallbacks.some((url) => !validateTarget(url))) {
      return errorResponse('Invalid MangaDex image URL', 502, false, 'invalid-response');
    }
    const initial = pages.slice(0, PROXY_CHAPTER_IMAGE_BATCH_MAX_REQUESTS);
    const subrequestBudget = createImageSubrequestBudget(initial.length, PROXY_IMAGE_BATCH_MAX_SUBREQUESTS - 1);
    const byteBudget = createImageByteBudget();
    let stopped = false;
    let next = 0;
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      async start(controller) {
        const write = (metadata, bytes = new Uint8Array()) => {
          const encoded = encoder.encode(JSON.stringify(metadata));
          const prefix = new Uint8Array(4);
          new DataView(prefix.buffer).setUint32(0, encoded.length);
          controller.enqueue(prefix); controller.enqueue(encoded);
          if (bytes.length) controller.enqueue(bytes);
        };
        try {
          write({ pages, pageFallbacks: fallbacks, label: target.searchParams.get('label') || 'Capítulo',
            mangaUrl: mangaId ? `https://mangadex.org/title/${mangaId}` : '', imageReferer: 'https://mangadex.org/' });
          await Promise.all(Array.from({ length: Math.min(PROXY_IMAGE_BATCH_CONCURRENCY, initial.length) }, async () => {
            while (!stopped && next < initial.length) {
              const index = next++;
              let image = await fetchImageBatchItem({ url: initial[index], referer: 'https://mangadex.org/' }, request, subrequestBudget, byteBudget);
              if (image.status >= 400 && fallbacks[index]) {
                image = await fetchImageBatchItem({ url: fallbacks[index], referer: 'https://mangadex.org/' }, request, subrequestBudget, byteBudget);
              }
              if (stopped) return;
              const bytes = image.body ? new Uint8Array(await image.body.arrayBuffer()) : new Uint8Array();
              write({ index, length: bytes.length, status: image.status, contentType: image.contentType || '' }, bytes);
            }
          }));
          if (!stopped) controller.close();
        } catch (error) { if (!stopped) controller.error(error); }
      },
      cancel() { stopped = true; }
    });
    return new Response(body, { headers: { 'cache-control': 'no-store', 'content-type': 'application/vnd.cytlex.chapter-stream', 'x-cytlex-proxy': '1' } });
  } catch (error) {
    return errorResponse('MangaDex chapter unavailable', deadline.signal.aborted ? 504 : 502, false,
      deadline.signal.aborted ? 'timeout' : isDnsFailure(error) ? 'dns-not-found' : 'unreachable');
  } finally { clearTimeout(timeout); }
}

async function handleLeerCapituloChapter(request, target) {
  if (target.origin !== 'https://www.leercapitulo.co' || !/^\/leer\/[^/]+\/[^/]+\/[^/]+\/?$/.test(target.pathname)) {
    return errorResponse('Invalid LeerCapitulo chapter', 400);
  }
  const deadline = new AbortController();
  const timeout = setTimeout(() => deadline.abort(), 12000);
  const signal = AbortSignal.any([request.signal, deadline.signal]);
  try {
    const result = await fetchTarget(target, 'GET', forwardedHeaders(request, target), undefined, signal, { retries: 0 });
    if (result.proxyError) return result.proxyError;
    if (!result.upstream.ok) return new Response(null, { status: result.upstream.status, headers: { 'x-cytlex-proxy': '1', 'x-cytlex-error-origin': 'source' } });
    const html = await new Response(limitResponseBody(result.upstream.body, PROXY_BATCH_RESPONSE_MAX_BYTES, () => {}, () => deadline.abort())).text();
    const attribute = (tag, name) => {
      const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
      return match?.[1] ?? match?.[2] ?? match?.[3] ?? '';
    };
    const openingTags = [...html.matchAll(/<[a-z][^>]*>/gi)];
    const pageContainer = openingTags.find(([tag]) => attribute(tag, 'id') === 'lcPages');
    if (!pageContainer) return errorResponse('LeerCapitulo chapter has no page container', 422);
    const containerTag = pageContainer[0].match(/^<([a-z]+)/i)?.[1]?.toLowerCase();
    if (!containerTag) return errorResponse('LeerCapitulo chapter has an invalid page container', 422);
    const pages = [];
    const tokens = new RegExp(`<\\/?${containerTag}\\b[^>]*>|<img\\b[^>]*>`, 'gi');
    let depth = 0;
    let inPages = false;
    for (const match of html.slice(pageContainer.index).matchAll(tokens)) {
      const tag = match[0];
      if (new RegExp(`^<${containerTag}\\b`, 'i').test(tag)) {
        inPages = true;
        depth++;
        continue;
      }
      if (new RegExp(`^<\\/${containerTag}\\b`, 'i').test(tag)) {
        if (inPages && --depth <= 0) break;
        continue;
      }
      if (!inPages) continue;
      const raw = attribute(tag, 'data-src') || attribute(tag, 'src');
      if (!raw) continue;
      try {
        const page = new URL(decodeHtmlAttribute(raw), target);
        if (page.protocol === 'https:' && validateTarget(page.href)) pages.push(page.href);
      } catch {}
    }
    const uniquePages = [...new Set(pages)];
    if (!uniquePages.length || uniquePages.length > 1000) return errorResponse('Invalid LeerCapitulo page list', 422);

    const select = html.match(/<select\b(?=[^>]*\bid\s*=\s*(["'])chapterSelect\1)[^>]*>([\s\S]*?)<\/select\s*>/i)?.[2] || '';
    const options = [...select.matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option\s*>/gi)].map(([_, tag, label]) => {
      let url = '';
      try { url = new URL(decodeHtmlAttribute(attribute(tag, 'value')), target).href; } catch {}
      return { url, title: decodeHtmlAttribute(label.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim() };
    }).filter((option) => option.url && option.title);
    const currentIndex = options.findIndex((option) => option.url === target.href);
    const mangaHeader = html.match(/<[^>]*class\s*=\s*(["'])[^"']*\blc-reader-top\b[^"']*\1[^>]*>([\s\S]*?)(?:<\/header\s*>|<\/div\s*>)/i)?.[2] || '';
    let mangaUrl = '';
    let mangaTitle = '';
    for (const [, tag, content] of mangaHeader.matchAll(/(<a\b[^>]*>)([\s\S]*?)<\/a\s*>/gi)) {
      const href = attribute(tag, 'href');
      if (!href) continue;
      try {
        const candidate = new URL(decodeHtmlAttribute(href), target);
        if (candidate.origin === target.origin && candidate.pathname.startsWith('/manga/')) {
          mangaUrl = candidate.href;
          mangaTitle = decodeHtmlAttribute(content.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
          break;
        }
      } catch {}
    }
    const pill = html.match(/<[^>]*id\s*=\s*(["'])lcChapterPill\1[^>]*>([\s\S]*?)<\//i)?.[2] || '';
    const label = decodeHtmlAttribute(pill.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
    const initial = uniquePages.slice(0, PROXY_CHAPTER_IMAGE_BATCH_MAX_REQUESTS);
    const subrequestBudget = createImageSubrequestBudget(initial.length, PROXY_IMAGE_BATCH_MAX_SUBREQUESTS - 1);
    const byteBudget = createImageByteBudget();
    let stopped = false;
    let next = 0;
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      async start(controller) {
        const write = (metadata, bytes = new Uint8Array()) => {
          const data = encoder.encode(JSON.stringify(metadata));
          const prefix = new Uint8Array(4);
          new DataView(prefix.buffer).setUint32(0, data.length);
          controller.enqueue(prefix); controller.enqueue(data);
          if (bytes.length) controller.enqueue(bytes);
        };
        try {
          write({ pages: uniquePages, options, mangaUrl, mangaTitle, label, imageReferer: target.href,
            prev: currentIndex >= 0 ? options[currentIndex + 1] || null : null,
            next: currentIndex >= 0 ? options[currentIndex - 1] || null : null });
          await Promise.all(Array.from({ length: Math.min(PROXY_IMAGE_BATCH_CONCURRENCY, initial.length) }, async () => {
            while (!stopped && next < initial.length) {
              const index = next++;
              const image = await fetchImageBatchItem({ url: initial[index], referer: target.href }, request, subrequestBudget, byteBudget);
              if (stopped) return;
              const bytes = image.body ? new Uint8Array(await image.body.arrayBuffer()) : new Uint8Array();
              write({ index, length: bytes.length, status: image.status, contentType: image.contentType || '' }, bytes);
            }
          }));
          if (!stopped) controller.close();
        } catch (error) { if (!stopped) controller.error(error); }
      },
      cancel() { stopped = true; }
    });
    return new Response(body, { headers: { 'cache-control': 'no-store', 'content-type': 'application/vnd.cytlex.chapter-stream', 'x-cytlex-proxy': '1' } });
  } catch (error) {
    return errorResponse('LeerCapitulo chapter unavailable', deadline.signal.aborted ? 504 : 422);
  } finally { clearTimeout(timeout); }
}

async function handleKomiwaChapter(request, target) {
  if (target.origin !== 'https://www.komiwa.net' || !/^\/chapter\/[\da-f-]{36}\/?$/i.test(target.pathname)) {
    return errorResponse('Invalid Komiwa chapter', 400);
  }
  const deadline = new AbortController();
  const timeout = setTimeout(() => deadline.abort(), 12000);
  const signal = AbortSignal.any([request.signal, deadline.signal]);
  try {
    const mangaId = target.searchParams.get('manga') || '';
    const slug = target.searchParams.get('slug') || '';
    const chapterPageUrl = new URL(target.pathname, target.origin);
    const chapterHeaders = forwardedHeaders(request, target);
    chapterHeaders.set('referer', 'https://www.komiwa.net/');
    const chapterRequest = fetchTarget(chapterPageUrl, 'GET', chapterHeaders, undefined, signal, { retries: 0 });
    const chaptersUrl = /^[\da-f-]{36}$/i.test(mangaId)
      ? new URL(`/manga/${encodeURIComponent(mangaId)}/chapters?page=1&limit=99999&sort=desc`, 'https://b78sk.komiwa.net')
      : null;
    const chaptersRequest = chaptersUrl
      ? fetchTarget(chaptersUrl, 'GET', new Headers({ accept: 'application/json', referer: 'https://www.komiwa.net/' }), undefined, signal, { retries: 0 })
      : Promise.resolve(null);
    const [chapterResult, chaptersResult] = await Promise.all([chapterRequest, chaptersRequest]);
    if (chapterResult.proxyError) return chapterResult.proxyError;
    if (!chapterResult.upstream.ok) return new Response(null, { status: chapterResult.upstream.status, headers: { 'cache-control': 'no-store', 'x-cytlex-proxy': '1', 'x-cytlex-error-origin': 'source' } });
    const html = await new Response(limitResponseBody(chapterResult.upstream.body, PROXY_BATCH_RESPONSE_MAX_BYTES, () => {}, () => deadline.abort())).text();
    let chapterData = null;
    if (chaptersResult?.upstream?.ok) {
      try {
        const raw = await new Response(limitResponseBody(chaptersResult.upstream.body, PROXY_BATCH_RESPONSE_MAX_BYTES, () => {}, () => deadline.abort())).text();
        chapterData = JSON.parse(raw)?.data?.chapters || null;
      } catch {}
    }
    const normalizeSlug = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase('es').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const normalizedMangaSlug = normalizeSlug(slug);
    const options = (Array.isArray(chapterData) ? chapterData : [])
      .filter((item) => item?.id)
      .sort((a, b) => {
        const left = Number.parseFloat(a.number), right = Number.parseFloat(b.number);
        if (Number.isFinite(left) && Number.isFinite(right) && left !== right) return left - right;
        return String(a.number).localeCompare(String(b.number), 'es', { numeric: true });
      })
      .map((item) => {
        const url = new URL(`/chapter/${encodeURIComponent(item.id)}`, 'https://www.komiwa.net');
        if (mangaId) url.searchParams.set('manga', mangaId);
        if (slug) url.searchParams.set('slug', slug);
        const title = String(item.title || '').replace(/\s+/g, ' ').trim();
        const mangaTitle = String(item.manga?.title || item.mangaTitle || '').replace(/\s+/g, ' ').trim();
        const isMangaTitle = (mangaTitle && title.toLocaleLowerCase('es') === mangaTitle.toLocaleLowerCase('es'))
          || (normalizedMangaSlug && normalizeSlug(title) === normalizedMangaSlug);
        return { url: url.href, title: !title || isMangaTitle ? `Capítulo ${String(item.number || '').trim()}` : title };
      });
    const currentIndex = options.findIndex((item) => new URL(item.url).pathname === target.pathname);
    const heading = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || '';
    const label = decodeHtmlAttribute(heading.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')).trim();
    const currentChapter = Array.isArray(chapterData)
      ? chapterData.find((item) => String(item?.id || '').toLowerCase() === target.pathname.match(/[\da-f-]{36}/i)?.[0]?.toLowerCase())
      : null;
    const pages = komiwaChapterPageUrls(html, chapterPageUrl.href, currentChapter?.number);
    if (!pages.length || pages.length > 1000) return errorResponse('Komiwa chapter has no pages', 422);

    const mangaUrl = slug ? `https://www.komiwa.net/manga/${encodeURIComponent(slug)}` : '';
    const initial = pages.slice(0, PROXY_CHAPTER_IMAGE_BATCH_MAX_REQUESTS);
    const subrequestBudget = createImageSubrequestBudget(initial.length, PROXY_IMAGE_BATCH_MAX_SUBREQUESTS - 2);
    const byteBudget = createImageByteBudget();
    let stopped = false, next = 0;
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      async start(controller) {
        const write = (metadata, bytes = new Uint8Array()) => {
          const data = encoder.encode(JSON.stringify(metadata));
          const prefix = new Uint8Array(4);
          new DataView(prefix.buffer).setUint32(0, data.length);
          controller.enqueue(prefix); controller.enqueue(data);
          if (bytes.length) controller.enqueue(bytes);
        };
        try {
          write({ pages, options, label: label || options[currentIndex]?.title || 'Capítulo', mangaUrl,
            imageReferer: chapterPageUrl.href,
            prev: currentIndex > 0 ? options[currentIndex - 1] : null,
            next: currentIndex >= 0 ? options[currentIndex + 1] || null : null });
          await Promise.all(Array.from({ length: Math.min(PROXY_IMAGE_BATCH_CONCURRENCY, initial.length) }, async () => {
            while (!stopped && next < initial.length) {
              const index = next++;
              const image = await fetchImageBatchItem({ url: initial[index], referer: target.href }, request, subrequestBudget, byteBudget);
              if (stopped) return;
              const bytes = image.body ? new Uint8Array(await image.body.arrayBuffer()) : new Uint8Array();
              write({ index, length: bytes.length, status: image.status, contentType: image.contentType || '' }, bytes);
            }
          }));
          if (!stopped) controller.close();
        } catch (error) { if (!stopped) controller.error(error); }
      },
      cancel() { stopped = true; }
    });
    return new Response(body, { headers: { 'cache-control': 'no-store', 'content-type': 'application/vnd.cytlex.chapter-stream', 'x-cytlex-proxy': '1' } });
  } catch (error) {
    return errorResponse('Komiwa chapter unavailable', deadline.signal.aborted ? 504 : 422, false,
      deadline.signal.aborted ? 'timeout' : isDnsFailure(error) ? 'dns-not-found' : 'unreachable');
  } finally { clearTimeout(timeout); }
}

async function handleOnfChapter(request, target) {
  if (target.origin !== 'https://onfmangas.com' || !target.pathname.startsWith('/lector/')) return errorResponse('Invalid ONF chapter', 400);
  const deadline = new AbortController();
  const timeout = setTimeout(() => deadline.abort(), 12000);
  const signal = AbortSignal.any([request.signal, deadline.signal]);
  try {
    const first = await fetchTarget(target, 'GET', forwardedHeaders(request, target), undefined, signal, { retries: 0 });
    if (first.proxyError) return first.proxyError;
    if (!first.upstream.ok) return new Response(null, { status: first.upstream.status, headers: { 'x-cytlex-proxy': '1', 'x-cytlex-error-origin': 'source' } });
    const html = await new Response(limitResponseBody(first.upstream.body, PROXY_BATCH_RESPONSE_MAX_BYTES, () => {}, () => deadline.abort())).text();
    const access = html.match(/(?:window\.)?onfReaderPagesPromise\s*=\s*[\s\S]{0,12000}?\)\s*\(\s*["']([A-Za-z0-9_-]{128,8192})["']\s*\)\s*:\s*Promise\.resolve\b/i)?.[1];
    if (!access) return errorResponse('ONF chapter requires the standard reader', 422);
    const cookiePairs = new Map([...onfCookiePairs(request), ...responseOnfCookies(first.upstream)].map((pair) => [pair.slice(0, pair.indexOf('=')), pair]));
    let cookies = [...cookiePairs.values()].join('; ').slice(0, 4096);
    const pageTarget = new URL('https://onfmangas.com/reader_pages.php');
    const pageHeaders = new Headers(request.headers);
    pageHeaders.set('x-cytlex-onf-cookie', cookies);
    pageHeaders.set('content-type', 'application/json');
    pageHeaders.set('x-requested-with', 'XMLHttpRequest');
    const pageRequest = new Request(request.url, { method: 'POST', headers: pageHeaders });
    const second = await fetchTarget(pageTarget, 'POST', forwardedHeaders(pageRequest, pageTarget), JSON.stringify({ access }), signal, { retries: 0 });
    if (second.proxyError || !second.upstream?.ok) return errorResponse('ONF page list unavailable', 422);
    for (const pair of responseOnfCookies(second.upstream)) cookiePairs.set(pair.slice(0, pair.indexOf('=')), pair);
    cookies = [...cookiePairs.values()].join('; ').slice(0, 4096);
    const raw = await new Response(limitResponseBody(second.upstream.body, PROXY_BATCH_RESPONSE_MAX_BYTES, () => {}, () => deadline.abort())).text();
    const payload = JSON.parse(raw);
    if (!Array.isArray(payload.pages) || !payload.pages.length || payload.pages.length > 1000) return errorResponse('Invalid ONF page list', 422);
    const entries = payload.pages.map((page) => {
      const src = typeof page === 'string' ? page : page?.src || page?.url || page?.proxy;
      const fallback = page && typeof page === 'object' && !Array.isArray(page)
        ? page.fallback || page.fallbackUrl || page.fallback_url || page.proxy || ''
        : '';
      const image = new URL(decodeHtmlAttribute(src), target);
      if (!validateTarget(image.href)) throw new Error('Invalid ONF image');
      const alternate = fallback ? validateTarget(new URL(decodeHtmlAttribute(fallback), target).href) : null;
      return { url: image.href, fallback: alternate?.href || '' };
    });
    const initial = entries.slice(0, 40);
    const subrequestBudget = createImageSubrequestBudget(initial.length, PROXY_IMAGE_BATCH_MAX_SUBREQUESTS - 2);
    const byteBudget = createImageByteBudget();
    let stopped = false, next = 0;
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      async start(controller) {
        const write = (metadata, bytes = new Uint8Array()) => {
          const data = encoder.encode(JSON.stringify(metadata));
          const prefix = new Uint8Array(4); new DataView(prefix.buffer).setUint32(0, data.length);
          controller.enqueue(prefix); controller.enqueue(data); if (bytes.length) controller.enqueue(bytes);
        };
        try {
          write({ pages: entries.map((entry) => entry.url), pageFallbacks: entries.map((entry) => entry.fallback), imageCookie: cookies });
          await Promise.all(Array.from({ length: Math.min(PROXY_IMAGE_BATCH_CONCURRENCY, initial.length) }, async () => {
            while (!stopped && next < initial.length) {
              const index = next++;
              let result = await fetchImageBatchItem({ url: initial[index].url, referer: target.href, onfCookie: cookies }, request, subrequestBudget, byteBudget);
              if ((!result.body || result.status !== 200) && initial[index].fallback) {
                const fallback = await fetchImageBatchItem({ url: initial[index].fallback, referer: target.href, onfCookie: cookies }, request, subrequestBudget, byteBudget);
                if (fallback.body && fallback.status === 200) result = fallback;
              }
              if (stopped) return;
              const bytes = result.body ? new Uint8Array(await result.body.arrayBuffer()) : new Uint8Array();
              write({ index, length: bytes.length, status: result.status, contentType: result.contentType || '' }, bytes);
            }
          }));
          if (!stopped) controller.close();
        } catch (error) { if (!stopped) controller.error(error); }
      }, cancel() { stopped = true; }
    });
    return new Response(body, { headers: { 'cache-control': 'no-store', 'content-type': 'application/vnd.cytlex.chapter-stream', 'x-cytlex-proxy': '1' } });
  } catch (error) {
    return errorResponse('ONF chapter unavailable', deadline.signal.aborted ? 504 : 422);
  } finally { clearTimeout(timeout); }
}

async function handleZonaTmoChapter(request, target) {
  if (target.hostname !== 'zonatmo.org' || !target.pathname.startsWith('/view_uploads/')) return errorResponse('Invalid ZonaTMO chapter', 400);
  const deadline = new AbortController();
  const timeout = setTimeout(() => deadline.abort(), 12000);
  const signal = AbortSignal.any([request.signal, deadline.signal]);
  try {
    const result = await fetchTarget(target, 'GET', forwardedHeaders(request, target), undefined, signal, { retries: 0 });
    if (result.proxyError) return result.proxyError;
    if (!result.upstream.ok) return new Response(null, { status: result.upstream.status, headers: { 'x-cytlex-proxy': '1', 'x-cytlex-error-origin': 'source' } });
    const html = await new Response(limitResponseBody(result.upstream.body, PROXY_BATCH_RESPONSE_MAX_BYTES, () => {}, () => deadline.abort())).text();
    const pages = [];
    for (const tag of html.match(/<img\b[^>]*>/gi) || []) {
      if (!/\bclass\s*=\s*(["'])[^"']*\breader-image\b[^"']*\1/i.test(tag)) continue;
      const raw = tag.match(/\b(?:src|data-src)\s*=\s*(["'])(.*?)\1/i)?.[2];
      if (!raw) continue;
      try {
        const page = new URL(decodeHtmlAttribute(raw), target);
        if (validateTarget(page.href)) pages.push(page.href);
      } catch {}
    }
    const uniquePages = [...new Set(pages)].slice(0, 1000);
    if (!uniquePages.length) return errorResponse('ZonaTMO chapter has no pages', 422);
    const select = html.match(/<select\b(?=[^>]*\bid\s*=\s*(["'])chapterSelect\1)[^>]*>([\s\S]*?)<\/select>/i)?.[2] || '';
    const options = [...select.matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)].map((match) => {
      const value = match[1].match(/\bvalue\s*=\s*(["'])(.*?)\1/i)?.[2] || '';
      const title = decodeHtmlAttribute(match[2].replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
      let url = '';
      try { url = new URL(decodeHtmlAttribute(value), target).href; } catch {}
      return { url, title };
    }).filter((option) => option.url && option.title).reverse();
    const index = options.findIndex((option) => option.url === target.href);
    const backHref = html.match(/<[^>]*id\s*=\s*(["'])reader-header\1[^>]*>[\s\S]*?<a\b[^>]*href\s*=\s*(["'])(.*?)\2/i)?.[3] || '';
    let mangaUrl = '';
    try { mangaUrl = new URL(decodeHtmlAttribute(backHref), target).href; } catch {}
    const initial = uniquePages.slice(0, PROXY_CHAPTER_IMAGE_BATCH_MAX_REQUESTS);
    const subrequestBudget = createImageSubrequestBudget(initial.length, PROXY_IMAGE_BATCH_MAX_SUBREQUESTS - 1);
    const byteBudget = createImageByteBudget();
    let stopped = false, next = 0;
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      async start(controller) {
        const write = (metadata, bytes = new Uint8Array()) => {
          const data = encoder.encode(JSON.stringify(metadata));
          const prefix = new Uint8Array(4); new DataView(prefix.buffer).setUint32(0, data.length);
          controller.enqueue(prefix); controller.enqueue(data); if (bytes.length) controller.enqueue(bytes);
        };
        try {
          write({ pages: uniquePages, label: options.find((option) => option.url === target.href)?.title || '', options, prev: index >= 0 ? options[index + 1] || null : null, next: index >= 0 ? options[index - 1] || null : null, mangaUrl, imageReferer: 'https://zonatmo.org/' });
          await Promise.all(Array.from({ length: Math.min(PROXY_IMAGE_BATCH_CONCURRENCY, initial.length) }, async () => {
            while (!stopped && next < initial.length) {
              const i = next++;
              const image = await fetchImageBatchItem({ url: initial[i], referer: 'https://zonatmo.org/' }, request, subrequestBudget, byteBudget);
              if (stopped) return;
              const bytes = image.body ? new Uint8Array(await image.body.arrayBuffer()) : new Uint8Array();
              write({ index: i, length: bytes.length, status: image.status, contentType: image.contentType || '' }, bytes);
            }
          }));
          if (!stopped) controller.close();
        } catch (error) { if (!stopped) controller.error(error); }
      },
      cancel() { stopped = true; }
    });
    return new Response(body, { headers: { 'cache-control': 'no-store', 'content-type': 'application/vnd.cytlex.chapter-stream', 'x-cytlex-proxy': '1' } });
  } catch (error) {
    return errorResponse('ZonaTMO chapter unavailable', deadline.signal.aborted ? 504 : 422, false,
      deadline.signal.aborted ? 'timeout' : isDnsFailure(error) ? 'dns-not-found' : 'unreachable');
  } finally { clearTimeout(timeout); }
}

async function handleInmangaChapter(request, target) {
  if (target.origin !== 'https://inmanga.com' || !target.pathname.startsWith('/chapter/chapterIndexControls')) {
    return errorResponse('Invalid InManga chapter', 400);
  }
  const chapterId = target.searchParams.get('identification') || '';
  const mangaId = target.searchParams.get('mangaIdentification') || '';
  if (!/^[\w-]{1,128}$/.test(chapterId) || !/^[\w-]{1,128}$/.test(mangaId)) {
    return errorResponse('Invalid InManga chapter identifiers', 400);
  }

  const deadline = new AbortController();
  const timeout = setTimeout(() => deadline.abort(), 12000);
  const signal = AbortSignal.any([request.signal, deadline.signal]);
  try {
    const pageTarget = new URL('/chapter/chapterIndexControls', target.origin);
    pageTarget.searchParams.set('identification', chapterId);
    const first = await fetchTarget(pageTarget, 'GET', forwardedHeaders(request, pageTarget), undefined, signal, { retries: 0 });
    if (first.proxyError) return first.proxyError;
    if (!first.upstream.ok) return new Response(null, { status: first.upstream.status, headers: { 'x-cytlex-proxy': '1', 'x-cytlex-error-origin': 'source' } });
    const html = await new Response(limitResponseBody(first.upstream.body, PROXY_BATCH_RESPONSE_MAX_BYTES, () => {}, () => deadline.abort())).text();
    const valueFor = (id) => {
      const tag = html.match(new RegExp(`<[^>]+\\bid=["']${id}["'][^>]*>`, 'i'))?.[0] || '';
      return tag.match(/\bvalue\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i)?.slice(1).find(Boolean) || '';
    };
    const mangaUuid = valueFor('MangaIdentification') || mangaId;
    const chapterUuid = valueFor('ChapterIdentification') || chapterId.toLowerCase();
    const safeSegment = (value) => /^[\w-]{1,128}$/.test(value);
    if (!safeSegment(mangaUuid) || !safeSegment(chapterUuid)) return errorResponse('Invalid InManga page identifiers', 422);

    const imageTags = [...html.matchAll(/<img\b[^>]*>/gi)].map(([tag]) => tag);
    const imagePageIds = imageTags.flatMap((tag) => {
      const classes = /\bclass\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag)?.slice(1).find(Boolean) || '';
      if (!/\bImageContainer\b/.test(classes)) return [];
      const id = /\bid\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag)?.slice(1).find(Boolean) || '';
      return safeSegment(id) ? [id] : [];
    });
    const pageList = html.match(/<(select|div|ul|ol)\b(?=[^>]*\bid=["']PageList["'])[^>]*>([\s\S]*?)<\/\1\s*>/i)?.[2] || '';
    const listedPageIds = [...pageList.matchAll(/<(?:option|li|div)\b[^>]*>/gi)]
      .map(([tag]) => /\bvalue\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag)?.slice(1).find(Boolean)
        || /\bid\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag)?.slice(1).find(Boolean)
        || '')
      .filter(safeSegment);
    const pageIds = [...new Set(imagePageIds.length ? imagePageIds : listedPageIds)];
    if (!pageIds.length || pageIds.length > 1000) return errorResponse('Invalid InManga page list', 422);

    const chapterNumber = target.searchParams.get('number') || valueFor('ChapterNumber');
    const slug = target.searchParams.get('slug') || valueFor('FriendlyMangaName');
    const legacyMangaName = valueFor('FriendlyMangaName') || slug;
    const legacyChapterNumber = valueFor('FriendlyChapterNumberUrl') || chapterNumber;
    const imageReferer = slug && chapterNumber
      ? `https://inmanga.com/ver/manga/${encodeURIComponent(slug)}/${encodeURIComponent(chapterNumber)}/${encodeURIComponent(chapterUuid)}`
      : 'https://inmanga.com/';
    const entries = pageIds.map((id, index) => {
      const url = `https://cdn1.intomanga.com/i/m/${encodeURIComponent(mangaUuid)}/c/${encodeURIComponent(chapterUuid)}/o/${encodeURIComponent(id)}.jpg`;
      const fallback = legacyMangaName && legacyChapterNumber
        ? `https://pack-yak.intomanga.com/images/manga/${encodeURIComponent(legacyMangaName)}/chapter/${encodeURIComponent(legacyChapterNumber)}/page/${index + 1}/${encodeURIComponent(id)}`
        : '';
      if (!validateTarget(url) || (fallback && !validateTarget(fallback))) throw new Error('Invalid InManga image URL');
      return { url, fallback };
    });
    const initial = entries.slice(0, 40);
    const subrequestBudget = createImageSubrequestBudget(initial.length, PROXY_IMAGE_BATCH_MAX_SUBREQUESTS - 2);
    const byteBudget = createImageByteBudget();
    let stopped = false;
    let next = 0;
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      async start(controller) {
        const write = (metadata, bytes = new Uint8Array()) => {
          const data = encoder.encode(JSON.stringify(metadata));
          const prefix = new Uint8Array(4);
          new DataView(prefix.buffer).setUint32(0, data.length);
          controller.enqueue(prefix); controller.enqueue(data);
          if (bytes.length) controller.enqueue(bytes);
        };
        try {
          write({
            pages: entries.map((entry) => entry.url),
            pageFallbacks: entries.map((entry) => entry.fallback),
            imageReferer,
            label: `Capítulo ${chapterNumber || ''}`.trim(),
            mangaUrl: `https://inmanga.com/ver/manga/${encodeURIComponent(slug || '')}/${encodeURIComponent(mangaUuid)}`
          });
          await Promise.all(Array.from({ length: Math.min(PROXY_IMAGE_BATCH_CONCURRENCY, initial.length) }, async () => {
            while (!stopped && next < initial.length) {
              const index = next++;
              let result = await fetchImageBatchItem({ url: initial[index].url, referer: imageReferer }, request, subrequestBudget, byteBudget);
              if (result.status >= 400 && initial[index].fallback) {
                result = await fetchImageBatchItem({ url: initial[index].fallback, referer: imageReferer }, request, subrequestBudget, byteBudget);
              }
              if (stopped) return;
              const bytes = result.body ? new Uint8Array(await result.body.arrayBuffer()) : new Uint8Array();
              write({ index, length: bytes.length, status: result.status, contentType: result.contentType || '' }, bytes);
            }
          }));
          if (!stopped) controller.close();
        } catch (error) { if (!stopped) controller.error(error); }
      },
      cancel() { stopped = true; }
    });
    return new Response(body, { headers: { 'cache-control': 'no-store', 'content-type': 'application/vnd.cytlex.chapter-stream', 'x-cytlex-proxy': '1' } });
  } catch (error) {
    return errorResponse('InManga chapter unavailable', deadline.signal.aborted ? 504 : 422);
  } finally { clearTimeout(timeout); }
}

async function handleMangaLectChapter(request, target) {
  if (target.origin !== 'https://mangalect.org' || !target.pathname.startsWith('/lectura/')) {
    return errorResponse('Invalid MangaLect chapter', 400);
  }

  const deadline = new AbortController();
  const timeout = setTimeout(() => deadline.abort(), 12000);
  const signal = AbortSignal.any([request.signal, deadline.signal]);
  try {
    const first = await fetchTarget(target, 'GET', forwardedHeaders(request, target), undefined, signal, { retries: 0 });
    if (first.proxyError) return first.proxyError;
    if (!first.upstream.ok) return new Response(null, { status: first.upstream.status, headers: { 'x-cytlex-proxy': '1', 'x-cytlex-error-origin': 'source' } });
    const html = await new Response(limitResponseBody(first.upstream.body, PROXY_BATCH_RESPONSE_MAX_BYTES, () => {}, () => deadline.abort())).text();
    const pages = [...html.matchAll(/<img\b[^>]*>/gi)].flatMap(([tag]) => {
      const classes = /\bclass\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag)?.slice(1).find(Boolean) || '';
      if (!/(?:^|\s)manga-image(?:\s|$)/.test(classes) || /(?:^|\s)single-manga-page(?:\s|$)/.test(classes)) return [];
      const src = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag)?.slice(1).find(Boolean) || '';
      if (!src) return [];
      const image = validateTarget(new URL(src.replace(/&amp;/g, '&'), target).href);
      if (!image) throw new Error('Invalid MangaLect image URL');
      return [image.href];
    });
    const entries = [...new Set(pages)].map((url) => ({ url }));
    if (!entries.length || entries.length > 1000) return errorResponse('Invalid MangaLect page list', 422);

    const initial = entries.slice(0, 40);
    const subrequestBudget = createImageSubrequestBudget(initial.length, PROXY_IMAGE_BATCH_MAX_SUBREQUESTS - 1);
    const byteBudget = createImageByteBudget();
    let stopped = false;
    let next = 0;
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      async start(controller) {
        const write = (metadata, bytes = new Uint8Array()) => {
          const data = encoder.encode(JSON.stringify(metadata));
          const prefix = new Uint8Array(4);
          new DataView(prefix.buffer).setUint32(0, data.length);
          controller.enqueue(prefix); controller.enqueue(data);
          if (bytes.length) controller.enqueue(bytes);
        };
        try {
          write({ html, pages: entries.map((entry) => entry.url) });
          await Promise.all(Array.from({ length: Math.min(PROXY_IMAGE_BATCH_CONCURRENCY, initial.length) }, async () => {
            while (!stopped && next < initial.length) {
              const index = next++;
              const result = await fetchImageBatchItem({ url: initial[index].url, referer: target.href }, request, subrequestBudget, byteBudget);
              if (stopped) return;
              const bytes = result.body ? new Uint8Array(await result.body.arrayBuffer()) : new Uint8Array();
              write({ index, length: bytes.length, status: result.status, contentType: result.contentType || '' }, bytes);
            }
          }));
          if (!stopped) controller.close();
        } catch (error) { if (!stopped) controller.error(error); }
      },
      cancel() { stopped = true; }
    });
    return new Response(body, { headers: { 'cache-control': 'no-store', 'content-type': 'application/vnd.cytlex.chapter-stream', 'x-cytlex-proxy': '1' } });
  } catch (error) {
    return errorResponse('MangaLect chapter unavailable', deadline.signal.aborted ? 504 : 422);
  } finally { clearTimeout(timeout); }
}

async function handleMangaOniChapter(request, target) {
  if (target.origin !== 'https://manga-oni.com' || !target.pathname.startsWith('/lector/')) {
    return errorResponse('Invalid MangaOni chapter', 400);
  }

  const deadline = new AbortController();
  const timeout = setTimeout(() => deadline.abort(), 12000);
  const signal = AbortSignal.any([request.signal, deadline.signal]);
  try {
    const result = await fetchTarget(target, 'GET', forwardedHeaders(request, target), undefined, signal, { retries: 0 });
    if (result.proxyError) return result.proxyError;
    if (!result.upstream.ok) return new Response(null, { status: result.upstream.status, headers: { 'x-cytlex-proxy': '1', 'x-cytlex-error-origin': 'source' } });
    const html = await new Response(limitResponseBody(result.upstream.body, PROXY_BATCH_RESPONSE_MAX_BYTES, () => {}, () => deadline.abort())).text();
    let directory = '';
    let names = [];
    for (const [, script] of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)) {
      const encoded = script.match(/unicap\s*=\s*["']([^"']+)["']/)?.[1];
      if (!encoded) continue;
      try {
        const binary = atob(encoded);
        const decoded = new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
        const [dir, raw = '[]'] = decoded.split('||');
        directory = dir || '';
        names = JSON.parse(raw.replace(/&quot;/g, '"'));
      } catch {
        return errorResponse('Invalid MangaOni page list', 422);
      }
      break;
    }
    if (!directory || !Array.isArray(names) || !names.length || names.length > 1000) {
      return errorResponse('Invalid MangaOni page list', 422);
    }
    const pages = names.map((name) => {
      if (typeof name !== 'string' || !name || name.length > 512) throw new Error('Invalid MangaOni image name');
      const image = validateTarget(new URL(`${directory}${name}`, target).href);
      if (!image || image.hostname !== 'oni.ntr-files.online') throw new Error('Invalid MangaOni image URL');
      return image.href;
    });

    const mangaUrl = [...html.matchAll(/<a\b[^>]*>/gi)].map(([tag]) => {
      const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag)?.slice(1).find(Boolean) || '';
      const classes = /\bclass\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag)?.slice(1).find(Boolean) || '';
      return /(?:^|\s)ajp(?:\s|$)/.test(classes) ? href : '';
    }).find(Boolean);
    const mangaTarget = mangaUrl ? validateTarget(new URL(mangaUrl.replace(/&amp;/g, '&'), target).href) : null;
    if (!mangaTarget || mangaTarget.origin !== target.origin || !mangaTarget.pathname.startsWith('/manga/')) {
      return errorResponse('Invalid MangaOni manga URL', 422);
    }
    const mangaResult = await fetchTarget(mangaTarget, 'GET', forwardedHeaders(request, mangaTarget), undefined, signal, { retries: 0 });
    if (mangaResult.proxyError) return mangaResult.proxyError;
    if (!mangaResult.upstream.ok) return new Response(null, { status: mangaResult.upstream.status, headers: { 'x-cytlex-proxy': '1', 'x-cytlex-error-origin': 'source' } });
    const mangaHtml = await new Response(limitResponseBody(mangaResult.upstream.body, PROXY_BATCH_RESPONSE_MAX_BYTES, () => {}, () => deadline.abort())).text();
    const decodeText = (value) => value.replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ')
      .replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
      .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
      .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
      .replace(/\s+/g, ' ').trim();
    const titleMarkup = mangaHtml.match(/<h1\b[^>]*class\s*=\s*(?:"[^"]*\bpost-title\b[^"]*"|'[^']*\bpost-title\b[^']*')[^>]*>([\s\S]*?)<\/h1\s*>/i)?.[1] || '';
    const title = decodeText(titleMarkup);
    const options = [...mangaHtml.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)].flatMap(([, attributes, content]) => {
      const titleMarkup = content.match(/<(?:span|div|h[1-6])\b[^>]*class\s*=\s*(?:"[^"]*\bentry-title-h2\b[^"]*"|'[^']*\bentry-title-h2\b[^']*')[^>]*>([\s\S]*?)<\/(?:span|div|h[1-6])\s*>/i)?.[1] || '';
      const title = decodeText(titleMarkup);
      const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attributes)?.slice(1).find(Boolean) || '';
      if (!title || !href) return [];
      const chapter = validateTarget(new URL(href.replace(/&amp;/g, '&'), mangaTarget).href);
      if (!chapter || chapter.origin !== target.origin || !chapter.pathname.startsWith('/lector/')) return [];
      return [{ url: chapter.href, title }];
    }).slice(0, 1000);

    const initial = pages.slice(0, 40);
    const subrequestBudget = createImageSubrequestBudget(initial.length, PROXY_IMAGE_BATCH_MAX_SUBREQUESTS - 2);
    const byteBudget = createImageByteBudget();
    let stopped = false;
    let next = 0;
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      async start(controller) {
        const write = (metadata, bytes = new Uint8Array()) => {
          const data = encoder.encode(JSON.stringify(metadata));
          const prefix = new Uint8Array(4);
          new DataView(prefix.buffer).setUint32(0, data.length);
          controller.enqueue(prefix); controller.enqueue(data);
          if (bytes.length) controller.enqueue(bytes);
        };
        try {
          write({ title, pages, mangaUrl: mangaTarget.href, options });
          await Promise.all(Array.from({ length: Math.min(PROXY_IMAGE_BATCH_CONCURRENCY, initial.length) }, async () => {
            while (!stopped && next < initial.length) {
              const index = next++;
              const image = await fetchImageBatchItem({ url: initial[index], referer: target.href }, request, subrequestBudget, byteBudget);
              if (stopped) return;
              const bytes = image.body ? new Uint8Array(await image.body.arrayBuffer()) : new Uint8Array();
              write({ index, length: bytes.length, status: image.status, contentType: image.contentType || '' }, bytes);
            }
          }));
          if (!stopped) controller.close();
        } catch (error) { if (!stopped) controller.error(error); }
      },
      cancel() { stopped = true; }
    });
    return new Response(body, { headers: { 'cache-control': 'no-store', 'content-type': 'application/vnd.cytlex.chapter-stream', 'x-cytlex-proxy': '1' } });
  } catch (error) {
    return errorResponse('MangaOni chapter unavailable', deadline.signal.aborted ? 504 : 422);
  } finally { clearTimeout(timeout); }
}

export async function onRequest(context) {
  const { request } = context;
  const method = request.method.toUpperCase();
  if (!['GET', 'HEAD', 'POST'].includes(method)) {
    return errorResponse('Method not allowed', 405);
  }

  const batchMode = new URL(request.url).searchParams.get('batch');
  if (batchMode === 'images') {
    if (method !== 'POST') return errorResponse('Method not allowed', 405);
    return handleImageBatchRequest(request);
  }
  if (batchMode === 'mangadex-details') {
    if (method !== 'POST') return errorResponse('Method not allowed', 405);
    return handleMangaDexDetailBatch(request);
  }
  if (batchMode === '1') {
    if (method !== 'POST') return errorResponse('Method not allowed', 405);
    return handleBatchRequest(request);
  }
  if (batchMode === 'search') {
    if (method !== 'POST') return errorResponse('Method not allowed', 405);
    return handleCombinedSearchRequest(request);
  }

  const requestUrl = new URL(request.url);
  const target = validateTarget(requestUrl.searchParams.get('url'));
  if (!target) return errorResponse('Target is not allowed', 403, true);
  if (requestUrl.searchParams.get('catalog') === 'achymanga') {
    if (method !== 'GET') return errorResponse('Method not allowed', 405);
    return handleAchyCatalog(request, target);
  }
  if (requestUrl.searchParams.get('detail') === 'onf') {
    if (method !== 'GET') return errorResponse('Method not allowed', 405);
    return handleOnfMangaDetail(request, target);
  }
  if (requestUrl.searchParams.get('detail') === 'olympus') {
    if (method !== 'GET') return errorResponse('Method not allowed', 405);
    return handleOlympusDetail(request, target);
  }
  if (requestUrl.searchParams.get('detail') === 'mangadex-feed') {
    if (method !== 'GET') return errorResponse('Method not allowed', 405);
    return handleMangaDexFeed(request, target);
  }
  if (requestUrl.searchParams.get('detail') === 'mangadex-detail') {
    if (method !== 'GET') return errorResponse('Method not allowed', 405);
    return handleMangaDexFeed(request, target, true);
  }
  if (requestUrl.searchParams.get('chapter') === 'achymanga') {
    if (method !== 'GET') return errorResponse('Method not allowed', 405);
    return handleAchyChapter(request, target);
  }
  if (requestUrl.searchParams.get('chapter') === 'olympus') {
    if (method !== 'GET') return errorResponse('Method not allowed', 405);
    return handleOlympusChapter(request, target);
  }
  if (requestUrl.searchParams.get('chapter') === 'leercapitulo') {
    if (method !== 'GET') return errorResponse('Method not allowed', 405);
    return handleLeerCapituloChapter(request, target);
  }
  if (requestUrl.searchParams.get('chapter') === 'mangadex') {
    if (method !== 'GET') return errorResponse('Method not allowed', 405);
    return handleMangaDexChapter(request, target);
  }
  if (new URL(request.url).searchParams.get('chapter') === 'onf') {
    if (method !== 'GET') return errorResponse('Method not allowed', 405);
    return handleOnfChapter(request, target);
  }
  if (requestUrl.searchParams.get('chapter') === 'zonatmo') {
    if (method !== 'GET') return errorResponse('Method not allowed', 405);
    return handleZonaTmoChapter(request, target);
  }
  if (new URL(request.url).searchParams.get('chapter') === 'inmanga') {
    if (method !== 'GET') return errorResponse('Method not allowed', 405);
    return handleInmangaChapter(request, target);
  }
  if (new URL(request.url).searchParams.get('chapter') === 'mangalect') {
    if (method !== 'GET') return errorResponse('Method not allowed', 405);
    return handleMangaLectChapter(request, target);
  }
  if (new URL(request.url).searchParams.get('chapter') === 'mangaoni') {
    if (method !== 'GET') return errorResponse('Method not allowed', 405);
    return handleMangaOniChapter(request, target);
  }
  if (new URL(request.url).searchParams.get('chapter') === 'komiwa') {
    if (method !== 'GET') return errorResponse('Method not allowed', 405);
    return handleKomiwaChapter(request, target);
  }
  if (new URL(request.url).searchParams.get('catalog') === 'mangadex') {
    if (method !== 'GET') return errorResponse('Method not allowed', 405);
    return handleMangaDexCatalog(request, target);
  }

  let body;
  if (method === 'POST') {
    const contentLength = Number(request.headers.get('content-length')) || 0;
    if (contentLength > 1_000_000) return errorResponse('Request body is too large', 413);
    body = await request.arrayBuffer();
    if (body.byteLength > 1_000_000) return errorResponse('Request body is too large', 413);
  }

  const deadline = new AbortController();
  const timeout = setTimeout(() => deadline.abort(), 12000);
  const signal = AbortSignal.any([request.signal, deadline.signal]);
  let streaming = false;
  try {
    const { upstream, proxyError, finalUrl } = await fetchTarget(target, method, forwardedHeaders(request, target), body, signal);
    if (proxyError) return proxyError;

    let responseBody = null;
    if (method !== 'HEAD' && upstream.body) {
      const contentLength = Number(upstream.headers.get('content-length'));
      if (Number.isFinite(contentLength) && contentLength > PROXY_RESPONSE_MAX_BYTES) {
        await upstream.body.cancel();
        return errorResponse('The source response is too large', 502, false, 'response-too-large');
      }
      responseBody = limitResponseBody(
        upstream.body,
        PROXY_RESPONSE_MAX_BYTES,
        () => clearTimeout(timeout),
        () => deadline.abort()
      );
    }

    const headers = new Headers({
      'cache-control': 'no-store',
      'x-cytlex-proxy': '1'
    });
    if (finalUrl) headers.set('x-cytlex-final-url', finalUrl);
    if (!upstream.ok) headers.set('x-cytlex-error-origin', 'source');
    for (const name of ['content-type', 'last-modified', 'accept-ranges', 'retry-after']) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    if (target.hostname === 'onfmangas.com') {
      const cookies = responseOnfCookies(upstream);
      if (cookies.length) headers.set('x-cytlex-onf-cookie', cookies.join('; ').slice(0, 4096));
    }

    const response = new Response(responseBody, {
      status: upstream.status,
      headers
    });
    streaming = Boolean(responseBody);
    return response;
  } catch (error) {
    if (deadline.signal.aborted) return errorResponse('The source took too long to respond', 504, false, 'timeout');
    return errorResponse('The source could not be reached', 502, false, isDnsFailure(error) ? 'dns-not-found' : 'unreachable');
  } finally {
    if (!streaming) clearTimeout(timeout);
  }
}

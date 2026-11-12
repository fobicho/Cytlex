const ALLOWED_HOSTS = new Set([
  'api.anilist.co',
  'api.mangadex.org',
  'd33y4i2dmzjqjh.cloudfront.net',
  'fobicho.github.io',
  'images.mangalect.org',
  'imagesolymp.xyz',
  'imagenes.plotnofansub.com',
  'inmanga.com',
  'intomanga.com',
  'jumpg-assets.tokyo-cdn.com',
  'manga-oni.com',
  'mangalect.org',
  'mangadex.org',
  'olympusxyz.com',
  'onfmangas.com',
  'panel.olympusxyz.com',
  'pack-yak.intomanga.com',
  'plotnofansub.com',
  'uploads.mangadex.org',
  'www.plotnofansub.com',
  'www.leercapitulo.co',
  'zonatmo.org'
]);

const ALLOWED_SUFFIXES = ['t34798ndc.com', 'mangadex.network', 'ntr-files.online'];
const REDIRECT_LIMIT = 5;
const UPSTREAM_RETRIES = 2;
const ONF_COOKIE_PAIR = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+=[^;\r\n]{1,2048}$/;

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

function errorResponse(message, status, deniedTarget = false) {
  const headers = { 'cache-control': 'no-store', 'x-cytlex-proxy': '1' };
  if (deniedTarget) headers['x-cytlex-proxy-denied'] = '1';
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

function forwardedHeaders(request, target) {
  const headers = new Headers();
  const isMangaDexApi = target.hostname === 'api.mangadex.org';
  const isMangaDexImage = target.hostname === 'uploads.mangadex.org' || target.hostname.endsWith('.mangadex.network');
  const isPlotTwist = target.hostname === 'plotnofansub.com' || target.hostname.endsWith('.plotnofansub.com');
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
  if (target.hostname === 'imagesolymp.xyz' || target.hostname === 'olympusxyz.com' || target.hostname.endsWith('.olympusxyz.com')) {
    headers.set('referer', 'https://olympusxyz.com/');
  }
  if (target.hostname === 'ntr-files.online' || target.hostname.endsWith('.ntr-files.online')) {
    headers.set('referer', 'https://manga-oni.com/');
  }
  if (target.hostname === 'www.leercapitulo.co' || target.hostname === 'leercapitulo.co' || target.hostname.endsWith('.t34798ndc.com')) {
    headers.set('referer', 'https://www.leercapitulo.co/');
  }
  if (target.hostname === 'zonatmo.org' || target.hostname.endsWith('.zonatmo.org')) {
    headers.set('referer', 'https://zonatmo.org/');
  }

  if (target.hostname === 'intomanga.com' || target.hostname.endsWith('.intomanga.com')) {
    headers.set('referer', inmangaReferer(request));
  }
  if (target.hostname === 'onfmangas.com') {
    headers.set('user-agent', request.headers.get('user-agent') || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
    headers.set('accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8');
    headers.set('accept-language', 'es-419,es;q=0.9,en;q=0.8');
    headers.set('sec-fetch-dest', 'document');
    headers.set('sec-fetch-mode', 'navigate');
    headers.set('sec-fetch-site', 'same-origin');
    headers.set('upgrade-insecure-requests', '1');
    headers.set('referer', onfReferer(request));
  }
  if (isPlotTwist) {
    headers.set('referer', 'https://plotnofansub.com/');
    headers.set('accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8');
    if (!headers.has('accept-language')) headers.set('accept-language', 'es-419,es;q=0.9,en;q=0.8');
  }
  if (target.hostname === 'd33y4i2dmzjqjh.cloudfront.net') {
    headers.set('referer', onfReferer(request));
    headers.set('accept', 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8');
    headers.set('user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Cytlex/0.1');
  }
  return headers;
}

async function fetchTarget(initialTarget, method, headers, body) {
  let target = initialTarget;
  let currentMethod = method;
  let currentBody = body;
  let currentHeaders = headers;
  const retryableMethod = currentMethod === 'GET' || currentMethod === 'HEAD';

  for (let redirects = 0; redirects <= REDIRECT_LIMIT; redirects += 1) {
    let response;
    const retries = target.hostname === 'd33y4i2dmzjqjh.cloudfront.net' ? 4 : UPSTREAM_RETRIES;
    for (let attempt = 0; ; attempt += 1) {
      try {
        response = await fetch(target, {
          method: currentMethod,
          headers: currentHeaders,
          body: currentMethod === 'GET' || currentMethod === 'HEAD' ? undefined : currentBody,
          redirect: 'manual'
        });
      } catch (error) {
        if (!retryableMethod || attempt >= retries) throw error;
        await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
        continue;
      }
      if (!retryableMethod || ![502, 503, 504].includes(response.status) || attempt >= retries) break;
      try { await response.body?.cancel(); } catch {}
      await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
    }

    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get('location');
    if (!location) return response;
    if (redirects === REDIRECT_LIMIT) return new Response('Too many redirects', { status: 508 });

    const nextTarget = validateTarget(new URL(location, target).href);
    if (!nextTarget) return new Response('Redirect target is not allowed', { status: 403 });

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

export async function onRequest(context) {
  const { request } = context;
  const method = request.method.toUpperCase();
  if (!['GET', 'HEAD', 'POST'].includes(method)) {
    return errorResponse('Method not allowed', 405);
  }

  const target = validateTarget(new URL(request.url).searchParams.get('url'));
  if (!target) return errorResponse('Target is not allowed', 403, true);

  let body;
  if (method === 'POST') {
    const contentLength = Number(request.headers.get('content-length')) || 0;
    if (contentLength > 1_000_000) return errorResponse('Request body is too large', 413);
    body = await request.arrayBuffer();
    if (body.byteLength > 1_000_000) return errorResponse('Request body is too large', 413);
  }

  try {
    const upstream = await fetchTarget(target, method, forwardedHeaders(request, target), body);
    const headers = new Headers({
      'cache-control': 'no-store',
      'x-cytlex-proxy': '1'
    });
    for (const name of ['content-type', 'last-modified', 'accept-ranges']) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    if (target.hostname === 'onfmangas.com') {
      const cookies = responseOnfCookies(upstream);
      if (cookies.length) headers.set('x-cytlex-onf-cookie', cookies.join('; ').slice(0, 4096));
    }

    return new Response(method === 'HEAD' ? null : upstream.body, {
      status: upstream.status,
      headers
    });
  } catch {
    return errorResponse('The source could not be reached', 502);
  }
}

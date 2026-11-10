const ALLOWED_HOSTS = new Set([
  'api.anilist.co',
  'api.mangadex.org',
  'd33y4i2dmzjqjh.cloudfront.net',
  'fobicho.github.io',
  'images.mangalect.org',
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

  if (target.hostname === 'intomanga.com' || target.hostname.endsWith('.intomanga.com')) {
    headers.set('referer', inmangaReferer(request));
  }
  if (target.hostname === 'onfmangas.com') {
    headers.set('referer', onfReferer(request));
  }
  if (target.hostname === 'plotnofansub.com' || target.hostname.endsWith('.plotnofansub.com')) {
    headers.set('referer', 'https://plotnofansub.com/');
  }
  if (target.hostname === 'd33y4i2dmzjqjh.cloudfront.net') {
    headers.set('referer', onfReferer(request));
    headers.set('accept', 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8');
    headers.set('user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Cytlex/0.1');
  }
  if (/^storage\d*\.zonatmo\.org$/.test(target.hostname)) {
    headers.set('referer', 'https://zonatmo.org/');
  }

  return headers;
}

async function fetchTarget(initialTarget, method, headers, body) {
  let target = initialTarget;
  let currentMethod = method;
  let currentBody = body;

  for (let redirects = 0; redirects <= REDIRECT_LIMIT; redirects += 1) {
    const response = await fetch(target, {
      method: currentMethod,
      headers,
      body: currentMethod === 'GET' || currentMethod === 'HEAD' ? undefined : currentBody,
      redirect: 'manual'
    });

    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get('location');
    if (!location) return response;
    if (redirects === REDIRECT_LIMIT) return new Response('Too many redirects', { status: 508 });

    const nextTarget = validateTarget(new URL(location, target).href);
    if (!nextTarget) return new Response('Redirect target is not allowed', { status: 403 });

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

    return new Response(method === 'HEAD' ? null : upstream.body, {
      status: upstream.status,
      headers
    });
  } catch {
    return errorResponse('The source could not be reached', 502);
  }
}

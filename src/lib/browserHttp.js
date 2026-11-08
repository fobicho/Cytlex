const electronBridge = () => (typeof window !== 'undefined' ? window.cytlex : null);

function proxyUrl(targetUrl) {
  const configuredProxy = import.meta.env.VITE_CYTLEX_PROXY_URL;
  const endpoint = configuredProxy || '/api/proxy';
  const proxy = new URL(endpoint, window.location.href);
  proxy.searchParams.set('url', targetUrl);
  return proxy.href;
}

export function browserImageUrl(url, referer = '') {
  if (electronBridge()?.fetchImage) return url;
  try {
    const { hostname } = new URL(url);
    if (hostname === 'intomanga.com' || hostname.endsWith('.intomanga.com')) {
      const proxy = new URL(proxyUrl(url));
      if (referer) proxy.searchParams.set('referer', referer);
      return proxy.href;
    }
  } catch {}
  return url;
}

function proxyRequestOptions(url, options) {
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

  return { ...options, headers: proxyHeaders };
}

async function browserRequest(url, options = {}) {
  let response;
  const requestOptions = { credentials: 'omit', redirect: 'follow', ...options };

  try {
    const proxied = await fetch(proxyUrl(url), proxyRequestOptions(url, requestOptions));
    const proxyIsLive = proxied.headers.get('x-cytlex-proxy') === '1';
    response = proxyIsLive && proxied.status !== 403 ? proxied : await fetch(url, requestOptions);
  } catch {
    throw new Error('El navegador bloqueó la conexión a esta fuente. Para fuentes sin acceso CORS, publica Cytlex con su proxy web habilitado.');
  }
  if (!response.ok) throw new Error(`HTTP ${response.status} al pedir ${url}`);
  return response;
}

export async function httpGet(url, requestId) {
  const bridge = electronBridge();
  if (bridge?.httpGet) return bridge.httpGet(url, requestId);
  return (await browserRequest(url)).text();
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
    headers: { 'Content-Type': 'application/json', ...payload.headers },
    body: typeof payload.body === 'string' ? payload.body : JSON.stringify(payload.body)
  });
  const text = await response.text();
  return payload.responseType === 'text' ? text : JSON.parse(text);
}

export async function fetchImage(url) {
  const bridge = electronBridge();
  if (bridge?.fetchImage) return bridge.fetchImage(url);
  const response = await browserRequest(url);
  const blob = await response.blob();
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return { mime: blob.type || 'application/octet-stream', base64: btoa(binary) };
}

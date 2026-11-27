const AUTH_URL = 'https://comick.dev/api/auth/oauth2/authorize';
const TOKEN_URL = 'https://comick.dev/api/auth/oauth2/token';
const REVOKE_URL = 'https://comick.dev/api/auth/oauth2/revoke';
const API_BASE = 'https://api.comick.dev/integrations/v1';
const RESOURCE = API_BASE;
const ATTEMPT_KEY = 'cytlex:comick:oauth-attempt:v1';
const ERROR_KEY = 'cytlex:comick:oauth-error:v1';
const REQUESTED_SCOPE = 'library:read library:write offline_access';

let tokens = null;
let profileValue = null;
let profilePromise = null;
let refreshPromise = null;
const listeners = new Set();

function clientId() {
  return String(import.meta.env.VITE_COMICK_CLIENT_ID || '').trim();
}

function emit() {
  for (const listener of listeners) listener();
}

function browserStorage() {
  try {
    return window.sessionStorage;
  } catch {
    throw new Error('El navegador no permite iniciar la conexión segura con Comick.');
  }
}

function callbackUri() {
  const configured = String(import.meta.env.VITE_COMICK_REDIRECT_URI || '').trim();
  if (configured) return new URL(configured).toString();
  if (typeof window === 'undefined' || !/^https?:$/.test(window.location.protocol)) {
    throw new Error('Comick solo puede conectarse desde la web; configura VITE_COMICK_REDIRECT_URI si usas otra URL.');
  }
  return new URL('/', window.location.origin).toString();
}

function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function randomValue() {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

function safeReturnPath(value) {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && !value.includes('\\')
    ? value
    : '/ajustes?section=seguimiento';
}

function storeAuthError(message) {
  try {
    browserStorage().setItem(ERROR_KEY, String(message || 'No se pudo conectar con Comick.'));
  } catch {}
}

function parseError(body, status) {
  return body?.error_description || body?.message || body?.error?.message || body?.error || `Comick respondió HTTP ${status}.`;
}

async function readBody(response) {
  return response.json().catch(() => null);
}

function setTokens(body, fallbackScope = '') {
  if (!body?.access_token) throw new Error('Comick no devolvió un token de acceso.');
  tokens = {
    accessToken: body.access_token,
    refreshToken: body.refresh_token || null,
    expiresAt: Date.now() + Math.max(1, Number(body.expires_in) || 900) * 1000,
    scope: String(body.scope || fallbackScope || '')
  };
  profileValue = null;
  profilePromise = null;
  emit();
  return tokens;
}

async function refreshAccessToken() {
  if (refreshPromise) return refreshPromise;
  if (!tokens?.refreshToken) {
    tokens = null;
    profileValue = null;
    emit();
    throw new Error('La sesión de Comick caducó. Vuelve a conectar tu cuenta.');
  }
  const current = tokens;
  const id = clientId();
  if (!id) throw new Error('Falta configurar VITE_COMICK_CLIENT_ID.');

  refreshPromise = (async () => {
    try {
      const response = await fetch(TOKEN_URL, {
        method: 'POST',
        credentials: 'omit',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: id,
          refresh_token: current.refreshToken,
          resource: RESOURCE
        })
      });
      const body = await readBody(response);
      if (!response.ok) throw new Error(parseError(body, response.status));
      return setTokens(body, current.scope);
    } catch (error) {
      tokens = null;
      profileValue = null;
      profilePromise = null;
      emit();
      throw new Error(`No se pudo renovar la sesión de Comick. Vuelve a conectar tu cuenta. ${error?.message || ''}`.trim());
    }
  })().finally(() => { refreshPromise = null; });
  return refreshPromise;
}

async function accessToken() {
  if (!tokens?.accessToken) throw new Error('Conecta tu cuenta de Comick para continuar.');
  if (Date.now() + 30_000 < tokens.expiresAt) return tokens.accessToken;
  return (await refreshAccessToken()).accessToken;
}

async function sendApiRequest(path, accessTokenValue, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set('Authorization', `Bearer ${accessTokenValue}`);
  headers.set('Accept', 'application/json');
  const response = await fetch(path.startsWith('http') ? path : `${API_BASE}${path}`, {
    ...options,
    credentials: 'omit',
    cache: 'no-store',
    headers
  });
  return response;
}

export async function consumeComickOAuthCallback() {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  if (!params.has('code') && !params.has('error')) return false;

  const storage = browserStorage();
  let attempt = null;
  try {
    attempt = JSON.parse(storage.getItem(ATTEMPT_KEY) || 'null');
  } catch {}
  storage.removeItem(ATTEMPT_KEY);

  const returnPath = safeReturnPath(attempt?.returnPath);
  try {
    if (!attempt || Date.now() - Number(attempt.createdAt) > 10 * 60_000
      || params.getAll('state').length !== 1
      || params.get('state') !== attempt.state) {
      throw new Error('La autorización de Comick no es válida o ha caducado. Inténtalo de nuevo.');
    }
    if (params.has('error')) {
      throw new Error(params.get('error_description') || 'Comick rechazó la conexión.');
    }
    if (params.getAll('code').length !== 1 || !params.get('code')) {
      throw new Error('Comick no devolvió un código de autorización válido.');
    }

    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      credentials: 'omit',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId(),
        code: params.get('code'),
        redirect_uri: attempt.redirectUri,
        code_verifier: attempt.verifier,
        resource: RESOURCE
      })
    });
    const body = await readBody(response);
    if (!response.ok) throw new Error(parseError(body, response.status));
    const connected = setTokens(body);
    if (!connected.scope.split(/\s+/).includes('library:read')) {
      tokens = null;
      throw new Error('Comick no concedió el permiso para leer tu biblioteca.');
    }
    storage.removeItem(ERROR_KEY);
  } catch (error) {
    storeAuthError(error?.message || 'No se pudo conectar con Comick.');
    tokens = null;
    profileValue = null;
    profilePromise = null;
    emit();
  } finally {
    window.history.replaceState(window.history.state, '', returnPath);
  }
  return true;
}

export function consumeComickAuthError() {
  try {
    const storage = browserStorage();
    const error = storage.getItem(ERROR_KEY) || '';
    storage.removeItem(ERROR_KEY);
    return error;
  } catch {
    return '';
  }
}

export const comickSession = {
  subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  status() {
    const scopes = tokens?.scope.split(/\s+/).filter(Boolean) || [];
    return {
      connected: !!tokens?.accessToken,
      canWrite: scopes.includes('library:write'),
      expiresAt: tokens?.expiresAt || null,
      hasRefreshToken: !!tokens?.refreshToken
    };
  },

  async login(returnPath = '/ajustes?section=seguimiento') {
    const id = clientId();
    if (!id) throw new Error('Registra una app pública de Comick y configura VITE_COMICK_CLIENT_ID.');
    if (!window.isSecureContext) throw new Error('Comick requiere una conexión HTTPS o localhost para iniciar sesión.');
    if (!crypto?.subtle) throw new Error('Este navegador no permite generar una conexión PKCE segura.');

    const verifier = randomValue();
    const state = randomValue();
    const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
    const redirectUri = callbackUri();
    browserStorage().setItem(ATTEMPT_KEY, JSON.stringify({
      state,
      verifier,
      redirectUri,
      returnPath: safeReturnPath(returnPath),
      createdAt: Date.now()
    }));

    const authorize = new URL(AUTH_URL);
    authorize.search = new URLSearchParams({
      response_type: 'code',
      client_id: id,
      redirect_uri: redirectUri,
      scope: REQUESTED_SCOPE,
      resource: RESOURCE,
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256'
    }).toString();
    window.location.assign(authorize.toString());
    return { redirecting: true };
  },

  async request(path, options = {}) {
    let access = await accessToken();
    let response = await sendApiRequest(path, access, options);
    if (response.status === 401 && tokens?.refreshToken) {
      access = (await refreshAccessToken()).accessToken;
      response = await sendApiRequest(path, access, options);
    } else if (response.status === 401) {
      tokens = null;
      profileValue = null;
      profilePromise = null;
      emit();
    }
    const body = response.status === 204 ? null : await readBody(response);
    if (!response.ok) throw new Error(parseError(body, response.status));
    return body;
  },

  async profile() {
    if (profileValue) return profileValue;
    if (profilePromise) return profilePromise;
    profilePromise = this.request('/me')
      .then((value) => { profileValue = value; return value; })
      .catch((error) => { profilePromise = null; throw error; });
    return profilePromise;
  },

  async logout() {
    const old = tokens;
    tokens = null;
    profileValue = null;
    profilePromise = null;
    emit();
    const id = clientId();
    if (old && id) {
      const credentials = [
        ...(old.refreshToken ? [[old.refreshToken, 'refresh_token']] : []),
        ...(old.accessToken ? [[old.accessToken, 'access_token']] : [])
      ];
      await Promise.allSettled(credentials.map(([token, hint]) => fetch(REVOKE_URL, {
        method: 'POST',
        credentials: 'omit',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: id, token, token_type_hint: hint })
      })));
    }
    return this.status();
  }
};

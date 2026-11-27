const bridge = () => (typeof window !== 'undefined' ? window.cytlex : null);
const TOKEN_KEY = 'cytlex:anilist:session:v1';
const PENDING_KEY = 'cytlex:anilist:pending-auth:v1';
const RETURN_SECTION_KEY = 'cytlex:anilist:return-section';
const AUTH_ERROR_KEY = 'cytlex:anilist:auth-error';
const AUTH_URL = 'https://anilist.co/api/v2/oauth/authorize';
const CLIENT_ID = import.meta.env.VITE_ANILIST_CLIENT_ID || '52189';
const LOCAL_CLIENT_ID = import.meta.env.VITE_ANILIST_LOCAL_CLIENT_ID?.trim();
const DEFAULT_TOKEN_TTL_MS = 365 * 24 * 60 * 60 * 1000;

let viewerPromise = null;

function browserStorage() {
  if (typeof window === 'undefined') throw new Error('El navegador no está disponible.');
  try {
    return window.sessionStorage;
  } catch {
    throw new Error('El navegador no permite guardar la sesión temporal de AniList.');
  }
}

function readBrowserSession() {
  const storage = browserStorage();
  try {
    const value = JSON.parse(storage.getItem(TOKEN_KEY) || 'null');
    if (!value?.accessToken) return { session: null, expired: false };
    if (Date.now() >= value.expiresAt) {
      storage.removeItem(TOKEN_KEY);
      return { session: null, expired: true };
    }
    return { session: value, expired: false };
  } catch {
    storage.removeItem(TOKEN_KEY);
    return { session: null, expired: false };
  }
}

function callbackUri() {
  const configured = import.meta.env.VITE_ANILIST_REDIRECT_URI?.trim();
  if (configured) return new URL(configured).toString();
  if (typeof window === 'undefined' || !/^https?:$/.test(window.location.protocol)) {
    throw new Error('Configura VITE_ANILIST_REDIRECT_URI para conectar AniList en esta versión.');
  }
  return new URL('/', window.location.origin).toString();
}

function anilistClientId() {
  if (window.location.hostname === 'localhost') {
    if (!LOCAL_CLIENT_ID) {
      throw new Error('Configura VITE_ANILIST_LOCAL_CLIENT_ID con el ID de una app AniList registrada para http://localhost:5174/.');
    }
    return LOCAL_CLIENT_ID;
  }
  return CLIENT_ID;
}

function randomState() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function gqlErrorMessage(response, body) {
  const detail = body?.errors?.[0]?.message || body?.message;
  return `AniList respondió HTTP ${response.status}${detail ? `: ${detail}` : ''}`;
}

export function consumeBrowserOAuthCallback() {
  if (typeof window === 'undefined' || bridge()) return false;
  const fragment = window.location.hash.slice(1);
  const params = new URLSearchParams(fragment);
  if (!params.has('access_token') && !params.has('error')) return false;

  const storage = browserStorage();
  let pending = null;
  try {
    pending = JSON.parse(storage.getItem(PENDING_KEY) || 'null');
  } catch {
    pending = null;
  }
  storage.removeItem(PENDING_KEY);

  const returnPath = pending?.returnPath?.startsWith('/')
    ? pending.returnPath
    : pending?.returnHash?.startsWith('#/') ? pending.returnHash.slice(1) : '/ajustes';
  const stateMatches = !!pending?.state && params.get('state') === pending.state;
  let error = '';

  if (!stateMatches) {
    error = 'La respuesta de AniList no coincide con el inicio de sesión. Inténtalo de nuevo.';
  } else if (params.has('error')) {
    error = `AniList denegó el acceso: ${params.get('error_description') || params.get('error')}`;
  } else {
    const accessToken = params.get('access_token');
    if (!accessToken) {
      error = 'AniList no devolvió un token de acceso.';
    } else {
      const expiresIn = Number(params.get('expires_in'));
      const expiresAt = Date.now() + (Number.isFinite(expiresIn) && expiresIn > 0
        ? expiresIn * 1000
        : DEFAULT_TOKEN_TTL_MS);
      storage.setItem(TOKEN_KEY, JSON.stringify({ accessToken, expiresAt }));
    }
  }

  if (pending?.section) storage.setItem(RETURN_SECTION_KEY, pending.section);
  if (error) storage.setItem(AUTH_ERROR_KEY, error);
  else storage.removeItem(AUTH_ERROR_KEY);

  window.history.replaceState(
    window.history.state,
    '',
    returnPath
  );
  return true;
}

export function consumeBrowserAuthError() {
  if (typeof window === 'undefined' || bridge()) return '';
  const storage = browserStorage();
  const error = storage.getItem(AUTH_ERROR_KEY) || '';
  storage.removeItem(AUTH_ERROR_KEY);
  return error;
}

export function consumeBrowserSettingsSection() {
  if (typeof window === 'undefined' || bridge()) return '';
  const storage = browserStorage();
  const section = storage.getItem(RETURN_SECTION_KEY) || '';
  storage.removeItem(RETURN_SECTION_KEY);
  return section;
}

export const session = {
  available() {
    if (bridge()?.authStatus) return true;
    try {
      return typeof window !== 'undefined' && !!window.sessionStorage;
    } catch {
      return false;
    }
  },

  async status() {
    const b = bridge();
    if (b?.authStatus) return await b.authStatus();
    const { session: current, expired } = readBrowserSession();
    return current
      ? { connected: true, expiresAt: current.expiresAt }
      : { connected: false, ...(expired ? { expired: true } : {}) };
  },

  async login(section) {
    const b = bridge();
    if (b?.authLogin) {
      const redirectUri = import.meta.env.VITE_ANILIST_REDIRECT_URI?.trim()
        || (/^https?:$/.test(window.location.protocol) ? callbackUri() : undefined);
      viewerPromise = null;
      return await b.authLogin(redirectUri ? { redirectUri } : undefined);
    }

    const clientId = anilistClientId();
    const storage = browserStorage();
    const state = randomState();
    const redirectUri = callbackUri();
    storage.setItem(PENDING_KEY, JSON.stringify({
      state,
      returnPath: window.location.pathname === '/'
        ? '/ajustes'
        : `${window.location.pathname}${window.location.search}`,
      section
    }));
    viewerPromise = null;

    const auth = new URL(AUTH_URL);
    auth.searchParams.set('client_id', clientId);
    auth.searchParams.set('response_type', 'token');
    auth.searchParams.set('state', state);
    window.location.assign(auth.toString());
    return { redirecting: true };
  },

  async logout() {
    const b = bridge();
    viewerPromise = null;
    if (b?.authLogout) return await b.authLogout();
    browserStorage().removeItem(TOKEN_KEY);
    return { connected: false };
  },

  async gql(query, variables = {}) {
    const b = bridge();
    if (b?.authGql) {
      const res = await b.authGql({ query, variables });
      if (res?.errors?.length) throw new Error(res.errors[0].message || 'Error de AniList');
      return res?.data;
    }

    const { session: current } = readBrowserSession();
    if (!current) throw new Error('La sesión de AniList no está activa o ha caducado.');
    const response = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${current.accessToken}`
      },
      body: JSON.stringify({ query, variables })
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(gqlErrorMessage(response, body));
    if (body?.errors?.length) throw new Error(body.errors[0].message || 'Error de AniList');
    return body?.data;
  },

  async viewer() {
    if (viewerPromise) return viewerPromise;
    viewerPromise = this.gql(
      `query { Viewer { id name avatar { medium } } }`
    )
      .then((d) => d?.Viewer || null)
      .catch(() => null)
      .then((v) => (v ? this.gql(
        `query { Viewer { mediaListOptions { scoreFormat } } }`
      ).then((d) => ({ ...v, scoreFormat: d?.Viewer?.mediaListOptions?.scoreFormat || 'POINT_10' })).catch(() => v) : v));
    return viewerPromise;
  },

  clearViewer() {
    viewerPromise = null;
  }
};

const bridge = () => (typeof window !== 'undefined' ? window.cytlex : null);

const noBridge = () =>
  new Error('Sin puente Electron. Abre la app con "npm run dev:electron".');

let viewerPromise = null;

export const session = {
  available() {
    const b = bridge();
    return !!b?.authStatus;
  },

  async status() {
    const b = bridge();
    if (!b?.authStatus) return { connected: false };
    return await b.authStatus();
  },

  async login() {
    const b = bridge();
    if (!b?.authLogin) throw noBridge();
    viewerPromise = null;
    return await b.authLogin();
  },

  async logout() {
    const b = bridge();
    if (!b?.authLogout) throw noBridge();
    viewerPromise = null;
    return await b.authLogout();
  },

  async gql(query, variables = {}) {
    const b = bridge();
    if (!b?.authGql) throw noBridge();
    const res = await b.authGql({ query, variables });
    if (res?.errors?.length) throw new Error(res.errors[0].message || 'Error de AniList');
    return res?.data;
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

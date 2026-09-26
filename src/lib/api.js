import { extensions } from './extensions.js';

function bridge() {
  if (typeof window !== 'undefined' && window.cytlex) return window.cytlex;
  return null;
}

function noBridgeError() {
  return new Error(
    'Sin puente Electron (window.cytlex no existe). Abre la app con "npm run dev:electron" en lugar de solo "npm run dev".'
  );
}

const isBuiltin = (id) => !id || id === 'leercapitulo';

export const api = {
  isBridgeOk() { return !!bridge(); },

  async home() {
    const b = bridge();
    if (!b) throw noBridgeError();
    return b.home();
  },

  async catalog(args, sourceId) {
    if (!isBuiltin(sourceId)) return (await extensions.source(sourceId)).catalog(args);
    const b = bridge();
    if (!b) throw noBridgeError();
    return b.catalog(args);
  },

  async detail(url, sourceId) {
    if (!isBuiltin(sourceId)) return (await extensions.source(sourceId)).detail(url);
    const b = bridge();
    if (!b) throw noBridgeError();
    return b.detail(url);
  },

  async chapter(url, sourceId) {
    if (!isBuiltin(sourceId)) return (await extensions.source(sourceId)).chapter(url);
    const b = bridge();
    if (!b) throw noBridgeError();
    return b.chapter(url);
  }
};

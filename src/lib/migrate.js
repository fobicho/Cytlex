const KEYS = ['favs', 'cats:v1', 'settings:v1', 'extensions:v1', 'theme'];

export function migrateLegacyStorage() {
  try {
    for (const k of KEYS) {
      const legacy = localStorage.getItem('fobi:' + k);
      if (legacy !== null && localStorage.getItem('cytlex:' + k) === null) {
        localStorage.setItem('cytlex:' + k, legacy);
      }
    }
  } catch {
  }
}


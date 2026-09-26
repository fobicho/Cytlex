// Migra los datos guardados con el nombre antiguo (fobi) al nuevo (cytlex),
// para no perder ajustes, favoritos, categorías ni extensiones.
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
    /* almacenamiento no disponible */
  }
}

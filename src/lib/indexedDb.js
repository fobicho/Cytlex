export function createDatabaseOpener(name, version, upgrade) {
  let opening = null;

  const open = () => {
    if (!globalThis.indexedDB) return Promise.resolve(null);
    if (opening) return opening;
    let request;
    try { request = indexedDB.open(name, version); } catch { return Promise.resolve(null); }
    let finished = false;
    let attempt;
    attempt = new Promise((resolve) => {
      const unavailable = () => {
        if (finished) return;
        finished = true;
        if (opening === attempt) opening = null;
        resolve(null);
      };
      request.onupgradeneeded = upgrade;
      request.onblocked = unavailable;
      request.onerror = unavailable;
      request.onsuccess = () => {
        const db = request.result;
        if (finished || opening !== attempt) { db.close(); return; }
        finished = true;
        db.onversionchange = () => {
          db.close();
          if (opening === attempt) opening = null;
        };
        resolve(db);
      };
    });
    opening = attempt;
    return attempt;
  };
  open.reset = () => { opening = null; };
  return open;
}

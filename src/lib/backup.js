const FORMAT = 'cytlex-backup';
const VERSION = 1;
const KEY_PREFIX = 'cytlex:';
const EXTENSIONS_KEY = 'cytlex:extensions:v1';

export function createBackup() {
  const data = {};
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (key?.startsWith(KEY_PREFIX) && key !== EXTENSIONS_KEY) data[key] = localStorage.getItem(key);
  }
  return {
    format: FORMAT,
    version: VERSION,
    createdAt: new Date().toISOString(),
    data
  };
}

export async function readBackupFile(file) {
  const bytes = await file.arrayBuffer();
  const signature = new Uint8Array(bytes, 0, Math.min(2, bytes.byteLength));
  if (signature[0] === 0x1f && signature[1] === 0x8b) {
    if (typeof DecompressionStream !== 'function') {
      throw new Error('Este entorno no puede descomprimir respaldos gzip.');
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).text();
  }
  return new TextDecoder().decode(bytes);
}

export async function compressBackup(content) {
  if (typeof CompressionStream !== 'function') {
    throw new Error('Este entorno no puede comprimir respaldos gzip.');
  }
  const stream = new Blob([content]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export function parseBackup(content) {
  const backup = JSON.parse(content);
  if (!backup || backup.format !== FORMAT || backup.version !== VERSION) {
    throw new Error('El archivo no es un respaldo compatible de Cytlex.');
  }
  if (!backup.data || typeof backup.data !== 'object' || Array.isArray(backup.data)) {
    throw new Error('El respaldo no contiene datos válidos.');
  }
  const entries = Object.entries(backup.data);
  if (!entries.length || entries.some(([key, value]) => !key.startsWith(KEY_PREFIX) || typeof value !== 'string')) {
    throw new Error('El respaldo contiene datos no válidos.');
  }
  return backup;
}

export function restoreBackup(data) {
  const current = {};
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (key?.startsWith(KEY_PREFIX)) current[key] = localStorage.getItem(key);
  }

  try {
    Object.keys(current).forEach((key) => {
      if (key !== EXTENSIONS_KEY) localStorage.removeItem(key);
    });
    Object.entries(data).forEach(([key, value]) => {
      if (key !== EXTENSIONS_KEY) localStorage.setItem(key, value);
    });
  } catch (error) {
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const key = localStorage.key(i);
      if (key?.startsWith(KEY_PREFIX) && key !== EXTENSIONS_KEY) localStorage.removeItem(key);
    }
    Object.entries(current).forEach(([key, value]) => localStorage.setItem(key, value));
    throw error;
  }
}

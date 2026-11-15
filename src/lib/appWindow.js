export const appWindow = {
  isAvailable() {
    return typeof window !== 'undefined' && !!window.cytlex?.toggleFullscreen;
  },
  async toggleFullscreen() {
    if (!this.isAvailable()) return false;
    return window.cytlex.toggleFullscreen();
  },
  async isFullscreen() {
    if (!this.isAvailable()) return false;
    return window.cytlex.isFullscreen();
  },
  async minimize() {
    if (this.isAvailable()) window.cytlex.minimize();
  },
  async toggleMaximize() {
    if (!this.isAvailable()) return false;
    return window.cytlex.toggleMaximize();
  },
  async isMaximized() {
    if (!this.isAvailable()) return false;
    return window.cytlex.isMaximized();
  },
  async close() {
    if (this.isAvailable()) window.cytlex.close();
  },
  onMaximizedChange(cb) {
    if (typeof window === 'undefined' || !window.cytlex?.onMaximizedChange) return () => {};
    return window.cytlex.onMaximizedChange(cb);
  },
  canDownload() {
    return typeof window !== 'undefined';
  },
  async downloadImage(url, suggested, getBlob) {
    const name = String(suggested || 'panel').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim() || 'panel';
    try {
      const extensionHint = new URL(url, window.location.href).pathname.match(/\.(jpe?g|png|webp|gif|avif|bmp|svg)$/i)?.[1]?.toLowerCase();
      let handle;
      if (!window.cytlex?.downloadImage && typeof window.showSaveFilePicker === 'function') {
        try {
          handle = await window.showSaveFilePicker({ suggestedName: extensionHint ? `${name}.${extensionHint}` : name });
        } catch (error) {
          if (error.name !== 'SecurityError' && error.name !== 'NotAllowedError') throw error;
        }
      }
      const blob = await getBlob();
      if (!blob?.size) return { ok: false };
      const extension = ({
        'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
        'image/gif': 'gif', 'image/avif': 'avif', 'image/bmp': 'bmp', 'image/svg+xml': 'svg'
      })[blob.type] || extensionHint || 'img';
      const filename = `${name}.${extension}`;
      if (window.cytlex?.downloadImage) {
        return await window.cytlex.downloadImage({ bytes: new Uint8Array(await blob.arrayBuffer()), filename, extension });
      }
      if (handle) {
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
      } else {
        const objectUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = objectUrl;
        link.download = filename;
        link.click();
        setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      }
      return { ok: true };
    } catch (error) {
      return error.name === 'AbortError' ? { ok: false, canceled: true } : { ok: false, error: error.message };
    }
  },
};

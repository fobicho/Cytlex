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
    return typeof window !== 'undefined' && !!window.cytlex?.downloadImage;
  },
  async downloadImage(url, suggested) {
    if (!this.canDownload()) return { ok: false, error: 'Descarga no disponible.' };
    return window.cytlex.downloadImage({ url, suggested });
  }
};

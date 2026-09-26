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
  }
};

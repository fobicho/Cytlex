const { contextBridge, ipcRenderer } = require('electron');

if (process.isMainFrame) contextBridge.exposeInMainWorld('cytlex', {
  httpGet: (url, requestId, options) => ipcRenderer.invoke('http:get', url, requestId, options),
  httpHead: (url) => ipcRenderer.invoke('http:head', url),
  httpPost: (payload, requestId) => ipcRenderer.invoke('http:post', payload, requestId),
  cancelHttpRequest: (requestId) => ipcRenderer.send('http:cancel', requestId),
  releaseHttpRequest: (requestId) => ipcRenderer.send('http:release', requestId),
  authLogin: (creds) => ipcRenderer.invoke('auth:login', creds),
  authLogout: () => ipcRenderer.invoke('auth:logout'),
  authStatus: () => ipcRenderer.invoke('auth:status'),
  authGql: (payload) => ipcRenderer.invoke('auth:gql', payload),
  fetchImage: (url, referer, onfCookie) => ipcRenderer.invoke('image:fetch', url, referer, onfCookie),
  downloadImage: (payload) => ipcRenderer.invoke('image:download', payload),
  saveBackup: (payload) => ipcRenderer.invoke('backup:save', payload),
  openBackup: () => ipcRenderer.invoke('backup:open'),
  openMihonBackup: () => ipcRenderer.invoke('backup:open-mihon'),
  toggleFullscreen: () => ipcRenderer.invoke('window:toggle-fullscreen'),
  saveTheme: (payload) => ipcRenderer.invoke('theme:save', payload),
  isFullscreen: () => ipcRenderer.invoke('window:is-fullscreen'),
  minimize: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),
  isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  close: () => ipcRenderer.invoke('window:close'),
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
  onMaximizedChange: (cb) => {
    const handler = (_e, value) => cb(value);
    ipcRenderer.on('window:maximized-changed', handler);
    return () => ipcRenderer.removeListener('window:maximized-changed', handler);
  },
  ping: () => 'cytlex-bridge-ok'
});

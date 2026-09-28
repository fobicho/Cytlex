const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cytlex', {
  home: () => ipcRenderer.invoke('manga:home'),
  catalog: (args) => ipcRenderer.invoke('manga:catalog', args),
  detail: (url) => ipcRenderer.invoke('manga:detail', url),
  chapter: (url) => ipcRenderer.invoke('manga:chapter', url),
  httpGet: (url) => ipcRenderer.invoke('http:get', url),
  httpPost: (payload) => ipcRenderer.invoke('http:post', payload),
  authLogin: (creds) => ipcRenderer.invoke('auth:login', creds),
  authLogout: () => ipcRenderer.invoke('auth:logout'),
  authStatus: () => ipcRenderer.invoke('auth:status'),
  authGql: (payload) => ipcRenderer.invoke('auth:gql', payload),
  fetchImage: (url) => ipcRenderer.invoke('image:fetch', url),
  downloadImage: (payload) => ipcRenderer.invoke('image:download', payload),
  toggleFullscreen: () => ipcRenderer.invoke('window:toggle-fullscreen'),
  isFullscreen: () => ipcRenderer.invoke('window:is-fullscreen'),
  minimize: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),
  isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  close: () => ipcRenderer.invoke('window:close'),
  onMaximizedChange: (cb) => {
    const handler = (_e, value) => cb(value);
    ipcRenderer.on('window:maximized-changed', handler);
    return () => ipcRenderer.removeListener('window:maximized-changed', handler);
  },
  ping: () => 'cytlex-bridge-ok'
});

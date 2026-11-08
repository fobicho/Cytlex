const { contextBridge, ipcRenderer } = require('electron');

if (process.isMainFrame) contextBridge.exposeInMainWorld('cytlex', {
  httpGet: (url, requestId) => ipcRenderer.invoke('http:get', url, requestId),
  httpHead: (url) => ipcRenderer.invoke('http:head', url),
  notify: (payload) => ipcRenderer.invoke('notify:show', payload),
  notifySupported: () => ipcRenderer.invoke('notify:supported'),
  setBackgroundCheck: (on, hours) => ipcRenderer.invoke('notify:background', on, hours),
  confirmTask: () => ipcRenderer.invoke('notify:confirm'),
  onNotifyClick: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on('notify:click', handler);
    return () => ipcRenderer.removeListener('notify:click', handler);
  },
  isBackground: () => ipcRenderer.invoke('app:background'),
  exitBackground: () => ipcRenderer.invoke('app:exit'),
  httpPost: (payload, requestId) => ipcRenderer.invoke('http:post', payload, requestId),
  cancelHttpRequest: (requestId) => ipcRenderer.send('http:cancel', requestId),
  releaseHttpRequest: (requestId) => ipcRenderer.send('http:release', requestId),
  authLogin: (creds) => ipcRenderer.invoke('auth:login', creds),
  authLogout: () => ipcRenderer.invoke('auth:logout'),
  authStatus: () => ipcRenderer.invoke('auth:status'),
  authGql: (payload) => ipcRenderer.invoke('auth:gql', payload),
  fetchImage: (url) => ipcRenderer.invoke('image:fetch', url),
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

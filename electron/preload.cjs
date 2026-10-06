const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cytlex', {
  home: () => ipcRenderer.invoke('manga:home'),
  catalog: (args) => ipcRenderer.invoke('manga:catalog', args),
  detail: (url) => ipcRenderer.invoke('manga:detail', url),
  chapter: (url) => ipcRenderer.invoke('manga:chapter', url),
  httpGet: (url) => ipcRenderer.invoke('http:get', url),
  httpHead: (url) => ipcRenderer.invoke('http:head', url),
  notify: (payload) => ipcRenderer.invoke('notify:show', payload),
  notifySupported: () => ipcRenderer.invoke('notify:supported'),
  setBackgroundCheck: (on, hours) => ipcRenderer.invoke('notify:background', on, hours),
  confirmTask: () => ipcRenderer.invoke('notify:confirm'),
  testNotify: () => ipcRenderer.invoke('notify:test'),
  onRunNotifyCheck: (cb) => {
    const handler = () => cb();
    ipcRenderer.on('notify:run-now', handler);
    return () => ipcRenderer.removeListener('notify:run-now', handler);
  },
  onNotifyClick: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on('notify:click', handler);
    return () => ipcRenderer.removeListener('notify:click', handler);
  },
  isBackground: () => ipcRenderer.invoke('app:background'),
  exitBackground: () => ipcRenderer.invoke('app:exit'),
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

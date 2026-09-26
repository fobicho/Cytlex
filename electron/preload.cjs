const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cytlex', {
  home: () => ipcRenderer.invoke('manga:home'),
  catalog: (args) => ipcRenderer.invoke('manga:catalog', args),
  detail: (url) => ipcRenderer.invoke('manga:detail', url),
  chapter: (url) => ipcRenderer.invoke('manga:chapter', url),
  httpGet: (url) => ipcRenderer.invoke('http:get', url),
  toggleFullscreen: () => ipcRenderer.invoke('window:toggle-fullscreen'),
  isFullscreen: () => ipcRenderer.invoke('window:is-fullscreen'),
  ping: () => 'cytlex-bridge-ok'
});

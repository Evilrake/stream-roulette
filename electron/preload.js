const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('rouletteApp', {
  openOverlayWindow: (kind) => ipcRenderer.invoke('open-overlay-window', kind || 'roulette'),
  getAppInfo: () => ipcRenderer.invoke('get-app-info'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  openDaOAuth: (url) => ipcRenderer.invoke('open-da-oauth', url)
});

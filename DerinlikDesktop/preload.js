// The only bridge between the game page and the desktop shell: the page can ask to quit or toggle fullscreen, nothing else.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('derinlikDesktop', {
  quit: () => ipcRenderer.send('derinlik:quit'),
  toggleFullscreen: () => ipcRenderer.send('derinlik:fullscreen'),
});

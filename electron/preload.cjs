const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  isElectron: true,
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  isMaximized: () => ipcRenderer.invoke('window-is-maximized'),
  setAlwaysOnTop: (flag) => ipcRenderer.send('window-always-on-top', flag),
  showItemInFolder: (filePath) => ipcRenderer.send('show-item-in-folder', filePath),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  downloadAndInstallUpdate: (url) => ipcRenderer.invoke('download-and-install-update', url),
  getSystemTheme: () => ipcRenderer.invoke('get-system-theme'),
  onSystemThemeChanged: (callback) => {
    const handler = (event, theme) => callback(theme);
    ipcRenderer.on('system-theme-changed', handler);
    return () => ipcRenderer.removeListener('system-theme-changed', handler);
  },
});

const { app, BrowserWindow, shell, ipcMain, nativeImage, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;
const stateFilePath = path.join(app.getPath('userData'), 'classitunes-window-state.json');

function loadWindowState() {
  try {
    if (fs.existsSync(stateFilePath)) {
      const data = JSON.parse(fs.readFileSync(stateFilePath, 'utf8'));
      return data;
    }
  } catch (e) {}
  return { width: 1200, height: 800 };
}

function saveWindowState(win) {
  if (!win || win.isDestroyed()) return;
  try {
    const isMaximized = win.isMaximized();
    let bounds;
    if (isMaximized && typeof win.getNormalBounds === 'function') {
      bounds = win.getNormalBounds();
    } else {
      bounds = win.getBounds();
    }
    const state = {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      isMaximized,
    };
    fs.writeFileSync(stateFilePath, JSON.stringify(state));
  } catch (e) {}
}

function createWindow() {
  const savedState = loadWindowState();

  mainWindow = new BrowserWindow({
    title: 'ClassiTunes',
    icon: path.join(__dirname, process.platform === 'win32' ? '../public/icon.ico' : '../public/icon.png'),
    x: savedState.x,
    y: savedState.y,
    width: savedState.width || 1200,
    height: savedState.height || 800,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hidden',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
    },
  });

  if (savedState.isMaximized) {
    mainWindow.maximize();
  }

  // Handle window bounds saving
  const handleSave = () => saveWindowState(mainWindow);
  mainWindow.on('resize', handleSave);
  mainWindow.on('move', handleSave);
  mainWindow.on('close', handleSave);

  // Window control IPC handlers
  ipcMain.on('window-minimize', () => {
    if (mainWindow) mainWindow.minimize();
  });

  ipcMain.on('window-maximize', () => {
    if (mainWindow) {
      if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
      } else {
        mainWindow.maximize();
      }
    }
  });

  ipcMain.on('window-close', () => {
    if (mainWindow) mainWindow.close();
  });

  ipcMain.on('window-always-on-top', (event, flag) => {
    if (mainWindow) mainWindow.setAlwaysOnTop(!!flag);
  });

  ipcMain.on('show-item-in-folder', (event, filePath) => {
    if (filePath && fs.existsSync(filePath)) {
      shell.showItemInFolder(filePath);
    }
  });

  ipcMain.handle('window-is-maximized', () => {
    return mainWindow ? mainWindow.isMaximized() : false;
  });

  ipcMain.handle('check-for-updates', async () => {
    return { updateAvailable: false };
  });

  ipcMain.handle('get-system-theme', () => {
    return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
  });

  nativeTheme.on('updated', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      const theme = nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
      mainWindow.webContents.send('system-theme-changed', theme);
    }
  });

  ipcMain.handle('download-and-install-update', async (event, url) => {
    if (url && (url.startsWith('http:') || url.startsWith('https:'))) {
      shell.openExternal(url);
      return true;
    }
    return false;
  });


  const devServerUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:3000';
  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

  if (isDev) {
    const loadDevServer = () => {
      mainWindow.loadURL(devServerUrl).catch((err) => {
        console.log('Dev server not ready yet, retrying in 1s...', err?.message || '');
        setTimeout(loadDevServer, 1000);
      });
    };
    loadDevServer();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

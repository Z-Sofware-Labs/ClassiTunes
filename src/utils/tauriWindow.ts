// Safe Window Controls & Position Persistence Helper for Tauri v1/v2, Electron & Web

export async function tauriMinimize(): Promise<boolean> {
  if (typeof window !== 'undefined' && ((window as any).__TAURI__ || (window as any).__TAURI_INTERNALS__ || (window as any).__TAURI_METADATA__)) {
    try {
      if ((window as any).__TAURI__?.window?.getCurrentWindow) {
        await (window as any).__TAURI__.window.getCurrentWindow().minimize();
        return true;
      }
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().minimize();
      return true;
    } catch (e) {
      console.warn('Tauri minimize notice:', e);
    }
  }

  if (typeof window !== 'undefined' && (window as any).electronAPI?.minimize) {
    try {
      (window as any).electronAPI.minimize();
      return true;
    } catch (e) {}
  }

  return false;
}

export async function tauriMaximize(): Promise<boolean> {
  if (typeof window !== 'undefined' && ((window as any).__TAURI__ || (window as any).__TAURI_INTERNALS__ || (window as any).__TAURI_METADATA__)) {
    try {
      let winObj: any = null;
      if ((window as any).__TAURI__?.window?.getCurrentWindow) {
        winObj = (window as any).__TAURI__.window.getCurrentWindow();
      } else {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        winObj = getCurrentWindow();
      }

      if (winObj) {
        const isMax = typeof winObj.isMaximized === 'function' ? await winObj.isMaximized() : false;
        if (isMax) {
          await winObj.unmaximize();
        } else {
          await winObj.maximize();
        }
        return true;
      }
    } catch (e) {
      console.warn('Tauri maximize notice:', e);
    }
  }

  if (typeof window !== 'undefined' && (window as any).electronAPI?.maximize) {
    try {
      (window as any).electronAPI.maximize();
      return true;
    } catch (e) {}
  }

  return false;
}

export async function tauriClose(): Promise<boolean> {
  if (typeof window !== 'undefined' && ((window as any).__TAURI__ || (window as any).__TAURI_INTERNALS__ || (window as any).__TAURI_METADATA__)) {
    try {
      if ((window as any).__TAURI__?.window?.getCurrentWindow) {
        await (window as any).__TAURI__.window.getCurrentWindow().close();
        return true;
      }
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().close();
      return true;
    } catch (e) {
      console.warn('Tauri close notice:', e);
    }
  }

  if (typeof window !== 'undefined' && (window as any).electronAPI?.close) {
    try {
      (window as any).electronAPI.close();
      return true;
    } catch (e) {}
  }

  return false;
}

export async function tauriSetAlwaysOnTop(onTop: boolean): Promise<boolean> {
  if (typeof window !== 'undefined' && ((window as any).__TAURI__ || (window as any).__TAURI_INTERNALS__ || (window as any).__TAURI_METADATA__)) {
    try {
      if ((window as any).__TAURI__?.window?.getCurrentWindow) {
        await (window as any).__TAURI__.window.getCurrentWindow().setAlwaysOnTop(onTop);
        return true;
      }
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().setAlwaysOnTop(onTop);
      return true;
    } catch (e) {
      console.warn('Tauri alwaysOnTop notice:', e);
    }
  }

  if (typeof window !== 'undefined' && (window as any).electronAPI?.setAlwaysOnTop) {
    try {
      (window as any).electronAPI.setAlwaysOnTop(onTop);
      return true;
    } catch (e) {}
  }

  return false;
}

// Restore & save window position and size for Tauri runtime
export async function setupWindowStatePersistence(): Promise<void> {
  if (typeof window === 'undefined') return;

  if ((window as any).__TAURI__ || (window as any).__TAURI_INTERNALS__ || (window as any).__TAURI_METADATA__) {
    try {
      let winObj: any = null;
      if ((window as any).__TAURI__?.window?.getCurrentWindow) {
        winObj = (window as any).__TAURI__.window.getCurrentWindow();
      } else {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        winObj = getCurrentWindow();
      }

      if (winObj) {
        // Restore saved bounds
        const saved = localStorage.getItem('classitunes_window_bounds');
        if (saved) {
          try {
            const { x, y, width, height, isMaximized } = JSON.parse(saved);
            if (width && height && typeof winObj.setSize === 'function') {
              const dpi = await import('@tauri-apps/api/dpi');
              await winObj.setSize(new dpi.PhysicalSize(width, height));
            }
            if (x !== undefined && y !== undefined && typeof winObj.setPosition === 'function') {
              const dpi = await import('@tauri-apps/api/dpi');
              await winObj.setPosition(new dpi.PhysicalPosition(x, y));
            }
            if (isMaximized && typeof winObj.maximize === 'function') {
              await winObj.maximize();
            }
          } catch (err) {}
        }

        // Debounced save listener
        let timer: any = null;
        const saveState = async () => {
          clearTimeout(timer);
          timer = setTimeout(async () => {
            try {
              const isMax = typeof winObj.isMaximized === 'function' ? await winObj.isMaximized() : false;
              const size = typeof winObj.innerSize === 'function' ? await winObj.innerSize() : null;
              const pos = typeof winObj.innerPosition === 'function' ? await winObj.innerPosition() : null;
              if (size && pos) {
                localStorage.setItem(
                  'classitunes_window_bounds',
                  JSON.stringify({
                    x: pos.x,
                    y: pos.y,
                    width: size.width,
                    height: size.height,
                    isMaximized: isMax,
                  })
                );
              }
            } catch (e) {}
          }, 300);
        };

        if (typeof winObj.onResized === 'function') winObj.onResized(saveState);
        if (typeof winObj.onMoved === 'function') winObj.onMoved(saveState);
      }
    } catch (e) {
      console.warn('Tauri window persistence notice:', e);
    }
  }
}

export async function openFileLocation(filePath: string): Promise<boolean> {
  if (!filePath) return false;

  // 1. Try Electron if running in Electron
  if (typeof window !== 'undefined' && (window as any).electronAPI?.showItemInFolder) {
    try {
      (window as any).electronAPI.showItemInFolder(filePath);
      return true;
    } catch (e) {
      console.warn('Electron showItemInFolder failed:', e);
    }
  }

  // 2. Try Tauri v2 if running in Tauri
  if (typeof window !== 'undefined' && ((window as any).__TAURI__ || (window as any).__TAURI_INTERNALS__ || (window as any).__TAURI_METADATA__)) {
    try {
      const { revealItemInDir } = await import('@tauri-apps/plugin-opener');
      await revealItemInDir(filePath);
      return true;
    } catch (e) {
      console.error('Tauri revealItemInDir failed:', e);
    }
  }

  return false;
}

let webLogs: string[] = [
  `[${new Date().toISOString()}] ClassiTunes diagnostic logs initialized.`,
  `[${new Date().toISOString()}] Running in browser preview / demo mode.`
];

export function getWebLogs(): string[] {
  return webLogs;
}

try {
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem('classitunes_logs');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) {
        webLogs = parsed;
      }
    }
  }
} catch (e) {}

let isDirEnsured = false;

export async function logToFile(message: string): Promise<void> {
  if (typeof window === 'undefined') return;
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] ${message}`;
  
  // Always log to console as well so running from terminal in Linux/macOS/Windows always shows logs
  console.log(`[ClassiTunes] ${logLine}`);

  if (!isTauri()) {
    webLogs.push(logLine);
    if (webLogs.length > 2000) webLogs.shift();
    try {
      localStorage.setItem('classitunes_logs', JSON.stringify(webLogs));
    } catch (e) {}
    return;
  }

  try {
    const { writeTextFile, mkdir, BaseDirectory } = await import('@tauri-apps/plugin-fs');
    if (!isDirEnsured) {
      try {
        await mkdir('', { baseDir: BaseDirectory.AppLocalData, recursive: true });
        isDirEnsured = true;
      } catch (mkdirErr) {
        // May already exist or will fail on write
      }
    }

    const logMessage = `${logLine}\n`;

    await writeTextFile('app_log.txt', logMessage, {
      baseDir: BaseDirectory.AppLocalData,
      append: true,
    });
  } catch (err) {
    console.error("Failed to write log to file:", err);
  }
}

export async function openLogDirectory(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  
  if (!isTauri()) {
    try {
      const blob = new Blob([webLogs.join('\n')], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'app_log.txt';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      return true;
    } catch (e) {
      console.error('Failed to download log in web mode:', e);
      return false;
    }
  }

  try {
    await logToFile('User requested to open the log directory.');
    const pathModule = await import('@tauri-apps/api/path');
    const { openPath, revealItemInDir } = await import('@tauri-apps/plugin-opener');
    const { writeTextFile, exists, BaseDirectory } = await import('@tauri-apps/plugin-fs');
    
    const dataDir = await pathModule.appLocalDataDir();
    const logPath = await pathModule.join(dataDir, 'app_log.txt');

    try {
      const logExists = await exists('app_log.txt', { baseDir: BaseDirectory.AppLocalData });
      if (!logExists) {
        await writeTextFile('app_log.txt', '[ClassiTunes] Diagnostics log initialized.\n', {
          baseDir: BaseDirectory.AppLocalData,
        });
      }
    } catch (dirErr) {
      console.warn('Error ensuring log file exists:', dirErr);
    }

    try {
      await openPath(dataDir);
    } catch (openErr) {
      console.warn('openPath failed, falling back to revealItemInDir:', openErr);
      try {
        await revealItemInDir(logPath);
      } catch (revealErr) {
        await revealItemInDir(dataDir);
      }
    }
    return true;
  } catch (e: any) {
    console.error('Failed to open log directory:', e);
    await logToFile(`Failed to open log directory: ${e?.message || e}`);
    return false;
  }
}

export async function openLogFile(): Promise<boolean> {
  return openLogDirectory();
}

export async function revealLogFile(): Promise<boolean> {
  if (typeof window === 'undefined') return false;

  if (!isTauri()) {
    alert("In browser preview, logs are saved in localStorage. Clicking OK will download your log file.");
    return openLogFile();
  }

  try {
    await logToFile('User requested to reveal the log file location.');
    const { appLocalDataDir, join } = await import('@tauri-apps/api/path');
    const { revealItemInDir } = await import('@tauri-apps/plugin-opener');
    const dataDir = await appLocalDataDir();
    const logPath = await join(dataDir, 'app_log.txt');
    await revealItemInDir(logPath);
    return true;
  } catch (e: any) {
    console.error('Failed to reveal log file:', e);
    await logToFile(`Failed to reveal log file: ${e?.message || e}`);
    return false;
  }
}

export function isTauri(): boolean {
  return typeof window !== 'undefined' && !!((window as any).__TAURI__ || (window as any).__TAURI_INTERNALS__ || (window as any).__TAURI_METADATA__);
}

export async function pickTauriFiles(): Promise<string[] | null> {
  try {
    await logToFile('Opening Tauri file picker...');
    const { open } = await import('@tauri-apps/plugin-dialog');
    const selected = await open({
      multiple: true,
      // Enable hidden files (those starting with a dot) to be selectable on Linux/macOS
      allowHidden: true,
      filters: [{
        name: 'Audio Files',
        extensions: ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'wma', 'aiff', 'alac']
      }]
    });
    if (selected === null) {
      await logToFile('Tauri file picker cancelled by user.');
      return null;
    }
    const paths = Array.isArray(selected) ? selected : [selected];
    await logToFile(`Tauri file picker selected ${paths.length} file(s).`);
    return paths;
  } catch (e: any) {
    const errMsg = e instanceof Error ? e.message : String(e);
    await logToFile(`Tauri pickTauriFiles failed: ${errMsg}`);
    console.error('Tauri pickTauriFiles failed:', e);
    return null;
  }
}

export async function pickTauriDirectory(): Promise<string | null> {
  try {
    await logToFile('Opening Tauri directory picker...');
    const { open } = await import('@tauri-apps/plugin-dialog');
    const selected = await open({
      directory: true,
      multiple: false
    });
    if (selected === null) {
      await logToFile('Tauri directory picker cancelled by user.');
      return null;
    }
    const path = Array.isArray(selected) ? selected[0] : selected;
    await logToFile(`Tauri directory picker selected: ${path}`);
    return path;
  } catch (e: any) {
    const errMsg = e instanceof Error ? e.message : String(e);
    await logToFile(`Tauri pickTauriDirectory failed: ${errMsg}`);
    console.error('Tauri pickTauriDirectory failed:', e);
    return null;
  }
}

export async function scanTauriDirectory(
  dirPath: string, 
  onProgress?: (count: number, currentFolder?: string) => void
): Promise<string[]> {
  try {
    await logToFile(`--- Starting directory scan at: ${dirPath} ---`);
    const { readDir } = await import('@tauri-apps/plugin-fs');
    const audioPaths: string[] = [];
    const audioExtensions = ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'wma', 'aiff', 'alac'];
    // Robust cross-platform path separator detection (Tauri API or platform inspection)
    let sep = '/';
    try {
      if (typeof window !== 'undefined' && ((window as any).__TAURI__ || (window as any).__TAURI_INTERNALS__ || (window as any).__TAURI_METADATA__)) {
        const { sep: tauriSep } = await import('@tauri-apps/api/path');
        if (typeof tauriSep === 'function') {
          sep = await tauriSep();
        }
      } else if (typeof window !== 'undefined' && (window as any).electronAPI?.platform) {
        sep = (window as any).electronAPI.platform === 'win32' ? '\\' : '/';
      } else if (typeof navigator !== 'undefined' && navigator.userAgent.toLowerCase().includes('win')) {
        sep = '\\';
      }
    } catch {
      const isWin = typeof navigator !== 'undefined' && (navigator.userAgent.toLowerCase().includes('win') || (navigator as any).userAgentData?.platform?.toLowerCase?.().includes('win'));
      sep = isWin ? '\\' : '/';
    }

    const rootFolderName = dirPath.split(/[/\\]/).filter(Boolean).pop() || dirPath;
    if (onProgress) {
      onProgress(0, rootFolderName);
    }

    const ignoredFolderNames = [
      // Dependency / Build / Dev folders
      'node_modules',
      '.git',
      '.cache',
      '.npm',
      '.vscode',
      '.cargo',
      '.idea',
      '.settings',
      '.gradle',
      'dist',
      'build',
      'out',
      'target',
      'vendor',
      'bower_components',
      'bin',
      'obj',

      // System / OS folders (Windows & Unix system directories)
      'appdata',
      'application data',
      'system32',
      'windows',
      'temp',
      'tmp',
      'program files',
      'program files (x86)',
      'programdata',
      'msocache',
      'recovery',
      'system volume information',
      '$recycle.bin',
      'recycle.bin',
      'system',
      'private',
      'usr',
      'sbin',
      'etc',
      'var',
      'dev',
      'cores',
      'opt',

      // Cloud / Online-only Storage (can cause long hangs or empty on-demand files)
      'onedrive',
      'dropbox',
      'google drive',
      'googledrive',
      'icloud',
      'icloud drive',
      'iclouddrive',
      'box',
      'creative cloud',
      'creativecloud',
      'nextcloud',
      'owncloud',
      'skydrive'
    ];

    // Do not await logToFile() for every directory/file here. Serial disk I/O
    // can make large-library scans appear frozen and delay UI progress.
    let lastProgressTime = 0;

    async function traverse(currentPath: string) {
      try {
        const folderName = currentPath.split(/[/\\]/).filter(Boolean).pop() || currentPath;
        const now = Date.now();
        if (onProgress && (now - lastProgressTime > 60)) {
          lastProgressTime = now;
          onProgress(audioPaths.length, folderName);
        }

        const entries = await readDir(currentPath);
        for (const entry of entries) {
          const fullPath = currentPath.endsWith(sep) ? `${currentPath}${entry.name}` : `${currentPath}${sep}${entry.name}`;
          if (entry.isDirectory) {
            const nameLower = entry.name.toLowerCase();
            const shouldIgnore = 
              entry.name.startsWith('.') || 
              ignoredFolderNames.includes(nameLower);
            
            if (shouldIgnore) {
              continue;
            }

            try {
              await traverse(fullPath);
            } catch (innerErr: any) {
              console.warn(`Skipping subdirectory due to read error: ${fullPath}`, innerErr);
            }
          } else if (entry.isFile) {
            const ext = entry.name.split('.').pop()?.toLowerCase();
            if (ext && audioExtensions.includes(ext)) {
              audioPaths.push(fullPath);
              const nowFile = Date.now();
              if (onProgress && (nowFile - lastProgressTime > 40)) {
                lastProgressTime = nowFile;
                onProgress(audioPaths.length, folderName);
              }
            }
          }
        }
      } catch (err: any) {
        const errMsg = err instanceof Error ? err.message : String(err);
        await logToFile(`Failed to read directory: ${currentPath} - ${errMsg}`);
        console.warn(`Failed to read directory: ${currentPath}`, err);
      }
    }

    await traverse(dirPath);
    await logToFile(`--- Directory scan complete. Scanned ${audioPaths.length} audio file(s) ---`);
    if (onProgress) onProgress(audioPaths.length, rootFolderName);
    return audioPaths;
  } catch (e: any) {
    const errMsg = e instanceof Error ? e.message : String(e);
    await logToFile(`Tauri scanTauriDirectory failed overall: ${errMsg}`);
    console.error('Tauri scanTauriDirectory failed:', e);
    return [];
  }
}

export async function convertPathsToFiles(paths: string[]): Promise<File[]> {
  try {
    await logToFile(`Converting ${paths.length} file path(s) into File objects...`);
    const { convertFileSrc } = await import('@tauri-apps/api/core');
    const files: File[] = [];

    for (const path of paths) {
      try {
        const assetUrl = convertFileSrc(path);
        const res = await fetch(assetUrl);
        const blob = await res.blob();
        const filename = path.split(/[/\\]/).pop() || 'imported_song.mp3';
        const file = new File([blob], filename, { type: blob.type || 'audio/mpeg' });
        
        Object.defineProperty(file, 'path', {
          value: path,
          writable: true,
          configurable: true,
          enumerable: true
        });

        files.push(file);
      } catch (err: any) {
        const errMsg = err instanceof Error ? err.message : String(err);
        await logToFile(`Failed to convert path to File: ${path} - ${errMsg}`);
        console.error('Failed to convert path to File:', path, err);
      }
    }
    await logToFile(`Converted ${files.length} of ${paths.length} file path(s) successfully.`);
    return files;
  } catch (e: any) {
    const errMsg = e instanceof Error ? e.message : String(e);
    await logToFile(`convertPathsToFiles failed overall: ${errMsg}`);
    console.error('convertPathsToFiles failed:', e);
    return [];
  }
}

export async function processDroppedPaths(
  paths: string[],
  onProgress?: (count: number, currentFolder?: string) => void
): Promise<string[]> {
  try {
    const { stat } = await import('@tauri-apps/plugin-fs');
    const allFilePaths: string[] = [];
    const audioExtensions = ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'wma', 'aiff', 'alac'];

    for (const path of paths) {
      try {
        const info = await stat(path);
        if (info.isDirectory) {
          const scannedPaths = await scanTauriDirectory(path, (count, folder) => {
            if (onProgress) {
              onProgress(allFilePaths.length + count, folder);
            }
          });
          allFilePaths.push(...scannedPaths);
        } else if (info.isFile) {
          const ext = path.split('.').pop()?.toLowerCase();
          if (ext && audioExtensions.includes(ext)) {
            allFilePaths.push(path);
            if (onProgress) {
              onProgress(allFilePaths.length);
            }
          }
        }
      } catch (err) {
        console.error('Failed to get stat for path:', path, err);
        // Fallback: if stat fails, assume it might be a file if it has a valid audio extension
        const ext = path.split('.').pop()?.toLowerCase();
        if (ext && audioExtensions.includes(ext)) {
          allFilePaths.push(path);
          if (onProgress) {
            onProgress(allFilePaths.length);
          }
        }
      }
    }

    return allFilePaths;
  } catch (e) {
    console.error('processDroppedPaths failed:', e);
    return [];
  }
}

export async function openExternalUrl(url: string): Promise<boolean> {
  if (typeof window === 'undefined') return false;

  if (isTauri()) {
    try {
      const { openUrl } = await import('@tauri-apps/plugin-opener');
      await openUrl(url);
      return true;
    } catch (e) {
      console.warn('Tauri openUrl notice:', e);
    }
  }

  window.open(url, '_blank', 'noopener,noreferrer');
  return true;
}



/**
 * Copy a Tauri-imported audio file into Artist/Album and name it <Title> - <Artist>.
 * The source file is never moved or deleted.
 */
export async function organizeTauriMusicFile(
  sourcePath: string, libraryRoot: string, artist: string, album: string, title: string, extensionOrFilename: string
): Promise<string> {
  if (!sourcePath || !libraryRoot) throw new Error('A source file and default music path are required.');
  const { invoke } = await import('@tauri-apps/api/core');
  return await invoke<string>('organize_music_file', { sourcePath, libraryRoot, artist, album, title, extensionOrFilename });
}

export async function deleteTauriFile(filePath: string): Promise<boolean> {
  if (!filePath || !isTauri()) return false;
  try {
    const { remove } = await import('@tauri-apps/plugin-fs');
    await remove(filePath);
    return true;
  } catch (error) {
    console.error('Could not delete physical music file:', error);
    return false;
  }
}

export async function writeTauriMusicMetadata(filePath: string, tags: Record<string, unknown>): Promise<boolean> {
  if (!filePath || !isTauri()) return false;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return !!(await invoke('write_music_metadata', { filePath, tags }));
  } catch (error) {
    console.error('Could not write music metadata:', error);
    throw error;
  }
}

export async function readTauriMusicMetadata(filePath: string): Promise<any | null> {
  if (!filePath || !isTauri()) return null;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke('read_music_metadata', { filePath });
  } catch (error) {
    console.warn(`Native metadata reading failed for ${filePath}:`, error);
    return null;
  }
}

export async function readTauriMusicMetadataBatch(filePaths: string[]): Promise<Record<string, any>> {
  if (!filePaths || filePaths.length === 0 || !isTauri()) return {};
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const results = await invoke<Array<{ path: string; metadata: any | null }>>('read_music_metadata_batch', { filePaths });
    const map: Record<string, any> = {};
    if (Array.isArray(results)) {
      for (const item of results) {
        if (item.metadata) {
          map[item.path] = item.metadata;
        }
      }
    }
    return map;
  } catch (error) {
    console.warn('Native batch metadata reading failed:', error);
    return {};
  }
}

// Backwards-compatible alias for callers that only handle ID3 files.
export const writeTauriId3Tags = writeTauriMusicMetadata;

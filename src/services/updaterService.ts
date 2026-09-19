// Pure on-demand Tauri native updater engine for ClassiTunes (Patterned after MatterPackr)
import { isTauri, logToFile } from '../utils/tauriWindow';
import { relaunch } from '@tauri-apps/plugin-process';

export interface UpdateInfo {
  available: boolean;
  version?: string;
  currentVersion: string;
  date?: string;
  body?: string;
}

export type InstallProgressCallback = (percent: number, statusText: string) => void;

let _resolvedVersion: string | null = null;

export async function getCurrentVersion(): Promise<string> {
  if (_resolvedVersion) return _resolvedVersion;
  if (isTauri()) {
    try {
      const { getVersion } = await import('@tauri-apps/api/app');
      _resolvedVersion = await getVersion();
      return _resolvedVersion;
    } catch {
      // ignore
    }
  }
  _resolvedVersion = '1.3.4';
  return _resolvedVersion;
}

export let CURRENT_VERSION = '1.3.4';
getCurrentVersion().then((v) => { CURRENT_VERSION = v; });

// Module-level cached handle to active update
let activeUpdateHandle: any = null;

/**
 * Check for updates on demand. Returns update details including release notes.
 */
export async function checkForAppUpdate(): Promise<UpdateInfo> {
  const currentVersion = await getCurrentVersion();

  if (!isTauri()) {
    return {
      available: false,
      currentVersion,
      body: 'Updates are only supported when running the desktop app.',
    };
  }

  try {
    await logToFile(`[Updater] Checking for updates (current: v${currentVersion})...`);
    const { check } = await import('@tauri-apps/plugin-updater');
    const update = await check({ timeout: 15000 });

    if (!update) {
      activeUpdateHandle = null;
      await logToFile('[Updater] App is up to date.');
      return {
        available: false,
        currentVersion,
      };
    }

    activeUpdateHandle = update;
    await logToFile(`[Updater] Update available: v${update.version} (released ${update.date || 'recently'})`);

    return {
      available: true,
      version: update.version,
      currentVersion,
      date: update.date,
      body: update.body,
    };
  } catch (err: any) {
    activeUpdateHandle = null;
    const msg = err instanceof Error ? err.message : String(err);
    await logToFile(`[Updater] Check failed: ${msg}`);
    console.error('[Updater] Failed to check for update:', err);
    throw err;
  }
}

/**
 * Download and install the available update with progress tracking, then relaunch.
 * No user interaction is required once this is initiated.
 */
export async function downloadAndInstallUpdate(
  onProgress?: InstallProgressCallback
): Promise<void> {
  if (!isTauri()) {
    throw new Error('Updater is only supported in desktop app');
  }

  let update = activeUpdateHandle;
  if (!update) {
    const { check } = await import('@tauri-apps/plugin-updater');
    update = await check({ timeout: 15000 });
    if (!update) {
      throw new Error('No update available to install');
    }
    activeUpdateHandle = update;
  }

  await logToFile(`[Updater] Starting download & install for v${update.version}...`);
  let totalBytes = 0;
  let downloadedBytes = 0;

  if (onProgress) {
    onProgress(5, 'Starting download...');
  }

  await update.downloadAndInstall((event: any) => {
    if (event.event === 'Started') {
      totalBytes = event.data.contentLength || 0;
      if (onProgress) {
        onProgress(10, 'Downloading update package...');
      }
    } else if (event.event === 'Progress') {
      downloadedBytes += event.data.chunkLength || 0;
      const percent = totalBytes > 0
        ? Math.min(95, Math.round((downloadedBytes / totalBytes) * 100))
        : 50;
      if (onProgress) {
        const mbDownloaded = (downloadedBytes / (1024 * 1024)).toFixed(1);
        const mbTotal = totalBytes > 0 ? (totalBytes / (1024 * 1024)).toFixed(1) : '?';
        onProgress(
          percent,
          totalBytes > 0
            ? `Downloading... ${percent}% (${mbDownloaded}MB / ${mbTotal}MB)`
            : `Downloading update package (${mbDownloaded}MB)...`
        );
      }
    } else if (event.event === 'Finished') {
      if (onProgress) {
        onProgress(98, 'Extracting & applying update...');
      }
    }
  });

  await logToFile('[Updater] Download & installation finished. Relaunching...');
  if (onProgress) {
    onProgress(100, 'Update ready! Relaunching ClassiTunes...');
  }

  try {
    await relaunch();
  } catch (relaunchErr) {
    console.warn('[Updater] Relaunch invocation response (may be exiting):', relaunchErr);
  }
}

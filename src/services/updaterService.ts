// Pure on-demand Tauri native updater engine for ClassiTunes
import { isTauri, logToFile } from '../utils/tauriWindow';
import { relaunch } from '@tauri-apps/plugin-process';

export type UpdateStatus = 
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'downloading'
  | 'installing'
  | 'error';

export interface UpdateState {
  status: UpdateStatus;
  progress: number; // 0 to 100
  currentVersion: string;
  targetVersion?: string;
  message: string;
  errorMessage?: string;
}

// Runtime cached version; falls back to package version
let _resolvedVersion: string | null = null;

export async function getCurrentVersion(): Promise<string> {
  if (_resolvedVersion) return _resolvedVersion;
  if (isTauri()) {
    try {
      const { getVersion } = await import('@tauri-apps/api/app');
      _resolvedVersion = await getVersion();
      return _resolvedVersion;
    } catch { /* ignore fallback below */ }
  }
  _resolvedVersion = '1.2.3';
  return _resolvedVersion;
}

export let CURRENT_VERSION = '1.2.3';
getCurrentVersion().then((v) => { CURRENT_VERSION = v; });

/**
 * Executes a fully on-demand, end-to-end update workflow:
 * 1. Checks Tauri updater endpoint (signed latest.json manifest).
 * 2. If no update available: cleanly informs the user that they're up to date.
 * 3. If update found: automatically downloads chunk by chunk with real progress,
 *    installs the update package, and relaunches the application without requiring
 *    any additional user clicks.
 */
export async function runOnDemandUpdate(
  onStateChange: (state: UpdateState) => void
): Promise<void> {
  const currentVer = await getCurrentVersion();

  onStateChange({
    status: 'checking',
    progress: 10,
    currentVersion: currentVer,
    message: 'Checking for updates...',
  });

  if (!isTauri()) {
    onStateChange({
      status: 'error',
      progress: 0,
      currentVersion: currentVer,
      message: 'Updates are only supported in the desktop application.',
      errorMessage: 'Not running in Tauri environment',
    });
    return;
  }

  try {
    await logToFile(`[Updater] Starting on-demand check (current: v${currentVer})...`);
    const { check } = await import('@tauri-apps/plugin-updater');
    
    const update = await check({ timeout: 12000 });

    if (!update) {
      await logToFile('[Updater] Application is up to date.');
      onStateChange({
        status: 'up-to-date',
        progress: 100,
        currentVersion: currentVer,
        targetVersion: currentVer,
        message: `ClassiTunes is up to date (v${currentVer})`,
      });
      return;
    }

    const newVer = update.version;
    await logToFile(`[Updater] Found new version: v${newVer}. Starting automatic download and install...`);

    onStateChange({
      status: 'downloading',
      progress: 0,
      currentVersion: currentVer,
      targetVersion: newVer,
      message: `Downloading update v${newVer}...`,
    });

    let totalBytes = 0;
    let downloadedBytes = 0;

    await update.downloadAndInstall((event: any) => {
      if (event.event === 'Started') {
        totalBytes = event.data.contentLength || 0;
        onStateChange({
          status: 'downloading',
          progress: 5,
          currentVersion: currentVer,
          targetVersion: newVer,
          message: `Starting download (v${newVer})...`,
        });
      } else if (event.event === 'Progress') {
        downloadedBytes += event.data.chunkLength || 0;
        const percent = totalBytes > 0 
          ? Math.min(95, Math.round((downloadedBytes / totalBytes) * 100))
          : 50;
        onStateChange({
          status: 'downloading',
          progress: percent,
          currentVersion: currentVer,
          targetVersion: newVer,
          message: totalBytes > 0
            ? `Downloading v${newVer} (${percent}%)...`
            : `Downloading update package...`,
        });
      } else if (event.event === 'Finished') {
        onStateChange({
          status: 'installing',
          progress: 98,
          currentVersion: currentVer,
          targetVersion: newVer,
          message: `Installing update v${newVer}...`,
        });
      }
    });

    await logToFile('[Updater] Installation completed successfully. Relaunching application...');

    onStateChange({
      status: 'installing',
      progress: 100,
      currentVersion: currentVer,
      targetVersion: newVer,
      message: `Update installed! Restarting ClassiTunes...`,
    });

    // Automatically relaunch into the updated app
    try {
      await relaunch();
    } catch (relaunchErr) {
      console.warn('[Updater] Relaunch triggered (may be handled by installer):', relaunchErr);
    }
  } catch (err: any) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    await logToFile(`[Updater] Update error: ${errorMsg}`);
    console.error('[Updater] Update process failed:', err);

    onStateChange({
      status: 'error',
      progress: 0,
      currentVersion: currentVer,
      message: 'Failed to update ClassiTunes.',
      errorMessage: errorMsg,
    });
  }
}

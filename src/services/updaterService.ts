// Automatic native updater service for ClassiTunes with Tauri Plugin Updater support
import { isTauri, openExternalUrl, logToFile } from '../utils/tauriWindow';

export type UpdateStatus = 
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'update-available'
  | 'downloading'
  | 'installing'
  | 'ready'
  | 'error';

export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  releaseName?: string;
  releaseNotes?: string;
  downloadUrl?: string;
  publishedAt?: string;
}

export interface UpdateState {
  status: UpdateStatus;
  progress: number; // 0 to 100
  info: UpdateInfo | null;
  errorMessage?: string;
  message?: string;
}

export const CURRENT_VERSION = '1.1.2';

// Canonical repository information
export const GITHUB_REPO = 'Z-Sofware-Labs/ClassiTunes';
export const RELEASES_API_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
export const RELEASES_PAGE_URL = `https://github.com/${GITHUB_REPO}/releases`;

// Cached active Tauri update handle across check -> downloadAndInstall
let activeTauriUpdate: any = null;

/**
 * Compare two semver strings: returns 1 if vA > vB, -1 if vA < vB, 0 if equal.
 */
export function compareVersions(vA: string, vB: string): number {
  const cleanA = vA.replace(/^v/, '').split('.').map(x => parseInt(x, 10) || 0);
  const cleanB = vB.replace(/^v/, '').split('.').map(x => parseInt(x, 10) || 0);

  const len = Math.max(cleanA.length, cleanB.length);
  for (let i = 0; i < len; i++) {
    const a = cleanA[i] || 0;
    const b = cleanB[i] || 0;
    if (a > b) return 1;
    if (a < b) return -1;
  }
  return 0;
}

/**
 * Detect current platform for asset resolution
 */
function getTargetPlatform(): 'win' | 'mac' | 'linux' | 'web' {
  if (typeof window !== 'undefined' && (window as any).electronAPI?.platform) {
    const p = (window as any).electronAPI.platform;
    if (p === 'win32') return 'win';
    if (p === 'darwin') return 'mac';
    return 'linux';
  }
  if (typeof navigator !== 'undefined') {
    const ua = navigator.userAgent.toLowerCase();
    if (ua.includes('win')) return 'win';
    if (ua.includes('mac')) return 'mac';
    if (ua.includes('linux')) return 'linux';
  }
  return 'web';
}

/**
 * Select the appropriate release asset URL for the current operating system.
 */
function findBestAssetUrl(assets: any[]): string | undefined {
  if (!Array.isArray(assets) || assets.length === 0) return undefined;
  const platform = getTargetPlatform();

  if (platform === 'win') {
    const exe = assets.find(a => typeof a.name === 'string' && a.name.endsWith('.exe'));
    if (exe?.browser_download_url) return exe.browser_download_url;
  } else if (platform === 'mac') {
    const dmg = assets.find(a => typeof a.name === 'string' && (a.name.endsWith('.dmg') || a.name.endsWith('.zip')));
    if (dmg?.browser_download_url) return dmg.browser_download_url;
  } else if (platform === 'linux') {
    const linuxPkg = assets.find(a => typeof a.name === 'string' && (a.name.endsWith('.AppImage') || a.name.endsWith('.deb')));
    if (linuxPkg?.browser_download_url) return linuxPkg.browser_download_url;
  }

  return assets[0]?.browser_download_url;
}

/**
 * Execute on-demand check for updates using Tauri Plugin Updater (with fallback).
 */
export async function checkForUpdate(
  onProgress?: (state: UpdateState) => void
): Promise<UpdateInfo | null> {
  const notify = (state: UpdateState) => {
    onProgress?.(state);
  };

  notify({
    status: 'checking',
    progress: 10,
    info: null,
    message: 'Checking for updates...',
  });

  try {
    await logToFile(`[Updater] Checking for updates (current: v${CURRENT_VERSION})...`);

    // 1. Check with Tauri native updater plugin if running in Tauri
    if (isTauri()) {
      try {
        const { check } = await import('@tauri-apps/plugin-updater');
        const update = await check({ timeout: 8000 });
        if (update) {
          activeTauriUpdate = update;
          const info: UpdateInfo = {
            currentVersion: update.currentVersion || CURRENT_VERSION,
            latestVersion: update.version,
            releaseName: `ClassiTunes v${update.version}`,
            releaseNotes: update.body || '',
            publishedAt: update.date,
          };
          await logToFile(`[Updater] Tauri plugin detected new version: v${update.version}`);
          notify({
            status: 'update-available',
            progress: 30,
            info,
            message: `New version v${update.version} available!`,
          });
          return info;
        } else {
          activeTauriUpdate = null;
          await logToFile(`[Updater] Tauri plugin reports up to date.`);
          const info: UpdateInfo = {
            currentVersion: CURRENT_VERSION,
            latestVersion: CURRENT_VERSION,
            releaseName: `ClassiTunes v${CURRENT_VERSION}`,
            releaseNotes: 'You are on the latest release.',
          };
          notify({
            status: 'up-to-date',
            progress: 100,
            info,
            message: `ClassiTunes is up to date (v${CURRENT_VERSION})`,
          });
          return null;
        }
      } catch (tauriErr: any) {
        await logToFile(`[Updater] Tauri plugin check notice (falling back to GitHub API): ${tauriErr?.message || tauriErr}`);
      }
    }

    // 2. Check with Electron IPC if running in Electron
    if (typeof window !== 'undefined' && (window as any).electronAPI?.checkForUpdates) {
      try {
        const result = await (window as any).electronAPI.checkForUpdates();
        if (result && result.updateAvailable) {
          const info: UpdateInfo = {
            currentVersion: CURRENT_VERSION,
            latestVersion: result.version || CURRENT_VERSION,
            releaseName: result.releaseName,
            releaseNotes: result.releaseNotes,
            downloadUrl: result.downloadUrl,
          };
          notify({
            status: 'update-available',
            progress: 30,
            info,
            message: `Update v${info.latestVersion} found!`,
          });
          return info;
        }
      } catch (err) {
        console.warn('Electron native updater error, falling back to HTTP check:', err);
      }
    }

    // 3. Direct GitHub Releases API check fallback
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    let data: any = null;
    let fetchStatus: number | null = null;
    let fetchError: string | null = null;

    try {
      const res = await fetch(RELEASES_API_URL, {
        signal: controller.signal,
        headers: {
          'Accept': 'application/vnd.github.v3+json',
        },
      });
      clearTimeout(timeoutId);
      fetchStatus = res.status;

      if (res.ok) {
        data = await res.json();
      } else {
        await logToFile(`[Updater] GitHub API status ${res.status}.`);
      }
    } catch (e: any) {
      clearTimeout(timeoutId);
      fetchError = e?.message || String(e);
      await logToFile(`[Updater] GitHub API fetch error: ${fetchError}`);
    }

    // If repository or release endpoint doesn't exist yet (404/403 or network failure)
    if (!data || !data.tag_name) {
      let failMessage = 'Unable to check for updates.';
      if (fetchStatus === 404) {
        failMessage = `Release repository not found (${GITHUB_REPO}). No releases published yet.`;
      } else if (fetchStatus === 403) {
        failMessage = 'GitHub API rate limit exceeded or access restricted.';
      } else if (fetchError) {
        failMessage = `Network error checking updates: ${fetchError}`;
      }

      await logToFile(`[Updater] ${failMessage}`);
      notify({
        status: 'error',
        progress: 0,
        info: null,
        errorMessage: failMessage,
        message: failMessage,
      });
      return null;
    }

    const latestVersion = data.tag_name.replace(/^v/, '');
    const isNewer = compareVersions(latestVersion, CURRENT_VERSION) > 0;

    const info: UpdateInfo = {
      currentVersion: CURRENT_VERSION,
      latestVersion,
      releaseName: data.name || `ClassiTunes v${latestVersion}`,
      releaseNotes: data.body || '',
      downloadUrl: findBestAssetUrl(data.assets) || data.html_url || RELEASES_PAGE_URL,
      publishedAt: data.published_at,
    };

    if (isNewer) {
      notify({
        status: 'update-available',
        progress: 30,
        info,
        message: `New version v${latestVersion} available!`,
      });
      return info;
    } else {
      notify({
        status: 'up-to-date',
        progress: 100,
        info,
        message: `ClassiTunes is up to date (v${CURRENT_VERSION})`,
      });
      return null;
    }
  } catch (error: any) {
    const errorMsg = error?.message || 'Failed to check for updates';
    await logToFile(`[Updater] Update check failed: ${errorMsg}`);
    notify({
      status: 'error',
      progress: 0,
      info: null,
      errorMessage: errorMsg,
      message: 'Update check failed.',
    });
    return null;
  }
}

/**
 * Execute the automatic on-demand update process:
 * 1. Check for updates
 * 2. If update found in Tauri: download via plugin with real byte-level progress and install/relaunch!
 * 3. Fallback: Electron IPC or external download link
 */
export async function startAutomaticUpdate(
  onStateChange: (state: UpdateState) => void
): Promise<void> {
  const updateState = (state: UpdateState) => {
    onStateChange(state);
  };

  try {
    const updateInfo = await checkForUpdate(updateState);

    if (!updateInfo) {
      return;
    }

    await logToFile(`[Updater] Automatically starting download for v${updateInfo.latestVersion}...`);
    
    updateState({
      status: 'downloading',
      progress: 0,
      info: updateInfo,
      message: `Downloading v${updateInfo.latestVersion}...`,
    });

    // Option A: Native Tauri Updater Plugin download & install
    if (isTauri() && activeTauriUpdate) {
      try {
        let totalBytes = 0;
        let downloadedBytes = 0;

        await activeTauriUpdate.downloadAndInstall((event: any) => {
          if (event.event === 'Started') {
            totalBytes = event.data.contentLength || 0;
            updateState({
              status: 'downloading',
              progress: 5,
              info: updateInfo,
              message: `Starting download (v${updateInfo.latestVersion})...`,
            });
          } else if (event.event === 'Progress') {
            downloadedBytes += event.data.chunkLength || 0;
            const percent = totalBytes > 0 
              ? Math.min(95, Math.round((downloadedBytes / totalBytes) * 100))
              : 50;
            updateState({
              status: 'downloading',
              progress: percent,
              info: updateInfo,
              message: totalBytes > 0 
                ? `Downloading update (${percent}%)...` 
                : 'Downloading update package...',
            });
          } else if (event.event === 'Finished') {
            updateState({
              status: 'installing',
              progress: 98,
              info: updateInfo,
              message: 'Installing update...',
            });
          }
        });

        await logToFile('[Updater] Tauri plugin download and install finished.');
        updateState({
          status: 'ready',
          progress: 100,
          info: updateInfo,
          message: 'Update installed successfully! Restarting...',
        });

        // Prompt relaunch if available on macOS / Linux
        try {
          // On Windows, the updater plugin automatically launches the installer and terminates
          const processModule = await (Function('return import("@tauri-apps/plugin-process")')() as Promise<any>);
          if (processModule && typeof processModule.relaunch === 'function') {
            await processModule.relaunch();
          }
        } catch {
          // Fallback or windows installer handled exit
        }
        return;
      } catch (tauriDownloadErr: any) {
        await logToFile(`[Updater] Tauri plugin download failed, attempting fallback: ${tauriDownloadErr?.message || tauriDownloadErr}`);
      }
    }

    // Option B: Electron IPC
    if (typeof window !== 'undefined' && (window as any).electronAPI?.downloadAndInstallUpdate) {
      try {
        updateState({
          status: 'installing',
          progress: 95,
          info: updateInfo,
          message: 'Applying update...',
        });
        await (window as any).electronAPI.downloadAndInstallUpdate(updateInfo.downloadUrl);
        updateState({
          status: 'ready',
          progress: 100,
          info: updateInfo,
          message: 'Update complete!',
        });
        return;
      } catch (err) {
        console.warn('Electron native install failed, opening download asset:', err);
      }
    }

    // Option C: Browser / External URL Download Fallback
    if (updateInfo.downloadUrl) {
      await logToFile(`[Updater] Triggering automated download of: ${updateInfo.downloadUrl}`);
      await openExternalUrl(updateInfo.downloadUrl);
    }

    updateState({
      status: 'ready',
      progress: 100,
      info: updateInfo,
      message: `Downloaded v${updateInfo.latestVersion}! Follow installer to complete.`,
    });
  } catch (err: any) {
    const errMsg = err?.message || 'Error occurred during automatic update';
    await logToFile(`[Updater] Auto-update failed: ${errMsg}`);
    updateState({
      status: 'error',
      progress: 0,
      info: null,
      errorMessage: errMsg,
      message: 'Failed to complete update.',
    });
  }
}

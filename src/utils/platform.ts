// Centralized platform capability and environment detection module.
// Distinguishes OS, runtime host, and rendering engine safely without assuming specific desktop environments or distributions.

export type PlatformOS = 'linux' | 'windows' | 'macos' | 'other';
export type AppRuntime = 'tauri' | 'electron' | 'browser';

export interface PlatformCapabilities {
  os: PlatformOS;
  runtime: AppRuntime;
  isLinux: boolean;
  isWindows: boolean;
  isMacOS: boolean;
  isTauri: boolean;
  isElectron: boolean;
  isBrowser: boolean;
  isWebKitGTK: boolean;
}

function detectOS(): PlatformOS {
  if (typeof window !== 'undefined' && (window as any).electronAPI?.platform) {
    const ep = (window as any).electronAPI.platform;
    if (ep === 'win32') return 'windows';
    if (ep === 'darwin') return 'macos';
    if (ep === 'linux') return 'linux';
  }

  if (typeof navigator === 'undefined') return 'other';

  const ua = (navigator.userAgent || '').toLowerCase();
  const platform = (
    (navigator as any).userAgentData?.platform ||
    navigator.platform ||
    ''
  ).toLowerCase();

  // Test Windows first to avoid Windows WebView2 / compatibility headers containing "linux"
  if (platform.includes('win') || ua.includes('windows') || ua.includes('win32') || ua.includes('win64')) {
    return 'windows';
  }
  if (platform.includes('mac') || ua.includes('macintosh') || ua.includes('mac os')) {
    return 'macos';
  }
  if (platform.includes('linux') || ua.includes('linux') || ua.includes('x11')) {
    return 'linux';
  }

  return 'other';
}

function detectRuntime(): AppRuntime {
  if (typeof window !== 'undefined') {
    if ((window as any).__TAURI__ || (window as any).__TAURI_INTERNALS__ || (window as any).__TAURI_METADATA__) {
      return 'tauri';
    }
    if ((window as any).electronAPI) {
      return 'electron';
    }
  }
  return 'browser';
}

function detectWebKitGTK(os: PlatformOS, runtime: AppRuntime): boolean {
  if (os !== 'linux') return false;
  if (runtime === 'tauri') {
    // Tauri on Linux uses WebKitGTK / WPE WebKit as its webview
    return true;
  }
  if (typeof navigator !== 'undefined') {
    const ua = navigator.userAgent.toLowerCase();
    return ua.includes('webkit') && !ua.includes('chrome') && !ua.includes('safari');
  }
  return false;
}

const detectedOS = detectOS();
const detectedRuntime = detectRuntime();
const detectedWebKitGTK = detectWebKitGTK(detectedOS, detectedRuntime);

export const platformInfo: PlatformCapabilities = {
  os: detectedOS,
  runtime: detectedRuntime,
  isLinux: detectedOS === 'linux',
  isWindows: detectedOS === 'windows',
  isMacOS: detectedOS === 'macos',
  isTauri: detectedRuntime === 'tauri',
  isElectron: detectedRuntime === 'electron',
  isBrowser: detectedRuntime === 'browser',
  isWebKitGTK: detectedWebKitGTK,
};

export const isWindowsTauri = platformInfo.isWindows && platformInfo.isTauri;
export const isMacTauri = platformInfo.isMacOS && platformInfo.isTauri;

export function getPlatformInfo(): PlatformCapabilities {
  return platformInfo;
}

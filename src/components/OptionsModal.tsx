import React, { useEffect, useRef, useState } from 'react';
import { X, Settings, FolderOpen, Check, RefreshCw, FolderSearch, Trash2, AlertTriangle } from 'lucide-react';
import { isTauri, pickTauriDirectory } from '../utils/tauriWindow';
import { audioDir } from '@tauri-apps/api/path';

export type ThemePreference = 'system' | 'dark' | 'light';

export interface AppSettings {
  defaultMusicPath: string;
  organizeMusicFolders: boolean;
  crossfadeEnabled: boolean;
  crossfadeSeconds: number;
  audioNormalization: boolean;
  defaultTheme: ThemePreference;
}

interface OptionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AppSettings;
  onSave: (settings: AppSettings) => void;
  theme?: 'dark' | 'light';
  trackCount?: number;
  onScanMusic?: (folderPathOrFiles?: string | File[]) => void;
  onRefreshLibrary?: () => void;
  onResetLibrary?: () => void;
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  defaultMusicPath: '',
  organizeMusicFolders: false,
  crossfadeEnabled: false,
  crossfadeSeconds: 5,
  audioNormalization: false,
  defaultTheme: 'system',
};

export const OptionsModal: React.FC<OptionsModalProps> = ({
  isOpen,
  onClose,
  settings,
  onSave,
  theme = 'dark',
  trackCount = 0,
  onScanMusic,
  onRefreshLibrary,
  onResetLibrary,
}) => {
  const isLight = theme === 'light';
  const [draft, setDraft] = useState<AppSettings>(settings);
  const [showResetConfirm, setShowResetConfirm] = useState<boolean>(false);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const scanFolderInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const initializeSettings = async () => {
      let currentSettings = { ...settings };
      // If no path is set yet, automatically resolve the OS music directory as an absolute path
      if (!currentSettings.defaultMusicPath && isTauri()) {
        try {
          const resolvedAudioDir = await audioDir();
          if (resolvedAudioDir) {
            currentSettings.defaultMusicPath = resolvedAudioDir;
          }
        } catch (error) {
          console.error('Failed to resolve OS music directory:', error);
        }
      }
      if (isOpen) {
        setDraft(currentSettings);
        setShowResetConfirm(false);
      }
    };

    initializeSettings();
  }, [isOpen, settings]);

  if (!isOpen) return null;

  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setDraft(prev => ({ ...prev, [key]: value }));
  };

  const browseForMusicFolder = async () => {
    if (isTauri()) {
      const path = await pickTauriDirectory();
      if (path) update('defaultMusicPath', path);
      return;
    }
    folderInputRef.current?.click();
  };

  const handleBrowserFolder = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []) as (File & { webkitRelativePath?: string })[];
    const first = files.find(file => file.webkitRelativePath);
    if (first?.webkitRelativePath) {
      update('defaultMusicPath', first.webkitRelativePath.split('/')[0]);
    }
    e.target.value = '';
  };

  const handleScanClick = async () => {
    if (isTauri()) {
      const path = await pickTauriDirectory();
      if (path) {
        onSave(draft);
        onClose();
        onScanMusic?.(path);
      } else if (draft.defaultMusicPath) {
        onSave(draft);
        onClose();
        onScanMusic?.(draft.defaultMusicPath);
      }
      return;
    }
    scanFolderInputRef.current?.click();
  };

  const handleScanFolderFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const files = Array.from(e.target.files);
      onSave(draft);
      onClose();
      onScanMusic?.(files);
      e.target.value = '';
    }
  };

  const handleRefreshClick = () => {
    if (!draft.defaultMusicPath && !settings.defaultMusicPath) {
      window.alert('Please set a Default Music Path first to refresh songs.');
      return;
    }
    onSave(draft);
    onClose();
    onRefreshLibrary?.();
  };

  const handleConfirmReset = () => {
    setShowResetConfirm(false);
    onClose();
    onResetLibrary?.();
  };

  const save = () => {
    onSave(draft);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <input
        ref={folderInputRef}
        type="file"
        {...({ webkitdirectory: '', directory: '', multiple: true } as any)}
        onChange={handleBrowserFolder}
        className="hidden"
      />
      <input
        ref={scanFolderInputRef}
        type="file"
        {...({ webkitdirectory: '', directory: '', multiple: true } as any)}
        onChange={handleScanFolderFiles}
        className="hidden"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="options-title"
        className={`w-full max-w-md max-h-[90vh] rounded-xl shadow-2xl border overflow-hidden flex flex-col relative ${isLight
          ? 'bg-[#f6f6f6] border-gray-300 text-gray-800'
          : 'bg-[#1c1c1c] border-[#333] text-gray-200'
          }`}
      >
        <div className={`px-4 py-3 border-b flex items-center justify-between ${isLight ? 'bg-[#ebebeb] border-gray-300' : 'bg-[#242424] border-[#333]'
          }`}>
          <div className="flex items-center gap-2">
            <Settings className={isLight ? 'w-4 h-4 text-blue-600' : 'w-4 h-4 text-cyan-400'} />
            <h2 id="options-title" className="text-sm font-bold">Options</h2>
          </div>
          <button
            onClick={onClose}
            className={`p-1.5 rounded-md ${isLight ? 'hover:bg-black/10' : 'hover:bg-white/10'}`}
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-5 text-xs">
          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className={`text-[11px] font-bold uppercase tracking-wider ${isLight ? 'text-gray-500' : 'text-gray-500'}`}>
                Music Library
              </h3>
              <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${isLight ? 'bg-gray-200 text-gray-700' : 'bg-[#2a2a2a] text-gray-400'}`}>
                {trackCount} {trackCount === 1 ? 'song' : 'songs'} in library
              </span>
            </div>

            <div className={`rounded-lg border p-3 ${isLight ? 'bg-white border-gray-300' : 'bg-[#202020] border-[#333]'}`}>
              <label className="block font-semibold mb-1.5">Default music path</label>
              <div className="flex gap-2">
                <input
                  value={draft.defaultMusicPath}
                  onChange={e => update('defaultMusicPath', e.target.value)}
                  placeholder="Choose a music folder..."
                  title={draft.defaultMusicPath}
                  className={`flex-1 min-w-0 px-2.5 py-2 rounded-md border outline-none text-ellipsis overflow-hidden whitespace-nowrap ${isLight
                    ? 'bg-white border-gray-300 focus:border-blue-500'
                    : 'bg-[#151515] border-[#3a3a3a] focus:border-cyan-500'
                    }`}
                />
                <button
                  onClick={browseForMusicFolder}
                  className={`px-2.5 py-1.5 rounded-md border flex items-center gap-1.5 text-[11px] font-medium shrink-0 ${isLight
                    ? 'bg-gray-100 border-gray-300 hover:bg-gray-200'
                    : 'bg-[#2a2a2a] border-[#444] hover:bg-[#333]'
                    }`}
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                  Browse…
                </button>
              </div>
              <p className={`mt-1.5 text-[10px] ${isLight ? 'text-gray-500' : 'text-gray-500'}`}>
                New imports and library synchronization use this folder as the root music location.
              </p>
            </div>

            {/* Library Actions: Scan, Refresh, Reset */}
            <div className={`mt-3 rounded-lg border p-3 space-y-2.5 ${isLight ? 'bg-white border-gray-300' : 'bg-[#202020] border-[#333]'}`}>
              <span className="block font-semibold text-[11px]">Library Management</span>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={handleScanClick}
                  className={`px-2.5 py-2 rounded-md border flex items-center justify-center gap-2 text-[11px] font-medium transition-colors ${
                    isLight
                      ? 'bg-blue-50 border-blue-200 text-blue-800 hover:bg-blue-100'
                      : 'bg-blue-950/40 border-blue-800/60 text-blue-300 hover:bg-blue-900/50'
                  }`}
                  title="Scan a folder recursively and import all audio tracks"
                >
                  <FolderSearch className="w-3.5 h-3.5 shrink-0 text-blue-500" />
                  <span>Scan for Music…</span>
                </button>

                <button
                  type="button"
                  onClick={handleRefreshClick}
                  className={`px-2.5 py-2 rounded-md border flex items-center justify-center gap-2 text-[11px] font-medium transition-colors ${
                    isLight
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-800 hover:bg-emerald-100'
                      : 'bg-emerald-950/40 border-emerald-800/60 text-emerald-300 hover:bg-emerald-900/50'
                  }`}
                  title="Detect and import only newly added or modified songs from default music path"
                >
                  <RefreshCw className="w-3.5 h-3.5 shrink-0 text-emerald-500" />
                  <span>Refresh Library</span>
                </button>
              </div>

              <p className={`text-[10px] leading-relaxed ${isLight ? 'text-gray-500' : 'text-gray-400'}`}>
                <b>Refresh</b> checks your default music folder for newly added or updated files and syncs them without modifying the rest of your library.
              </p>

              <div className="pt-2 border-t border-dashed border-gray-300 dark:border-[#333] flex justify-between items-center">
                <span className={`text-[10px] ${isLight ? 'text-gray-500' : 'text-gray-400'}`}>
                  Wipe all imported tracks & playlists:
                </span>
                <button
                  type="button"
                  onClick={() => setShowResetConfirm(true)}
                  className={`px-2.5 py-1 rounded-md border flex items-center gap-1.5 text-[11px] font-medium text-red-600 dark:text-red-400 transition-colors ${
                    isLight
                      ? 'bg-red-50 border-red-200 hover:bg-red-100'
                      : 'bg-red-950/30 border-red-800/50 hover:bg-red-900/40'
                  }`}
                >
                  <Trash2 className="w-3 h-3" />
                  Reset Library
                </button>
              </div>
            </div>

            <label className={`mt-2 flex items-start gap-3 p-3 rounded-lg border cursor-pointer ${isLight ? 'bg-white border-gray-300 hover:bg-blue-50' : 'bg-[#202020] border-[#333] hover:bg-white/[0.03]'
              }`}>
              <input
                type="checkbox"
                checked={draft.organizeMusicFolders}
                onChange={e => update('organizeMusicFolders', e.target.checked)}
                className="mt-0.5 accent-blue-600"
              />
              <span>
                <span className="block font-semibold">Organize music folders</span>
                <span className={`block text-[10px] mt-0.5 leading-relaxed ${isLight ? 'text-gray-500' : 'text-gray-400'}`}>
                  When enabled, imported tracks are duplicated into your Default Music Path and organized into nested folders (<b>Artist / Album / Title - Artist</b>).
                </span>
              </span>
            </label>
          </section>

          <section>
            <h3 className="text-[11px] text-gray-500 font-bold uppercase tracking-wider mb-2">Playback</h3>
            <div className={`rounded-lg border p-3 space-y-3 ${isLight ? 'bg-white border-gray-300' : 'bg-[#202020] border-[#333]'}`}>
              <div>
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft.crossfadeEnabled}
                    onChange={e => update('crossfadeEnabled', e.target.checked)}
                    className="accent-blue-600"
                  />
                  <span className="font-semibold">Enable crossfade</span>
                </label>
                <div className={`mt-3 ml-6 flex items-center gap-3 ${!draft.crossfadeEnabled ? 'opacity-45' : ''}`}>
                  <span className="w-20">Duration</span>
                  <input
                    type="range"
                    min="1"
                    max="12"
                    step="1"
                    disabled={!draft.crossfadeEnabled}
                    value={draft.crossfadeSeconds}
                    onChange={e => update('crossfadeSeconds', Number(e.target.value))}
                    className="flex-1 accent-blue-600"
                  />
                  <span className="w-12 text-right font-mono">{draft.crossfadeSeconds}s</span>
                </div>
              </div>

              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={draft.audioNormalization}
                  onChange={e => update('audioNormalization', e.target.checked)}
                  className="accent-blue-600"
                />
                <span>
                  <span className="block font-semibold">Audio normalization</span>
                  <span className={`block text-[10px] mt-0.5 ${isLight ? 'text-gray-500' : 'text-gray-500'}`}>
                    Keep playback levels more consistent between tracks.
                  </span>
                </span>
              </label>
            </div>
          </section>

          <section>
            <h3 className="text-[11px] text-gray-500 font-bold uppercase tracking-wider mb-2">Appearance</h3>
            <div className={`rounded-lg border p-3 ${isLight ? 'bg-white border-gray-300' : 'bg-[#202020] border-[#333]'}`}>
              <label className="block font-semibold mb-2">Default theme</label>
              <div className="grid grid-cols-3 gap-2">
                {(['system', 'dark', 'light'] as ThemePreference[]).map(option => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => update('defaultTheme', option)}
                    className={`px-2.5 py-1.5 rounded-md border capitalize text-[11px] font-medium flex items-center justify-center gap-1.5 ${draft.defaultTheme === option
                      ? isLight
                        ? 'bg-blue-100 border-blue-400 text-blue-800'
                        : 'bg-blue-700 border-blue-600 text-white'
                      : isLight
                        ? 'bg-gray-50 border-gray-300 hover:bg-gray-100'
                        : 'bg-[#181818] border-[#3a3a3a] hover:bg-[#252525]'
                      }`}
                  >
                    {draft.defaultTheme === option && <Check className="w-3 h-3" />}
                    {option}
                  </button>
                ))}
              </div>
            </div>
          </section>
        </div>

        <div className={`px-4 py-3 border-t flex justify-end gap-2 ${isLight ? 'bg-[#ebebeb] border-gray-300' : 'bg-[#242424] border-[#333]'
          }`}>
          <button
            onClick={onClose}
            className={`px-3 py-1.5 rounded-md border text-[11px] font-medium ${isLight ? 'bg-white border-gray-300 hover:bg-gray-100' : 'bg-[#1c1c1c] border-[#444] hover:bg-[#333]'
              }`}
          >
            Cancel
          </button>
          <button
            onClick={save}
            className={`px-3 py-1.5 rounded-md text-[11px] font-medium text-white ${isLight ? 'bg-blue-600 hover:bg-blue-700' : 'bg-blue-700 hover:bg-blue-600'
              }`}
          >
            Save
          </button>
        </div>

        {/* Reset Confirmation Overlay */}
        {showResetConfirm && (
          <div className="absolute inset-0 bg-black/75 backdrop-blur-sm z-20 flex items-center justify-center p-5 animate-in fade-in duration-100">
            <div className={`w-full max-w-xs rounded-xl border p-4 shadow-2xl flex flex-col items-center text-center ${
              isLight ? 'bg-white border-gray-300 text-gray-800' : 'bg-[#222] border-[#444] text-gray-200'
            }`}>
              <div className="w-10 h-10 rounded-full bg-red-500/10 text-red-500 flex items-center justify-center mb-3">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <h4 className="font-bold text-sm mb-1.5">Reset Music Library?</h4>
              <p className={`text-xs leading-relaxed mb-4 ${isLight ? 'text-gray-600' : 'text-gray-400'}`}>
                This will remove all songs, playlists, and indexed audio from ClassiTunes. Physical audio files on disk will <b>not</b> be deleted.
              </p>
              <div className="flex w-full gap-2">
                <button
                  type="button"
                  onClick={() => setShowResetConfirm(false)}
                  className={`flex-1 py-1.5 rounded-md border text-xs font-medium ${
                    isLight ? 'bg-gray-100 hover:bg-gray-200 border-gray-300' : 'bg-[#333] hover:bg-[#3d3d3d] border-[#555]'
                  }`}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmReset}
                  className="flex-1 py-1.5 rounded-md text-xs font-medium bg-red-600 hover:bg-red-700 text-white"
                >
                  Reset
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
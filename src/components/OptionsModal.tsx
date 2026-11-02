import React, { useEffect, useRef, useState } from 'react';
import { 
  X, Settings, FolderOpen, Check, RefreshCw, FolderSearch, Trash2, 
  AlertTriangle, Sliders, HardDrive, Play, Palette, Cpu,
  ArrowDownCircle, CheckCircle2, Loader2, Sparkles, AlertCircle,
  Volume2, Disc
} from 'lucide-react';
import { isTauri, pickTauriDirectory } from '../utils/tauriWindow';
import { audioDir } from '@tauri-apps/api/path';
import { platformInfo } from '../utils/platform';
import { 
  checkForAppUpdate, 
  downloadAndInstallUpdate, 
  UpdateInfo, 
  CURRENT_VERSION 
} from '../services/updaterService';
import {
  ThemePreference,
  TranscodeFormat,
  TranscodeBitrate,
  OptionsTab,
  AppSettings,
  DEFAULT_APP_SETTINGS,
} from '../types';

export type { ThemePreference, TranscodeFormat, TranscodeBitrate, OptionsTab, AppSettings };
export { DEFAULT_APP_SETTINGS };

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
  initialTab?: OptionsTab;
}

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
  initialTab,
}) => {
  const isLight = theme === 'light';
  const isMac = platformInfo.isMacOS;
  const [activeTab, setActiveTab] = useState<OptionsTab>(initialTab || 'general');
  const [draft, setDraft] = useState<AppSettings>(settings);
  const [showResetConfirm, setShowResetConfirm] = useState<boolean>(false);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const scanFolderInputRef = useRef<HTMLInputElement>(null);

  // Software Update State
  const [updateStatus, setUpdateStatus] = useState<'idle' | 'checking' | 'available' | 'latest' | 'downloading' | 'error'>('idle');
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [progressPercent, setProgressPercent] = useState<number>(0);
  const [progressStatusText, setProgressStatusText] = useState<string>('');

  const checkUpdate = async () => {
    setUpdateStatus('checking');
    setUpdateError(null);
    setProgressPercent(0);
    setProgressStatusText('');

    try {
      const info = await checkForAppUpdate();
      setUpdateInfo(info);
      if (info.available) {
        setUpdateStatus('available');
      } else {
        setUpdateStatus('latest');
      }
    } catch (err: any) {
      setUpdateError(err instanceof Error ? err.message : String(err));
      setUpdateStatus('error');
    }
  };

  const handleStartUpdate = async () => {
    setUpdateStatus('downloading');
    setProgressPercent(5);
    setProgressStatusText('Starting download...');

    try {
      await downloadAndInstallUpdate((percent, statusText) => {
        setProgressPercent(percent);
        setProgressStatusText(statusText);
      });
    } catch (err: any) {
      setUpdateError(err instanceof Error ? err.message : String(err));
      setUpdateStatus('error');
    }
  };

  useEffect(() => {
    if (isOpen && initialTab) {
      setActiveTab(initialTab);
    }
  }, [isOpen, initialTab]);

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

  const TABS: { id: OptionsTab; label: string; icon: React.ReactNode }[] = [
    { id: 'general', label: 'General', icon: <Sliders className="w-4 h-4" /> },
    { id: 'playback', label: 'Playback', icon: <Volume2 className="w-4 h-4" /> },
    { id: 'transcode', label: 'Transcode', icon: <Disc className="w-4 h-4" /> },
    { id: 'appearance', label: 'Appearance', icon: <Palette className="w-4 h-4" /> },
    { id: 'updates', label: 'Updates', icon: <ArrowDownCircle className="w-4 h-4" /> },
  ];

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
        className={`w-full max-w-[680px] rounded-xl shadow-2xl border overflow-hidden flex flex-col relative ${isLight
          ? 'bg-[#f6f6f6] border-gray-300 text-gray-800'
          : 'bg-[#1c1c1c] border-[#333] text-gray-200'
          }`}
      >
        {/* Header bar */}
        <div className={`px-4 py-2.5 border-b flex items-center justify-between shrink-0 ${isLight ? 'bg-[#ebebeb] border-gray-300' : 'bg-[#242424] border-[#333]'}`}>
          <div className="flex items-center gap-2">
            {isMac && (
              <button
                type="button"
                onClick={onClose}
                className="w-3 h-3 rounded-full bg-[#ff5f56] border border-[#e0443e] hover:bg-[#ff3b30] flex items-center justify-center group cursor-pointer mr-1 shrink-0 transition-opacity"
                title="Close"
              >
                <X className="w-2 h-2 text-black/70 opacity-0 group-hover:opacity-100" />
              </button>
            )}
            <Settings className={isLight ? 'w-4 h-4 text-blue-600' : 'w-4 h-4 text-cyan-400'} />
            <h2 id="options-title" className="text-sm font-bold">Preferences</h2>
          </div>
          {!isMac && (
            <button
              type="button"
              onClick={onClose}
              className={`p-1.5 rounded-md transition-colors ${isLight ? 'hover:bg-black/10 text-gray-500 hover:text-gray-900' : 'hover:bg-white/10 text-gray-400 hover:text-white'}`}
              title="Close"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* 2-Column Body: Left Sidebar Tabs + Right Content Area */}
        <div className="flex flex-1 min-h-[370px] overflow-hidden">
          {/* Left Tabs Sidebar */}
          <div className={`w-44 shrink-0 p-2.5 border-r flex flex-col gap-1 select-none ${
            isLight
              ? 'bg-[#f0f2f5] border-[#d8dbe0]'
              : 'bg-[#16171a] border-[#2a2b2e]'
          }`}>
            <span className={`px-2.5 pt-1 pb-1.5 text-[10px] font-bold uppercase tracking-wider ${
              isLight ? 'text-gray-500' : 'text-gray-500'
            }`}>
              Settings
            </span>
            {TABS.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs transition-all cursor-pointer text-left ${
                    isActive
                      ? isLight
                        ? 'bg-blue-600 text-white font-semibold shadow-sm'
                        : 'bg-blue-600 text-white font-semibold shadow-sm'
                      : isLight
                      ? 'text-gray-700 hover:text-gray-950 hover:bg-black/5 font-medium'
                      : 'text-gray-400 hover:text-gray-100 hover:bg-white/5 font-medium'
                  }`}
                >
                  <span className={`shrink-0 ${isActive ? 'text-white' : isLight ? 'text-gray-500' : 'text-gray-400'}`}>
                    {tab.icon}
                  </span>
                  <span className="truncate">{tab.label}</span>
                </button>
              );
            })}
          </div>

          {/* Right Content Pane - Fitted without vertical scrolling */}
          <div className="flex-1 min-w-0 p-4 text-xs overflow-hidden flex flex-col justify-start">
          {/* TAB 1: GENERAL */}
          {activeTab === 'general' && (
            <div className="space-y-2.5 animate-in fade-in duration-100">
              <div className="flex items-center justify-between">
                <h3 className={`text-[11px] font-bold uppercase tracking-wider ${isLight ? 'text-gray-500' : 'text-gray-500'}`}>
                  Music Library & Folders
                </h3>
                <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${isLight ? 'bg-gray-200 text-gray-700' : 'bg-[#2a2a2a] text-gray-400'}`}>
                  {trackCount} {trackCount === 1 ? 'song' : 'songs'}
                </span>
              </div>

              <div className={`rounded-lg border p-2.5 ${isLight ? 'bg-white border-gray-300' : 'bg-[#202020] border-[#333]'}`}>
                <label className="block font-semibold mb-1">Default music path</label>
                <div className="flex gap-2">
                  <input
                    value={draft.defaultMusicPath}
                    onChange={e => update('defaultMusicPath', e.target.value)}
                    placeholder="Choose a music folder..."
                    title={draft.defaultMusicPath}
                    className={`flex-1 min-w-0 px-2 py-1.5 rounded-md border outline-none text-ellipsis overflow-hidden whitespace-nowrap text-xs ${isLight
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
                <p className={`mt-1 text-[10px] ${isLight ? 'text-gray-500' : 'text-gray-500'}`}>
                  New imports and library synchronization use this folder as the root music location.
                </p>
              </div>

              {/* Library Actions: Scan, Refresh, Reset */}
              <div className={`rounded-lg border p-2.5 space-y-2 ${isLight ? 'bg-white border-gray-300' : 'bg-[#202020] border-[#333]'}`}>
                <span className="block font-semibold text-[11px]">Library Actions</span>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={handleScanClick}
                    className={`px-2.5 py-1.5 rounded-md border flex items-center justify-center gap-2 text-[11px] font-medium transition-colors ${
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
                    className={`px-2.5 py-1.5 rounded-md border flex items-center justify-center gap-2 text-[11px] font-medium transition-colors ${
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

                <div className="pt-1.5 border-t border-dashed border-gray-300 dark:border-[#333] flex justify-between items-center">
                  <span className={`text-[10px] ${isLight ? 'text-gray-500' : 'text-gray-400'}`}>
                    Clear imported library index:
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

              <label className={`flex items-start gap-2.5 p-2.5 rounded-lg border cursor-pointer ${isLight ? 'bg-white border-gray-300 hover:bg-blue-50' : 'bg-[#202020] border-[#333] hover:bg-white/[0.03]'}`}>
                <input
                  type="checkbox"
                  checked={draft.organizeMusicFolders}
                  onChange={e => update('organizeMusicFolders', e.target.checked)}
                  className="mt-0.5 accent-blue-600"
                />
                <span>
                  <span className="block font-semibold">Keep ClassiTunes Music folder organized</span>
                  <span className={`block text-[10px] mt-0.5 leading-relaxed ${isLight ? 'text-gray-500' : 'text-gray-400'}`}>
                    Automatically place imported audio files into <b>Artist / Album / Track - Title</b> folders inside your Default Music Path.
                  </span>
                </span>
              </label>
            </div>
          )}

          {/* TAB 2: PLAYBACK */}
          {activeTab === 'playback' && (
            <div className="space-y-2.5 animate-in fade-in duration-100">
              <h3 className="text-[11px] text-gray-500 font-bold uppercase tracking-wider">Audio & Playback</h3>
              <div className={`rounded-lg border p-3 space-y-3 ${isLight ? 'bg-white border-gray-300' : 'bg-[#202020] border-[#333]'}`}>
                <div>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={draft.crossfadeEnabled}
                      onChange={e => update('crossfadeEnabled', e.target.checked)}
                      className="accent-blue-600"
                    />
                    <span className="font-semibold text-xs">Crossfade Songs</span>
                  </label>
                  <p className={`text-[10px] ml-6 mt-0.5 ${isLight ? 'text-gray-500' : 'text-gray-400'}`}>
                    Fades out current song while fading in the next song.
                  </p>
                  <div className={`mt-2 ml-6 flex items-center gap-3 ${!draft.crossfadeEnabled ? 'opacity-45 pointer-events-none' : ''}`}>
                    <span className="w-16 text-[11px] text-gray-500 font-medium">Duration</span>
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
                    <span className="w-12 text-right font-mono font-semibold">{draft.crossfadeSeconds}s</span>
                  </div>
                </div>

                <div className={`pt-2.5 border-t ${isLight ? 'border-gray-200' : 'border-[#333]'}`}>
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={draft.audioNormalization}
                      onChange={e => update('audioNormalization', e.target.checked)}
                      className="mt-0.5 accent-blue-600"
                    />
                    <span>
                      <span className="block font-semibold text-xs">Sound Check (Audio Normalization)</span>
                      <span className={`block text-[10px] mt-0.5 leading-relaxed ${isLight ? 'text-gray-500' : 'text-gray-400'}`}>
                        Automatically adjust song playback volume to the same level so track-to-track volume jumps are minimized.
                      </span>
                    </span>
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: TRANSCODING */}
          {activeTab === 'transcode' && (
            <div className="space-y-2.5 animate-in fade-in duration-100">
              <h3 className="text-[11px] text-gray-500 font-bold uppercase tracking-wider">Import & Sync Transcoding</h3>
              <div className={`rounded-lg border p-3 space-y-2.5 ${isLight ? 'bg-white border-gray-300' : 'bg-[#202020] border-[#333]'}`}>
                <div>
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={draft.transcodeOnSync}
                      onChange={e => update('transcodeOnSync', e.target.checked)}
                      className="mt-0.5 accent-blue-600"
                    />
                    <span>
                      <span className="block font-semibold text-xs">Convert higher bit rate songs for device sync</span>
                      <span className={`block text-[10px] mt-0.5 leading-relaxed ${isLight ? 'text-gray-500' : 'text-gray-400'}`}>
                        Transcode tracks down to a lower bit rate or compatible format when syncing to an iPod, MP3 player, or USB drive to save device storage.
                      </span>
                    </span>
                  </label>
                </div>

                {/* Encoder Format & Bitrate Controls */}
                <div className={`space-y-2.5 pt-2 border-t transition-opacity ${isLight ? 'border-gray-200' : 'border-[#2d2d2d]'} ${!draft.transcodeOnSync ? 'opacity-40 pointer-events-none' : ''}`}>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block font-semibold mb-1 text-[11px]">Encoder</label>
                      <select
                        value={draft.transcodeFormat}
                        disabled={!draft.transcodeOnSync}
                        onChange={e => update('transcodeFormat', e.target.value as TranscodeFormat)}
                        className={`w-full px-2.5 py-1.5 rounded-md border outline-none text-[11px] font-medium ${
                          isLight
                            ? 'bg-gray-50 border-gray-300 focus:border-blue-500 text-gray-800'
                            : 'bg-[#151515] border-[#3a3a3a] focus:border-cyan-500 text-gray-200'
                        }`}
                      >
                        <option value="MP3">MP3 Encoder</option>
                        <option value="AAC">AAC / M4A Encoder</option>
                        <option value="WAV">WAV (Lossless PCM)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block font-semibold mb-1 text-[11px]">Target Bit Rate</label>
                      <select
                        value={draft.transcodeBitrate}
                        disabled={!draft.transcodeOnSync || draft.transcodeFormat === 'WAV'}
                        onChange={e => update('transcodeBitrate', e.target.value as TranscodeBitrate)}
                        className={`w-full px-2.5 py-1.5 rounded-md border outline-none text-[11px] font-medium ${
                          isLight
                            ? 'bg-gray-50 border-gray-300 focus:border-blue-500 text-gray-800'
                            : 'bg-[#151515] border-[#3a3a3a] focus:border-cyan-500 text-gray-200'
                        } ${draft.transcodeFormat === 'WAV' ? 'opacity-40 cursor-not-allowed' : ''}`}
                      >
                        <option value="128">128 kbps (Space Saver)</option>
                        <option value="192">192 kbps (Standard)</option>
                        <option value="256">256 kbps (High Quality)</option>
                        <option value="320">320 kbps (Maximum Quality)</option>
                      </select>
                    </div>
                  </div>

                  <div className="space-y-2 pt-0.5">
                    <label className="flex items-center gap-2.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={draft.transcodeDownsample44k}
                        disabled={!draft.transcodeOnSync}
                        onChange={e => update('transcodeDownsample44k', e.target.checked)}
                        className="accent-blue-600"
                      />
                      <span className="text-[11px]">Downsample High-Res Audio to 44.1 kHz (CD Quality)</span>
                    </label>

                    <label className="flex items-center gap-2.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={draft.transcodeDownmixMono}
                        disabled={!draft.transcodeOnSync}
                        onChange={e => update('transcodeDownmixMono', e.target.checked)}
                        className="accent-blue-600"
                      />
                      <span className="text-[11px]">Downmix Stereo to Mono (Audiobooks / Spoken Word)</span>
                    </label>
                  </div>
                </div>
              </div>

              <h3 className="text-[11px] text-gray-500 font-bold uppercase tracking-wider">Device Album Artwork</h3>
              <div className={`rounded-lg border p-3 ${isLight ? 'bg-white border-gray-300' : 'bg-[#202020] border-[#333]'}`}>
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft.scaleArtwork500}
                    onChange={e => update('scaleArtwork500', e.target.checked)}
                    className="mt-0.5 accent-blue-600"
                  />
                  <span>
                    <span className="block font-semibold text-xs">Scale down album cover to 500x500</span>
                    <span className={`block text-[10px] mt-0.5 leading-relaxed ${isLight ? 'text-gray-500' : 'text-gray-400'}`}>
                      Scale down album cover to 500x500 to reduce memory consumption on the device.
                    </span>
                  </span>
                </label>
              </div>
            </div>
          )}

          {/* TAB 4: APPEARANCE */}
          {activeTab === 'appearance' && (
            <div className="space-y-2.5 animate-in fade-in duration-100">
              <h3 className="text-[11px] text-gray-500 font-bold uppercase tracking-wider">Theme & Interface</h3>
              <div className={`rounded-lg border p-3.5 ${isLight ? 'bg-white border-gray-300' : 'bg-[#202020] border-[#333]'}`}>
                <label className="block font-semibold mb-2">Theme Preference</label>
                <div className="grid grid-cols-3 gap-2.5">
                  {(['system', 'dark', 'light'] as ThemePreference[]).map(option => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => update('defaultTheme', option)}
                      className={`px-3 py-2 rounded-md border capitalize text-xs font-medium flex items-center justify-center gap-1.5 transition-all ${draft.defaultTheme === option
                        ? isLight
                          ? 'bg-blue-100 border-blue-400 text-blue-800 shadow-sm font-bold'
                          : 'bg-blue-700 border-blue-600 text-white shadow-sm font-bold'
                        : isLight
                          ? 'bg-gray-50 border-gray-300 hover:bg-gray-100'
                          : 'bg-[#181818] border-[#3a3a3a] hover:bg-[#252525]'
                        }`}
                    >
                      {draft.defaultTheme === option && <Check className="w-3.5 h-3.5" />}
                      {option}
                    </button>
                  ))}
                </div>
                <p className={`mt-2.5 text-[10px] leading-relaxed ${isLight ? 'text-gray-500' : 'text-gray-400'}`}>
                  Select <b>System</b> to follow your operating system appearance, or lock ClassiTunes into Classic Dark or Silver Light mode.
                </p>
              </div>
            </div>
          )}

          {/* TAB 5: UPDATES */}
          {activeTab === 'updates' && (
            <div className="space-y-2.5 animate-in fade-in duration-100">
              <div className="flex items-center justify-between">
                <h3 className={`text-[11px] font-bold uppercase tracking-wider ${isLight ? 'text-gray-500' : 'text-gray-500'}`}>
                  Software Updates
                </h3>
                {updateStatus === 'checking' && (
                  <span className="flex items-center gap-1.5 text-[10px] text-blue-500 font-medium">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Checking...
                  </span>
                )}
              </div>

              {/* Version Comparison Card */}
              <div
                className={`flex items-center justify-between p-3.5 rounded-lg border text-xs ${
                  isLight ? 'bg-white border-slate-200 shadow-sm' : 'bg-[#202020] border-[#333]'
                }`}
              >
                <div>
                  <span className={`block text-[10px] uppercase font-semibold ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                    Installed Version
                  </span>
                  <span className="font-mono font-bold text-sm">
                    v{updateInfo?.currentVersion || CURRENT_VERSION}
                  </span>
                </div>

                <div className="text-right">
                  <span className={`block text-[10px] uppercase font-semibold ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                    Latest Version
                  </span>
                  <span
                    className={`font-mono font-bold text-sm ${
                      updateStatus === 'available'
                        ? 'text-emerald-500 font-extrabold'
                        : ''
                    }`}
                  >
                    {updateStatus === 'checking'
                      ? 'Checking...'
                      : updateInfo?.version
                      ? `v${updateInfo.version}`
                      : updateStatus === 'idle'
                      ? '—'
                      : `v${updateInfo?.currentVersion || CURRENT_VERSION}`}
                  </span>
                </div>
              </div>

              {/* Dynamic Status / Actions Card */}
              <div className={`rounded-lg border p-3 space-y-2.5 ${isLight ? 'bg-white border-slate-200' : 'bg-[#202020] border-[#333]'}`}>
                {updateStatus === 'checking' && (
                  <div className="flex items-center gap-3 text-xs py-1">
                    <Loader2 className="w-4 h-4 animate-spin shrink-0 text-blue-500" />
                    <span>Checking for updates from GitHub releases...</span>
                  </div>
                )}

                {updateStatus === 'latest' && (
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-500 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-xs text-emerald-600 dark:text-emerald-400">ClassiTunes is up to date!</p>
                      <p className={`text-[11px] mt-0.5 ${isLight ? 'text-gray-500' : 'text-gray-400'}`}>
                        You are running the latest version (v{updateInfo?.currentVersion || CURRENT_VERSION}).
                      </p>
                      <div className="mt-2.5">
                        <button
                          type="button"
                          onClick={checkUpdate}
                          className={`px-3 py-1.5 rounded-md border text-xs font-medium flex items-center gap-1.5 transition-colors ${
                            isLight
                              ? 'bg-gray-50 border-gray-300 hover:bg-gray-100 text-gray-700'
                              : 'bg-[#2a2a2a] border-[#444] hover:bg-[#333] text-gray-200'
                          }`}
                        >
                          <RefreshCw className="w-3 h-3" />
                          Check Again
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {updateStatus === 'available' && (
                  <div className="space-y-2.5">
                    <div className="flex items-start gap-2.5">
                      <Sparkles className="w-4 h-4 shrink-0 text-blue-500 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-xs text-blue-600 dark:text-blue-400">
                          New update available: v{updateInfo?.version}
                        </p>
                        {updateInfo?.date && (
                          <p className={`text-[10px] mt-0.5 ${isLight ? 'text-gray-500' : 'text-gray-400'}`}>
                            Released on {updateInfo.date}
                          </p>
                        )}
                      </div>
                    </div>

                    {updateInfo?.body && (
                      <div
                        className={`p-2.5 rounded-md border text-[11px] font-mono whitespace-pre-wrap max-h-24 overflow-y-auto leading-relaxed ${
                          isLight
                            ? 'bg-gray-50 border-gray-200 text-gray-700'
                            : 'bg-black/30 border-white/5 text-gray-300'
                        }`}
                      >
                        {updateInfo.body}
                      </div>
                    )}

                    <div className="pt-0.5 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleStartUpdate}
                        className="px-3.5 py-1.5 rounded-md text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 shadow-sm flex items-center gap-1.5 transition-all"
                      >
                        <ArrowDownCircle className="w-3.5 h-3.5" />
                        Download & Install Update
                      </button>
                      <button
                        type="button"
                        onClick={checkUpdate}
                        className={`px-3 py-1.5 rounded-md border text-xs font-medium transition-colors ${
                          isLight ? 'bg-gray-50 border-gray-300 hover:bg-gray-100 text-gray-700' : 'bg-[#2a2a2a] border-[#444] hover:bg-[#333] text-gray-200'
                        }`}
                      >
                        Refresh
                      </button>
                    </div>
                  </div>
                )}

                {updateStatus === 'downloading' && (
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between text-xs font-semibold">
                      <span className="flex items-center gap-2">
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500" />
                        {progressStatusText || 'Downloading update...'}
                      </span>
                      <span className="font-mono text-blue-500">{progressPercent}%</span>
                    </div>

                    {/* Animated Progress Bar */}
                    <div className={`w-full h-3 rounded-full overflow-hidden border p-0.5 ${
                      isLight ? 'bg-gray-200 border-gray-300' : 'bg-black/40 border-white/10'
                    }`}>
                      <div
                        className="h-full rounded-full transition-all duration-200 bg-gradient-to-r from-blue-500 via-indigo-500 to-blue-600"
                        style={{ width: `${Math.max(5, progressPercent)}%` }}
                      />
                    </div>
                    <p className={`text-[10px] ${isLight ? 'text-gray-500' : 'text-gray-400'}`}>
                      ClassiTunes will automatically restart once the installation finishes.
                    </p>
                  </div>
                )}

                {updateStatus === 'error' && (
                  <div className="space-y-3">
                    <div className="flex items-start gap-2.5 text-xs text-rose-500">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                      <div>
                        <p className="font-semibold">Update check failed</p>
                        <p className={`text-[11px] mt-0.5 ${isLight ? 'text-gray-600' : 'text-gray-400'}`}>
                          {updateError || 'An error occurred while connecting to the update server.'}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={checkUpdate}
                      className={`px-3 py-1.5 rounded-md border text-xs font-medium flex items-center gap-1.5 transition-colors ${
                        isLight ? 'bg-gray-50 border-gray-300 hover:bg-gray-100 text-gray-700' : 'bg-[#2a2a2a] border-[#444] hover:bg-[#333] text-gray-200'
                      }`}
                    >
                      <RefreshCw className="w-3 h-3" />
                      Try Again
                    </button>
                  </div>
                )}

                {updateStatus === 'idle' && (
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-semibold text-xs">Check for new releases</p>
                      <p className={`text-[10px] mt-0.5 ${isLight ? 'text-gray-500' : 'text-gray-400'}`}>
                        Verify if a newer version of ClassiTunes is available.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={checkUpdate}
                      className="px-3.5 py-1.5 rounded-md text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 shadow-sm flex items-center gap-1.5 transition-colors"
                    >
                      <ArrowDownCircle className="w-3.5 h-3.5" />
                      Check for Updates
                    </button>
                  </div>
                )}
              </div>

              <p className={`text-[10px] leading-relaxed px-1 ${isLight ? 'text-gray-500' : 'text-gray-400'}`}>
                ClassiTunes automatically connects to the official release channels to deliver critical bug fixes, performance improvements, and format compatibility updates.
              </p>
            </div>
          )}
          </div>
        </div>

        {/* Footer controls */}
        <div className={`px-4 py-3 border-t flex justify-end gap-2 ${isLight ? 'bg-[#ebebeb] border-gray-300' : 'bg-[#242424] border-[#333]'}`}>
          <button
            onClick={onClose}
            className={`px-4 py-1.5 rounded-md border text-[11px] font-medium ${isLight ? 'bg-white border-gray-300 hover:bg-gray-100' : 'bg-[#1c1c1c] border-[#444] hover:bg-[#333]'}`}
          >
            Cancel
          </button>
          <button
            onClick={save}
            className={`px-5 py-1.5 rounded-md text-[11px] font-medium text-white shadow-sm transition-all ${isLight ? 'bg-blue-600 hover:bg-blue-700' : 'bg-blue-700 hover:bg-blue-600'}`}
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
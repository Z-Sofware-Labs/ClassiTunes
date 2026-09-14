import React, { useState, useEffect } from 'react';
import { Track } from '../types';
import { Sliders, Maximize2, Disc, Shuffle, Repeat, Repeat1, Sun, Moon, FileText, Info, Settings, ArrowDownCircle, Check, Loader2, AlertCircle } from 'lucide-react';
import { openLogDirectory } from '../utils/tauriWindow';
import { startAutomaticUpdate, UpdateState, CURRENT_VERSION } from '../services/updaterService';

interface StatusBarProps {
  tracks: Track[];
  currentTrack: Track | null;
  onOpenEQ: () => void;
  onOpenVisualizer: () => void;
  onOpenAbout: () => void;
  onOpenOptions: () => void;
  isShuffle: boolean;
  onToggleShuffle: () => void;
  repeatMode: 'off' | 'all' | 'one';
  onToggleRepeat: () => void;
  theme?: 'dark' | 'light';
  onToggleTheme?: () => void;
}

export const StatusBar: React.FC<StatusBarProps> = ({
  tracks,
  currentTrack,
  onOpenEQ,
  onOpenVisualizer,
  onOpenAbout,
  onOpenOptions,
  isShuffle,
  onToggleShuffle,
  repeatMode,
  onToggleRepeat,
  theme = 'dark',
  onToggleTheme,
}) => {
  const [showCoverPreview, setShowCoverPreview] = useState(false);
  const [updateState, setUpdateState] = useState<UpdateState>({
    status: 'idle',
    progress: 0,
    info: null,
  });
  const [showUpdateToast, setShowUpdateToast] = useState(false);

  const isLight = theme === 'light';

  const totalCount = tracks.length;
  const totalSeconds = tracks.reduce((acc, t) => acc + (t.duration || 0), 0);
  const totalMinutes = (totalSeconds / 60).toFixed(1);
  const totalMB = (tracks.reduce((acc, t) => acc + (t.sizeBytes || 4000000), 0) / (1024 * 1024)).toFixed(1);

  // Auto dismiss toast after 4.5 seconds if finished or up-to-date
  useEffect(() => {
    if (updateState.status === 'up-to-date' || updateState.status === 'ready' || updateState.status === 'error') {
      const timer = setTimeout(() => {
        setShowUpdateToast(false);
      }, 4500);
      return () => clearTimeout(timer);
    }
  }, [updateState.status]);

  const handleTriggerUpdate = async () => {
    if (updateState.status === 'checking' || updateState.status === 'downloading' || updateState.status === 'installing') {
      return; // Already in progress
    }
    setShowUpdateToast(true);
    await startAutomaticUpdate((state) => {
      setUpdateState(state);
      setShowUpdateToast(true);
    });
  };

  const isUpdating = updateState.status === 'checking' || updateState.status === 'downloading' || updateState.status === 'installing';

  return (
    <footer className={`relative select-none border-t px-3 py-1 text-[11px] font-sans flex items-center justify-between z-20 shrink-0 transition-colors duration-200 ${isLight
        ? 'bg-[#e2e8f0] border-[#cbd5e1] text-gray-700'
        : 'bg-[#161616] border-black text-gray-400'
      }`}>
      {/* Left: Active Album Thumbnail */}
      <div className="flex items-center gap-2 min-w-[180px]">
        {currentTrack ? (
          <div className="relative group">
            <img
              src={currentTrack.coverUrl}
              alt=""
              onClick={() => setShowCoverPreview(!showCoverPreview)}
              className={`w-5 h-5 rounded object-cover border shadow-sm cursor-pointer hover:opacity-90 ${isLight ? 'border-gray-400' : 'border-white/20'
                }`}
            />
            {/* Popover Preview */}
            {showCoverPreview && (
              <div className={`absolute left-0 bottom-7 p-2 rounded-lg border shadow-2xl z-50 animate-in zoom-in-95 duration-150 ${isLight ? 'bg-white border-gray-300 text-gray-800' : 'bg-[#1e1e1e] border-[#333] text-white'
                }`}>
                <img
                  src={currentTrack.coverUrl}
                  alt=""
                  className="w-44 h-44 rounded object-cover border border-black/10"
                />
                <div className={`mt-2 font-mono text-[10px] text-center ${isLight ? 'text-gray-900' : 'text-white'}`}>
                  <p className="font-bold truncate">{currentTrack.title}</p>
                  <p className={`truncate ${isLight ? 'text-gray-500' : 'text-gray-400'}`}>{currentTrack.artist}</p>
                </div>
              </div>
            )}
          </div>
        ) : (
          <Disc className={`w-4 h-4 ${isLight ? 'text-gray-400' : 'text-gray-600'}`} />
        )}
        <span className={`truncate text-[10px] font-medium ${isLight ? 'text-gray-600' : 'text-gray-400'}`}>
          {currentTrack ? `${currentTrack.artist} — ${currentTrack.album}` : 'No track selected'}
        </span>
      </div>

      {/* Center Summary */}
      <div className={`font-mono text-[11px] font-semibold text-center ${isLight ? 'text-gray-800' : 'text-gray-300'}`}>
        {totalCount} {totalCount === 1 ? 'item' : 'items'}, {totalMinutes} minutes, {totalMB} MB
      </div>

      {/* Right Quick Toggles */}
      <div className="flex items-center gap-1.5 min-w-[180px] justify-end relative">
        {/* On-Demand Auto Updater Button */}
        <div className="relative">
          <button
            onClick={handleTriggerUpdate}
            disabled={isUpdating}
            className={`p-1 rounded transition-all flex items-center justify-center relative ${
              isUpdating
                ? isLight ? 'bg-blue-100 text-blue-600 animate-pulse' : 'bg-blue-500/20 text-blue-400 animate-pulse'
                : updateState.status === 'up-to-date'
                ? isLight ? 'text-emerald-600 hover:bg-black/10' : 'text-emerald-400 hover:bg-white/10'
                : isLight ? 'hover:bg-black/10 text-gray-700 hover:text-blue-600' : 'hover:bg-white/10 text-gray-400 hover:text-white'
            }`}
            title={
              isUpdating
                ? (updateState.message || 'Updating ClassiTunes...')
                : updateState.status === 'up-to-date'
                ? `ClassiTunes is up to date (v${CURRENT_VERSION})`
                : 'Check for Updates'
            }
            aria-label="Check for Updates"
          >
            {isUpdating ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : updateState.status === 'up-to-date' ? (
              <Check className="w-3.5 h-3.5" />
            ) : (
              <ArrowDownCircle className="w-3.5 h-3.5" />
            )}
          </button>

          {/* Automatic Update Status Floating Toast / Popover */}
          {showUpdateToast && (
            <div
              className={`absolute right-0 bottom-7 w-64 p-3 rounded-lg border shadow-2xl z-50 animate-in fade-in zoom-in-95 duration-150 ${
                isLight ? 'bg-white border-gray-300 text-gray-800 shadow-slate-900/20' : 'bg-[#1e1e1e] border-[#383838] text-gray-100 shadow-black/80'
              }`}
            >
              <div className="flex items-start justify-between gap-2 mb-1.5">
                <div className="flex items-center gap-1.5">
                  {isUpdating ? (
                    <Loader2 className="w-4 h-4 text-blue-500 animate-spin shrink-0" />
                  ) : updateState.status === 'up-to-date' || updateState.status === 'ready' ? (
                    <Check className="w-4 h-4 text-emerald-500 shrink-0" />
                  ) : updateState.status === 'error' ? (
                    <AlertCircle className="w-4 h-4 text-rose-500 shrink-0" />
                  ) : (
                    <ArrowDownCircle className="w-4 h-4 text-blue-500 shrink-0" />
                  )}
                  <span className="font-semibold text-[11px] leading-tight">
                    {updateState.status === 'checking' && 'Checking for Updates…'}
                    {updateState.status === 'downloading' && 'Downloading Update…'}
                    {updateState.status === 'installing' && 'Installing Update…'}
                    {updateState.status === 'ready' && 'Update Ready'}
                    {updateState.status === 'up-to-date' && 'Up to Date'}
                    {updateState.status === 'error' && 'Update Check Failed'}
                    {updateState.status === 'idle' && 'Software Update'}
                  </span>
                </div>
                <button
                  onClick={() => setShowUpdateToast(false)}
                  className={`text-[10px] px-1 py-0.5 rounded transition-colors ${
                    isLight ? 'text-gray-400 hover:text-gray-700 hover:bg-gray-100' : 'text-gray-500 hover:text-gray-300 hover:bg-white/10'
                  }`}
                  title="Dismiss"
                >
                  ✕
                </button>
              </div>

              <p className={`text-[10px] leading-relaxed mb-2 ${isLight ? 'text-gray-600' : 'text-gray-400'}`}>
                {updateState.message || `Current version: v${CURRENT_VERSION}`}
              </p>

              {/* Progress bar when checking or downloading */}
              {isUpdating && (
                <div className="w-full bg-black/10 dark:bg-white/10 rounded-full h-1.5 overflow-hidden mb-1">
                  <div
                    className="bg-blue-600 dark:bg-blue-500 h-1.5 rounded-full transition-all duration-300 ease-out"
                    style={{ width: `${Math.max(8, updateState.progress)}%` }}
                  />
                </div>
              )}

              {updateState.status === 'ready' && updateState.info?.downloadUrl && (
                <a
                  href={updateState.info.downloadUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 block text-center py-1 px-2 rounded bg-blue-600 hover:bg-blue-500 text-white font-medium text-[10px] transition-colors"
                >
                  Open Download / Installer
                </a>
              )}
            </div>
          )}
        </div>

        {/* Options Button */}
        <button
          onClick={onOpenOptions}
          className={`p-1 rounded transition-all ${isLight ? 'hover:bg-black/10 text-gray-700 hover:text-blue-600' : 'hover:bg-white/10 text-gray-400 hover:text-white'
            }`}
          title="Options"
          aria-label="Options"
        >
          <Settings className="w-3.5 h-3.5" />
        </button>

        {/* About ClassiTunes Button */}
        <button
          onClick={onOpenAbout}
          className={`p-1 rounded transition-all ${isLight ? 'hover:bg-black/10 text-gray-700 hover:text-blue-600' : 'hover:bg-white/10 text-gray-400 hover:text-white'
            }`}
          title="About ClassiTunes"
        >
          <Info className="w-3.5 h-3.5" />
        </button>

        {/* Tauri Scan Logs */}
        <button
          onClick={async () => {
            await openLogDirectory();
          }}
          className={`p-1 rounded transition-all ${isLight ? 'hover:bg-black/10 text-orange-600' : 'hover:bg-white/10 text-orange-400 hover:text-orange-300'
            }`}
          title="Open Log Directory"
        >
          <FileText className="w-3.5 h-3.5" />
        </button>
        <div className={`w-[1px] h-3 mx-0.5 ${isLight ? 'bg-gray-300' : 'bg-white/10'}`} />

        {/* Shuffle Button */}
        <button
          onClick={onToggleShuffle}
          className={`p-1 rounded transition-all ${isShuffle
              ? isLight ? 'bg-blue-100 text-blue-600' : 'bg-blue-500/20 text-blue-400'
              : isLight ? 'hover:bg-black/10 text-gray-700' : 'hover:bg-white/10 text-gray-300 hover:text-white'
            }`}
          title="Shuffle"
        >
          <Shuffle className="w-3.5 h-3.5" />
        </button>

        {/* Repeat Button */}
        <button
          onClick={onToggleRepeat}
          className={`p-1 rounded transition-all ${repeatMode !== 'off'
              ? isLight ? 'bg-blue-100 text-blue-600' : 'bg-blue-500/20 text-blue-400'
              : isLight ? 'hover:bg-black/10 text-gray-700' : 'hover:bg-white/10 text-gray-300 hover:text-white'
            }`}
          title={`Repeat: ${repeatMode}`}
        >
          {repeatMode === 'one' ? <Repeat1 className="w-3.5 h-3.5" /> : <Repeat className="w-3.5 h-3.5" />}
        </button>

        {/* Theme Toggle Button (Light/Dark Mode) */}
        {onToggleTheme && (
          <button
            onClick={onToggleTheme}
            className={`p-1 rounded transition-all ${isLight ? 'hover:bg-black/10 text-gray-700' : 'hover:bg-white/10 text-gray-300 hover:text-white'
              }`}
            title={isLight ? "Switch to Dark Mode" : "Switch to Light Mode"}
          >
            {isLight ? <Moon className="w-3.5 h-3.5" /> : <Sun className="w-3.5 h-3.5 text-amber-400" />}
          </button>
        )}

        {/* 10-Band Equalizer Button */}
        <button
          onClick={onOpenEQ}
          className={`p-1 rounded transition-colors ${isLight ? 'hover:bg-black/10 text-gray-700' : 'hover:bg-white/10 text-gray-300 hover:text-white'
            }`}
          title="10-Band Equalizer"
        >
          <Sliders className="w-3.5 h-3.5" />
        </button>

        {/* Fullscreen Visualizer Button */}
        <button
          onClick={onOpenVisualizer}
          className={`p-1 rounded transition-colors ${isLight ? 'hover:bg-black/10 text-gray-700' : 'hover:bg-white/10 text-gray-300 hover:text-white'
            }`}
          title="Fullscreen Visualizer"
        >
          <Maximize2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </footer>
  );
};

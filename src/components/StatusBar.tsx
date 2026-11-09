import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Track } from '../types';
import { Sliders, Maximize2, Disc, Shuffle, Repeat, Repeat1, FileText, Info, Settings, Gauge } from 'lucide-react';
import { openLogDirectory } from '../utils/tauriWindow';
import { audioEngine } from '../services/audioEngine';

interface StatusBarProps {
  tracks: Track[];
  currentTrack: Track | null;
  onOpenEQ: () => void;
  onOpenVisualizer: () => void;
  onOpenAbout: () => void;
  onOpenOptions: () => void;
  onOpenUpdate?: () => void;
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
}) => {
  const [showCoverPreview, setShowCoverPreview] = useState(false);
  const [showSpeedPopover, setShowSpeedPopover] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(() => audioEngine.getPlaybackRate());
  const speedPopoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showSpeedPopover) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (speedPopoverRef.current && !speedPopoverRef.current.contains(e.target as Node)) {
        setShowSpeedPopover(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowSpeedPopover(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [showSpeedPopover]);

  const isLight = theme === 'light';

  const { totalCount, totalMinutes, totalMB } = useMemo(() => {
    const count = tracks.length;
    let sec = 0;
    let bytes = 0;
    for (let i = 0; i < count; i++) {
      const t = tracks[i];
      sec += t.duration || 0;
      bytes += t.sizeBytes || 4000000;
    }
    return {
      totalCount: count,
      totalMinutes: (sec / 60).toFixed(1),
      totalMB: (bytes / (1024 * 1024)).toFixed(1),
    };
  }, [tracks]);

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

        {/* Playback Speed Button & Popover */}
        <div className="relative" ref={speedPopoverRef}>
          <button
            onClick={() => setShowSpeedPopover(!showSpeedPopover)}
            className={`p-1 rounded transition-all flex items-center gap-1 ${
              showSpeedPopover || playbackSpeed !== 1.0
                ? isLight ? 'bg-blue-100 text-blue-600 font-bold' : 'bg-blue-500/20 text-blue-400 font-bold'
                : isLight ? 'hover:bg-black/10 text-gray-700 hover:text-blue-600' : 'hover:bg-white/10 text-gray-400 hover:text-white'
            }`}
            title={`Playback speed (${playbackSpeed.toFixed(2)}x)`}
            aria-label="Playback speed"
          >
            <Gauge className="w-3.5 h-3.5" />
          </button>

          {/* Speed Control Popover */}
          {showSpeedPopover && (
            <div
              className={`absolute right-0 bottom-7 p-3 rounded-xl border shadow-2xl z-50 w-48 animate-in zoom-in-95 duration-150 select-none ${
                isLight ? 'bg-white border-gray-300 text-gray-800' : 'bg-[#1e1e1e] border-[#333] text-white'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="font-semibold text-xs flex items-center gap-1.5">
                  <Gauge className="w-3.5 h-3.5 text-blue-500" />
                  Playback Speed
                </span>
                <span className={`font-mono text-xs font-bold px-1.5 py-0.5 rounded ${
                  isLight ? 'bg-blue-50 text-blue-600 border border-blue-200' : 'bg-blue-950/40 text-blue-400 border border-blue-800/40'
                }`}>
                  {playbackSpeed.toFixed(2)}x
                </span>
              </div>

              {/* Slider */}
              <input
                type="range"
                min="0.5"
                max="2.0"
                step="0.01"
                value={playbackSpeed}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setPlaybackSpeed(val);
                  audioEngine.setPlaybackRate(val);
                }}
                onDoubleClick={() => {
                  setPlaybackSpeed(1.0);
                  audioEngine.setPlaybackRate(1.0);
                }}
                title="Double-click to reset to 1.00x"
                className="w-full accent-blue-500 cursor-pointer h-1.5 rounded-lg bg-gray-200 dark:bg-gray-700 my-1"
              />

              <div className="flex justify-between text-[10px] text-gray-400 mt-1 font-mono">
                <span>0.50x</span>
                <span>2.00x</span>
              </div>
            </div>
          )}
        </div>

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

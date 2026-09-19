import React, { useState, useEffect } from 'react';
import {
  Play, Pause, SkipBack, SkipForward, Volume2, VolumeX,
  Search, List, LayoutGrid, Sliders, Shuffle, Repeat, Repeat1, Star,
  Sun, Moon, Minus, Square, X, Disc
} from 'lucide-react';
import { Track, ViewMode } from '../types';
import { audioEngine } from '../services/audioEngine';
import { tauriMinimize, tauriMaximize, tauriClose } from '../utils/tauriWindow';
import { MarqueeText } from './MarqueeText';

interface HeaderBarProps {
  currentTrack: Track | null;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onNextTrack: () => void;
  onPrevTrack: () => void;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  isShuffle: boolean;
  onToggleShuffle: () => void;
  repeatMode: 'off' | 'all' | 'one';
  onToggleRepeat: () => void;
  onOpenEQ: () => void;
  onOpenVisualizer: () => void;
  onUpdateRating: (trackId: string, rating: number) => void;
  theme?: 'dark' | 'light';
  onToggleTheme?: () => void;
}

export const HeaderBar: React.FC<HeaderBarProps> = ({
  currentTrack,
  isPlaying,
  onTogglePlay,
  onNextTrack,
  onPrevTrack,
  viewMode,
  onViewModeChange,
  searchQuery,
  onSearchChange,
  isShuffle,
  onToggleShuffle,
  repeatMode,
  onToggleRepeat,
  onOpenEQ,
  onOpenVisualizer,
  onUpdateRating,
  theme = 'dark',
  onToggleTheme,
}) => {
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.8);
  const [isMuted, setIsMuted] = useState(false);
  const [isDraggingSeek, setIsDraggingSeek] = useState(false);
  const [seekVal, setSeekVal] = useState(0);

  const isLight = theme === 'light';

  useEffect(() => {
    const unsubTime = audioEngine.onTimeUpdate(() => {
      if (!isDraggingSeek) {
        setCurrentTime(audioEngine.getCurrentTime());
      }
    });

    const unsubMeta = audioEngine.onLoadedMetadata(() => {
      const d = audioEngine.getDuration();
      if (d && isFinite(d) && d > 0) {
        setDuration(d);
      }
    });

    return () => {
      unsubTime();
      unsubMeta();
    };
  }, [isDraggingSeek]);

  useEffect(() => {
    if (currentTrack) {
      // Immediately reset position to 0 to prevent the previous song's time offset
      // from temporarily rendering against the new song's duration.
      setCurrentTime(0);
      setSeekVal(0);
      setIsDraggingSeek(false);
      const engDur = audioEngine.getDuration();
      setDuration(engDur && isFinite(engDur) && engDur > 0 ? engDur : (currentTrack.duration || 0));
    } else {
      setCurrentTime(0);
      setDuration(0);
      setSeekVal(0);
      setIsDraggingSeek(false);
    }
  }, [currentTrack?.id]);

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value);
    setVolume(v);
    setIsMuted(v === 0);
    audioEngine.setVolume(v);
  };

  const toggleMute = () => {
    if (isMuted) {
      setIsMuted(false);
      audioEngine.setVolume(volume || 0.8);
    } else {
      setIsMuted(true);
      audioEngine.setVolume(0);
    }
  };

  const handleSeekChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSeekVal(parseFloat(e.target.value));
  };

  const handleSeekMouseDown = () => {
    setIsDraggingSeek(true);
  };

  const handleSeekMouseUp = () => {
    setIsDraggingSeek(false);
    audioEngine.seek(seekVal);
    setCurrentTime(seekVal);
  };

  const formatTime = (secs: number) => {
    if (isNaN(secs) || secs < 0) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const activeDuration = duration || currentTrack?.duration || 0;
  const remainingTime = Math.max(0, activeDuration - (isDraggingSeek ? seekVal : currentTime));
  const progressPercent = activeDuration > 0 ? ((isDraggingSeek ? seekVal : currentTime) / activeDuration) * 100 : 0;

  const isMac = typeof window !== 'undefined' && (/Mac|iPod|iPhone|iPad/i.test(navigator.platform) || /Mac OS X/i.test(navigator.userAgent) || (window as any).electronAPI?.platform === 'darwin');
  const isLinux = typeof window !== 'undefined' && (/Linux/i.test(navigator.platform) || /Linux/i.test(navigator.userAgent) || (window as any).electronAPI?.platform === 'linux');
  const isAppWindow = typeof window !== 'undefined' && (
    !!(window as any).__TAURI__ ||
    !!(window as any).__TAURI_INTERNALS__ ||
    !!(window as any).__TAURI_METADATA__ ||
    !!(window as any).electronAPI
  );

  const handleMinimize = async () => {
    await tauriMinimize();
  };

  const handleMaximize = async () => {
    const handled = await tauriMaximize();
    if (!handled) {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => { });
      } else {
        document.exitFullscreen().catch(() => { });
      }
    }
  };

  const handleClose = async () => {
    const handled = await tauriClose();
    if (!handled) {
      if (confirm('Close ClassiTunes?')) {
        window.close();
      }
    }
  };

  return (
    <header className={`relative select-none z-30 transition-colors duration-200 ${isLight
      ? 'bg-gradient-to-b from-[#e8edf5] via-[#cbd5e2] to-[#b0bed4] border-b border-[#707f96] shadow-md text-gray-950 font-medium'
      : 'bg-[#212121] border-b border-black shadow-md text-gray-100'
      }`}>
      {/* Top Titlebar Strip (Frameless Window Drag Region & Title) - Hidden on Linux for pure native KDE/system window titlebar */}
      {!isLinux && (
        <>
          <div
            data-tauri-drag-region
            className={`w-full px-3 py-1 flex items-center justify-between text-xs border-b ${isLight
              ? 'bg-[#2b2b2b] border-black text-white font-bold'
              : 'bg-[#181818] border-[#2a2a2a] text-gray-300'
              }`}
            style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
          >
            {/* Left: Stoplight Window Controls & App Branding */}
            <div className="flex items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
              {isMac && isAppWindow && (
                <div className="flex items-center gap-1.5 mr-1">
                  <button
                    type="button"
                    onClick={handleClose}
                    className="w-3 h-3 rounded-full bg-[#ff5f56] border border-[#e0443e] hover:bg-[#ff3b30] flex items-center justify-center group cursor-pointer"
                    title="Close"
                    id="titlebar-close-btn"
                  >
                    <X className="w-2 h-2 text-black/70 opacity-0 group-hover:opacity-100" />
                  </button>
                  <button
                    type="button"
                    onClick={handleMinimize}
                    className="w-3 h-3 rounded-full bg-[#ffbd2e] border border-[#dea123] hover:bg-[#ffcc00] flex items-center justify-center group cursor-pointer"
                    title="Minimize"
                    id="titlebar-minimize-btn"
                  >
                    <Minus className="w-2 h-2 text-black/70 opacity-0 group-hover:opacity-100" />
                  </button>
                  <button
                    type="button"
                    onClick={handleMaximize}
                    className="w-3 h-3 rounded-full bg-[#27c93f] border border-[#1aab29] hover:bg-[#34c759] flex items-center justify-center group cursor-pointer"
                    title="Maximize / Zoom"
                    id="titlebar-maximize-btn"
                  >
                    <Square className="w-1.5 h-1.5 text-black/70 opacity-0 group-hover:opacity-100" />
                  </button>
                </div>
              )}
              <div className="flex items-center gap-1.5 font-bold tracking-tight text-[11px] text-white dark:text-gray-100">
                <Disc className="w-4 h-4 text-cyan-400 dark:text-cyan-400" />
                <span>ClassiTunes</span>
              </div>
            </div>

            {/* Center: Blank Spacer */}
            <div className="flex-1" />

            {/* Right: Windows-style controls fallback */}
            {!isMac && isAppWindow && (
              <div className="flex items-center gap-1" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
                <button
                  type="button"
                  onClick={handleMinimize}
                  className={`p-1 rounded hover:bg-white/10 dark:hover:bg-white/10 ${isLight ? 'text-white font-bold' : 'text-gray-400'}`}
                  title="Minimize"
                >
                  <Minus className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  onClick={handleMaximize}
                  className={`p-1 rounded hover:bg-white/10 dark:hover:bg-white/10 ${isLight ? 'text-white font-bold' : 'text-gray-400'}`}
                  title="Maximize"
                >
                  <Square className="w-2.5 h-2.5" />
                </button>
                <button
                  type="button"
                  onClick={handleClose}
                  className={`p-1 rounded hover:bg-red-500 hover:text-white ${isLight ? 'text-white font-bold' : 'text-gray-400'}`}
                  title="Close"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>

          {/* Top Brushed Highlight line */}
          <div className={`h-[1px] w-full ${isLight ? 'bg-white/80' : 'bg-white/10'}`} />
        </>
      )}

      <div
        className="px-3 py-2 grid grid-cols-[auto_1fr_auto] md:grid-cols-[1fr_auto_1fr] items-center gap-2 sm:gap-3 w-full"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {/* Left Section: Transport & Playback Controls (Equal Width Column) */}
        <div className="flex items-center justify-start gap-2 sm:gap-3 min-w-0">
          {/* Transport Buttons */}
          <div className={`flex items-center p-1 rounded-full border shadow-inner shrink-0 ${isLight
            ? 'bg-gradient-to-b from-white to-[#d6dc8f/20] bg-white/60 border-[#9fa8b8]'
            : 'bg-[#1a1a1a] border-[#333]'
            }`}>
            <button
              onClick={onPrevTrack}
              className={`p-1.5 rounded-full transition-colors ${isLight
                ? 'hover:bg-black/10 active:bg-black/20 text-gray-700 hover:text-black'
                : 'hover:bg-white/10 active:bg-white/20 text-gray-300 hover:text-white'
                }`}
              title="Previous Track"
              id="prev-track-btn"
            >
              <SkipBack className="w-4 h-4 fill-current" />
            </button>
            <button
              onClick={onTogglePlay}
              className={`p-2 mx-0.5 rounded-full shadow-lg transition-all ${isLight
                ? 'bg-gradient-to-b from-[#3b82f6] to-[#1d4ed8] text-white border border-[#1d4ed8] hover:from-[#4087fa] hover:to-[#2255e0]'
                : 'bg-[#2a2a2a] hover:bg-[#383838] active:bg-[#444] text-white border border-[#444]'
                }`}
              title={isPlaying ? 'Pause' : 'Play'}
              id="play-pause-btn"
            >
              {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
            </button>
            <button
              onClick={onNextTrack}
              className={`p-1.5 rounded-full transition-colors ${isLight
                ? 'hover:bg-black/10 active:bg-black/20 text-gray-700 hover:text-black'
                : 'hover:bg-white/10 active:bg-white/20 text-gray-300 hover:text-white'
                }`}
              title="Next Track"
              id="next-track-btn"
            >
              <SkipForward className="w-4 h-4 fill-current" />
            </button>
          </div>

          {/* Volume Control */}
          <div className="flex items-center gap-1 ml-0.5 shrink-0">
            <button onClick={toggleMute} className={isLight ? 'text-gray-600 hover:text-black' : 'text-gray-400 hover:text-white'}>
              {isMuted || volume === 0 ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
            </button>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={isMuted ? 0 : volume}
              onChange={handleVolumeChange}
              className={`w-12 sm:w-16 h-1 rounded-lg appearance-none cursor-pointer ${isLight ? 'bg-[#adb8c8] accent-blue-600' : 'bg-[#333] accent-indigo-500'
                }`}
              title="Volume"
              id="volume-slider"
            />
          </div>
        </div>

        {/* Center Section: LCD Display (True Dead Center) */}
        <div className="flex items-center justify-center w-full min-w-0 sm:min-w-[340px] md:min-w-[440px] lg:min-w-[512px] max-w-[640px] mx-auto">
          <div className={`relative border rounded-md px-2.5 py-0.5 text-center overflow-hidden transition-colors w-full ${isLight
            ? 'bg-gradient-to-b from-white via-[#f0f4fa] to-[#dbe5f2] border-[#8a97a8] shadow-[inset_0_1px_3px_rgba(0,0,0,0.15)] text-gray-900'
            : 'bg-gradient-to-b from-[#2a2a2a] to-[#1a1a1a] border-[#333] shadow-[inset_0_1px_3px_rgba(0,0,0,0.5)] text-gray-100'
            }`}>
            {/* Gloss reflection overlay */}
            <div className={`absolute top-0 left-0 right-0 h-1/2 pointer-events-none ${isLight ? 'bg-gradient-to-b from-white/60 to-transparent' : 'bg-gradient-to-b from-white/5 to-transparent'
              }`} />

            {currentTrack ? (
              <div className="flex flex-col items-center relative w-full">
                {/* Row 1: Title (matches song list Title column: 11px font-medium) */}
                <div className="w-full text-center px-4 leading-none pb-[1px]">
                  <MarqueeText
                    text={currentTrack.title}
                    className={`text-[11px] font-medium tracking-normal block leading-none ${isLight ? 'text-gray-900 drop-shadow-[0_1px_0_rgba(255,255,255,0.7)]' : 'text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]'}`}
                  />
                </div>

                {/* Row 2: Artist — Album with Marquee support for long text (11px font-normal) */}
                <div className="w-full text-center px-4 leading-none pb-[1px]">
                  <MarqueeText
                    text={`${currentTrack.artist}${currentTrack.album ? ` — ${currentTrack.album}` : ''}`}
                    className={`text-[11px] font-normal tracking-normal block leading-none ${isLight ? 'text-gray-700' : 'text-gray-300'}`}
                  />
                </div>

                {/* Row 3: LCD Scrubber & Times (typeface matches 2nd row: system sans, 12px font-normal, tabular-nums, normal spacing) */}
                <div className="w-full flex items-center gap-1.5 mt-0.5 px-1">
                  <span
                    className={`text-[10px] tabular-nums font-normal tracking-normal min-w-[34px] text-left leading-none ${isLight ? 'text-gray-600' : 'text-gray-400'}`}
                  >
                    {formatTime(isDraggingSeek ? seekVal : currentTime)}
                  </span>
                  <div className="relative flex-1 flex items-center h-3">
                    {/* Flat Recessed Track Background */}
                    <div
                      className={`absolute left-0 right-0 h-[3px] pointer-events-none rounded-[1px] ${isLight
                        ? 'bg-[#c5cfe0] border-t border-[#a0abbd]'
                        : 'bg-[#151515] border-t border-[#0a0a0a] border-b border-[#262626]'
                        }`}
                    >
                      {/* Flat Progress Bar Fill */}
                      <div
                        className={`h-full pointer-events-none ${isLight
                          ? 'bg-[#43628e]'
                          : 'bg-[#5b7294]'
                          }`}
                        style={{ width: `${Math.min(100, Math.max(0, progressPercent))}%` }}
                      />
                    </div>

                    <input
                      type="range"
                      min="0"
                      max={activeDuration || 100}
                      step="0.1"
                      value={isDraggingSeek ? seekVal : currentTime}
                      onChange={handleSeekChange}
                      onMouseDown={handleSeekMouseDown}
                      onMouseUp={handleSeekMouseUp}
                      className="w-full h-full cursor-pointer z-10 relative"
                      id="track-scrubber"
                    />
                  </div>
                  <span
                    className={`text-[10px] tabular-nums font-normal tracking-normal min-w-[34px] text-right leading-none ${isLight ? 'text-gray-600' : 'text-gray-400'}`}
                  >
                    -{formatTime(remainingTime)}
                  </span>
                </div>
              </div>
            ) : (
              <div
                className={`py-0.5 text-[11px] font-normal tracking-normal flex items-center justify-center gap-1.5 ${isLight ? 'text-gray-600' : 'text-gray-400'}`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                <span>ClassiTunes — Select or drop tracks to play</span>
              </div>
            )}
          </div>
        </div>

        {/* Right Section: View Mode, Tools & Theme Switcher (Equal Width Column) */}
        <div className="flex items-center justify-end gap-1 sm:gap-2 min-w-0">
          {/* Mode Toggles */}
          <div className={`flex items-center p-0.5 rounded-md border shrink-0 ${isLight ? 'bg-[#d8e0ed] border-[#9aa7b9]' : 'bg-[#1a1a1a] border-[#333]'
            }`}>
            <button
              onClick={() => onViewModeChange('list')}
              className={`p-1 sm:p-1.5 rounded transition-all ${viewMode === 'list'
                ? isLight ? 'bg-white text-blue-600 shadow-sm font-bold' : 'bg-[#3a3a3a] text-white shadow'
                : isLight ? 'text-gray-600 hover:text-black' : 'text-gray-400 hover:text-white'
                }`}
              title="List View"
              id="view-list-btn"
            >
              <List className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => onViewModeChange('grid')}
              className={`p-1 sm:p-1.5 rounded transition-all ${viewMode === 'grid'
                ? isLight ? 'bg-white text-blue-600 shadow-sm font-bold' : 'bg-[#3a3a3a] text-white shadow'
                : isLight ? 'text-gray-600 hover:text-black' : 'text-gray-400 hover:text-white'
                }`}
              title="Grid / Album View"
              id="view-grid-btn"
            >
              <LayoutGrid className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Search Pill */}
          <div className="relative flex items-center shrink min-w-[60px] sm:min-w-[80px]">
            <Search className={`w-3 h-3 absolute left-2 pointer-events-none ${isLight ? 'text-gray-500' : 'text-gray-400'}`} />
            <input
              type="text"
              placeholder="Search Library"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              className={`pl-6 pr-2 py-1 text-[11px] rounded-full focus:outline-none w-16 xs:w-24 sm:w-32 lg:w-40 transition-all ${isLight
                ? 'bg-white border border-[#9aa7b9] text-gray-900 placeholder-gray-500 focus:border-blue-500 shadow-inner'
                : 'bg-[#1a1a1a] border border-[#333] text-white placeholder-gray-500 focus:border-indigo-500'
                }`}
              id="search-input"
            />
            {searchQuery && (
              <button
                onClick={() => onSearchChange('')}
                className={`absolute right-2 text-xs font-bold ${isLight ? 'text-gray-500 hover:text-black' : 'text-gray-400 hover:text-white'}`}
              >
                ×
              </button>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};


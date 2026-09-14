import React, { useEffect, useRef } from 'react';
import { Play, Pause, Info, FolderPlus, Trash2, Star, Heart, Copy, Plus, Disc, Music, FolderOpen } from 'lucide-react';
import { Track, Playlist } from '../types';
import { openFileLocation } from '../utils/tauriWindow';

export interface ContextMenuState {
  x: number;
  y: number;
  track: Track;
}

interface ContextMenuProps {
  contextMenu: ContextMenuState | null;
  onClose: () => void;
  isPlaying: boolean;
  currentTrack: Track | null;
  playlists: Playlist[];
  onPlayTrack: (track: Track) => void;
  onTogglePlay: () => void;
  onOpenGetInfo: (track: Track) => void;
  onUpdateRating: (trackId: string, rating: number) => void;
  onAddTrackToPlaylist: (trackId: string, playlistId: string) => void;
  onCreatePlaylistWithTrack?: (track: Track) => void;
  onDeleteTrack: (trackId: string) => void;
  onDeleteTracks?: (trackIds: string[]) => void;
  selectedTrackIds?: string[];
  theme?: 'dark' | 'light';
}

export const ContextMenu: React.FC<ContextMenuProps> = ({
  contextMenu,
  onClose,
  isPlaying,
  currentTrack,
  playlists,
  onPlayTrack,
  onTogglePlay,
  onOpenGetInfo,
  onUpdateRating,
  onAddTrackToPlaylist,
  onCreatePlaylistWithTrack,
  onDeleteTrack,
  onDeleteTracks,
  selectedTrackIds = [],
  theme = 'dark',
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const isLight = theme === 'light';

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    if (contextMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [contextMenu, onClose]);

  if (!contextMenu) return null;

  const { x, y, track } = contextMenu;
  const isCurrentPlayingThis = currentTrack?.id === track.id && isPlaying;
  const userPlaylists = playlists.filter(p => !p.systemType || p.systemType === 'user');

  // Adjust menu position to keep within screen bounds
  const menuWidth = 220;
  const menuHeight = 320;
  const adjustedX = Math.min(x, window.innerWidth - menuWidth - 10);
  const adjustedY = Math.min(y, window.innerHeight - menuHeight - 10);

  const handleCopyDetails = () => {
    const text = `${track.title} by ${track.artist} (${track.album})`;
    navigator.clipboard.writeText(text);
    onClose();
  };

  return (
    <div
      ref={menuRef}
      style={{ left: `${adjustedX}px`, top: `${adjustedY}px` }}
      className={`fixed z-50 w-56 rounded-lg shadow-2xl border py-1.5 text-xs select-none animate-in fade-in zoom-in-95 duration-100 ${
        isLight
          ? 'bg-white/95 backdrop-blur-md border-gray-300 text-gray-800 shadow-[0_10px_25px_rgba(0,0,0,0.15)]'
          : 'bg-[#1e1e1e]/95 backdrop-blur-md border-[#3a3a3a] text-gray-200 shadow-[0_10px_30px_rgba(0,0,0,0.6)]'
      }`}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header with track name */}
      <div className={`px-3 py-1 mb-1 border-b text-[10px] truncate ${
        isLight ? 'border-gray-200 text-gray-500' : 'border-white/10 text-gray-400'
      }`}>
        <span className="font-bold uppercase tracking-wider block text-[9px] opacity-70">Song Options</span>
        <span className={`font-semibold text-xs truncate block ${isLight ? 'text-gray-900' : 'text-white'}`}>{track.title}</span>
      </div>

      {/* Play / Pause */}
      <button
        onClick={() => {
          if (currentTrack?.id === track.id) {
            onTogglePlay();
          } else {
            onPlayTrack(track);
          }
          onClose();
        }}
        className={`w-full px-3 py-1.5 flex items-center gap-2.5 transition-colors ${
          isLight ? 'hover:bg-blue-600 hover:text-white' : 'hover:bg-indigo-600 hover:text-white'
        }`}
      >
        {isCurrentPlayingThis ? (
          <>
            <Pause className="w-3.5 h-3.5 fill-current text-blue-500" />
            <span>Pause</span>
          </>
        ) : (
          <>
            <Play className="w-3.5 h-3.5 fill-current text-blue-500" />
            <span>Play Song</span>
          </>
        )}
      </button>

      {/* Get Info */}
      <button
        onClick={() => {
          onOpenGetInfo(track);
          onClose();
        }}
        className={`w-full px-3 py-1.5 flex items-center justify-between transition-colors ${
          isLight ? 'hover:bg-blue-600 hover:text-white' : 'hover:bg-indigo-600 hover:text-white'
        }`}
      >
        <div className="flex items-center gap-2.5">
          <Info className="w-3.5 h-3.5 text-blue-500" />
          <span>Get Info</span>
        </div>
        <span className="text-[10px] opacity-60 font-mono">⌘I</span>
      </button>

      <div className={`border-t my-1 ${isLight ? 'border-gray-200' : 'border-white/10'}`} />

      {/* Rating Submenu / Stars */}
      <div className="px-3 py-1">
        <div className={`text-[10px] font-bold uppercase mb-1 ${isLight ? 'text-gray-500' : 'text-gray-400'}`}>Rating</div>
        <div className="flex items-center gap-1 py-0.5">
          {[1, 2, 3, 4, 5].map((s) => (
            <button
              key={s}
              onClick={() => {
                onUpdateRating(track.id, s === track.rating ? 0 : s);
                onClose();
              }}
              className="p-1 hover:scale-125 transition-transform"
              title={`${s} Star${s > 1 ? 's' : ''}`}
            >
              <Star
                className={`w-3.5 h-3.5 ${
                  s <= track.rating ? 'fill-amber-400 text-amber-400' : isLight ? 'text-gray-300' : 'text-gray-600'
                }`}
              />
            </button>
          ))}
          {track.rating > 0 && (
            <button
              onClick={() => {
                onUpdateRating(track.id, 0);
                onClose();
              }}
              className="text-[10px] ml-2 opacity-60 hover:opacity-100 hover:underline"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      <div className={`border-t my-1 ${isLight ? 'border-gray-200' : 'border-white/10'}`} />

      {/* Add to Playlist */}
      <div className="relative group/playlist">
        <div className={`px-3 py-1 text-[10px] font-bold uppercase ${isLight ? 'text-gray-500' : 'text-gray-400'}`}>
          Add To Playlist
        </div>

        {userPlaylists.length > 0 ? (
          <div className="max-h-32 overflow-y-auto custom-scrollbar space-y-0.5">
            {userPlaylists.map((pl) => (
              <button
                key={pl.id}
                onClick={() => {
                  const idsToAdd = selectedTrackIds.length > 0 ? selectedTrackIds : [track.id];
                  idsToAdd.forEach(id => onAddTrackToPlaylist(id, pl.id));
                  onClose();
                }}
                className={`w-full px-3 py-1 flex items-center gap-2 pl-4 text-[11px] transition-colors ${
                  isLight ? 'hover:bg-blue-600 hover:text-white' : 'hover:bg-indigo-600 hover:text-white'
                }`}
              >
                <FolderPlus className="w-3.5 h-3.5 text-blue-500" />
                <span className="truncate">{pl.name}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="px-4 py-0.5 text-[10px] italic text-gray-500">No playlists created</div>
        )}

        {onCreatePlaylistWithTrack && (
          <button
            onClick={() => {
              onCreatePlaylistWithTrack(track);
              onClose();
            }}
            className={`w-full px-3 py-1.5 flex items-center gap-2 pl-4 text-[11px] font-medium transition-colors ${
              isLight ? 'hover:bg-blue-600 hover:text-white text-blue-600' : 'hover:bg-indigo-600 hover:text-white text-indigo-400'
            }`}
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Playlist from Selection</span>
          </button>
        )}
      </div>

      <div className={`border-t my-1 ${isLight ? 'border-gray-200' : 'border-white/10'}`} />

      {/* Open File Location */}
      {track.filePath ? (
        <button
          onClick={() => {
            openFileLocation(track.filePath!);
            onClose();
          }}
          className={`w-full px-3 py-1.5 flex items-center gap-2.5 transition-colors cursor-pointer ${
            isLight ? 'hover:bg-blue-600 hover:text-white' : 'hover:bg-indigo-600 hover:text-white'
          }`}
        >
          <FolderOpen className="w-3.5 h-3.5 opacity-70 text-blue-500 animate-pulse-once" />
          <span>Open File Location</span>
        </button>
      ) : (
        <div
          title="This track does not have a physical file path on your system (e.g. it is a synthesized or demo track)"
          className={`w-full px-3 py-1.5 flex items-center gap-2.5 opacity-40 cursor-not-allowed`}
        >
          <FolderOpen className="w-3.5 h-3.5 opacity-70" />
          <span>Open File Location</span>
        </div>
      )}

      {/* Copy Song Details */}
      <button
        onClick={handleCopyDetails}
        className={`w-full px-3 py-1.5 flex items-center gap-2.5 transition-colors ${
          isLight ? 'hover:bg-blue-600 hover:text-white' : 'hover:bg-indigo-600 hover:text-white'
        }`}
      >
        <Copy className="w-3.5 h-3.5 opacity-70" />
        <span>Copy Song Details</span>
      </button>

      {/* Delete from Library */}
      <button
        onClick={() => {
          const idsToDelete = selectedTrackIds.length > 0 ? selectedTrackIds : [track.id];
          if (onDeleteTracks) {
            onDeleteTracks(idsToDelete);
          } else {
            idsToDelete.forEach(id => onDeleteTrack(id));
          }
          onClose();
        }}
        className="w-full px-3 py-1.5 flex items-center gap-2.5 text-red-500 hover:bg-red-600 hover:text-white transition-colors"
      >
        <Trash2 className="w-3.5 h-3.5" />
        <span>Delete from Library ({selectedTrackIds.length > 1 ? `${selectedTrackIds.length} Songs` : '1 Song'})</span>
      </button>
    </div>
  );
};

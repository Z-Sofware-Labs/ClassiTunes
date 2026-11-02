import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Play, Pause, Info, FolderPlus, Trash2, Star, Heart, Copy, Plus, Disc, Music, FolderOpen, HardDrive, Smartphone, ArrowUpDown, ChevronRight, Check, Shuffle } from 'lucide-react';
import { Track, Playlist, AlbumSortField } from '../types';
import { openFileLocation, Mp3Device } from '../utils/tauriWindow';

export interface ContextMenuState {
  x: number;
  y: number;
  track?: Track | null;
  navigationTracks?: Track[];
  isBackground?: boolean;
}

interface ContextMenuProps {
  contextMenu: ContextMenuState | null;
  onClose: () => void;
  isPlaying: boolean;
  currentTrack: Track | null;
  playlists: Playlist[];
  devices?: Mp3Device[];
  onImportToDevice?: (trackIds: string[], device: Mp3Device) => void;
  onPlayTrack: (track: Track, queue?: Track[]) => void;
  onTogglePlay: () => void;
  onOpenGetInfo: (trackOrTracks: Track | Track[], navigationTracks?: Track[]) => void;
  onUpdateRating: (trackId: string, rating: number) => void;
  onAddTrackToPlaylist: (trackId: string, playlistId: string) => void;
  onCreatePlaylistWithTrack?: (track: Track) => void;
  onDeleteTrack: (trackId: string) => void;
  onDeleteTracks?: (trackIds: string[]) => void;
  selectedTrackIds?: string[];
  tracks?: Track[];
  theme?: 'dark' | 'light';
  isDeviceContext?: boolean;
  isAlbumView?: boolean;
  albumSortField?: AlbumSortField;
  onAlbumSortChange?: (field: AlbumSortField) => void;
  isAlbumGrouped?: boolean;
  onToggleAlbumGrouped?: (grouped: boolean) => void;
  onPlayAllAlbums?: () => void;
  onShuffleAllAlbums?: () => void;
  onSelectAllAlbums?: () => void;
}

export const ContextMenu: React.FC<ContextMenuProps> = ({
  contextMenu,
  onClose,
  isPlaying,
  currentTrack,
  playlists,
  devices = [],
  onImportToDevice,
  onPlayTrack,
  onTogglePlay,
  onOpenGetInfo,
  onUpdateRating,
  onAddTrackToPlaylist,
  onCreatePlaylistWithTrack,
  onDeleteTrack,
  onDeleteTracks,
  selectedTrackIds = [],
  checkedTrackIds,
  isCheckboxVisible = false,
  onCreatePlaylistWithTracks,
  tracks = [],
  theme = 'dark',
  isDeviceContext = false,
  isAlbumView = false,
  albumSortField = 'album',
  onAlbumSortChange,
  isAlbumGrouped = false,
  onToggleAlbumGrouped,
  onPlayAllAlbums,
  onShuffleAllAlbums,
  onSelectAllAlbums,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [isSortSubmenuOpen, setIsSortSubmenuOpen] = useState(false);
  const isLight = theme === 'light';

  const isCheckboxEngaged = Boolean(isCheckboxVisible && checkedTrackIds && checkedTrackIds.size > 0);
  const effectiveTrackIds = useMemo(() => {
    if (isCheckboxEngaged && checkedTrackIds) {
      return Array.from(checkedTrackIds);
    }
    return selectedTrackIds.length > 0 ? selectedTrackIds : (track ? [track.id] : []);
  }, [isCheckboxEngaged, checkedTrackIds, selectedTrackIds, track?.id]);

  const effectiveSelectedTracks = useMemo(() => {
    if (tracks.length === 0) return track ? [track] : [];
    const idSet = new Set(effectiveTrackIds);
    const matched = tracks.filter(t => idSet.has(t.id));
    return matched.length > 0 ? matched : (track ? [track] : []);
  }, [tracks, effectiveTrackIds, track]);

  useEffect(() => {
    setIsSortSubmenuOpen(false);
  }, [contextMenu]);

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

  const getClampedCoords = (x: number, y: number) => {
    const el = menuRef.current;
    const width = el?.offsetWidth || 224;
    const height = el?.offsetHeight || 380;
    const padding = 12;
    const bottomReserved = 32; // bottom status bar height

    let newX = x;
    let newY = y;

    if (newX + width > window.innerWidth - padding) {
      newX = Math.max(padding, window.innerWidth - width - padding);
    }
    if (newY + height > window.innerHeight - bottomReserved - padding) {
      newY = Math.max(padding, window.innerHeight - bottomReserved - height - padding);
    }

    return { left: newX, top: newY };
  };

  const [coords, setCoords] = React.useState<{ left: number; top: number } | null>(() => {
    if (!contextMenu) return null;
    return getClampedCoords(contextMenu.x, contextMenu.y);
  });

  React.useLayoutEffect(() => {
    if (!contextMenu) return;
    setCoords(getClampedCoords(contextMenu.x, contextMenu.y));
  }, [contextMenu]);

  if (!contextMenu) return null;

  const currentCoords = coords || getClampedCoords(contextMenu.x, contextMenu.y);
  const shouldFlyoutLeft = currentCoords.left + 224 + 180 > window.innerWidth;

  const sortOptions: { id: AlbumSortField; label: string }[] = [
    { id: 'album', label: 'Album' },
    { id: 'artist', label: 'Artist' },
    { id: 'genre', label: 'Genre' },
    { id: 'year', label: 'Year' },
  ];

  const renderSortSubmenu = () => (
    <div
      className="relative group/sort"
      onMouseEnter={() => setIsSortSubmenuOpen(true)}
      onMouseLeave={() => setIsSortSubmenuOpen(false)}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setIsSortSubmenuOpen(prev => !prev);
        }}
        className={`w-full px-3 py-1.5 flex items-center justify-between transition-colors cursor-pointer ${
          isLight ? 'hover:bg-blue-600 hover:text-white' : 'hover:bg-indigo-600 hover:text-white'
        }`}
      >
        <div className="flex items-center gap-2.5">
          <ArrowUpDown className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
          <span>Sort By</span>
        </div>
        <ChevronRight className="w-3.5 h-3.5 opacity-60 flex-shrink-0" />
      </button>

      {isSortSubmenuOpen && (
        <div
          className={`absolute z-50 w-44 rounded-lg shadow-2xl border py-1 text-xs select-none ${
            shouldFlyoutLeft
              ? 'right-full mr-1 before:absolute before:-right-3 before:top-0 before:bottom-0 before:w-3'
              : 'left-full ml-1 before:absolute before:-left-3 before:top-0 before:bottom-0 before:w-3'
          } -top-1 ${
            isLight
              ? 'bg-white/95 backdrop-blur-md border-gray-300 text-gray-800 shadow-[0_10px_25px_rgba(0,0,0,0.18)]'
              : 'bg-[#1e1e1e]/95 backdrop-blur-md border-[#3a3a3a] text-gray-200 shadow-[0_10px_30px_rgba(0,0,0,0.7)]'
          }`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className={`px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${
            isLight ? 'text-gray-400' : 'text-gray-500'
          }`}>
            Sort By
          </div>

          {sortOptions.map((item) => {
            const isSelected = (albumSortField || 'album') === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  onAlbumSortChange?.(item.id);
                  onClose();
                }}
                className={`w-full px-2.5 py-1.5 flex items-center gap-2 text-left transition-colors cursor-pointer ${
                  isLight
                    ? 'hover:bg-blue-600 hover:text-white'
                    : 'hover:bg-indigo-600 hover:text-white'
                }`}
              >
                <span className="w-4 flex items-center justify-center flex-shrink-0">
                  {isSelected && <Check className="w-3.5 h-3.5 stroke-[2.5]" />}
                </span>
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}

          <div className={`border-t my-1 ${isLight ? 'border-gray-200' : 'border-white/10'}`} />

          <button
            type="button"
            onClick={() => {
              onToggleAlbumGrouped?.(!isAlbumGrouped);
              onClose();
            }}
            className={`w-full px-2.5 py-1.5 flex items-center gap-2 text-left transition-colors cursor-pointer ${
              isLight
                ? 'hover:bg-blue-600 hover:text-white'
                : 'hover:bg-indigo-600 hover:text-white'
            }`}
          >
            <span className="w-4 flex items-center justify-center flex-shrink-0">
              {isAlbumGrouped && <Check className="w-3.5 h-3.5 stroke-[2.5]" />}
            </span>
            <span className="truncate">Grouped</span>
          </button>
        </div>
      )}
    </div>
  );

  // Background Context Menu (e.g. right-clicked empty whitespace in Album View)
  if (contextMenu.isBackground || !contextMenu.track) {
    return (
      <div
        ref={menuRef}
        style={{ left: `${currentCoords.left}px`, top: `${currentCoords.top}px` }}
        className={`fixed z-50 w-52 rounded-lg shadow-2xl border py-1.5 text-xs select-none ${
          isLight
            ? 'bg-white/95 backdrop-blur-md border-gray-300 text-gray-800 shadow-[0_10px_25px_rgba(0,0,0,0.15)]'
            : 'bg-[#1e1e1e]/95 backdrop-blur-md border-[#3a3a3a] text-gray-200 shadow-[0_10px_30px_rgba(0,0,0,0.6)]'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {renderSortSubmenu()}

        {(onPlayAllAlbums || onShuffleAllAlbums || onSelectAllAlbums) && (
          <div className={`border-t my-1 ${isLight ? 'border-gray-200' : 'border-white/10'}`} />
        )}

        {onPlayAllAlbums && (
          <button
            type="button"
            onClick={() => {
              onPlayAllAlbums();
              onClose();
            }}
            className={`w-full px-3 py-1.5 flex items-center gap-2.5 transition-colors cursor-pointer ${
              isLight ? 'hover:bg-blue-600 hover:text-white' : 'hover:bg-indigo-600 hover:text-white'
            }`}
          >
            <Play className="w-3.5 h-3.5 fill-current text-blue-500" />
            <span>Play All</span>
          </button>
        )}

        {onShuffleAllAlbums && (
          <button
            type="button"
            onClick={() => {
              onShuffleAllAlbums();
              onClose();
            }}
            className={`w-full px-3 py-1.5 flex items-center gap-2.5 transition-colors cursor-pointer ${
              isLight ? 'hover:bg-blue-600 hover:text-white' : 'hover:bg-indigo-600 hover:text-white'
            }`}
          >
            <Shuffle className="w-3.5 h-3.5 text-blue-500" />
            <span>Shuffle All</span>
          </button>
        )}

        {onSelectAllAlbums && (
          <button
            type="button"
            onClick={() => {
              onSelectAllAlbums();
              onClose();
            }}
            className={`w-full px-3 py-1.5 flex items-center justify-between transition-colors cursor-pointer ${
              isLight ? 'hover:bg-blue-600 hover:text-white' : 'hover:bg-indigo-600 hover:text-white'
            }`}
          >
            <span>Select All</span>
            <span className="text-[10px] opacity-60 font-mono">⌘A</span>
          </button>
        )}
      </div>
    );
  }

  const { track } = contextMenu;
  const isCurrentPlayingThis = currentTrack?.id === track.id && isPlaying;
  const userPlaylists = playlists.filter(p => (!p.systemType || p.systemType === 'user') && !p.isFolder && !p.isSmart);

  const handleCopyDetails = () => {
    const text = effectiveSelectedTracks
      .map(t => `${t.title} by ${t.artist} (${t.album})`)
      .join('\n');
    navigator.clipboard.writeText(text);
    onClose();
  };

  return (
    <div
      ref={menuRef}
      style={{ left: `${currentCoords.left}px`, top: `${currentCoords.top}px` }}
      className={`fixed z-50 w-56 rounded-lg shadow-2xl border py-1.5 text-xs select-none ${
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
        <span className="font-bold uppercase tracking-wider block text-[9px] opacity-70">
          {isCheckboxEngaged ? 'Checked Songs Options' : 'Song Options'}
        </span>
        <span className={`font-semibold text-xs truncate block ${isLight ? 'text-gray-900' : 'text-white'}`}>
          {isCheckboxEngaged
            ? `${effectiveTrackIds.length} Checked Songs`
            : effectiveTrackIds.length > 1
            ? `${effectiveTrackIds.length} Selected Songs`
            : track.title}
        </span>
      </div>

      {/* Play / Pause */}
      <button
        onClick={() => {
          if (currentTrack?.id === track.id) {
            onTogglePlay();
          } else {
            onPlayTrack(track, tracks);
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
          if (effectiveTrackIds.length > 1) {
            onOpenGetInfo(effectiveSelectedTracks, contextMenu.navigationTracks);
          } else {
            onOpenGetInfo(track, contextMenu.navigationTracks);
          }
          onClose();
        }}
        className={`w-full px-3 py-1.5 flex items-center justify-between transition-colors ${
          isLight ? 'hover:bg-blue-600 hover:text-white' : 'hover:bg-indigo-600 hover:text-white'
        }`}
      >
        <div className="flex items-center gap-2.5">
          <Info className="w-3.5 h-3.5 text-blue-500" />
          <span>
            {effectiveTrackIds.length > 1
              ? `Get Info (${effectiveTrackIds.length} ${isCheckboxEngaged ? 'checked items' : 'items'})`
              : 'Get Info'}
          </span>
        </div>
        <span className="text-[10px] opacity-60 font-mono">⌘I</span>
      </button>

      {/* Sort By Submenu in Album View */}
      {isAlbumView && (
        <>
          <div className={`border-t my-1 ${isLight ? 'border-gray-200' : 'border-white/10'}`} />
          {renderSortSubmenu()}
        </>
      )}

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
                  effectiveTrackIds.forEach(id => onAddTrackToPlaylist(id, pl.id));
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
              if (onCreatePlaylistWithTracks) {
                onCreatePlaylistWithTracks(effectiveSelectedTracks);
              } else {
                onCreatePlaylistWithTrack(effectiveSelectedTracks[0] || track);
              }
              onClose();
            }}
            className={`w-full px-3 py-1.5 flex items-center gap-2 pl-4 text-[11px] font-medium transition-colors ${
              isLight ? 'hover:bg-blue-600 hover:text-white text-blue-600' : 'hover:bg-indigo-600 hover:text-white text-indigo-400'
            }`}
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Playlist from ${isCheckboxEngaged ? 'Checked Songs' : 'Selection'}</span>
          </button>
        )}
      </div>

      {/* Copy / Import to Device Submenu */}
      {devices.length > 0 && onImportToDevice && !isDeviceContext && (
        <>
          <div className={`border-t my-1 ${isLight ? 'border-gray-200' : 'border-white/10'}`} />
          <div className="relative group/device">
            <div className={`px-3 py-1 text-[10px] font-bold uppercase ${isLight ? 'text-gray-500' : 'text-gray-400'}`}>
              Copy to Device
            </div>
            <div className="space-y-0.5">
              {devices.map((dev) => {
                return (
                  <button
                    key={dev.id}
                    onClick={() => {
                      onImportToDevice(effectiveTrackIds, dev);
                      onClose();
                    }}
                    className={`w-full px-3 py-1 flex items-center gap-2 pl-4 text-[11px] transition-colors ${
                      isLight ? 'hover:bg-blue-600 hover:text-white' : 'hover:bg-indigo-600 hover:text-white'
                    }`}
                  >
                    {dev.category === 'ipod' || dev.category === 'iphone' ? (
                      <Smartphone className="w-3.5 h-3.5 text-blue-500" />
                    ) : (
                      <HardDrive className="w-3.5 h-3.5 text-blue-500" />
                    )}
                    <span className="truncate">
                      {dev.name} ({effectiveTrackIds.length > 1 ? `${effectiveTrackIds.length} ${isCheckboxEngaged ? 'Checked Songs' : 'Songs'}` : '1 Song'})
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}

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

      {/* Delete from Library / Device */}
      <button
        onClick={() => {
          if (onDeleteTracks) {
            onDeleteTracks(effectiveTrackIds);
          } else {
            effectiveTrackIds.forEach(id => onDeleteTrack(id));
          }
          onClose();
        }}
        className="w-full px-3 py-1.5 flex items-center gap-2.5 text-red-500 hover:bg-red-600 hover:text-white transition-colors"
      >
        <Trash2 className="w-3.5 h-3.5" />
        <span>
          {isDeviceContext
            ? `Delete from Device (${effectiveTrackIds.length > 1 ? `${effectiveTrackIds.length} ${isCheckboxEngaged ? 'Checked Songs' : 'Songs'}` : '1 Song'})`
            : `Delete from Library (${effectiveTrackIds.length > 1 ? `${effectiveTrackIds.length} ${isCheckboxEngaged ? 'Checked Songs' : 'Songs'}` : '1 Song'})`}
        </span>
      </button>
    </div>
  );
};

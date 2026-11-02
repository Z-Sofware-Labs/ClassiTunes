import React, { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Track, Playlist } from '../types';
import { 
  Play, Volume2, Star, ArrowUp, ArrowDown, MoreHorizontal, 
  Trash2, Info, FolderPlus, Folder, Disc, Upload, Music, Check,
  Columns, SlidersHorizontal, RotateCcw, Search, X,
  ChevronUp, ChevronDown, GripVertical
} from 'lucide-react';
import { ImportMusicButton } from './ImportMusicButton';
import { platformInfo } from '../utils/platform';

interface ListViewProps {
  tracks: Track[];
  currentTrack: Track | null;
  isPlaying: boolean;
  playlists: Playlist[];
  onPlayTrack: (track: Track, queue?: Track[]) => void;
  onUpdateRating: (trackId: string, rating: number) => void;
  onOpenGetInfo: (track: Track, navigationTracks?: Track[]) => void;
  onDeleteTrack: (trackId: string) => void;
  onDeleteTracks?: (trackIds: string[]) => void;
  onAddTrackToPlaylist: (trackId: string, playlistId: string) => void;
  onTrackContextMenu?: (track: Track, e: React.MouseEvent, navigationTracks?: Track[]) => void;
  onImportFiles?: (files: FileList | File[] | string[]) => void;
  onStartImporting?: (statusText?: string) => void;
  theme?: 'dark' | 'light';
  selectedTrackIds?: string[];
  onSelectionChange?: (ids: string[]) => void;
  searchQuery?: string;
  onClearSearch?: () => void;
  checkedTrackIds?: Set<string>;
  onToggleCheckTrack?: (trackId: string, e: React.MouseEvent) => void;
  onToggleCheckAll?: () => void;
  visibleColumns?: ColumnId[];
  onVisibleColumnsChange?: (cols: ColumnId[]) => void;
  storageScope?: string;
  defaultVisibleColumns?: ColumnId[];
  selectedPlaylist?: Playlist | null;
}

export type ColumnId = 
  | 'checkbox'
  | 'trackNumber'
  | 'title'
  | 'duration'
  | 'artist'
  | 'album'
  | 'genre'
  | 'rating'
  | 'playCount'
  | 'year'
  | 'bitrate'
  | 'sampleRate'
  | 'dateAdded'
  | 'format';

export interface ColumnConfig {
  id: ColumnId;
  label: string;
  defaultVisible: boolean;
  align?: 'left' | 'center' | 'right';
  widthClass?: string;
  sortKey: keyof Track;
}

const ALL_COLUMNS: ColumnConfig[] = [
  { id: 'checkbox', label: '✔', defaultVisible: true, align: 'center', widthClass: 'w-8', sortKey: 'isChecked' as keyof Track },
  { id: 'trackNumber', label: '#', defaultVisible: true, align: 'center', widthClass: 'w-10', sortKey: 'trackNumber' },
  { id: 'title', label: 'Name', defaultVisible: true, align: 'left', widthClass: 'w-[26%]', sortKey: 'title' },
  { id: 'duration', label: 'Time', defaultVisible: true, align: 'right', widthClass: 'w-16', sortKey: 'duration' },
  { id: 'artist', label: 'Artist', defaultVisible: true, align: 'left', widthClass: 'w-[20%]', sortKey: 'artist' },
  { id: 'album', label: 'Album', defaultVisible: true, align: 'left', widthClass: 'w-[20%]', sortKey: 'album' },
  { id: 'genre', label: 'Genre', defaultVisible: true, align: 'left', widthClass: 'w-24', sortKey: 'genre' },
  { id: 'rating', label: 'Rating', defaultVisible: true, align: 'center', widthClass: 'w-24', sortKey: 'rating' },
  { id: 'playCount', label: 'Plays', defaultVisible: true, align: 'center', widthClass: 'w-16', sortKey: 'playCount' },
  { id: 'year', label: 'Year', defaultVisible: false, align: 'center', widthClass: 'w-16', sortKey: 'year' },
  { id: 'bitrate', label: 'Bit Rate', defaultVisible: false, align: 'right', widthClass: 'w-20', sortKey: 'bitrate' },
  { id: 'sampleRate', label: 'Sample Rate', defaultVisible: false, align: 'right', widthClass: 'w-24', sortKey: 'sampleRate' },
  { id: 'dateAdded', label: 'Date Added', defaultVisible: false, align: 'left', widthClass: 'w-28', sortKey: 'dateAdded' },
  { id: 'format', label: 'Kind', defaultVisible: false, align: 'center', widthClass: 'w-16', sortKey: 'format' },
];

export const DEFAULT_VISIBLE: ColumnId[] = ['checkbox', 'trackNumber', 'title', 'duration', 'artist', 'album', 'genre', 'rating', 'playCount'];
export const ALL_COLUMN_IDS: ColumnId[] = ALL_COLUMNS.map(c => c.id);

export function getInitialColumnOrder(storageScope: string = 'classitunes'): ColumnId[] {
  try {
    const saved = localStorage.getItem(`${storageScope}_column_order`);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const validSet = new Set<string>(ALL_COLUMN_IDS);
        const filtered = parsed.filter((id: any): id is ColumnId => validSet.has(id));
        ALL_COLUMN_IDS.forEach(id => {
          if (!filtered.includes(id)) filtered.push(id);
        });
        return filtered;
      }
    }
    // If no explicit column_order saved yet, initialize from saved visible_columns + remaining
    const savedVisible = localStorage.getItem(`${storageScope}_visible_columns`) || (storageScope === 'classitunes' ? localStorage.getItem('itunes_visible_columns') : null);
    if (savedVisible) {
      const parsed = JSON.parse(savedVisible);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const validSet = new Set<string>(ALL_COLUMN_IDS);
        const order: ColumnId[] = parsed.filter((id: any): id is ColumnId => validSet.has(id));
        ALL_COLUMN_IDS.forEach(id => {
          if (!order.includes(id)) order.push(id);
        });
        return order;
      }
    }
  } catch (e) {}
  return [...ALL_COLUMN_IDS];
}

const DEFAULT_COLUMN_WIDTHS: Record<ColumnId, number> = {
  checkbox: 34,
  trackNumber: 44,
  title: 250,
  duration: 70,
  artist: 180,
  album: 180,
  genre: 110,
  rating: 110,
  playCount: 70,
  year: 65,
  bitrate: 80,
  sampleRate: 90,
  dateAdded: 110,
  format: 70,
};

const formatTime = (secs: number) => {
  if (!secs || isNaN(secs)) return '0:00';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
};

const dateCache = new Map<string, string>();
export const formatDateAdded = (dateStr?: string | number): string => {
  if (!dateStr) return '-';
  const key = String(dateStr);
  const cached = dateCache.get(key);
  if (cached !== undefined) return cached;
  try {
    const formatted = new Date(dateStr).toLocaleDateString();
    if (dateCache.size > 2000) dateCache.clear();
    dateCache.set(key, formatted);
    return formatted;
  } catch (e) {
    return '-';
  }
};

interface TrackRowProps {
  track: Track;
  idx: number;
  isCurrentPlaying: boolean;
  isPlaying: boolean;
  isSelected: boolean;
  isCheckedTrack: boolean;
  isZebraOdd: boolean;
  visibleColumns: ColumnId[];
  columnWidths: Record<ColumnId, number>;
  isLight: boolean;
  isLinux: boolean;
  pyClass: string;
  isMenuOpen: boolean;
  userPlaylists: Playlist[];
  onPlayTrackRow: (track: Track) => void;
  onToggleCheckTrack: (trackId: string, e: React.MouseEvent) => void;
  onUpdateRating: (trackId: string, rating: number) => void;
  onOpenGetInfo: (track: Track, navigationTracks?: Track[]) => void;
  onDeleteSelected: (fallbackTrackId: string) => void;
  onAddSelectedToPlaylist: (playlistId: string, fallbackTrackId: string) => void;
  onTrackContextMenu?: (track: Track, e: React.MouseEvent, navigationTracks?: Track[]) => void;
  handleRowClick: (trackId: string, e: React.MouseEvent) => void;
  handleDragStart: (e: React.DragEvent, track: Track) => void;
  handleDragEnd: () => void;
  setContextMenuTrackId: (id: string | null) => void;
  updateSelectedTrackIds: (ids: string[]) => void;
  isDeviceScope?: boolean;
}

const TrackRow = React.memo<TrackRowProps>(({
  track,
  idx,
  isCurrentPlaying,
  isPlaying,
  isSelected,
  isCheckedTrack,
  isZebraOdd,
  visibleColumns,
  columnWidths,
  isLight,
  isLinux,
  pyClass,
  isMenuOpen,
  userPlaylists,
  onPlayTrackRow,
  onToggleCheckTrack,
  onUpdateRating,
  onOpenGetInfo,
  onDeleteSelected,
  onAddSelectedToPlaylist,
  onTrackContextMenu,
  handleRowClick,
  handleDragStart,
  handleDragEnd,
  setContextMenuTrackId,
  updateSelectedTrackIds,
  isDeviceScope = false,
}) => {
  return (
    <tr
      draggable
      onDragStart={(e) => handleDragStart(e, track)}
      onDragEnd={handleDragEnd}
      onMouseDown={(e) => {
        if (e.button !== 0) return;
        const target = e.target as HTMLElement;
        if (target.closest('button, input, select, textarea, a, svg, .no-drag')) return;
        if (!e.shiftKey && !e.ctrlKey && !e.metaKey) {
          if (!isSelected) {
            updateSelectedTrackIds([track.id]);
          }
        }
      }}
      onClick={(e) => handleRowClick(track.id, e)}
      onDoubleClick={() => onPlayTrackRow(track)}
      onContextMenu={(e) => {
        e.preventDefault();
        if (!isSelected) {
          updateSelectedTrackIds([track.id]);
        }
        if (onTrackContextMenu) onTrackContextMenu(track, e);
      }}
      className={`group cursor-pointer ${
        isSelected
          ? isLight ? 'bg-gradient-to-b from-[#3b82f6] to-[#1d4ed8] text-white font-medium' : 'bg-[#3a3a3a] text-white font-medium'
          : isCurrentPlaying
          ? isLight ? 'bg-blue-100/90 text-blue-950 font-semibold' : 'bg-indigo-950/70 text-indigo-200 font-semibold'
          : isZebraOdd
          ? isLight ? 'bg-[#edf2f9] hover:bg-blue-100/70 text-gray-900' : 'bg-[#1c1d22] hover:bg-[#282932] text-gray-100'
          : isLight ? 'bg-white hover:bg-blue-100/70 text-gray-900' : 'bg-[#131315] hover:bg-[#282932] text-gray-100'
      }`}
      id={`track-row-${track.id}`}
      style={{
        contentVisibility: 'auto',
        containIntrinsicSize: 'auto 36px',
        WebkitUserDrag: 'element',
      } as React.CSSProperties}
    >
      {/* Dynamic Ordered Columns */}
      {visibleColumns.map((colId) => {
        const colWidth = columnWidths[colId] || DEFAULT_COLUMN_WIDTHS[colId];
        switch (colId) {
          case 'checkbox':
            return (
              <td
                key="checkbox"
                style={{ width: `${colWidth}px` }}
                className={`${pyClass} px-1 text-center`}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleCheckTrack(track.id, e);
                }}
              >
                <div className="flex items-center justify-center">
                  <input
                    type="checkbox"
                    checked={isCheckedTrack}
                    onChange={() => {}}
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleCheckTrack(track.id, e);
                    }}
                    className={`w-3.5 h-3.5 rounded cursor-pointer transition-colors ${
                      isLight
                        ? 'accent-blue-600 border-gray-300'
                        : 'accent-indigo-500 border-neutral-600'
                    }`}
                  />
                </div>
              </td>
            );
          case 'trackNumber':
            return (
              <td
                key="trackNumber"
                style={{ width: `${colWidth}px` }}
                className={`${pyClass} px-2 text-center font-mono text-[12px]`}
              >
                {isCurrentPlaying ? (
                  <div className={`flex items-center justify-center font-bold ${isLight ? 'text-blue-600' : 'text-indigo-400'}`}>
                    {isPlaying ? (
                      // animate-pulse suppressed on Linux: CSS keyframe animations on visible
                      // rows keep the row dirty in the compositor, causing repaints during scroll.
                      <Volume2 className={`w-3.5 h-3.5 ${isSelected ? 'text-white' : isLight ? 'text-blue-600' : 'text-indigo-400'}${isLinux ? '' : ' animate-pulse'}`} />
                    ) : (
                      <Play className={`w-3 h-3 fill-current ${isSelected ? 'text-white' : isLight ? 'text-blue-600' : 'text-indigo-400'}`} />
                    )}
                  </div>
                ) : (
                  <span className={isSelected ? 'text-white' : isLight ? 'text-gray-500' : 'text-gray-500'}>
                    {idx + 1}
                  </span>
                )}
              </td>
            );
          case 'title':
            return (
              <td
                key="title"
                style={{ width: `${colWidth}px` }}
                className={`${pyClass} px-3 truncate font-medium text-[12px]`}
              >
                <div className="flex items-center gap-2">
                  <span className="truncate">{track.title}</span>
                </div>
              </td>
            );
          case 'duration':
            return (
              <td
                key="duration"
                style={{ width: `${colWidth}px` }}
                className={`${pyClass} px-2 text-right pr-3 font-mono text-[12px]`}
              >
                <span className={isSelected ? 'text-white' : isLight ? 'text-gray-600' : 'text-gray-400'}>
                  {formatTime(track.duration)}
                </span>
              </td>
            );
          case 'artist':
            return (
              <td
                key="artist"
                style={{ width: `${colWidth}px` }}
                className={`${pyClass} px-3 truncate text-[12px]`}
              >
                <span className={isSelected ? 'text-white' : isLight ? 'text-gray-700' : 'text-gray-300'}>
                  {track.artist}
                </span>
              </td>
            );
          case 'album':
            return (
              <td
                key="album"
                style={{ width: `${colWidth}px` }}
                className={`${pyClass} px-3 truncate text-[12px]`}
              >
                <span className={isSelected ? 'text-white' : isLight ? 'text-gray-600' : 'text-gray-400'}>
                  {track.album}
                </span>
              </td>
            );
          case 'genre':
            return (
              <td
                key="genre"
                style={{ width: `${colWidth}px` }}
                className={`${pyClass} px-2 truncate text-[12px]`}
              >
                <span className={isSelected ? 'text-white' : isLight ? 'text-gray-600' : 'text-gray-400'}>
                  {track.genre || 'Music'}
                </span>
              </td>
            );
          case 'rating':
            return (
              <td
                key="rating"
                style={{ width: `${colWidth}px` }}
                className={`${pyClass} px-2 text-center`}
              >
                <div className="flex items-center justify-center gap-0.5">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <Star
                      key={star}
                      className={`w-2.5 h-2.5 cursor-pointer ${
                        star <= track.rating
                          ? 'fill-amber-400 text-amber-400'
                          : isSelected
                          ? 'text-blue-200 hover:text-white'
                          : isLight
                          ? 'text-gray-300 hover:text-gray-500'
                          : 'text-gray-700 hover:text-gray-500'
                      }`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onUpdateRating(track.id, star === track.rating ? 0 : star);
                      }}
                    />
                  ))}
                </div>
              </td>
            );
          case 'playCount':
            return (
              <td
                key="playCount"
                style={{ width: `${colWidth}px` }}
                className={`${pyClass} px-2 text-center font-mono text-[12px]`}
              >
                <span className={isSelected ? 'text-white' : isLight ? 'text-gray-600' : 'text-gray-500'}>
                  {track.playCount || 0}
                </span>
              </td>
            );
          case 'year':
            return (
              <td
                key="year"
                style={{ width: `${colWidth}px` }}
                className={`${pyClass} px-2 text-center font-mono text-[12px] truncate`}
              >
                <span className={isSelected ? 'text-white' : isLight ? 'text-gray-600' : 'text-gray-400'}>
                  {track.year || '-'}
                </span>
              </td>
            );
          case 'bitrate':
            return (
              <td
                key="bitrate"
                style={{ width: `${colWidth}px` }}
                className={`${pyClass} px-2 text-right font-mono text-[12px] truncate pr-3`}
              >
                <span className={isSelected ? 'text-white' : isLight ? 'text-gray-600' : 'text-gray-400'}>
                  {track.bitrate ? `${track.bitrate} kbps` : '-'}
                </span>
              </td>
            );
          case 'sampleRate':
            return (
              <td
                key="sampleRate"
                style={{ width: `${colWidth}px` }}
                className={`${pyClass} px-2 text-right font-mono text-[12px] truncate pr-3`}
              >
                <span className={isSelected ? 'text-white' : isLight ? 'text-gray-600' : 'text-gray-400'}>
                  {track.sampleRate ? `${(track.sampleRate / 1000).toFixed(1)} kHz` : '-'}
                </span>
              </td>
            );
          case 'dateAdded':
            return (
              <td
                key="dateAdded"
                style={{ width: `${colWidth}px` }}
                className={`${pyClass} px-2 text-left text-[12px] truncate`}
              >
                <span className={isSelected ? 'text-white' : isLight ? 'text-gray-600' : 'text-gray-400'}>
                  {formatDateAdded(track.dateAdded)}
                </span>
              </td>
            );
          case 'format':
            return (
              <td
                key="format"
                style={{ width: `${colWidth}px` }}
                className={`${pyClass} px-2 text-center font-mono text-[10px] truncate`}
              >
                <span className={`px-1.5 py-0.5 rounded ${
                  isSelected ? 'bg-white/20 text-white' : isLight ? 'bg-gray-100 text-gray-700' : 'bg-white/5 text-gray-400'
                }`}>
                  {track.format ? track.format.toUpperCase() : 'MP3'}
                </span>
              </td>
            );
          default:
            return null;
        }
      })}

      {/* More Options / Context Menu Trigger */}
      <td className={`${pyClass} px-1 text-center relative`}>
        <button
          onClick={(e) => {
            e.stopPropagation();
            setContextMenuTrackId(isMenuOpen ? null : track.id);
          }}
          className={`p-1 rounded ${
            isSelected
              ? 'text-white hover:bg-white/20'
              : isLight
              ? 'text-gray-400 hover:bg-gray-200 group-hover:text-gray-800'
              : 'text-gray-500 hover:bg-white/10 group-hover:text-white'
          }`}
          title="Options"
        >
          <MoreHorizontal className="w-3.5 h-3.5" />
        </button>

        {/* Popover Menu */}
        {isMenuOpen && (
          <div 
            onClick={(e) => e.stopPropagation()}
            className={`absolute right-2 bottom-full mb-1 sm:bottom-auto sm:top-8 z-50 w-44 rounded-md shadow-2xl border py-1 text-left text-xs font-normal ${
              isLight
                ? 'bg-white border-gray-200 text-gray-800 shadow-xl'
                : 'bg-[#222222] border-[#3a3a3a] text-gray-200 shadow-2xl'
            }`}
          >
            <button
              onClick={() => {
                onPlayTrackRow(track);
                setContextMenuTrackId(null);
              }}
              className={`w-full px-3 py-1.5 flex items-center gap-2 ${
                isLight ? 'hover:bg-blue-600 hover:text-white' : 'hover:bg-indigo-600 hover:text-white'
              }`}
            >
              <Play className="w-3 h-3 fill-current" />
              <span>Play Song</span>
            </button>

            <button
              onClick={() => {
                onOpenGetInfo(track);
                setContextMenuTrackId(null);
              }}
              className={`w-full px-3 py-1.5 flex items-center gap-2 ${
                isLight ? 'hover:bg-blue-600 hover:text-white' : 'hover:bg-indigo-600 hover:text-white'
              }`}
            >
              <Info className="w-3 h-3" />
              <span>Get Info</span>
            </button>

            {/* Add to Playlist Submenu */}
            {userPlaylists.length > 0 && (
              <div className={`border-t my-1 pt-1 ${isLight ? 'border-gray-200' : 'border-white/10'}`}>
                <div className={`px-3 py-1 text-[10px] font-bold uppercase ${isLight ? 'text-gray-500' : 'text-gray-500'}`}>
                  Add To Playlist:
                </div>
                {userPlaylists.map((pl) => (
                  <button
                    key={pl.id}
                    onClick={() => {
                      onAddSelectedToPlaylist(pl.id, track.id);
                      setContextMenuTrackId(null);
                    }}
                    className={`w-full px-3 py-1 flex items-center gap-2 pl-4 text-[11px] ${
                      isLight ? 'hover:bg-blue-600 hover:text-white' : 'hover:bg-indigo-600 hover:text-white'
                    }`}
                  >
                    <FolderPlus className={`w-3 h-3 ${isLight ? 'text-blue-600' : 'text-indigo-400'}`} />
                    <span className="truncate">{pl.name}</span>
                  </button>
                ))}
              </div>
            )}

            <div className={`border-t my-1 ${isLight ? 'border-gray-200' : 'border-white/10'}`} />

            <button
              onClick={() => {
                onDeleteSelected(track.id);
                setContextMenuTrackId(null);
              }}
              className="w-full px-3 py-1.5 hover:bg-red-600 hover:text-white text-red-500 flex items-center gap-2"
            >
              <Trash2 className="w-3 h-3" />
              <span>{isDeviceScope ? 'Delete from Device' : 'Delete from Library'}</span>
            </button>
          </div>
        )}
      </td>
    </tr>
  );
});

const ListViewComponent: React.FC<ListViewProps> = ({
  tracks,
  currentTrack,
  isPlaying,
  playlists,
  onPlayTrack,
  onUpdateRating,
  onOpenGetInfo,
  onDeleteTrack,
  onDeleteTracks,
  onAddTrackToPlaylist,
  onTrackContextMenu,
  onImportFiles,
  onStartImporting,
  theme = 'dark',
  selectedTrackIds: propSelectedTrackIds,
  onSelectionChange,
  searchQuery,
  onClearSearch,
  checkedTrackIds: propCheckedTrackIds,
  onToggleCheckTrack: propOnToggleCheckTrack,
  onToggleCheckAll: propOnToggleCheckAll,
  visibleColumns: propVisibleColumns,
  onVisibleColumnsChange: propOnVisibleColumnsChange,
  storageScope = 'classitunes',
  defaultVisibleColumns,
  selectedPlaylist,
}) => {


  const [internalSelectedTrackIds, setInternalSelectedTrackIds] = useState<string[]>([]);
  const selectedTrackIds = propSelectedTrackIds !== undefined ? propSelectedTrackIds : internalSelectedTrackIds;
  const selectedTrackIdsRef = useRef<string[]>(selectedTrackIds);
  selectedTrackIdsRef.current = selectedTrackIds;
  const selectedTrackSet = useMemo(() => new Set(selectedTrackIds), [selectedTrackIds]);

  // Checked tracks state (Track Checkbox column, classic style)
  // Store explicitly checked track IDs in localStorage so selection is absolute
  const [internalCheckedTrackIds, setInternalCheckedTrackIds] = useState<Set<string>>(() => {
    try {
      const savedChecked = localStorage.getItem(`${storageScope}_checked_tracks`);
      if (savedChecked !== null) {
        return new Set(JSON.parse(savedChecked));
      }
    } catch (e) {}
    // Default initial state: empty Set (0 checked until user checks songs or disables column)
    return new Set<string>();
  });

  const checkedTrackIds = propCheckedTrackIds !== undefined ? propCheckedTrackIds : internalCheckedTrackIds;

  const handleToggleCheckTrack = useCallback((trackId: string, e: React.MouseEvent) => {
    if (propOnToggleCheckTrack) {
      propOnToggleCheckTrack(trackId, e);
      return;
    }
    e.stopPropagation();
    setInternalCheckedTrackIds(prev => {
      const updated = new Set(prev);
      if (updated.has(trackId)) {
        updated.delete(trackId);
      } else {
        updated.add(trackId);
      }
      try {
        localStorage.setItem(`${storageScope}_checked_tracks`, JSON.stringify(Array.from(updated)));
        window.dispatchEvent(new CustomEvent(`${storageScope}:checked-changed`));
      } catch (err) {}
      return updated;
    });
  }, [propOnToggleCheckTrack, storageScope]);

  const handleToggleCheckAll = useCallback(() => {
    if (propOnToggleCheckAll) {
      propOnToggleCheckAll();
      return;
    }
    const allTrackIds = tracks.map(t => t.id);
    const areAllCurrentlyChecked = allTrackIds.length > 0 && allTrackIds.every(id => checkedTrackIds.has(id));

    setInternalCheckedTrackIds(() => {
      const next = areAllCurrentlyChecked ? new Set<string>() : new Set(allTrackIds);
      try {
        localStorage.setItem(`${storageScope}_checked_tracks`, JSON.stringify(Array.from(next)));
        window.dispatchEvent(new CustomEvent(`${storageScope}:checked-changed`));
      } catch (err) {}
      return next;
    });
  }, [propOnToggleCheckAll, tracks, checkedTrackIds, storageScope]);

  const areAllTracksChecked = useMemo(() => {
    if (tracks.length === 0) return true;
    return tracks.every(t => checkedTrackIds.has(t.id));
  }, [tracks, checkedTrackIds]);

  const areSomeTracksChecked = useMemo(() => {
    if (tracks.length === 0) return false;
    let checkedCount = 0;
    for (const t of tracks) {
      if (checkedTrackIds.has(t.id)) checkedCount++;
    }
    return checkedCount > 0 && checkedCount < tracks.length;
  }, [tracks, checkedTrackIds]);

  const updateSelectedTrackIds = useCallback((ids: string[]) => {
    selectedTrackIdsRef.current = ids;
    setInternalSelectedTrackIds(ids);
    if (onSelectionChange) {
      onSelectionChange(ids);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onSelectionChange]);

  // Marquee / Box Selection State & Logic
  const [selectionBox, setSelectionBox] = useState<{ startX: number; startY: number; currentX: number; currentY: number } | null>(null);
  const isMouseDownRef = useRef(false);
  const mouseDownPosRef = useRef<{ x: number; y: number } | null>(null);
  const isBoxSelectingRef = useRef(false);
  const wasBlankAreaClickRef = useRef(false);
  const initialSelectionRef = useRef<string[]>([]);
  const rowRectsRef = useRef<{ id: string; rect: DOMRect }[]>([]);

  const [sortField, setSortField] = useState<keyof Track>('title');
  const [sortAsc, setSortAsc] = useState<boolean>(true);
  const [contextMenuTrackId, setContextMenuTrackId] = useState<string | null>(null);
  const [showColumnPicker, setShowColumnPicker] = useState<boolean>(false);

  const [rowHeight, setRowHeight] = useState<'compact' | 'normal' | 'relaxed'>(() => {
    try {
      const saved = localStorage.getItem(`${storageScope}_row_height`) || (storageScope === 'classitunes' ? (localStorage.getItem('classitunes_row_height') || localStorage.getItem('itunes_row_height')) : null);
      return (saved as 'compact' | 'normal' | 'relaxed') || 'normal';
    } catch (e) {
      return 'normal';
    }
  });

  const changeRowHeight = (height: 'compact' | 'normal' | 'relaxed') => {
    setRowHeight(height);
    try {
      localStorage.setItem(`${storageScope}_row_height`, height);
    } catch (e) {}
  };

  const pyClass = rowHeight === 'compact' ? 'py-1' : rowHeight === 'relaxed' ? 'py-3' : 'py-2';
  const estimatedRowHeight = rowHeight === 'compact' ? 28 : rowHeight === 'relaxed' ? 44 : 36;

  const tableContainerRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(600);

  // Measure container height & track scroll position for virtualization (throttled via requestAnimationFrame)
  const rafScrollRef = useRef<number | null>(null);
  useEffect(() => {
    const el = tableContainerRef.current;
    if (!el) return;

    const handleScroll = () => {
      if (rafScrollRef.current !== null) return;
      rafScrollRef.current = requestAnimationFrame(() => {
        rafScrollRef.current = null;
        setScrollTop(el.scrollTop);
      });
    };

    setContainerHeight(el.clientHeight || 600);
    setScrollTop(el.scrollTop || 0);
    el.addEventListener('scroll', handleScroll, { passive: true });

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerHeight(entry.contentRect.height);
      }
    });
    observer.observe(el);

    return () => {
      el.removeEventListener('scroll', handleScroll);
      observer.disconnect();
      if (rafScrollRef.current !== null) {
        cancelAnimationFrame(rafScrollRef.current);
      }
    };
  }, [tracks.length > 0]); // Re-attach properly whenever switching between 0 tracks (empty state) and >0 tracks (table mounted)

  // Keyboard shortcut for CTRL+A (Select All) and Delete / Backspace (Clear/Delete selected tracks)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((document.activeElement as HTMLElement)?.tagName)) {
        return;
      }
      // Ctrl+A or Cmd+A
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        const allIds = tracks.map(t => t.id);
        updateSelectedTrackIds(allIds);
      }
      // Ctrl+I or Cmd+I
      const isCheckboxEngaged = (visibleColumns || []).includes('checkbox') && checkedTrackIds && checkedTrackIds.size > 0;
      const targetIds = isCheckboxEngaged ? Array.from(checkedTrackIds!) : selectedTrackIdsRef.current;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'i' && targetIds.length > 0) {
        e.preventDefault();
        const selected = sortedTracksRef.current.filter(t => targetIds.includes(t.id));
        if (selected.length === 1) {
          onOpenGetInfo(selected[0], sortedTracksRef.current);
        } else if (selected.length > 1) {
          onOpenGetInfo(selected as any, sortedTracksRef.current);
        }
      }
      // Delete or Backspace
      if ((e.key === 'Delete' || e.key === 'Backspace') && targetIds.length > 0) {
        e.preventDefault();
        const idsToDelete = [...targetIds];
        updateSelectedTrackIds([]);
        if (onDeleteTracks) {
          onDeleteTracks(idsToDelete);
        } else {
          idsToDelete.forEach(id => onDeleteTrack(id));
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [tracks, onDeleteTracks, onDeleteTrack, onOpenGetInfo, checkedTrackIds, visibleColumns]);

  const [internalVisibleColumns, setInternalVisibleColumns] = useState<ColumnId[]>(() => {
    try {
      const saved = localStorage.getItem(`${storageScope}_visible_columns`) || (storageScope === 'classitunes' ? (localStorage.getItem('classitunes_visible_columns') || localStorage.getItem('itunes_visible_columns')) : null);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          // If the user's saved list does not have 'checkbox' recorded yet (e.g. from older version),
          // ensure 'checkbox' is placed at the front so it is visible by default
          const validIds = ALL_COLUMNS.map(c => c.id);
          const filtered = parsed.filter((id: any) => validIds.includes(id));
          if (!filtered.includes('checkbox')) {
            filtered.unshift('checkbox');
          }
          return filtered;
        }
      }
    } catch (e) {}
    return defaultVisibleColumns || DEFAULT_VISIBLE;
  });

  const visibleColumns = propVisibleColumns !== undefined ? propVisibleColumns : internalVisibleColumns;

  const [columnOrder, setColumnOrder] = useState<ColumnId[]>(() => getInitialColumnOrder(storageScope));

  const saveColumnOrder = useCallback((newOrder: ColumnId[]) => {
    setColumnOrder(newOrder);
    try {
      localStorage.setItem(`${storageScope}_column_order`, JSON.stringify(newOrder));
    } catch (e) {}
  }, [storageScope]);

  const setVisibleColumns = useCallback((cols: ColumnId[]) => {
    if (propOnVisibleColumnsChange) {
      propOnVisibleColumnsChange(cols);
    } else {
      setInternalVisibleColumns(cols);
      try {
        localStorage.setItem(`${storageScope}_visible_columns`, JSON.stringify(cols));
        window.dispatchEvent(new CustomEvent(`${storageScope}:checked-changed`));
      } catch (e) {}
    }
  }, [propOnVisibleColumnsChange, storageScope]);

  const [columnWidths, setColumnWidths] = useState<Record<ColumnId, number>>(() => {
    try {
      const saved = localStorage.getItem(`${storageScope}_column_widths`) || (storageScope === 'classitunes' ? (localStorage.getItem('classitunes_column_widths') || localStorage.getItem('itunes_column_widths')) : null);
      if (saved) {
        const parsed = JSON.parse(saved);
        return { ...DEFAULT_COLUMN_WIDTHS, ...parsed };
      }
    } catch (e) {}
    return DEFAULT_COLUMN_WIDTHS;
  });

  const [resizingCol, setResizingCol] = useState<{ id: ColumnId; startX: number; startWidth: number } | null>(null);

  // Column Reordering State (Mouse-driven for 100% reliable desktop/Tauri behavior without OS drag restrictions)
  const [draggingHeader, setDraggingHeader] = useState<{
    colId: ColumnId;
    label: string;
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
    isDragging: boolean;
  } | null>(null);
  const [dropTargetCol, setDropTargetCol] = useState<{
    colId: ColumnId;
    position: 'before' | 'after';
  } | null>(null);

  const columnConfigMap = useMemo(() => {
    const map = new Map<ColumnId, ColumnConfig>();
    ALL_COLUMNS.forEach(c => map.set(c.id, c));
    return map;
  }, []);

  const activeColumns = useMemo(() => {
    return visibleColumns
      .map(id => columnConfigMap.get(id))
      .filter((col): col is ColumnConfig => Boolean(col));
  }, [visibleColumns, columnConfigMap]);

  const moveColumn = (fromColId: ColumnId, toColId: ColumnId, position: 'before' | 'after') => {
    const fromIndex = columnOrder.indexOf(fromColId);
    const toIndex = columnOrder.indexOf(toColId);
    if (fromIndex === -1 || toIndex === -1 || fromColId === toColId) return;

    const newOrder = [...columnOrder];
    newOrder.splice(fromIndex, 1);
    const targetIdx = newOrder.indexOf(toColId);
    const insertIdx = position === 'after' ? targetIdx + 1 : targetIdx;
    newOrder.splice(insertIdx, 0, fromColId);

    saveColumnOrder(newOrder);

    // Apply new order to the currently visible subset
    const visibleSet = new Set(visibleColumns);
    const updated = newOrder.filter(id => visibleSet.has(id));
    setVisibleColumns(updated);
  };

  const shiftColumn = (colId: ColumnId, direction: 'up' | 'down') => {
    const visibleIndex = visibleColumns.indexOf(colId);
    if (visibleIndex === -1) return;
    if (direction === 'up' && visibleIndex === 0) return;
    if (direction === 'down' && visibleIndex === visibleColumns.length - 1) return;

    const targetColId = direction === 'up' ? visibleColumns[visibleIndex - 1] : visibleColumns[visibleIndex + 1];
    moveColumn(colId, targetColId, direction === 'up' ? 'before' : 'after');
  };

  const handleHeaderMouseDown = (col: ColumnConfig, e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('.col-resizer') || target.closest('button') || target.closest('input')) {
      return;
    }
    e.preventDefault();
    setDraggingHeader({
      colId: col.id,
      label: col.label,
      startX: e.clientX,
      startY: e.clientY,
      currentX: e.clientX,
      currentY: e.clientY,
      isDragging: false,
    });
  };

  useEffect(() => {
    if (!draggingHeader) return;

    const handleMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - draggingHeader.startX;
      const dy = e.clientY - draggingHeader.startY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const isDragging = draggingHeader.isDragging || dist > 4;

      setDraggingHeader(prev => {
        if (!prev) return null;
        return {
          ...prev,
          currentX: e.clientX,
          currentY: e.clientY,
          isDragging,
        };
      });

      if (isDragging) {
        // Find which column header we are hovering over or closest to
        const headerElements = Array.from(document.querySelectorAll<HTMLTableCellElement>('th[data-column-id]'));
        let target: { colId: ColumnId; position: 'before' | 'after' } | null = null;

        for (const th of headerElements) {
          const colId = th.getAttribute('data-column-id') as ColumnId;
          if (!colId || colId === draggingHeader.colId) continue;

          const rect = th.getBoundingClientRect();
          if (e.clientX >= rect.left && e.clientX <= rect.right) {
            const midX = rect.left + rect.width / 2;
            target = { colId, position: e.clientX < midX ? 'before' : 'after' };
            break;
          }
        }

        // Check if dragged beyond first or last header
        if (!target && headerElements.length > 0) {
          const firstTh = headerElements[0];
          const lastTh = headerElements[headerElements.length - 1];
          const firstRect = firstTh.getBoundingClientRect();
          const lastRect = lastTh.getBoundingClientRect();

          if (e.clientX < firstRect.left) {
            const firstColId = firstTh.getAttribute('data-column-id') as ColumnId;
            if (firstColId && firstColId !== draggingHeader.colId) {
              target = { colId: firstColId, position: 'before' };
            }
          } else if (e.clientX > lastRect.right) {
            const lastColId = lastTh.getAttribute('data-column-id') as ColumnId;
            if (lastColId && lastColId !== draggingHeader.colId) {
              target = { colId: lastColId, position: 'after' };
            }
          }
        }

        setDropTargetCol(target);
      }
    };

    const handleMouseUp = () => {
      if (draggingHeader.isDragging && dropTargetCol) {
        moveColumn(draggingHeader.colId, dropTargetCol.colId, dropTargetCol.position);
      } else if (!draggingHeader.isDragging) {
        // Plain click without drag: sort by this column
        const col = ALL_COLUMNS.find(c => c.id === draggingHeader.colId);
        if (col) {
          handleSort(col.sortKey);
        }
      }
      setDraggingHeader(null);
      setDropTargetCol(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [draggingHeader, dropTargetCol]);

  const handleResizeMouseDown = (colId: ColumnId, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setResizingCol({
      id: colId,
      startX: e.clientX,
      startWidth: columnWidths[colId] || DEFAULT_COLUMN_WIDTHS[colId],
    });
  };

  useEffect(() => {
    if (!resizingCol) return;

    let pendingWidth: number | null = null;

    const handleMouseMove = (e: MouseEvent) => {
      const diff = e.clientX - resizingCol.startX;
      const newWidth = Math.max(35, resizingCol.startWidth + diff);
      pendingWidth = newWidth;
      setColumnWidths(prev => ({ ...prev, [resizingCol.id]: newWidth }));
    };

    const handleMouseUp = () => {
      // Persist to localStorage only once on release, not on every pixel (#9)
      if (pendingWidth !== null) {
        setColumnWidths(prev => {
          const updated = { ...prev, [resizingCol.id]: pendingWidth! };
          try {
            localStorage.setItem(`${storageScope}_column_widths`, JSON.stringify(updated));
          } catch (err) {}
          return updated;
        });
      }
      setResizingCol(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizingCol, storageScope]);

  const isLight = theme === 'light';
  // Centralized detection for Linux/WebKitGTK to disable compositing-heavy CSS that causes scroll jank.
  const isLinux = platformInfo.isLinux;
  const userPlaylists = useMemo(() => playlists.filter(p => !p.systemType || p.systemType === 'user'), [playlists]);

  const handleSort = (field: keyof Track) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(true);
    }
  };

  // Define sortedTracks BEFORE any callbacks/effects that reference it to avoid TDZ ReferenceError
  const sortedTracks = useMemo(() => {
    const sorted = [...tracks].sort((a, b) => {
      if (sortField === ('isChecked' as any)) {
        const aChecked = checkedTrackIds.has(a.id);
        const bChecked = checkedTrackIds.has(b.id);
        if (aChecked !== bChecked) {
          return sortAsc ? (aChecked ? -1 : 1) : (aChecked ? 1 : -1);
        }
        return 0;
      }

      let valA = a[sortField];
      let valB = b[sortField];

      if (valA === undefined || valA === null) valA = '';
      if (valB === undefined || valB === null) valB = '';

      if (typeof valA === 'string' && typeof valB === 'string') {
        if (valA === valB) return 0;
        const strA = valA.toLowerCase();
        const strB = valB.toLowerCase();
        if (strA < strB) return sortAsc ? -1 : 1;
        if (strA > strB) return sortAsc ? 1 : -1;
        return 0;
      }
      
      if (typeof valA === 'number' && typeof valB === 'number') {
        return sortAsc ? valA - valB : valB - valA;
      }

      return 0;
    });
    return sorted;
  }, [tracks, sortField, sortAsc, checkedTrackIds]);

  const sortedTracksRef = useRef<Track[]>(sortedTracks);
  sortedTracksRef.current = sortedTracks;

  const handlePlayTrackRow = useCallback((track: Track) => {
    onPlayTrack(track, sortedTracksRef.current);
  }, [onPlayTrack]);

  const handleAddSelectedToPlaylist = useCallback((playlistId: string, fallbackTrackId: string) => {
    const ids = selectedTrackIdsRef.current.length > 0 ? selectedTrackIdsRef.current : [fallbackTrackId];
    ids.forEach(id => onAddTrackToPlaylist(id, playlistId));
  }, [onAddTrackToPlaylist]);

  const handleDeleteSelected = useCallback((fallbackTrackId: string) => {
    const ids = selectedTrackIdsRef.current.length > 0 ? selectedTrackIdsRef.current : [fallbackTrackId];
    if (onDeleteTracks) {
      onDeleteTracks(ids);
    } else {
      ids.forEach(id => onDeleteTrack(id));
    }
    updateSelectedTrackIds([]);
  }, [onDeleteTracks, onDeleteTrack, updateSelectedTrackIds]);

  const handleOpenGetInfoRow = useCallback((track: Track) => {
    onOpenGetInfo(track, sortedTracksRef.current);
  }, [onOpenGetInfo]);

  const handleTrackContextMenuRow = useCallback((track: Track, e: React.MouseEvent) => {
    onTrackContextMenu?.(track, e, sortedTracksRef.current);
  }, [onTrackContextMenu]);

  const toggleColumn = (colId: ColumnId) => {
    let updated: ColumnId[];
    const isCurrentlyVisible = visibleColumns.includes(colId);

    if (isCurrentlyVisible) {
      if (colId === 'title' && visibleColumns.length === 1) return; // Keep title at minimum
      updated = visibleColumns.filter(id => id !== colId);
    } else {
      // Re-enabling column: restore it at its exact relative position from columnOrder
      const visibleSet = new Set([...visibleColumns, colId]);
      updated = columnOrder.filter(id => visibleSet.has(id));
    }

    setVisibleColumns(updated);
  };

  const resetColumns = () => {
    saveColumnOrder([...ALL_COLUMN_IDS]);
    setVisibleColumns(DEFAULT_VISIBLE);
  };

  // Windowed Virtualization Calculation: on Linux/WebKitGTK use 35 rows overscan buffer
  // to ensure zero blank frame stutter during high-speed momentum mousewheel/touchpad scrolling
  const OVERSCAN = 30;
  const totalTrackCount = sortedTracks.length;
  const isVirtualizationActive = totalTrackCount > 60;
  const [measuredRowHeight, setMeasuredRowHeight] = useState(estimatedRowHeight);
  const [tableHeaderHeight, setTableHeaderHeight] = useState(0);

  const rowH = Math.max(20, measuredRowHeight || estimatedRowHeight || 36);
  const contentScrollTop = Math.max(0, scrollTop - tableHeaderHeight);
  const startIndex = isVirtualizationActive
    ? Math.max(0, Math.floor(contentScrollTop / rowH) - OVERSCAN)
    : 0;
  const visibleCount = isVirtualizationActive
    ? Math.ceil((containerHeight || 600) / rowH) + OVERSCAN * 2
    : totalTrackCount;
  const endIndex = isVirtualizationActive
    ? Math.min(totalTrackCount, startIndex + visibleCount)
    : totalTrackCount;

  const topSpacerHeight = isVirtualizationActive ? startIndex * rowH : 0;
  const bottomSpacerHeight = isVirtualizationActive ? Math.max(0, (totalTrackCount - endIndex) * rowH) : 0;

  // Memoize visible slice: only re-slices array when index boundaries actually change
  const visibleWindowTracks = useMemo(() => {
    return isVirtualizationActive ? sortedTracks.slice(startIndex, endIndex) : sortedTracks;
  }, [sortedTracks, isVirtualizationActive, startIndex, endIndex]);

  useLayoutEffect(() => {
    // Set deterministic exact row height immediately without triggering DOM layout thrashing
    setMeasuredRowHeight(estimatedRowHeight);
    const header = tableContainerRef.current?.querySelector<HTMLTableSectionElement>('thead');
    if (header) {
      const h = header.offsetHeight;
      if (h > 0) setTableHeaderHeight(h);
    }
  }, [estimatedRowHeight]);

  const resetDragAndBoxSelection = () => {
    isMouseDownRef.current = false;
    isBoxSelectingRef.current = false;
    mouseDownPosRef.current = null;
    wasBlankAreaClickRef.current = false;
    setSelectionBox(null);
  };

  // Effect for Rubberband / Box Selection mouse move and mouse up
  useEffect(() => {
    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (!isMouseDownRef.current || !mouseDownPosRef.current) return;

      const dx = e.clientX - mouseDownPosRef.current.x;
      const dy = e.clientY - mouseDownPosRef.current.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (!isBoxSelectingRef.current && distance > 5) {
        isBoxSelectingRef.current = true;
      }

      if (isBoxSelectingRef.current) {
        setSelectionBox({
          startX: mouseDownPosRef.current.x,
          startY: mouseDownPosRef.current.y,
          currentX: e.clientX,
          currentY: e.clientY,
        });

        const boxLeft = Math.min(mouseDownPosRef.current.x, e.clientX);
        const boxTop = Math.min(mouseDownPosRef.current.y, e.clientY);
        const boxRight = Math.max(mouseDownPosRef.current.x, e.clientX);
        const boxBottom = Math.max(mouseDownPosRef.current.y, e.clientY);

        const newlySelectedIds: string[] = [];
        const cachedRects = rowRectsRef.current;
        for (let i = 0; i < cachedRects.length; i++) {
          const { id, rect } = cachedRects[i];
          const intersects = !(
            boxRight <= rect.left ||
            boxLeft >= rect.right ||
            boxBottom <= rect.top ||
            boxTop >= rect.bottom
          );
          if (intersects) {
            newlySelectedIds.push(id);
          }
        }

        const combined = Array.from(new Set([...initialSelectionRef.current, ...newlySelectedIds]));
        updateSelectedTrackIds(combined);
      }
    };

    const handleGlobalMouseUp = () => {
      if (isMouseDownRef.current) {
        if (!isBoxSelectingRef.current && wasBlankAreaClickRef.current) {
          updateSelectedTrackIds([]);
        }
        resetDragAndBoxSelection();
      }
    };

    const handleGlobalDragEnd = () => {
      resetDragAndBoxSelection();
    };

    window.addEventListener('mousemove', handleGlobalMouseMove);
    window.addEventListener('mouseup', handleGlobalMouseUp);
    window.addEventListener('dragend', handleGlobalDragEnd);

    return () => {
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
      window.removeEventListener('dragend', handleGlobalDragEnd);
    };
  }, []);

  const handleContainerMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('button, input, select, textarea, a, svg, .no-box-select, th')) return;

    const isRowClick = Boolean(target.closest('tbody tr'));
    if (isRowClick) {
      wasBlankAreaClickRef.current = false;
      return;
    }

    wasBlankAreaClickRef.current = true;
    isMouseDownRef.current = true;
    mouseDownPosRef.current = { x: e.clientX, y: e.clientY };
    initialSelectionRef.current = e.shiftKey || e.ctrlKey || e.metaKey ? [...selectedTrackIdsRef.current] : [];

    // Cache currently rendered row client rects for fast box selection without layout thrashing
    // Scope to the table container only (#8), not the full document
    const rects: { id: string; rect: DOMRect }[] = [];
    const container = tableContainerRef.current;
    const renderedRows = container
      ? container.querySelectorAll<HTMLElement>('tr[id^="track-row-"]')
      : document.querySelectorAll<HTMLElement>('tr[id^="track-row-"]');
    renderedRows.forEach((rowElem) => {
      const id = rowElem.id.replace('track-row-', '');
      const rect = rowElem.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        rects.push({ id, rect });
      }
    });
    rowRectsRef.current = rects;
  };

  const handleRowClick = useCallback((trackId: string, e: React.MouseEvent) => {
    if (isBoxSelectingRef.current) return;

    let newSelection: string[];
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      if (selectedTrackIds.includes(trackId)) {
        newSelection = selectedTrackIds.filter(id => id !== trackId);
      } else {
        newSelection = [...selectedTrackIds, trackId];
      }
    } else {
      newSelection = [trackId];
    }
    updateSelectedTrackIds(newSelection);
  }, [selectedTrackIds, updateSelectedTrackIds]);

  const handleDragStart = useCallback((e: React.DragEvent, track: Track) => {
    resetDragAndBoxSelection();
    const isCheckboxEngaged = (visibleColumns || []).includes('checkbox') && checkedTrackIds && checkedTrackIds.size > 0;
    let idsToDrag: string[];
    if (isCheckboxEngaged && (checkedTrackIds!.has(track.id) || selectedTrackIdsRef.current.includes(track.id) || selectedTrackIdsRef.current.length <= 1)) {
      idsToDrag = Array.from(checkedTrackIds!);
    } else {
      const currentSelected = selectedTrackIdsRef.current;
      idsToDrag = currentSelected.includes(track.id) ? currentSelected : [track.id];
      if (!currentSelected.includes(track.id)) {
        updateSelectedTrackIds([track.id]);
      }
    }

    const json = JSON.stringify(idsToDrag);
    e.dataTransfer.setData('application/classiplayer-tracks', json);
    e.dataTransfer.setData('text/plain', json);
    e.dataTransfer.effectAllowed = 'all';

    (window as any).__activeDraggedTrackIds = idsToDrag;

    // Create a floating badge for drag visual feedback
    try {
      const badge = document.createElement('div');
      badge.style.position = 'fixed';
      badge.style.left = '-9999px';
      badge.style.top = '-9999px';
      badge.style.padding = '4px 10px';
      badge.style.background = '#2563eb';
      badge.style.color = '#ffffff';
      badge.style.borderRadius = '6px';
      badge.style.fontSize = '12px';
      badge.style.fontWeight = '600';
      badge.style.boxShadow = '0 4px 12px rgba(0,0,0,0.35)';
      badge.style.pointerEvents = 'none';
      badge.style.zIndex = '99999';
      badge.textContent = idsToDrag.length > 1 ? `${idsToDrag.length} Songs` : (track.title || '1 Song');
      document.body.appendChild(badge);
      e.dataTransfer.setDragImage(badge, 20, 15);
      setTimeout(() => {
        if (badge.parentNode) badge.parentNode.removeChild(badge);
      }, 0);
    } catch {}
  }, [updateSelectedTrackIds]);

  const handleDragEnd = useCallback(() => {
    resetDragAndBoxSelection();
    (window as any).__activeDraggedTrackIds = null;
  }, []);

  if (tracks.length === 0) {
    if (searchQuery && searchQuery.trim().length > 0) {
      return (
        <div className={`flex-1 flex flex-col items-center justify-center p-8 text-center transition-colors duration-200 select-none ${
          isLight ? 'bg-white text-gray-500' : 'bg-[#121212] text-gray-500'
        }`}>
          <div className={`w-16 h-16 rounded-full flex items-center justify-center mb-3.5 border ${
            isLight ? 'bg-amber-50 border-amber-200 text-amber-600' : 'bg-amber-950/30 border-amber-800/30 text-amber-400'
          }`}>
            <Search className="w-8 h-8" />
          </div>
          <h3 className={`text-base font-bold mb-1 ${isLight ? 'text-gray-900' : 'text-white'}`}>
            No Results Found
          </h3>
          <p className={`text-xs max-w-sm mb-4 ${isLight ? 'text-gray-600' : 'text-gray-400'}`}>
            No songs, artists, or albums matched <span className="font-semibold text-amber-500">"{searchQuery}"</span>.
          </p>
          {onClearSearch && (
            <button
              onClick={onClearSearch}
              className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium rounded-lg border shadow-sm transition-all cursor-pointer ${
                isLight 
                  ? 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-300 active:bg-slate-300' 
                  : 'bg-white/10 hover:bg-white/15 text-slate-200 border-white/10 hover:text-white active:bg-white/20'
              }`}
            >
              <X className="w-3.5 h-3.5" />
              Clear Search
            </button>
          )}
        </div>
      );
    }

    const isFolderEmpty = selectedPlaylist?.isFolder;
    const isPlaylistEmpty = selectedPlaylist && !selectedPlaylist.systemType && !selectedPlaylist.isFolder;

    return (
      <div className={`flex-1 flex flex-col items-center justify-center p-8 text-center transition-colors duration-200 select-none ${
        isLight ? 'bg-white text-gray-500' : 'bg-[#121212] text-gray-500'
      }`}>
        <div className={`w-20 h-20 rounded-full flex items-center justify-center mb-4 border ${
          isLight ? 'bg-blue-50 border-blue-200 text-blue-600' : 'bg-indigo-950/40 border-indigo-800/40 text-indigo-400'
        }`}>
          {isFolderEmpty ? (
            <Folder className="w-10 h-10 text-blue-500" />
          ) : (
            <Music className="w-10 h-10" />
          )}
        </div>
        <h3 className={`text-base font-bold mb-1 ${isLight ? 'text-gray-900' : 'text-white'}`}>
          {isFolderEmpty ? `"${selectedPlaylist.name}" is Empty` : isPlaylistEmpty ? `"${selectedPlaylist.name}" is Empty` : 'Your Library is Empty'}
        </h3>
        <p className={`text-xs max-w-sm mb-4 ${isLight ? 'text-gray-600' : 'text-gray-400'}`}>
          {isFolderEmpty
            ? 'Drag playlists into this folder in the sidebar, or right-click the folder to create a new playlist.'
            : isPlaylistEmpty
            ? 'Drag songs from your library into this playlist in the sidebar, or import new files.'
            : 'Drag and drop audio files anywhere onto ClassiTunes, or click below to import music files from your device.'}
        </p>
        {!isFolderEmpty && onImportFiles && (
          <ImportMusicButton
            onImportFiles={onImportFiles}
            onStartImporting={onStartImporting}
            isLight={isLight}
            buttonText="Import Music Files"
          />
        )}
      </div>
    );
  }

  return (
    <div className={`flex-1 flex flex-col h-full select-none overflow-hidden text-[12px] transition-colors duration-200 relative ${
      isLight ? 'bg-white text-gray-800' : 'bg-[#121212] text-gray-300'
    }`}>
      {/* Table Container */}
      <div
        ref={tableContainerRef}
        className="flex-1 overflow-auto custom-scrollbar relative"
        onMouseDown={handleContainerMouseDown}
        // On Linux/WebKitGTK, explicitly promoting the scroll container to its own
        // compositor layer avoids the browser having to repaint the full-page layer
        // on every scroll event. transform: translateZ(0) ensures hardware rasterization.
        style={{ willChange: 'transform, scroll-position', transform: 'translateZ(0)' }}
      >
        {/* Rubberband / Box Selection Overlay Portaled to Document Body so transforms/offsets never displace it */}
        {selectionBox && typeof document !== 'undefined' && createPortal(
          <div
            className="fixed pointer-events-none z-50 border border-blue-500 bg-blue-500/20 dark:bg-blue-400/20 dark:border-blue-400 rounded-sm shadow-sm"
            style={{
              left: `${Math.min(selectionBox.startX, selectionBox.currentX)}px`,
              top: `${Math.min(selectionBox.startY, selectionBox.currentY)}px`,
              width: `${Math.abs(selectionBox.currentX - selectionBox.startX)}px`,
              height: `${Math.abs(selectionBox.currentY - selectionBox.startY)}px`,
            }}
          />,
          document.body
        )}

        <table className="w-full text-left border-collapse table-fixed">
          {/* Sticky Table Header */}
          <thead 
            onContextMenu={(e) => {
              e.preventDefault();
              setShowColumnPicker(!showColumnPicker);
            }}
            className={`sticky top-0 z-20 text-[12px] font-bold shadow-sm border-b transition-colors ${
              isLight
                ? 'bg-gradient-to-b from-[#f8fafc] to-[#e2e8f0] border-[#cbd5e1] text-[#475569]'
                : 'bg-[#1a1a1a] border-[#2e2e2e] text-gray-400'
            }`}
          >
            <tr>
              {activeColumns.map(col => {
                const isSorted = sortField === col.sortKey;
                const colWidth = columnWidths[col.id] || DEFAULT_COLUMN_WIDTHS[col.id];
                const isBeingDragged = draggingHeader?.isDragging && draggingHeader.colId === col.id;
                const isDropTarget = draggingHeader?.isDragging && dropTargetCol?.colId === col.id;

                return (
                  <th
                    key={col.id}
                    data-column-id={col.id}
                    onMouseDown={(e) => handleHeaderMouseDown(col, e)}
                    style={{ width: `${colWidth}px`, minWidth: `${colWidth}px` }}
                    title={col.id === 'checkbox' ? 'Click to select / unselect all songs • Drag to reorder column' : `Drag to reorder column • Click to sort by ${col.label}`}
                    className={`group/col relative py-2 ${col.id === 'checkbox' ? 'px-1' : 'px-2.5'} border-r cursor-grab active:cursor-grabbing truncate select-none transition-all ${
                      isBeingDragged ? 'opacity-40 bg-blue-500/15' : ''
                    } ${
                      col.align === 'center' ? 'text-center' : col.align === 'right' ? 'text-right pr-3' : 'text-left'
                    } ${
                      isLight 
                        ? 'border-[#cbd5e1] hover:bg-slate-200/70 hover:text-gray-900' 
                        : 'border-[#2e2e2e] hover:bg-white/5 hover:text-white'
                    } ${isDropTarget ? (dropTargetCol.position === 'before' ? 'border-l-2 border-l-blue-500' : 'border-r-2 border-r-blue-500') : ''}`}
                  >
                    {col.id === 'checkbox' ? (
                      <div className="flex items-center justify-center">
                        <input
                          type="checkbox"
                          checked={areAllTracksChecked}
                          ref={(el) => {
                            if (el) el.indeterminate = areSomeTracksChecked;
                          }}
                          onChange={handleToggleCheckAll}
                          onClick={(e) => e.stopPropagation()}
                          className={`w-3.5 h-3.5 rounded cursor-pointer transition-colors ${
                            isLight
                              ? 'accent-blue-600 border-gray-300'
                              : 'accent-indigo-500 border-neutral-600'
                          }`}
                          title={areAllTracksChecked ? 'Uncheck all songs' : 'Check all songs'}
                        />
                      </div>
                    ) : (
                      <div className={`flex items-center gap-1.5 ${col.align === 'center' ? 'justify-center' : col.align === 'right' ? 'justify-end' : 'justify-start'}`}>
                        <span>{col.label}</span>
                        {isSorted && (
                          sortAsc ? (
                            <ArrowUp className={`w-3 h-3 flex-shrink-0 ${isLight ? 'text-blue-600' : 'text-indigo-400'}`} />
                          ) : (
                            <ArrowDown className={`w-3 h-3 flex-shrink-0 ${isLight ? 'text-blue-600' : 'text-indigo-400'}`} />
                          )
                        )}
                      </div>
                    )}

                    {/* Resizer Drag Handle */}
                    <div
                      className="col-resizer absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-blue-500/50 z-30 group"
                      onMouseDown={(e) => handleResizeMouseDown(col.id, e)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </th>
                );
              })}

              {/* Column Settings Header Button */}
              <th className="w-10 py-2 px-1 text-center relative">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowColumnPicker(!showColumnPicker);
                  }}
                  className={`p-1 rounded transition-colors ${
                    isLight 
                      ? 'text-gray-500 hover:text-blue-600 hover:bg-gray-300/50' 
                      : 'text-gray-400 hover:text-indigo-400 hover:bg-white/10'
                  }`}
                  title="Customize Columns (Right-click header anytime)"
                  id="customize-columns-btn"
                >
                  <SlidersHorizontal className="w-3.5 h-3.5 mx-auto" />
                </button>
              </th>
            </tr>
          </thead>

          {/* Table Body with Alternating Zebra Stripes & Virtualized Windowing */}
          <tbody className={isLight ? 'divide-y divide-gray-200' : 'divide-y divide-white/5'}>
            {topSpacerHeight > 0 && (
              <tr style={{ height: `${topSpacerHeight}px`, pointerEvents: 'none' }} aria-hidden="true">
                <td colSpan={activeColumns.length + 1} style={{ height: `${topSpacerHeight}px`, padding: 0, border: 'none' }}>
                  <div style={{ height: `${topSpacerHeight}px` }} />
                </td>
              </tr>
            )}

            {visibleWindowTracks.map((track, i) => {
              const idx = isVirtualizationActive ? startIndex + i : i;
              const isCurrentPlaying = currentTrack?.id === track.id;
              const isSelected = selectedTrackSet.has(track.id);
              const isCheckedTrack = checkedTrackIds.has(track.id);
              const isZebraOdd = idx % 2 === 1;

              return (
                <TrackRow
                  key={track.id}
                  track={track}
                  idx={idx}
                  isCurrentPlaying={isCurrentPlaying}
                  isPlaying={isPlaying}
                  isSelected={isSelected}
                  isCheckedTrack={isCheckedTrack}
                  isZebraOdd={isZebraOdd}
                  visibleColumns={visibleColumns}
                  columnWidths={columnWidths}
                  isLight={isLight}
                  isLinux={isLinux}
                  pyClass={pyClass}
                  isMenuOpen={contextMenuTrackId === track.id}
                  userPlaylists={userPlaylists}
                  onPlayTrackRow={handlePlayTrackRow}
                  onToggleCheckTrack={handleToggleCheckTrack}
                  onUpdateRating={onUpdateRating}
                  onOpenGetInfo={handleOpenGetInfoRow}
                  onDeleteSelected={handleDeleteSelected}
                  onAddSelectedToPlaylist={handleAddSelectedToPlaylist}
                  onTrackContextMenu={handleTrackContextMenuRow}
                  handleRowClick={handleRowClick}
                  handleDragStart={handleDragStart}
                  handleDragEnd={handleDragEnd}
                  setContextMenuTrackId={setContextMenuTrackId}
                  updateSelectedTrackIds={updateSelectedTrackIds}
                  isDeviceScope={storageScope === 'device'}
                />
              );
            })}

            {bottomSpacerHeight > 0 && (
              <tr style={{ height: `${bottomSpacerHeight}px`, pointerEvents: 'none' }} aria-hidden="true">
                <td colSpan={activeColumns.length + 1} style={{ height: `${bottomSpacerHeight}px`, padding: 0, border: 'none' }}>
                  <div style={{ height: `${bottomSpacerHeight}px` }} />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Floating Column Drag Preview Pill */}
      {draggingHeader?.isDragging && (
        <div
          className="fixed z-50 pointer-events-none px-3 py-1.5 rounded-md shadow-2xl text-xs font-bold flex items-center gap-1.5 border backdrop-blur-md transition-none"
          style={{
            left: `${draggingHeader.currentX + 12}px`,
            top: `${draggingHeader.currentY + 12}px`,
            backgroundColor: isLight ? 'rgba(255, 255, 255, 0.95)' : 'rgba(30, 30, 30, 0.95)',
            color: isLight ? '#1e293b' : '#f1f5f9',
            borderColor: isLight ? '#94a3b8' : '#475569',
            boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.3), 0 8px 10px -6px rgba(0, 0, 0, 0.3)',
          }}
        >
          <GripVertical className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
          <span>{draggingHeader.label}</span>
        </div>
      )}

      {/* Column Customization Popover Dialog */}
      {showColumnPicker && (
        <>
          <div 
            className="fixed inset-0 z-40" 
            onClick={() => setShowColumnPicker(false)} 
          />
          <div className={`absolute top-9 right-3 z-50 w-52 py-2 rounded-lg border shadow-2xl backdrop-blur-md text-xs animate-in fade-in zoom-in-95 duration-100 ${
            isLight
              ? 'bg-white/95 border-gray-300 text-gray-800 shadow-xl'
              : 'bg-[#252525]/95 border-white/10 text-gray-100 shadow-2xl'
          }`}>
            <div className={`px-3 py-1 mb-1 font-bold text-[10px] uppercase tracking-wider flex items-center justify-between border-b pb-1.5 ${
              isLight ? 'border-gray-200 text-gray-500' : 'border-white/10 text-gray-400'
            }`}>
              <span>Visible Columns</span>
              <Columns className="w-3 h-3" />
            </div>

            <div className="max-h-72 overflow-y-auto custom-scrollbar py-0.5">
              {ALL_COLUMNS.map((col) => {
                const isChecked = visibleColumns.includes(col.id);
                const visibleIdx = visibleColumns.indexOf(col.id);
                return (
                  <div
                    key={col.id}
                    className={`w-full px-2.5 py-1.5 flex items-center justify-between text-left transition-colors group ${
                      isLight
                        ? 'hover:bg-blue-50 text-gray-700'
                        : 'hover:bg-white/10 text-gray-200'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => toggleColumn(col.id)}
                      className="flex-1 flex items-center gap-2 truncate text-left cursor-pointer"
                    >
                      <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors flex-shrink-0 ${
                        isChecked
                          ? isLight
                            ? 'bg-blue-600 border-blue-600 text-white'
                            : 'bg-indigo-600 border-indigo-600 text-white'
                          : isLight
                          ? 'border-gray-300 bg-gray-50'
                          : 'border-gray-600 bg-transparent'
                      }`}>
                        {isChecked && <Check className="w-3 h-3 stroke-[3]" />}
                      </div>
                      <span className="truncate">{col.label}</span>
                    </button>

                    {isChecked && (
                      <div className="flex items-center gap-0.5 ml-2 opacity-60 group-hover:opacity-100 transition-opacity">
                        <button
                          type="button"
                          disabled={visibleIdx === 0}
                          onClick={(e) => {
                            e.stopPropagation();
                            shiftColumn(col.id, 'up');
                          }}
                          className={`p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10 disabled:opacity-20 disabled:hover:bg-transparent ${
                            isLight ? 'text-gray-600 hover:text-blue-600' : 'text-gray-400 hover:text-white'
                          }`}
                          title="Move Left"
                        >
                          <ChevronUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={visibleIdx === visibleColumns.length - 1}
                          onClick={(e) => {
                            e.stopPropagation();
                            shiftColumn(col.id, 'down');
                          }}
                          className={`p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10 disabled:opacity-20 disabled:hover:bg-transparent ${
                            isLight ? 'text-gray-600 hover:text-blue-600' : 'text-gray-400 hover:text-white'
                          }`}
                          title="Move Right"
                        >
                          <ChevronDown className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className={`px-3 py-2 border-t border-b ${isLight ? 'border-gray-200 bg-gray-50/50' : 'border-white/10 bg-black/10'}`}>
              <div className={`font-bold text-[10px] uppercase tracking-wider mb-1.5 ${isLight ? 'text-gray-500' : 'text-gray-400'}`}>
                Row Height
              </div>
              <div className="flex rounded bg-black/5 dark:bg-black/30 p-0.5">
                {(['compact', 'normal', 'relaxed'] as const).map((h) => (
                  <button
                    key={h}
                    type="button"
                    onClick={() => changeRowHeight(h)}
                    className={`flex-1 py-1 text-[10px] rounded text-center capitalize transition-all ${
                      rowHeight === h
                        ? isLight
                          ? 'bg-white text-blue-600 shadow-sm font-bold'
                          : 'bg-[#3a3a3a] text-white shadow-sm font-semibold'
                        : isLight
                        ? 'text-gray-500 hover:text-gray-900 hover:bg-white/40'
                        : 'text-gray-400 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    {h}
                  </button>
                ))}
              </div>
            </div>

            <div className={`border-t mt-1.5 pt-1 px-2 ${isLight ? 'border-gray-200' : 'border-white/10'}`}>
              <button
                type="button"
                onClick={() => {
                  resetColumns();
                  setShowColumnPicker(false);
                }}
                className={`w-full py-1 px-2 rounded text-[11px] flex items-center justify-center gap-1.5 transition-colors ${
                  isLight
                    ? 'hover:bg-gray-100 text-gray-600'
                    : 'hover:bg-white/10 text-gray-400 hover:text-white'
                }`}
              >
                <RotateCcw className="w-3 h-3" />
                <span>Reset to Default</span>
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export const ListView = React.memo(ListViewComponent);

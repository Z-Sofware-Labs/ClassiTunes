import React, { useState, useEffect, useRef, useMemo, useCallback, createContext, useContext } from 'react';
import { createPortal } from 'react-dom';
import { Album, Track, AlbumSortField } from '../types';
import { Play, Star, Disc, X, Shuffle, Volume2, Info, Check } from 'lucide-react';
import { ImportMusicButton } from './ImportMusicButton';
import { getCachedArtwork, setCachedArtwork, getArtwork } from '../services/mediaStorage';
import { resolveNativeCoverUrlSync } from '../utils/tauriWindow';
import { platformInfo } from '../utils/platform';

interface AlbumGridViewProps {
  albums: Album[];
  currentTrack: Track | null;
  isPlaying: boolean;
  onPlayTrack: (track: Track, albumTracks?: Track[]) => void;
  onUpdateRating: (trackId: string, rating: number) => void;
  onOpenGetInfo: (trackOrTracks: Track | Track[], navigationTracks?: Track[]) => void;
  onTrackContextMenu?: (track: Track, e: React.MouseEvent, navigationTracks?: Track[]) => void;
  onBackgroundContextMenu?: (e: React.MouseEvent) => void;
  onImportFiles?: (files: FileList | File[] | string[]) => void;
  onStartImporting?: (statusText?: string) => void;
  theme?: 'dark' | 'light';
  searchQuery?: string;
  onClearSearch?: () => void;
  selectedTrackIds?: string[];
  onSelectionChange?: (trackIds: string[]) => void;
  selectedAlbumIds?: string[];
  onSelectedAlbumIdsChange?: (albumIds: string[]) => void;
  albumSortField?: AlbumSortField;
  onAlbumSortChange?: (field: AlbumSortField) => void;
  isAlbumGrouped?: boolean;
  onToggleAlbumGrouped?: (grouped: boolean) => void;
}

export function cleanSortString(str: string): string {
  let s = str.trim();
  const lower = s.toLowerCase();
  if (lower.startsWith('the ')) return s.slice(4).trim();
  if (lower.startsWith('a ')) return s.slice(2).trim();
  if (lower.startsWith('an ')) return s.slice(3).trim();
  return s;
}

export function sortAlbumsList(albums: Album[], field: AlbumSortField = 'album'): Album[] {
  return [...albums].sort((a, b) => {
    if (field === 'artist') {
      const artistA = cleanSortString(a.artist || 'Unknown Artist');
      const artistB = cleanSortString(b.artist || 'Unknown Artist');
      const cmp = artistA.localeCompare(artistB, undefined, { numeric: true, sensitivity: 'base' });
      if (cmp !== 0) return cmp;
      const yearA = a.year || 0;
      const yearB = b.year || 0;
      if (yearA !== yearB) return yearA - yearB;
      return cleanSortString(a.name).localeCompare(cleanSortString(b.name), undefined, { numeric: true, sensitivity: 'base' });
    }

    if (field === 'genre') {
      const genreA = (a.tracks[0]?.genre || 'Unknown Genre').trim();
      const genreB = (b.tracks[0]?.genre || 'Unknown Genre').trim();
      const cmp = genreA.localeCompare(genreB, undefined, { numeric: true, sensitivity: 'base' });
      if (cmp !== 0) return cmp;
      const artistCmp = cleanSortString(a.artist || '').localeCompare(cleanSortString(b.artist || ''), undefined, { numeric: true, sensitivity: 'base' });
      if (artistCmp !== 0) return artistCmp;
      return cleanSortString(a.name).localeCompare(cleanSortString(b.name), undefined, { numeric: true, sensitivity: 'base' });
    }

    if (field === 'year') {
      const yearA = a.year && a.year > 0 ? a.year : 99999;
      const yearB = b.year && b.year > 0 ? b.year : 99999;
      if (yearA !== yearB) return yearA - yearB;
      const artistCmp = cleanSortString(a.artist || '').localeCompare(cleanSortString(b.artist || ''), undefined, { numeric: true, sensitivity: 'base' });
      if (artistCmp !== 0) return artistCmp;
      return cleanSortString(a.name).localeCompare(cleanSortString(b.name), undefined, { numeric: true, sensitivity: 'base' });
    }

    // Default: 'album'
    const nameA = cleanSortString(a.name);
    const nameB = cleanSortString(b.name);
    const cmp = nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
    if (cmp !== 0) return cmp;
    const artistCmp = cleanSortString(a.artist || '').localeCompare(cleanSortString(b.artist || ''), undefined, { numeric: true, sensitivity: 'base' });
    if (artistCmp !== 0) return artistCmp;
    const yearA = a.year || 0;
    const yearB = b.year || 0;
    return yearA - yearB;
  });
}

export interface AlbumLetterGroup {
  key: string;
  label: string;
  albums: Album[];
  rows?: Album[][];
}

export function getAlbumGroupLetter(album: Album, field: AlbumSortField): string {
  let text = '';
  if (field === 'artist') {
    text = cleanSortString(album.artist || '');
  } else if (field === 'genre') {
    text = (album.tracks[0]?.genre || '').trim();
  } else if (field === 'year') {
    if (album.year && album.year > 0) {
      const decade = Math.floor(album.year / 10) * 10;
      return `${decade}s`;
    }
    return '#';
  } else {
    // 'album'
    text = cleanSortString(album.name || '');
  }

  if (!text) return '#';
  const first = text.charAt(0).toUpperCase();
  if (first >= 'A' && first <= 'Z') {
    return first;
  }
  return '#';
}

export function groupAlbumsByLetter(albums: Album[], field: AlbumSortField): AlbumLetterGroup[] {
  const map = new Map<string, Album[]>();

  for (const album of albums) {
    const letter = getAlbumGroupLetter(album, field);
    if (!map.has(letter)) {
      map.set(letter, []);
    }
    map.get(letter)!.push(album);
  }

  const groups: AlbumLetterGroup[] = [];
  const keys = Array.from(map.keys());

  if (field === 'year') {
    keys.sort((a, b) => {
      if (a === '#') return 1;
      if (b === '#') return -1;
      return a.localeCompare(b, undefined, { numeric: true });
    });
  } else {
    keys.sort((a, b) => {
      if (a === '#') return 1;
      if (b === '#') return -1;
      return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
    });
  }

  for (const key of keys) {
    groups.push({
      key,
      label: key,
      albums: map.get(key)!,
    });
  }

  return groups;
}

// In-memory artwork cache to avoid repeated disk/IndexedDB queries
const artworkCache = {
  get: (key: string) => getCachedArtwork(key),
  set: (key: string, val: string) => setCachedArtwork(key, val),
  has: (key: string) => !!getCachedArtwork(key),
};

/** Helper to format seconds into m:ss */
function formatTime(seconds: number): string {
  if (!seconds || isNaN(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/** Helper to check if a coverUrl can be rendered directly without async hydration */
function isDirectCoverUrl(url?: string | null): url is string {
  if (!url) return false;
  return (
    url.startsWith('blob:') ||
    url.startsWith('asset:') ||
    url.startsWith('http://') ||
    url.startsWith('https://') ||
    url.startsWith('data:')
  );
}

/** Helper to resolve a coverUrl synchronously (including raw native disk cache paths) */
function getImmediateCoverUrl(url?: string | null): string | null {
  if (!url) return null;
  if (isDirectCoverUrl(url)) return url;
  const resolved = resolveNativeCoverUrlSync(url);
  if (resolved && isDirectCoverUrl(resolved)) return resolved;
  return null;
}

// ─── Shared IntersectionObserver context (#10) ───────────────────────────────
// A single observer for the entire grid — each AlbumCard registers a callback
// instead of creating its own observer instance.
type VisibilityCallback = (isVisible: boolean) => void;
const SharedIOContext = createContext<{
  observe: (el: Element, cb: VisibilityCallback) => void;
  unobserve: (el: Element) => void;
} | null>(null);

function useSharedVisibility(ref: React.RefObject<HTMLDivElement | null>, onVisible: () => void) {
  const ctx = useContext(SharedIOContext);
  const onVisibleRef = useRef(onVisible);
  onVisibleRef.current = onVisible;

  useEffect(() => {
    const el = ref.current;
    if (!el || !ctx) return;
    ctx.observe(el, (visible) => { if (visible) onVisibleRef.current(); });
    return () => ctx.unobserve(el);
  }, [ref, ctx]);
}

/** Individual Album Card with Lazy Artwork Resolution via Shared IntersectionObserver */
const AlbumCard = React.memo<{
  album: Album;
  activeAlbumTrack: Track | null;
  isSelected: boolean;
  isAlbumPlaying: boolean;
  isPlaying: boolean;
  isLight: boolean;
  onSelectAlbum: (albumId: string, e: React.MouseEvent) => void;
  onPlayAlbumCard: (album: Album) => void;
  onAlbumContextMenu?: (album: Album, e: React.MouseEvent) => void;
  allSelectedAlbums?: Album[];
}>((
{
  album,
  activeAlbumTrack,
  isSelected,
  isAlbumPlaying,
  isPlaying,
  isLight,
  onSelectAlbum,
  onPlayAlbumCard,
  onAlbumContextMenu,
  allSelectedAlbums,
}) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [coverUrl, setCoverUrl] = useState<string | null>(() => {
    const cached = artworkCache.get(album.id);
    if (cached) return cached;
    const directAlbum = getImmediateCoverUrl(album.coverUrl);
    if (directAlbum) {
      artworkCache.set(album.id, directAlbum);
      return directAlbum;
    }
    for (const t of album.tracks) {
      const directTrack = getImmediateCoverUrl(t.coverUrl);
      if (directTrack) {
        artworkCache.set(album.id, directTrack);
        return directTrack;
      }
    }
    return null;
  });
  const [imgError, setImgError] = useState(false);

  // Use shared IntersectionObserver (#10) — no per-card observer instance
  useSharedVisibility(cardRef, () => setIsVisible(true));

  // Hydrate artwork only once visible and not yet cached
  useEffect(() => {
    if (!isVisible) return;
    let isMounted = true;
    const cachedAlbumArtwork = artworkCache.get(album.id);
    if (cachedAlbumArtwork) {
      setCoverUrl(cachedAlbumArtwork);
      setImgError(false);
      return;
    }

    const sourceTrack = activeAlbumTrack || album.tracks.find(t => !!t.coverUrl) || album.tracks[0];
    const sourceKey = sourceTrack?.id || album.id;
    const sourceCoverUrl = sourceTrack?.coverUrl || album.coverUrl;
    const sourceFilePath = sourceTrack?.filePath;

    void getArtwork(sourceKey, sourceCoverUrl, sourceFilePath).then((url) => {
      if (!isMounted || !url) return;
      artworkCache.set(album.id, url);
      setCoverUrl(url);
      setImgError(false);
    }).catch(() => {});

    return () => {
      isMounted = false;
    };
  }, [album.id, album.tracks, album.coverUrl, activeAlbumTrack, isVisible]);

  const handleCardSelect = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onSelectAlbum(album.id, e);
  }, [onSelectAlbum, album.id]);

  const handleCardContextMenu = useCallback((e: React.MouseEvent) => {
    if (onAlbumContextMenu) {
      onAlbumContextMenu(album, e);
    }
  }, [onAlbumContextMenu, album]);

  return (
    <div
      ref={cardRef}
      draggable
      onDragStart={(e) => {
        const selectedAlbums = isSelected && allSelectedAlbums && allSelectedAlbums.length > 1
          ? allSelectedAlbums
          : [album];
        const allTrackIds = selectedAlbums.flatMap(a => a.tracks.map(t => t.id));
        const json = JSON.stringify(allTrackIds);
        e.dataTransfer.setData('application/classiplayer-tracks', json);
        e.dataTransfer.setData('text/plain', json);
        e.dataTransfer.effectAllowed = 'all';
        (window as any).__activeDraggedTrackIds = allTrackIds;

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
          badge.textContent = selectedAlbums.length > 1
            ? `${selectedAlbums.length} Albums (${allTrackIds.length} Songs)`
            : (album.name || '1 Album');
          document.body.appendChild(badge);
          e.dataTransfer.setDragImage(badge, 20, 15);
          setTimeout(() => {
            if (badge.parentNode) badge.parentNode.removeChild(badge);
          }, 0);
        } catch {}
      }}
      onDragEnd={() => {
        (window as any).__activeDraggedTrackIds = null;
      }}
      onContextMenu={handleCardContextMenu}
      onClick={handleCardSelect}
      style={{ WebkitUserDrag: 'element' } as React.CSSProperties}
      className={`group relative flex flex-col p-2.5 rounded-xl transition-colors duration-150 select-none cursor-pointer ${
        isSelected
          ? isLight
            ? 'bg-blue-50/90 ring-2 ring-blue-500 shadow-md'
            : 'bg-white/10 ring-2 ring-blue-400 shadow-xl'
          : isLight
            ? 'hover:bg-slate-200/60 hover:shadow-sm'
            : 'hover:bg-white/5 hover:shadow-md'
      }`}
      id={`album-card-${album.id}`}
    >
      {/* Square Album Art Thumbnail: Clicking thumbnail toggles song drawer or plays via hover button */}
      <div 
        onClick={handleCardSelect}
        className="relative aspect-square w-full rounded-lg overflow-hidden bg-[#181818] shadow-md border border-black/10 cursor-pointer"
      >
        {/* Selected Checkmark Badge */}
        {isSelected && (
          <div className="absolute top-2 left-2 z-10 w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center shadow-md animate-in zoom-in-75 duration-100">
            <Check className="w-3 h-3 stroke-[3]" />
          </div>
        )}

        {coverUrl && !imgError ? (
          <img
            src={coverUrl}
            alt={album.name}
            onError={() => setImgError(true)}
            className="w-full h-full object-cover"
            loading="lazy"
            decoding="async"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-[#2a2e36] to-[#15171a] text-slate-400">
            <Disc className="w-12 h-12 stroke-[1.2] opacity-60" />
            <span className="text-[10px] mt-1.5 font-semibold opacity-40 uppercase tracking-widest px-2 text-center truncate w-full">
              {album.name}
            </span>
          </div>
        )}

        {/* Subtle Glass Sheen */}
        <div className="absolute inset-0 bg-gradient-to-tr from-black/20 via-transparent to-white/10 pointer-events-none" />

        {/* Hover Overlay with Centered Play Circle */}
        <div 
          className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none"
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onPlayAlbumCard(album);
            }}
            className={`pointer-events-auto w-12 h-12 rounded-full text-white flex items-center justify-center shadow-2xl hover:scale-110 active:scale-95 transition-transform cursor-pointer ${
              isLight ? 'bg-blue-600 hover:bg-blue-500' : 'bg-blue-500 hover:bg-blue-400'
            }`}
            title={`Play ${album.name}`}
          >
            <Play className="w-5 h-5 fill-current ml-0.5" />
          </button>
        </div>

        {/* Playing Indicator */}
        {isAlbumPlaying && isPlaying && (
          <div className="absolute top-2 right-2 px-1.5 py-0.5 rounded-full bg-blue-600 text-white text-[10px] font-bold flex items-center gap-1 shadow">
            <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
            <span>PLAYING</span>
          </div>
        )}
      </div>

      {/* Album Text Info: Also clickable to expand */}
      <div 
        onClick={handleCardSelect}
        className="mt-2.5 flex flex-col cursor-pointer"
      >
        <h4 className={`text-xs font-bold truncate leading-snug ${isLight ? 'text-gray-900' : 'text-gray-100'}`} title={album.name}>
          {album.name}
        </h4>
        <p className={`text-[11px] truncate mt-0.5 ${isLight ? 'text-gray-600' : 'text-gray-400'}`} title={album.artist}>
          {album.artist}
        </p>
        <div className={`flex items-center justify-between text-[10px] mt-1 ${isLight ? 'text-gray-400' : 'text-gray-500'}`}>
          <span>{album.year || '—'}</span>
          <span>{album.tracks.length} {album.tracks.length === 1 ? 'song' : 'songs'}</span>
        </div>
      </div>
    </div>
  );
});

/** Classic Expanding Shelf / Tray Drawer */
const AlbumDrawer: React.FC<{
  album: Album;
  currentTrack: Track | null;
  isPlaying: boolean;
  isLight: boolean;
  selectedTrackIds?: string[];
  onSelectTracks: (trackIds: string[]) => void;
  onClose: () => void;
  onPlayTrack: (track: Track, albumTracks?: Track[]) => void;
  onPlayAlbum: (shuffle?: boolean) => void;
  onUpdateRating: (trackId: string, rating: number) => void;
  onOpenGetInfo: (trackOrTracks: Track | Track[], navigationTracks?: Track[]) => void;
  onTrackContextMenu?: (track: Track, e: React.MouseEvent, navigationTracks?: Track[]) => void;
}> = ({
  album,
  currentTrack,
  isPlaying,
  isLight,
  selectedTrackIds = [],
  onSelectTracks,
  onClose,
  onPlayTrack,
  onPlayAlbum,
  onUpdateRating,
  onOpenGetInfo,
  onTrackContextMenu,
}) => {
  const isMac = platformInfo.isMacOS;
  const [coverUrl, setCoverUrl] = useState<string | null>(() => {
    const cached = artworkCache.get(album.id);
    if (cached) return cached;
    const directAlbum = getImmediateCoverUrl(album.coverUrl);
    if (directAlbum) return directAlbum;
    for (const t of album.tracks) {
      const directTrack = getImmediateCoverUrl(t.coverUrl);
      if (directTrack) return directTrack;
    }
    return null;
  });

  useEffect(() => {
    let isMounted = true;
    const cachedAlbumArtwork = artworkCache.get(album.id);
    if (cachedAlbumArtwork) {
      setCoverUrl(cachedAlbumArtwork);
      return () => {
        isMounted = false;
      };
    }

    const activeAlbumTrack = currentTrack && album.tracks.some(t => t.id === currentTrack.id)
      ? currentTrack
      : null;
    const sourceTrack = activeAlbumTrack || album.tracks.find(t => !!t.coverUrl) || album.tracks[0];
    if (!sourceTrack && !album.coverUrl) return;
    const sourceKey = sourceTrack?.id || album.id;
    const sourceCoverUrl = sourceTrack?.coverUrl || album.coverUrl;

    void getArtwork(sourceKey, sourceCoverUrl, sourceTrack?.filePath).then((url) => {
      if (isMounted && url) {
        setCoverUrl(url);
        artworkCache.set(album.id, url);
      }
    }).catch(() => {});
    return () => {
      isMounted = false;
    };
  }, [album, currentTrack]);

  const totalDurationSeconds = useMemo(() => {
    return album.tracks.reduce((acc, t) => acc + (t.duration || 0), 0);
  }, [album.tracks]);

  // Split tracks into 2 columns if > 4 tracks (classic multi-column style)
  const [col1Tracks, col2Tracks] = useMemo(() => {
    const total = album.tracks.length;
    if (total <= 4) {
      return [album.tracks, []];
    }
    const mid = Math.ceil(total / 2);
    return [album.tracks.slice(0, mid), album.tracks.slice(mid)];
  }, [album.tracks]);

  const lastSelectedTrackIdRef = useRef<string | null>(null);

  const handleTrackClick = (track: Track, e: React.MouseEvent) => {
    e.stopPropagation();

    let newSelected: string[];
    const current = selectedTrackIds || [];
    if (e.shiftKey && lastSelectedTrackIdRef.current) {
      const lastIdx = album.tracks.findIndex(t => t.id === lastSelectedTrackIdRef.current);
      const currIdx = album.tracks.findIndex(t => t.id === track.id);
      if (lastIdx !== -1 && currIdx !== -1) {
        const start = Math.min(lastIdx, currIdx);
        const end = Math.max(lastIdx, currIdx);
        const rangeIds = album.tracks.slice(start, end + 1).map(t => t.id);
        newSelected = Array.from(new Set([...current, ...rangeIds]));
      } else {
        newSelected = [track.id];
      }
    } else if (e.ctrlKey || e.metaKey) {
      if (current.includes(track.id)) {
        newSelected = current.filter(id => id !== track.id);
      } else {
        newSelected = [...current, track.id];
      }
      lastSelectedTrackIdRef.current = track.id;
    } else {
      newSelected = [track.id];
      lastSelectedTrackIdRef.current = track.id;
    }

    onSelectTracks(newSelected);
  };

  const renderTrackItem = (track: Track, index: number, isCol2 = false) => {
    const isCurrent = currentTrack?.id === track.id;
    const isSelected = (selectedTrackIds || []).includes(track.id);
    const trackNum = track.trackNumber || (isCol2 ? col1Tracks.length + index + 1 : index + 1);

    return (
      <div
        key={track.id}
        data-track-row="true"
        draggable
        onDragStart={(e) => {
          e.stopPropagation();
          const idsToDrag = isSelected && (selectedTrackIds || []).length > 1
            ? (selectedTrackIds || [])
            : [track.id];
          const json = JSON.stringify(idsToDrag);
          e.dataTransfer.setData('application/classiplayer-tracks', json);
          e.dataTransfer.setData('text/plain', json);
          e.dataTransfer.effectAllowed = 'all';
          (window as any).__activeDraggedTrackIds = idsToDrag;
        }}
        onDragEnd={() => {
          (window as any).__activeDraggedTrackIds = null;
        }}
        onClick={(e) => handleTrackClick(track, e)}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onPlayTrack(track, album.tracks);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!(selectedTrackIds || []).includes(track.id)) {
            lastSelectedTrackIdRef.current = track.id;
            onSelectTracks([track.id]);
          }
          if (onTrackContextMenu) onTrackContextMenu(track, e, album.tracks);
        }}
        style={{ WebkitUserDrag: 'element' } as React.CSSProperties}
        className={`group flex items-center justify-between py-1.5 px-2.5 rounded text-xs transition-colors cursor-pointer select-none ${
          isSelected
            ? 'bg-blue-600 text-white font-medium shadow-sm'
            : isCurrent
              ? isLight
                ? 'bg-blue-100 text-blue-900 font-medium'
                : 'bg-blue-950/50 text-blue-200 font-medium'
              : isLight
                ? 'hover:bg-black/5 text-gray-800'
                : 'hover:bg-white/10 text-gray-200'
        }`}
      >
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          {/* Track Number / Play Button */}
          <div className="w-5 text-right shrink-0 flex items-center justify-center">
            {isCurrent && isPlaying ? (
              <Volume2 className={`w-3.5 h-3.5 animate-pulse ${isSelected ? 'text-white' : isLight ? 'text-blue-600' : 'text-blue-400'}`} />
            ) : (
              <>
                <span className={`group-hover:hidden ${isSelected ? 'text-white' : isCurrent ? (isLight ? 'text-blue-700' : 'text-blue-300') : isLight ? 'text-gray-400' : 'text-gray-500'}`}>
                  {trackNum}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onPlayTrack(track, album.tracks);
                  }}
                  className={`hidden group-hover:flex items-center justify-center ${isSelected ? 'text-white' : isCurrent ? (isLight ? 'text-blue-700' : 'text-blue-300') : isLight ? 'text-blue-600' : 'text-blue-400'}`}
                >
                  <Play className="w-3 h-3 fill-current" />
                </button>
              </>
            )}
          </div>

          {/* Track Title & Artist (for Various Artists / Compilations) */}
          <div className="flex items-baseline gap-1.5 min-w-0 flex-1 truncate">
            <span className={`truncate font-medium ${isSelected ? 'text-white' : isCurrent ? (isLight ? 'text-blue-900' : 'text-blue-200') : ''}`} title={track.title}>
              {track.title}
            </span>
            {(album.artist === 'Various Artists' || (track.artist && track.artist !== album.artist)) && (
              <span className={`text-[11px] truncate opacity-70 ${isSelected ? 'text-white/80' : isCurrent ? (isLight ? 'text-blue-800' : 'text-blue-300') : isLight ? 'text-gray-600' : 'text-gray-400'}`}>
                — {track.artist}
              </span>
            )}
          </div>
        </div>

        {/* Right Info: Rating & Duration */}
        <div className="flex items-center gap-3 shrink-0 ml-3">
          {/* Interactive Rating */}
          <div className="hidden sm:flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                onClick={(e) => {
                  e.stopPropagation();
                  onUpdateRating(track.id, star === track.rating ? 0 : star);
                }}
                className="p-0.5 hover:scale-125 transition-transform"
              >
                <Star
                  className={`w-2.5 h-2.5 ${
                    star <= (track.rating || 0)
                      ? isSelected ? 'text-amber-300 fill-amber-300' : isCurrent ? 'text-amber-400 fill-amber-400' : 'text-amber-400 fill-amber-400'
                      : isSelected ? 'text-white/40' : 'text-gray-400/50'
                  }`}
                />
              </button>
            ))}
          </div>

          {/* Duration */}
          <span className={`font-mono text-[11px] ${isSelected ? 'text-white/90' : isCurrent ? (isLight ? 'text-blue-900 font-semibold' : 'text-blue-200 font-semibold') : isLight ? 'text-gray-500' : 'text-gray-400'}`}>
            {formatTime(track.duration)}
          </span>
        </div>
      </div>
    );
  };

  return (
    <div
      onClick={(e) => {
        // If clicking on drawer background (not on a track or interactive element), clear track selection back to album
        const target = e.target as HTMLElement;
        if (!target.closest('[data-track-row="true"]') && !target.closest('button, input, a, select')) {
          onSelectTracks([]);
        }
      }}
      className={`relative w-full rounded-xl p-5 shadow-2xl border transition-all duration-200 overflow-hidden ${
      isLight
        ? 'bg-[#e9edf3] border-[#c9d3e0] text-gray-800 shadow-slate-300/60'
        : 'bg-[#202328] border-[#343a42] text-gray-200 shadow-black/80'
    }`}>
      {/* Top Close Button */}
      {isMac ? (
        <button
          type="button"
          onClick={onClose}
          className="absolute top-3.5 left-3.5 w-3 h-3 rounded-full bg-[#ff5f56] border border-[#e0443e] hover:bg-[#ff3b30] flex items-center justify-center group cursor-pointer z-20 transition-opacity"
          title="Close Album"
        >
          <X className="w-2 h-2 text-black/70 opacity-0 group-hover:opacity-100" />
        </button>
      ) : (
        <button
          type="button"
          onClick={onClose}
          className={`absolute top-3 right-3 p-1.5 rounded-full transition-colors z-20 ${
            isLight ? 'text-gray-400 hover:text-black hover:bg-black/10' : 'text-gray-400 hover:text-white hover:bg-white/10'
          }`}
          title="Close Album"
        >
          <X className="w-4 h-4" />
        </button>
      )}

      <div className="flex flex-col lg:flex-row gap-6 items-start relative z-10">
        {/* Left / Middle: Album Details & Multi-Column Tracklist */}
        <div className="flex-1 min-w-0 w-full">
          {/* Header Row */}
          <div className={`flex flex-wrap items-end justify-between gap-3 pb-3 border-b mb-4 ${isMac ? 'pl-6' : ''}`}
               style={{ borderColor: isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)' }}>
            <div>
              <h2 className={`text-xl font-bold tracking-tight leading-snug ${isLight ? 'text-gray-900' : 'text-white'}`}>
                {album.name}
              </h2>
              <div className="flex items-center gap-2 mt-1 text-xs">
                <span className={`font-semibold ${isLight ? 'text-blue-700' : 'text-blue-400'}`}>
                  {album.artist}
                </span>
                {album.year && (
                  <span className={isLight ? 'text-gray-500' : 'text-gray-400'}>
                    • {album.year}
                  </span>
                )}
                {album.tracks[0]?.genre && (
                  <span className={isLight ? 'text-gray-500' : 'text-gray-400'}>
                    • {album.tracks[0].genre}
                  </span>
                )}
                <span className={isLight ? 'text-gray-500' : 'text-gray-400'}>
                  • {album.tracks.length} songs, {formatTime(totalDurationSeconds)}
                </span>
              </div>
            </div>

            {/* Quick Play, Shuffle, Song Info (if song selected) & Album Info */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => onPlayAlbum(false)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white rounded-md text-xs font-semibold shadow transition-all"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Play Album</span>
              </button>
              <button
                onClick={() => onPlayAlbum(true)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold border transition-all ${
                  isLight
                    ? 'bg-white hover:bg-gray-100 text-gray-700 border-gray-300'
                    : 'bg-white/10 hover:bg-white/15 text-gray-200 border-white/10'
                }`}
              >
                <Shuffle className="w-3.5 h-3.5" />
                <span>Shuffle</span>
              </button>

              {/* If song(s) are selected in drawer, show Song Info */}
              {(selectedTrackIds || []).length > 0 && (
                <button
                  onClick={() => {
                    const sel = album.tracks.filter(t => (selectedTrackIds || []).includes(t.id));
                    if (sel.length === 1) {
                      onOpenGetInfo(sel[0], album.tracks);
                    } else if (sel.length > 1) {
                      onOpenGetInfo(sel, album.tracks);
                    }
                  }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold border transition-all shadow-sm ${
                    isLight
                      ? 'bg-blue-600 text-white hover:bg-blue-700 border-blue-700'
                      : 'bg-blue-600 text-white hover:bg-blue-500 border-blue-500'
                  }`}
                  title={(selectedTrackIds || []).length === 1 ? 'Edit Song Metadata' : 'Edit Selected Songs Metadata'}
                >
                  <Info className="w-3.5 h-3.5" />
                  <span>{(selectedTrackIds || []).length === 1 ? 'Song Info' : `Song Info (${(selectedTrackIds || []).length})`}</span>
                </button>
              )}

              {/* Album Info (always available to open entire album metadata) */}
              <button
                onClick={() => onOpenGetInfo(album.tracks)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold border transition-all ${
                  isLight
                    ? 'bg-white hover:bg-gray-100 text-gray-700 border-gray-300'
                    : 'bg-white/10 hover:bg-white/15 text-gray-200 border-white/10'
                }`}
                title="Edit Album Metadata for all songs"
              >
                <Info className="w-3.5 h-3.5" />
                <span>Album Info</span>
              </button>
            </div>
          </div>

          {/* Multi-Column Track Lists */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-0.5">
            {/* Column 1 */}
            <div className="flex flex-col">
              {col1Tracks.map((track, idx) => renderTrackItem(track, idx, false))}
            </div>

            {/* Column 2 */}
            {col2Tracks.length > 0 && (
              <div className="flex flex-col">
                {col2Tracks.map((track, idx) => renderTrackItem(track, idx, true))}
              </div>
            )}
          </div>
        </div>

        {/* Right Side: Large Faded Album Artwork */}
        <div className="hidden lg:block shrink-0 relative w-64 h-64 select-none pointer-events-none rounded-xl overflow-hidden self-center">
          {coverUrl ? (
            <img
              src={coverUrl}
              alt={album.name}
              className="w-full h-full object-cover object-center"
              style={{
                maskImage: 'linear-gradient(to right, transparent 0%, rgba(0,0,0,0.85) 45%, black 100%)',
                WebkitMaskImage: 'linear-gradient(to right, transparent 0%, rgba(0,0,0,0.85) 45%, black 100%)',
              }}
            />
          ) : (
            <div
              className="w-full h-full flex items-center justify-center bg-gradient-to-br from-black/40 to-black/10 text-white/20"
              style={{
                maskImage: 'linear-gradient(to right, transparent 0%, black 50%)',
                WebkitMaskImage: 'linear-gradient(to right, transparent 0%, black 50%)',
              }}
            >
              <Disc className="w-32 h-32 stroke-[1]" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export const AlbumGridView: React.FC<AlbumGridViewProps> = ({
  albums,
  currentTrack,
  isPlaying,
  onPlayTrack,
  onUpdateRating,
  onOpenGetInfo,
  onTrackContextMenu,
  onBackgroundContextMenu,
  onImportFiles,
  onStartImporting,
  theme = 'dark',
  searchQuery,
  onClearSearch,
  selectedTrackIds,
  onSelectionChange,
  selectedAlbumIds: propSelectedAlbumIds,
  onSelectedAlbumIdsChange,
  albumSortField = 'album',
  onAlbumSortChange,
  isAlbumGrouped = false,
  onToggleAlbumGrouped,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const firstRowRef = useRef<HTMLDivElement>(null);
  const [columnsCount, setColumnsCount] = useState<number>(5);
  const [expandedAlbumId, setExpandedAlbumId] = useState<string | null>(null);

  // ── Sorted albums & letter groups ─────────────────────────────────────────
  const sortedAlbums = useMemo(() => {
    return sortAlbumsList(albums, albumSortField);
  }, [albums, albumSortField]);

  const albumGroups = useMemo(() => {
    if (!isAlbumGrouped) return [];
    const groups = groupAlbumsByLetter(sortedAlbums, albumSortField);
    return groups.map(g => {
      const r: Album[][] = [];
      for (let i = 0; i < g.albums.length; i += columnsCount) {
        r.push(g.albums.slice(i, i + columnsCount));
      }
      return { ...g, rows: r };
    });
  }, [sortedAlbums, isAlbumGrouped, albumSortField, columnsCount]);

  // ── Multi-selection state ────────────────────────────────────────────────
  const [selectedAlbumIds, setSelectedAlbumIds] = useState<string[]>(() => {
    if (propSelectedAlbumIds) return propSelectedAlbumIds;
    if (selectedTrackIds && selectedTrackIds.length > 0) {
      const initial: string[] = [];
      for (const a of albums) {
        if (a.tracks.some(t => selectedTrackIds.includes(t.id))) {
          initial.push(a.id);
        }
      }
      return initial;
    }
    return [];
  });

  const selectedAlbumIdsRef = useRef<string[]>(selectedAlbumIds);
  selectedAlbumIdsRef.current = selectedAlbumIds;
  const lastSelectedAlbumIdRef = useRef<string | null>(null);

  // ── Drawer individual track selection state ──────────────────────────────
  const [selectedDrawerTrackIds, setSelectedDrawerTrackIds] = useState<string[]>([]);
  const selectedDrawerTrackIdsRef = useRef<string[]>(selectedDrawerTrackIds);
  selectedDrawerTrackIdsRef.current = selectedDrawerTrackIds;

  const updateSelectedDrawerTrackIds = useCallback((trackIds: string[]) => {
    setSelectedDrawerTrackIds(trackIds);
    if (trackIds.length > 0) {
      if (onSelectionChange) {
        onSelectionChange(trackIds);
      }
    } else {
      // Revert selection back to whole album(s)
      if (onSelectionChange) {
        const allTracks = albums
          .filter(a => selectedAlbumIdsRef.current.includes(a.id))
          .flatMap(a => a.tracks.map(t => t.id));
        onSelectionChange(allTracks);
      }
    }
  }, [albums, onSelectionChange]);

  useEffect(() => {
    if (propSelectedAlbumIds) {
      setSelectedAlbumIds(propSelectedAlbumIds);
    }
  }, [propSelectedAlbumIds]);

  const updateSelectedAlbumIds = useCallback((newIds: string[]) => {
    setSelectedAlbumIds(newIds);
    if (onSelectionChange) {
      const allTracks = albums
        .filter(a => newIds.includes(a.id))
        .flatMap(a => a.tracks.map(t => t.id));
      onSelectionChange(allTracks);
    }
    if (onSelectedAlbumIdsChange) {
      onSelectedAlbumIdsChange(newIds);
    }
  }, [albums, onSelectionChange, onSelectedAlbumIdsChange]);

  const allSelectedAlbums = useMemo(() => {
    return sortedAlbums.filter(a => selectedAlbumIds.includes(a.id));
  }, [sortedAlbums, selectedAlbumIds]);

  const allSelectedTracks = useMemo(() => {
    return allSelectedAlbums.flatMap(a => a.tracks);
  }, [allSelectedAlbums]);

  // Find currently expanded album object
  const expandedAlbum = useMemo(() => {
    if (!expandedAlbumId) return null;
    return sortedAlbums.find(a => a.id === expandedAlbumId) || null;
  }, [sortedAlbums, expandedAlbumId]);

  // ── Marquee / Box Selection State & Logic ──────────────────────────────────
  const [selectionBox, setSelectionBox] = useState<{
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
  } | null>(null);

  const isMouseDownRef = useRef(false);
  const mouseDownPosRef = useRef<{ x: number; y: number } | null>(null);
  const isBoxSelectingRef = useRef(false);
  const wasBlankAreaClickRef = useRef(false);
  const initialSelectionRef = useRef<string[]>([]);
  const cardRectsRef = useRef<{ id: string; rect: DOMRect }[]>([]);
  const initialScrollTopRef = useRef<number>(0);

  const handleContainerMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('button, input, select, textarea, a, svg, .no-box-select')) return;
    if (target.closest('#album-expanded-drawer')) return;

    // Clear drawer track selection when starting box selection or clicking whitespace
    setSelectedDrawerTrackIds([]);

    const cardElem = target.closest<HTMLElement>('[id^="album-card-"]');
    if (cardElem) {
      wasBlankAreaClickRef.current = false;
      return;
    }

    wasBlankAreaClickRef.current = true;
    isMouseDownRef.current = true;
    mouseDownPosRef.current = { x: e.clientX, y: e.clientY };
    initialScrollTopRef.current = containerRef.current?.scrollTop || 0;
    initialSelectionRef.current = (e.shiftKey || e.ctrlKey || e.metaKey)
      ? [...selectedAlbumIdsRef.current]
      : [];

    // Cache currently rendered card client rects for fast box selection without layout thrashing
    const rects: { id: string; rect: DOMRect }[] = [];
    const container = containerRef.current;
    const renderedCards = container
      ? container.querySelectorAll<HTMLElement>('[id^="album-card-"]')
      : document.querySelectorAll<HTMLElement>('[id^="album-card-"]');
    renderedCards.forEach((card) => {
      const id = card.id.replace('album-card-', '');
      const rect = card.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        rects.push({ id, rect });
      }
    });
    cardRectsRef.current = rects;
  };

  useEffect(() => {
    const resetBoxSelection = () => {
      isMouseDownRef.current = false;
      mouseDownPosRef.current = null;
      cardRectsRef.current = [];
      setSelectionBox(null);
      setTimeout(() => {
        isBoxSelectingRef.current = false;
      }, 50);
    };

    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (!isMouseDownRef.current || !mouseDownPosRef.current) return;

      const dx = e.clientX - mouseDownPosRef.current.x;
      const dy = e.clientY - mouseDownPosRef.current.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (!isBoxSelectingRef.current && distance > 5) {
        isBoxSelectingRef.current = true;
        setExpandedAlbumId(null);
      }

      if (isBoxSelectingRef.current) {
        setSelectionBox({
          startX: mouseDownPosRef.current.x,
          startY: mouseDownPosRef.current.y,
          currentX: e.clientX,
          currentY: e.clientY,
        });

        // Auto-scroll when dragging near top/bottom edges of the album view
        if (containerRef.current) {
          const containerRect = containerRef.current.getBoundingClientRect();
          const SCROLL_ZONE = 40;
          const SCROLL_SPEED = 14;
          if (e.clientY < containerRect.top + SCROLL_ZONE && containerRef.current.scrollTop > 0) {
            containerRef.current.scrollTop -= SCROLL_SPEED;
          } else if (e.clientY > containerRect.bottom - SCROLL_ZONE) {
            containerRef.current.scrollTop += SCROLL_SPEED;
          }
        }

        const scrollDelta = (containerRef.current?.scrollTop || 0) - initialScrollTopRef.current;
        const boxLeft = Math.min(mouseDownPosRef.current.x, e.clientX);
        const boxTop = Math.min(mouseDownPosRef.current.y, e.clientY);
        const boxRight = Math.max(mouseDownPosRef.current.x, e.clientX);
        const boxBottom = Math.max(mouseDownPosRef.current.y, e.clientY);

        const newlySelectedIds: string[] = [];
        const cachedRects = cardRectsRef.current;
        for (let i = 0; i < cachedRects.length; i++) {
          const { id, rect } = cachedRects[i];
          const adjustedTop = rect.top - scrollDelta;
          const adjustedBottom = rect.bottom - scrollDelta;
          const intersects = !(
            boxRight <= rect.left ||
            boxLeft >= rect.right ||
            boxBottom <= adjustedTop ||
            boxTop >= adjustedBottom
          );
          if (intersects) {
            newlySelectedIds.push(id);
          }
        }

        const combined = Array.from(new Set([...initialSelectionRef.current, ...newlySelectedIds]));
        updateSelectedAlbumIds(combined);
      }
    };

    const handleGlobalMouseUp = () => {
      if (isMouseDownRef.current) {
        if (!isBoxSelectingRef.current && wasBlankAreaClickRef.current) {
          updateSelectedAlbumIds([]);
          updateSelectedDrawerTrackIds([]);
          setExpandedAlbumId(null);
        }
        resetBoxSelection();
      }
    };

    const handleGlobalDragEnd = () => {
      resetBoxSelection();
    };

    window.addEventListener('mousemove', handleGlobalMouseMove);
    window.addEventListener('mouseup', handleGlobalMouseUp);
    window.addEventListener('dragend', handleGlobalDragEnd);

    return () => {
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
      window.removeEventListener('dragend', handleGlobalDragEnd);
    };
  }, [updateSelectedAlbumIds, updateSelectedDrawerTrackIds]);

  // Keyboard shortcuts: Ctrl+A / ⌘+A to Select All, Ctrl+I / ⌘+I to Get Info, Escape to Clear
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      if (
        activeEl &&
        (activeEl.tagName === 'INPUT' ||
          activeEl.tagName === 'TEXTAREA' ||
          activeEl.getAttribute('contenteditable') === 'true')
      ) {
        return;
      }

      if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        const allIds = albums.map(a => a.id);
        updateSelectedAlbumIds(allIds);
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'i' || e.key === 'I')) {
        e.preventDefault();
        // If song(s) in drawer are selected, open song metadata
        if (selectedDrawerTrackIdsRef.current.length > 0 && expandedAlbum) {
          const selectedTracks = expandedAlbum.tracks.filter(t =>
            selectedDrawerTrackIdsRef.current.includes(t.id)
          );
          if (selectedTracks.length === 1) {
            onOpenGetInfo(selectedTracks[0], expandedAlbum.tracks);
          } else if (selectedTracks.length > 1) {
            onOpenGetInfo(selectedTracks, expandedAlbum.tracks);
          }
        } else if (allSelectedTracks.length > 0) {
          // Album is selected, open album metadata
          onOpenGetInfo(allSelectedTracks);
        } else if (expandedAlbum) {
          onOpenGetInfo(expandedAlbum.tracks);
        }
      } else if (e.key === 'Escape') {
        if (selectedDrawerTrackIdsRef.current.length > 0) {
          e.preventDefault();
          updateSelectedDrawerTrackIds([]);
        } else {
          if (selectedAlbumIdsRef.current.length > 0) {
            e.preventDefault();
            updateSelectedAlbumIds([]);
          }
          setExpandedAlbumId(null);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [albums, expandedAlbum, allSelectedTracks, onOpenGetInfo, updateSelectedAlbumIds, updateSelectedDrawerTrackIds]);

  // ── Row Virtualization state (#7) ────────────────────────────────────────
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(600);
  const ROW_GAP = 24; // gap-6 = 24px
  const [measuredRowHeight, setMeasuredRowHeight] = useState<number>(280);
  const ROW_HEIGHT = measuredRowHeight + ROW_GAP;
  const OVERSCAN_ROWS = 4;

  // ── Shared IntersectionObserver (#10) ───────────────────────────────────
  const cbMapRef = useRef<Map<Element, VisibilityCallback>>(new Map());
  const sharedObserverRef = useRef<IntersectionObserver | null>(null);
  const sharedIOCtx = useMemo(() => ({
    observe: (el: Element, cb: VisibilityCallback) => {
      cbMapRef.current.set(el, cb);
      sharedObserverRef.current?.observe(el);
    },
    unobserve: (el: Element) => {
      cbMapRef.current.delete(el);
      sharedObserverRef.current?.unobserve(el);
    },
  }), []);

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const cb = cbMapRef.current.get(entry.target);
          if (cb) cb(entry.isIntersecting);
        }
      },
      { rootMargin: '300px', root: containerRef.current }
    );
    sharedObserverRef.current = observer;
    // Observe any elements already registered
    cbMapRef.current.forEach((_, el) => observer.observe(el));
    return () => {
      observer.disconnect();
      sharedObserverRef.current = null;
    };
  }, []);

  const isLight = theme === 'light';

  // Measure container width to determine exact columns count and exact card row height
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const updateDimensions = () => {
      const width = el.clientWidth;
      let cols = 6;
      if (width < 600) cols = 2;
      else if (width < 800) cols = 3;
      else if (width < 1050) cols = 4;
      else if (width < 1300) cols = 5;
      setColumnsCount(cols);

      if (firstRowRef.current) {
        const rectHeight = firstRowRef.current.getBoundingClientRect().height;
        if (rectHeight > 100) {
          setMeasuredRowHeight(Math.round(rectHeight));
          return;
        }
      }

      // Fallback formula matching max-w-7xl (1280px), p-6 (48px total), gap-5 (20px), card p-2.5 (20px) + 64px text block
      const innerWidth = Math.min(Math.max(width - 48, 300), 1280);
      const colWidth = (innerWidth - (cols - 1) * 20) / cols;
      const cardHeight = Math.round(colWidth + 64);
      setMeasuredRowHeight(cardHeight);
    };

    updateDimensions();
    const ro = new ResizeObserver(updateDimensions);
    ro.observe(el);
    return () => ro.disconnect();
  }, [albums.length]);

  // Also observe the first rendered row's exact height whenever it mounts/resizes
  useEffect(() => {
    const rowEl = firstRowRef.current;
    if (!rowEl) return;
    const measure = () => {
      const h = rowEl.getBoundingClientRect().height;
      if (h > 100) {
        setMeasuredRowHeight((prev) => (Math.abs(prev - h) >= 1 ? Math.round(h) : prev));
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(rowEl);
    return () => ro.disconnect();
  });

  // Track scroll position for virtualization (RAF-throttled)
  const rafRef = useRef<number | null>(null);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setContainerHeight(el.clientHeight || 600);
    const onScroll = () => {
      if (rafRef.current !== null) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        setScrollTop(el.scrollTop);
      });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    const ro = new ResizeObserver((entries) => {
      setContainerHeight(entries[0]?.contentRect.height ?? 600);
    });
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', onScroll);
      ro.disconnect();
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // Split albums into strict rows of length `columnsCount`
  const rows = useMemo(() => {
    const r: Album[][] = [];
    for (let i = 0; i < sortedAlbums.length; i += columnsCount) {
      r.push(sortedAlbums.slice(i, i + columnsCount));
    }
    return r;
  }, [sortedAlbums, columnsCount]);

  // Pre-compute which album the current track belongs to (#6)
  const currentAlbumId = useMemo(() => {
    if (!currentTrack) return null;
    const found = sortedAlbums.find(a => a.tracks.some(t => t.id === currentTrack.id));
    return found?.id ?? null;
  }, [sortedAlbums, currentTrack]);

  // Row virtualization: which rows are visible (#7)
  const { visibleRowStart, visibleRowEnd } = useMemo(() => {
    const totalRows = rows.length;
    if (totalRows <= 20) {
      // For small libraries, render everything
      return { visibleRowStart: 0, visibleRowEnd: totalRows };
    }
    const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN_ROWS);
    const visible = Math.ceil(containerHeight / ROW_HEIGHT) + OVERSCAN_ROWS * 2;
    const end = Math.min(totalRows, start + visible);
    return { visibleRowStart: start, visibleRowEnd: end };
  }, [rows.length, scrollTop, containerHeight, ROW_HEIGHT, OVERSCAN_ROWS]);

  const topSpacerHeight = Math.max(0, visibleRowStart * ROW_HEIGHT - (visibleRowStart > 0 ? ROW_GAP : 0));
  const bottomSpacerHeight = Math.max(0, (rows.length - visibleRowEnd) * ROW_HEIGHT - (visibleRowEnd < rows.length ? ROW_GAP : 0));

  const handleSelectAlbum = useCallback((albumId: string, e: React.MouseEvent) => {
    if (isBoxSelectingRef.current) return;

    // Reset drawer track selection so the album itself is selected
    updateSelectedDrawerTrackIds([]);

    if (e.shiftKey && lastSelectedAlbumIdRef.current) {
      const lastIdx = sortedAlbums.findIndex(a => a.id === lastSelectedAlbumIdRef.current);
      const currIdx = sortedAlbums.findIndex(a => a.id === albumId);
      if (lastIdx !== -1 && currIdx !== -1) {
        const start = Math.min(lastIdx, currIdx);
        const end = Math.max(lastIdx, currIdx);
        const rangeIds = sortedAlbums.slice(start, end + 1).map(a => a.id);
        const combined = Array.from(new Set([...selectedAlbumIdsRef.current, ...rangeIds]));
        updateSelectedAlbumIds(combined);
        return;
      }
    }

    if (e.ctrlKey || e.metaKey) {
      const alreadySelected = selectedAlbumIdsRef.current.includes(albumId);
      const updated = alreadySelected
        ? selectedAlbumIdsRef.current.filter(id => id !== albumId)
        : [...selectedAlbumIdsRef.current, albumId];
      lastSelectedAlbumIdRef.current = albumId;
      updateSelectedAlbumIds(updated);
      return;
    }

    lastSelectedAlbumIdRef.current = albumId;
    updateSelectedAlbumIds([albumId]);
    setExpandedAlbumId(prev => (prev === albumId ? null : albumId));
  }, [sortedAlbums, updateSelectedAlbumIds, updateSelectedDrawerTrackIds]);

  const handlePlayAlbum = useCallback((album: Album, shuffle = false) => {
    if (album.tracks.length === 0) return;
    const tracksToPlay = shuffle
      ? [...album.tracks].sort(() => Math.random() - 0.5)
      : album.tracks;
    onPlayTrack(tracksToPlay[0], tracksToPlay);
  }, [onPlayTrack]);

  const handlePlayAlbumCard = useCallback((album: Album) => {
    updateSelectedDrawerTrackIds([]);
    lastSelectedAlbumIdRef.current = album.id;
    updateSelectedAlbumIds([album.id]);
    setExpandedAlbumId(album.id);
    handlePlayAlbum(album, false);
  }, [handlePlayAlbum, updateSelectedAlbumIds, updateSelectedDrawerTrackIds]);

  const handleAlbumContextMenu = useCallback((album: Album, e: React.MouseEvent) => {
    if (album.tracks.length > 0 && onTrackContextMenu) {
      updateSelectedDrawerTrackIds([]);
      if (!selectedAlbumIdsRef.current.includes(album.id)) {
        lastSelectedAlbumIdRef.current = album.id;
        updateSelectedAlbumIds([album.id]);
      }
      onTrackContextMenu(album.tracks[0], e, album.tracks);
    }
  }, [onTrackContextMenu, updateSelectedAlbumIds, updateSelectedDrawerTrackIds]);

  const handleContainerContextMenu = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('[id^="album-card-"]') || target.closest('#album-expanded-drawer')) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    onBackgroundContextMenu?.(e);
  }, [onBackgroundContextMenu]);

  // Smoothly scroll the drawer into view when an album is selected
  useEffect(() => {
    if (!expandedAlbumId) return;
    const timer = setTimeout(() => {
      const drawerEl = document.getElementById('album-expanded-drawer');
      if (drawerEl) {
        drawerEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }, 50);
    return () => clearTimeout(timer);
  }, [expandedAlbumId]);

  // Empty state: No search results
  if (albums.length === 0) {
    if (searchQuery && searchQuery.trim().length > 0) {
      return (
        <div className={`flex-1 flex flex-col items-center justify-center p-8 text-center select-none ${
          isLight ? 'bg-white text-gray-500' : 'bg-[#121212] text-gray-500'
        }`}>
          <h3 className={`text-base font-bold mb-1 ${isLight ? 'text-gray-900' : 'text-white'}`}>
            No Albums Found
          </h3>
          <p className="text-xs mb-4">
            No albums match <span className="font-semibold text-blue-500">"{searchQuery}"</span>.
          </p>
          {onClearSearch && (
            <button
              onClick={onClearSearch}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md border shadow-sm ${
                isLight ? 'bg-slate-100 hover:bg-slate-200 text-slate-700' : 'bg-white/10 hover:bg-white/15 text-white'
              }`}
            >
              Clear Search
            </button>
          )}
        </div>
      );
    }

    return (
      <div className={`flex-1 flex flex-col items-center justify-center p-8 text-center select-none ${
        isLight ? 'bg-white text-gray-500' : 'bg-[#121212] text-gray-500'
      }`}>
        <div className={`w-20 h-20 rounded-full flex items-center justify-center mb-4 border ${
          isLight ? 'bg-blue-50 border-blue-200 text-blue-600' : 'bg-blue-950/40 border-blue-800/40 text-blue-400'
        }`}>
          <Disc className="w-10 h-10" />
        </div>
        <h3 className={`text-base font-bold mb-1 ${isLight ? 'text-gray-900' : 'text-white'}`}>No Albums in Library</h3>
        <p className={`text-xs max-w-sm mb-4 ${isLight ? 'text-gray-600' : 'text-gray-400'}`}>
          Import audio files into ClassiTunes to display your music library in the iconic Album View.
        </p>
        {onImportFiles && (
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

  const drawerBgColor = isLight ? '#e9edf3' : '#202328';

  return (
    <SharedIOContext.Provider value={sharedIOCtx}>
      <div
        ref={containerRef}
        onMouseDown={handleContainerMouseDown}
        onContextMenu={handleContainerContextMenu}
        className={`flex-1 overflow-y-auto p-6 select-none custom-scrollbar transition-colors duration-200 ${
          isLight ? 'bg-[#f4f6f9]' : 'bg-[#121212]'
        }`}
        style={{ willChange: 'scroll-position', transform: 'translateZ(0)' }}
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

        <div className={`max-w-7xl mx-auto flex flex-col ${isAlbumGrouped ? 'gap-8' : 'gap-6'}`}>
          {isAlbumGrouped ? (
            albumGroups.map((group) => {
              const rowsToRender = group.rows || [];

              return (
                <div key={`group-${group.key}`} className="flex flex-col">
                  {/* Sticky Group / Letter Header */}
                  <div className={`sticky top-0 z-20 flex items-baseline justify-between pt-4 pb-2 border-b backdrop-blur-md mb-4 select-none ${
                    isLight
                      ? 'bg-[#f4f6f9]/90 border-gray-300/80 text-gray-900'
                      : 'bg-[#121212]/90 border-white/10 text-white'
                  }`}>
                    <div className="flex items-baseline gap-3">
                      <span className="text-2xl font-bold tracking-tight">
                        {group.label}
                      </span>
                      <span className={`text-xs font-medium ${isLight ? 'text-gray-500' : 'text-gray-400'}`}>
                        {group.albums.length} {group.albums.length === 1 ? 'album' : 'albums'}
                      </span>
                    </div>
                  </div>

                  {/* Grid Rows for this group */}
                  <div className="flex flex-col gap-6">
                    {rowsToRender.map((rowAlbums, rowIdx) => {
                      const selectedColIndex = rowAlbums.findIndex(a => a.id === expandedAlbumId);
                      const isRowExpanded = selectedColIndex !== -1;

                      return (
                        <div key={`group-${group.key}-row-${rowIdx}`} className="flex flex-col">
                          <div
                            className="grid gap-5"
                            style={{
                              gridTemplateColumns: `repeat(${columnsCount}, minmax(0, 1fr))`,
                            }}
                          >
                            {rowAlbums.map((album) => {
                              const isSelected = selectedAlbumIds.includes(album.id);
                              const isAlbumPlaying = album.id === currentAlbumId;
                              const activeAlbumTrack = isAlbumPlaying ? currentTrack : null;

                              return (
                                <AlbumCard
                                  key={album.id}
                                  album={album}
                                  activeAlbumTrack={activeAlbumTrack}
                                  isSelected={isSelected}
                                  isAlbumPlaying={isAlbumPlaying}
                                  isPlaying={isPlaying}
                                  isLight={isLight}
                                  onSelectAlbum={handleSelectAlbum}
                                  onPlayAlbumCard={handlePlayAlbumCard}
                                  onAlbumContextMenu={handleAlbumContextMenu}
                                  allSelectedAlbums={allSelectedAlbums}
                                />
                              );
                            })}
                          </div>

                          {/* Row-Aware Expanding Shelf / Drawer */}
                          {isRowExpanded && expandedAlbum && (
                            <div
                              id="album-expanded-drawer"
                              className="relative mt-3 mb-4 animate-in fade-in slide-in-from-top-2 duration-200"
                            >
                              <div
                                className="absolute -top-2.5 z-20 w-0 h-0 transition-all duration-200"
                                style={{
                                  left: `calc(${(selectedColIndex + 0.5) * (100 / columnsCount)}% - 10px)`,
                                  borderLeft: '10px solid transparent',
                                  borderRight: '10px solid transparent',
                                  borderBottom: `10px solid ${drawerBgColor}`,
                                }}
                              />

                              <AlbumDrawer
                                album={expandedAlbum}
                                currentTrack={currentTrack}
                                isPlaying={isPlaying}
                                isLight={isLight}
                                selectedTrackIds={selectedDrawerTrackIds}
                                onSelectTracks={updateSelectedDrawerTrackIds}
                                onClose={() => {
                                  setExpandedAlbumId(null);
                                  updateSelectedDrawerTrackIds([]);
                                }}
                                onPlayTrack={onPlayTrack}
                                onPlayAlbum={(shuffle) => handlePlayAlbum(expandedAlbum, shuffle)}
                                onUpdateRating={onUpdateRating}
                                onOpenGetInfo={onOpenGetInfo}
                                onTrackContextMenu={onTrackContextMenu}
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })
          ) : (
            <>
              {/* Top spacer for virtualized rows above viewport */}
              {topSpacerHeight > 0 && (
                <div style={{ height: topSpacerHeight, flexShrink: 0 }} aria-hidden="true" />
              )}

              {rows.slice(visibleRowStart, visibleRowEnd).map((rowAlbums, relIdx) => {
                const rowIndex = visibleRowStart + relIdx;
                // Check if the currently expanded album is in this row
                const selectedColIndex = rowAlbums.findIndex(a => a.id === expandedAlbumId);
                const isRowExpanded = selectedColIndex !== -1;

                return (
                  <div key={`row-${rowIndex}`} className="flex flex-col">
                    {/* Row Grid: Full columnsCount across */}
                    <div
                      ref={relIdx === 0 ? firstRowRef : undefined}
                      className="grid gap-5"
                      style={{
                        gridTemplateColumns: `repeat(${columnsCount}, minmax(0, 1fr))`,
                      }}
                    >
                      {rowAlbums.map((album) => {
                        const isSelected = selectedAlbumIds.includes(album.id);
                        // Use pre-computed currentAlbumId instead of Array.some() per card (#6)
                        const isAlbumPlaying = album.id === currentAlbumId;
                        const activeAlbumTrack = isAlbumPlaying ? currentTrack : null;

                        return (
                          <AlbumCard
                            key={album.id}
                            album={album}
                            activeAlbumTrack={activeAlbumTrack}
                            isSelected={isSelected}
                            isAlbumPlaying={isAlbumPlaying}
                            isPlaying={isPlaying}
                            isLight={isLight}
                            onSelectAlbum={handleSelectAlbum}
                            onPlayAlbumCard={handlePlayAlbumCard}
                            onAlbumContextMenu={handleAlbumContextMenu}
                            allSelectedAlbums={allSelectedAlbums}
                          />
                        );
                      })}
                    </div>

                    {/* Row-Aware Expanding Shelf / Drawer */}
                    {isRowExpanded && expandedAlbum && (
                      <div
                        id="album-expanded-drawer"
                        className="relative mt-3 mb-4 animate-in fade-in slide-in-from-top-2 duration-200"
                      >
                        {/* Pointer Arrow pointing to selected album */}
                        <div
                          className="absolute -top-2.5 z-20 w-0 h-0 transition-all duration-200"
                          style={{
                            left: `calc(${(selectedColIndex + 0.5) * (100 / columnsCount)}% - 10px)`,
                            borderLeft: '10px solid transparent',
                            borderRight: '10px solid transparent',
                            borderBottom: `10px solid ${drawerBgColor}`,
                          }}
                        />

                        <AlbumDrawer
                          album={expandedAlbum}
                          currentTrack={currentTrack}
                          isPlaying={isPlaying}
                          isLight={isLight}
                          selectedTrackIds={selectedDrawerTrackIds}
                          onSelectTracks={updateSelectedDrawerTrackIds}
                          onClose={() => {
                            setExpandedAlbumId(null);
                            updateSelectedDrawerTrackIds([]);
                          }}
                          onPlayTrack={onPlayTrack}
                          onPlayAlbum={(shuffle) => handlePlayAlbum(expandedAlbum, shuffle)}
                          onUpdateRating={onUpdateRating}
                          onOpenGetInfo={onOpenGetInfo}
                          onTrackContextMenu={onTrackContextMenu}
                        />
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Bottom spacer for virtualized rows below viewport */}
              {bottomSpacerHeight > 0 && (
                <div style={{ height: bottomSpacerHeight, flexShrink: 0 }} aria-hidden="true" />
              )}
            </>
          )}
        </div>

        {/* Floating Multi-Selection Action Pill */}
        {selectedAlbumIds.length > 1 && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 animate-in fade-in slide-in-from-bottom-3 duration-150">
            <div className={`flex items-center gap-3 px-4 py-2 rounded-full border shadow-2xl backdrop-blur-md ${
              isLight
                ? 'bg-white/95 border-gray-300 text-gray-800 shadow-[0_8px_30px_rgba(0,0,0,0.12)]'
                : 'bg-[#1e1e1e]/95 border-[#3a3a3a] text-gray-100 shadow-[0_8px_30px_rgba(0,0,0,0.6)]'
            }`}>
              <span className="text-xs font-bold tabular-nums">
                {selectedAlbumIds.length} albums selected
              </span>
              <span className="text-[10px] opacity-60">
                ({allSelectedTracks.length} songs)
              </span>
              <div className={`h-3.5 w-px ${isLight ? 'bg-gray-300' : 'bg-white/20'}`} />
              <button
                type="button"
                onClick={() => {
                  if (allSelectedTracks.length > 0) {
                    onPlayTrack(allSelectedTracks[0], allSelectedTracks);
                  }
                }}
                className="px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white flex items-center gap-1.5 transition-colors shadow-sm cursor-pointer"
                title="Play all songs from selected albums"
              >
                <Play className="w-3 h-3 fill-current ml-0.5" />
                <span>Play</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  if (allSelectedTracks.length > 0) {
                    onOpenGetInfo(allSelectedTracks);
                  }
                }}
                className={`px-2.5 py-1 rounded-full text-xs font-semibold border flex items-center gap-1.5 transition-colors cursor-pointer ${
                  isLight
                    ? 'bg-gray-100 hover:bg-gray-200 border-gray-300 text-gray-700'
                    : 'bg-white/10 hover:bg-white/15 border-white/10 text-gray-200'
                }`}
                title="Open Get Info to edit metadata for all selected albums"
              >
                <Info className="w-3 h-3" />
                <span>Get Info</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  updateSelectedAlbumIds([]);
                }}
                className="p-1 rounded-full hover:bg-black/10 dark:hover:bg-white/10 transition-colors opacity-70 hover:opacity-100 cursor-pointer"
                title="Clear selection (Esc)"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>
    </SharedIOContext.Provider>
  );
};

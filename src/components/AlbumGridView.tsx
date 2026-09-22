import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Album, Track } from '../types';
import { Play, Star, Disc, Music, X, Shuffle, Volume2, Info } from 'lucide-react';
import { ImportMusicButton } from './ImportMusicButton';
import { getMediaFile, getCachedArtwork, setCachedArtwork } from '../services/mediaStorage';
import { isTauri, readTauriMusicMetadata } from '../utils/tauriWindow';

interface AlbumGridViewProps {
  albums: Album[];
  currentTrack: Track | null;
  isPlaying: boolean;
  onPlayTrack: (track: Track, albumTracks?: Track[]) => void;
  onUpdateRating: (trackId: string, rating: number) => void;
  onOpenGetInfo: (trackOrTracks: Track | Track[]) => void;
  onTrackContextMenu?: (track: Track, e: React.MouseEvent) => void;
  onImportFiles?: (files: FileList | File[] | string[]) => void;
  onStartImporting?: (statusText?: string) => void;
  theme?: 'dark' | 'light';
  searchQuery?: string;
  onClearSearch?: () => void;
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

/** Individual Album Card with Lazy Artwork Resolution and IntersectionObserver */
const AlbumCard = React.memo<{
  album: Album;
  isSelected: boolean;
  isAlbumPlaying: boolean;
  isPlaying: boolean;
  isLight: boolean;
  onSelect: () => void;
  onPlayAlbum: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}>(({
  album,
  isSelected,
  isAlbumPlaying,
  isPlaying,
  isLight,
  onSelect,
  onPlayAlbum,
  onContextMenu,
}) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [coverUrl, setCoverUrl] = useState<string | null>(() => {
    if (album.coverUrl) return album.coverUrl;
    if (artworkCache.has(album.id)) return artworkCache.get(album.id)!;
    return null;
  });
  const [imgError, setImgError] = useState(false);

  // IntersectionObserver: Only fetch/decode heavy artwork when the card is near the viewport
  useEffect(() => {
    const el = cardRef.current;
    if (!el || isVisible) return;

    if (typeof IntersectionObserver !== 'undefined') {
      const observer = new IntersectionObserver(
        (entries) => {
          if (entries[0]?.isIntersecting) {
            setIsVisible(true);
            observer.disconnect();
          }
        },
        { rootMargin: '300px' }
      );
      observer.observe(el);
      return () => observer.disconnect();
    } else {
      setIsVisible(true);
    }
  }, [isVisible]);

  // Hydrate artwork only once visible and not yet cached
  useEffect(() => {
    if (!isVisible) return;
    if (coverUrl && !coverUrl.startsWith('blob:')) return;
    if (artworkCache.has(album.id)) {
      setCoverUrl(artworkCache.get(album.id)!);
      return;
    }

    let isMounted = true;
    const firstTrack = album.tracks[0];
    if (!firstTrack) return;

    if (firstTrack.coverUrl) {
      artworkCache.set(album.id, firstTrack.coverUrl);
      if (isMounted) setCoverUrl(firstTrack.coverUrl);
      return;
    }

    // Lazy load from IndexedDB or native metadata
    getMediaFile(`cover_${firstTrack.id}`).then((blob) => {
      if (!isMounted) return;
      if (blob) {
        const url = URL.createObjectURL(blob);
        artworkCache.set(album.id, url);
        setCoverUrl(url);
      } else if (isTauri() && firstTrack.filePath) {
        readTauriMusicMetadata(firstTrack.filePath).then((meta) => {
          if (!isMounted) return;
          if (meta?.coverUrl) {
            artworkCache.set(album.id, meta.coverUrl);
            setCoverUrl(meta.coverUrl);
          }
        }).catch(() => {});
      }
    }).catch(() => {});

    return () => {
      isMounted = false;
    };
  }, [album.id, album.tracks, coverUrl, isVisible]);

  return (
    <div
      ref={cardRef}
      onContextMenu={onContextMenu}
      className={`group relative flex flex-col p-2.5 rounded-xl transition-all duration-150 select-none ${
        isSelected
          ? isLight
            ? 'bg-blue-50/90 ring-2 ring-blue-500 shadow-md scale-[1.01]'
            : 'bg-white/10 ring-2 ring-blue-400 shadow-xl scale-[1.01]'
          : isLight
            ? 'hover:bg-slate-200/60 hover:shadow-sm'
            : 'hover:bg-white/5 hover:shadow-md'
      }`}
      id={`album-card-${album.id}`}
    >
      {/* Square Album Art Thumbnail: Clicking thumbnail toggles song drawer or plays via hover button */}
      <div 
        onClick={onSelect}
        className="relative aspect-square w-full rounded-lg overflow-hidden bg-[#181818] shadow-md border border-black/10 cursor-pointer"
      >
        {coverUrl && !imgError ? (
          <img
            src={coverUrl}
            alt={album.name}
            onError={() => setImgError(true)}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            loading="lazy"
            decoding="async"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-[#2a2e36] to-[#15171a] text-slate-400">
            <Disc className="w-12 h-12 stroke-[1.2] opacity-60 group-hover:rotate-45 transition-transform duration-500" />
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
              onPlayAlbum();
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
        onClick={onSelect}
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

/** iTunes 11 Expanding Shelf / Tray Drawer */
const AlbumDrawer: React.FC<{
  album: Album;
  currentTrack: Track | null;
  isPlaying: boolean;
  isLight: boolean;
  onClose: () => void;
  onPlayTrack: (track: Track, albumTracks?: Track[]) => void;
  onPlayAlbum: (shuffle?: boolean) => void;
  onUpdateRating: (trackId: string, rating: number) => void;
  onOpenGetInfo: (trackOrTracks: Track | Track[]) => void;
  onTrackContextMenu?: (track: Track, e: React.MouseEvent) => void;
}> = ({
  album,
  currentTrack,
  isPlaying,
  isLight,
  onClose,
  onPlayTrack,
  onPlayAlbum,
  onUpdateRating,
  onOpenGetInfo,
  onTrackContextMenu,
}) => {
  const [coverUrl, setCoverUrl] = useState<string | null>(() => {
    if (album.coverUrl) return album.coverUrl;
    if (artworkCache.has(album.id)) return artworkCache.get(album.id)!;
    return null;
  });

  useEffect(() => {
    if (coverUrl) return;
    if (artworkCache.has(album.id)) {
      setCoverUrl(artworkCache.get(album.id)!);
    }
  }, [album.id, coverUrl]);

  const totalDurationSeconds = useMemo(() => {
    return album.tracks.reduce((acc, t) => acc + (t.duration || 0), 0);
  }, [album.tracks]);

  // Split tracks into 2 columns if > 4 tracks (iTunes 11 style)
  const [col1Tracks, col2Tracks] = useMemo(() => {
    const total = album.tracks.length;
    if (total <= 4) {
      return [album.tracks, []];
    }
    const mid = Math.ceil(total / 2);
    return [album.tracks.slice(0, mid), album.tracks.slice(mid)];
  }, [album.tracks]);

  const renderTrackItem = (track: Track, index: number, isCol2 = false) => {
    const isCurrent = currentTrack?.id === track.id;
    const trackNum = track.trackNumber || (isCol2 ? col1Tracks.length + index + 1 : index + 1);

    return (
      <div
        key={track.id}
        onDoubleClick={() => onPlayTrack(track, album.tracks)}
        onContextMenu={(e) => {
          e.preventDefault();
          if (onTrackContextMenu) onTrackContextMenu(track, e);
        }}
        className={`group flex items-center justify-between py-1.5 px-2.5 rounded text-xs transition-colors cursor-pointer select-none ${
          isCurrent
            ? 'bg-blue-600 text-white font-medium shadow-sm'
            : isLight
              ? 'hover:bg-black/5 text-gray-800'
              : 'hover:bg-white/10 text-gray-200'
        }`}
      >
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          {/* Track Number / Play Button */}
          <div className="w-5 text-right shrink-0 flex items-center justify-center">
            {isCurrent && isPlaying ? (
              <Volume2 className="w-3.5 h-3.5 animate-pulse text-white" />
            ) : (
              <>
                <span className={`group-hover:hidden ${isCurrent ? 'text-white' : isLight ? 'text-gray-400' : 'text-gray-500'}`}>
                  {trackNum}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onPlayTrack(track, album.tracks);
                  }}
                  className={`hidden group-hover:flex items-center justify-center ${isCurrent ? 'text-white' : isLight ? 'text-blue-600' : 'text-blue-400'}`}
                >
                  <Play className="w-3 h-3 fill-current" />
                </button>
              </>
            )}
          </div>

          {/* Track Title & Artist (for Various Artists / Compilations) */}
          <div className="flex items-baseline gap-1.5 min-w-0 flex-1 truncate">
            <span className="truncate font-medium" title={track.title}>
              {track.title}
            </span>
            {(album.artist === 'Various Artists' || (track.artist && track.artist !== album.artist)) && (
              <span className={`text-[11px] truncate opacity-70 ${isCurrent ? 'text-white' : isLight ? 'text-gray-600' : 'text-gray-400'}`}>
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
                      ? isCurrent ? 'text-amber-300 fill-amber-300' : 'text-amber-400 fill-amber-400'
                      : isCurrent ? 'text-white/40' : 'text-gray-400/50'
                  }`}
                />
              </button>
            ))}
          </div>

          {/* Duration */}
          <span className={`font-mono text-[11px] ${isCurrent ? 'text-white/90' : isLight ? 'text-gray-500' : 'text-gray-400'}`}>
            {formatTime(track.duration)}
          </span>
        </div>
      </div>
    );
  };

  return (
    <div className={`relative w-full rounded-xl p-5 shadow-2xl border transition-all duration-200 overflow-hidden ${
      isLight
        ? 'bg-[#e9edf3] border-[#c9d3e0] text-gray-800 shadow-slate-300/60'
        : 'bg-[#202328] border-[#343a42] text-gray-200 shadow-black/80'
    }`}>
      {/* Top Close Button */}
      <button
        onClick={onClose}
        className={`absolute top-3 right-3 p-1.5 rounded-full transition-colors z-20 ${
          isLight ? 'text-gray-400 hover:text-black hover:bg-black/10' : 'text-gray-400 hover:text-white hover:bg-white/10'
        }`}
        title="Close Album"
      >
        <X className="w-4 h-4" />
      </button>

      <div className="flex flex-col lg:flex-row gap-6 items-start relative z-10">
        {/* Left / Middle: Album Details & Multi-Column Tracklist */}
        <div className="flex-1 min-w-0 w-full">
          {/* Header Row */}
          <div className="flex flex-wrap items-end justify-between gap-3 pb-3 border-b mb-4"
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

            {/* Quick Play & Shuffle Buttons */}
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

          {/* Multi-Column Track Lists (iTunes 11 Style) */}
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

        {/* Right Side: Large Faded Album Artwork (Authentic iTunes 11 Look) */}
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
  onImportFiles,
  onStartImporting,
  theme = 'dark',
  searchQuery,
  onClearSearch,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [columnsCount, setColumnsCount] = useState<number>(5);
  const [expandedAlbumId, setExpandedAlbumId] = useState<string | null>(null);

  const isLight = theme === 'light';

  // Measure container width to determine exact columns count for perfect row chunking
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const updateColumns = () => {
      const width = el.clientWidth;
      if (width < 600) setColumnsCount(2);
      else if (width < 800) setColumnsCount(3);
      else if (width < 1050) setColumnsCount(4);
      else if (width < 1300) setColumnsCount(5);
      else setColumnsCount(6);
    };

    updateColumns();
    const ro = new ResizeObserver(updateColumns);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Split albums into strict rows of length `columnsCount`
  const rows = useMemo(() => {
    const r: Album[][] = [];
    for (let i = 0; i < albums.length; i += columnsCount) {
      r.push(albums.slice(i, i + columnsCount));
    }
    return r;
  }, [albums, columnsCount]);

  // Find currently expanded album object
  const expandedAlbum = useMemo(() => {
    if (!expandedAlbumId) return null;
    return albums.find(a => a.id === expandedAlbumId) || null;
  }, [albums, expandedAlbumId]);

  const handleSelectAlbum = useCallback((albumId: string) => {
    setExpandedAlbumId(prev => (prev === albumId ? null : albumId));
  }, []);

  const handlePlayAlbum = useCallback((album: Album, shuffle = false) => {
    if (album.tracks.length === 0) return;
    const tracksToPlay = shuffle
      ? [...album.tracks].sort(() => Math.random() - 0.5)
      : album.tracks;
    onPlayTrack(tracksToPlay[0], tracksToPlay);
  }, [onPlayTrack]);

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
    <div
      ref={containerRef}
      className={`flex-1 overflow-y-auto p-6 select-none custom-scrollbar transition-colors duration-200 ${
        isLight ? 'bg-[#f4f6f9]' : 'bg-[#121212]'
      }`}
    >
      <div className="max-w-7xl mx-auto flex flex-col gap-6">
        {rows.map((rowAlbums, rowIndex) => {
          // Check if the currently expanded album is in this row
          const selectedColIndex = rowAlbums.findIndex(a => a.id === expandedAlbumId);
          const isRowExpanded = selectedColIndex !== -1;

          return (
            <div key={`row-${rowIndex}`} className="flex flex-col">
              {/* Row Grid: Full columnsCount across */}
              <div
                className="grid gap-5"
                style={{
                  gridTemplateColumns: `repeat(${columnsCount}, minmax(0, 1fr))`,
                }}
              >
                {rowAlbums.map((album) => {
                  const isSelected = expandedAlbumId === album.id;
                  const isAlbumPlaying = album.tracks.some(t => t.id === currentTrack?.id);

                  return (
                    <AlbumCard
                      key={album.id}
                      album={album}
                      isSelected={isSelected}
                      isAlbumPlaying={isAlbumPlaying}
                      isPlaying={isPlaying}
                      isLight={isLight}
                      onSelect={() => handleSelectAlbum(album.id)}
                      onPlayAlbum={() => {
                        setExpandedAlbumId(album.id);
                        handlePlayAlbum(album, false);
                      }}
                      onContextMenu={(e) => {
                        if (album.tracks.length > 0 && onTrackContextMenu) {
                          onTrackContextMenu(album.tracks[0], e);
                        }
                      }}
                    />
                  );
                })}
              </div>

              {/* Row-Aware Expanding Shelf / Drawer (Rendered strictly underneath this complete row) */}
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
                    onClose={() => setExpandedAlbumId(null)}
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
};

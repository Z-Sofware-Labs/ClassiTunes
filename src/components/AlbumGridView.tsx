import React, { useState } from 'react';
import { Album, Track } from '../types';
import { Play, Star, Disc, ChevronDown, ChevronUp, Music, Upload, FolderPlus, Search, X } from 'lucide-react';
import { ImportMusicButton } from './ImportMusicButton';

interface AlbumGridViewProps {
  albums: Album[];
  currentTrack: Track | null;
  isPlaying: boolean;
  onPlayTrack: (track: Track) => void;
  onUpdateRating: (trackId: string, rating: number) => void;
  onOpenGetInfo: (track: Track) => void;
  onTrackContextMenu?: (track: Track, e: React.MouseEvent) => void;
  onImportFiles?: (files: FileList | File[] | string[]) => void;
  onStartImporting?: (statusText?: string) => void;
  theme?: 'dark' | 'light';
  searchQuery?: string;
  onClearSearch?: () => void;
}

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
  const [expandedAlbumId, setExpandedAlbumId] = useState<string | null>(albums[0]?.id || null);
  const [selectedTrackIds, setSelectedTrackIds] = useState<string[]>([]);

  const isLight = theme === 'light';

  if (albums.length === 0) {
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
            No albums matched <span className="font-semibold text-amber-500">"{searchQuery}"</span>.
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

    return (
      <div className={`flex-1 flex flex-col items-center justify-center p-8 text-center transition-colors duration-200 select-none ${
        isLight ? 'bg-white text-gray-500' : 'bg-[#121212] text-gray-500'
      }`}>
        <div className={`w-20 h-20 rounded-full flex items-center justify-center mb-4 border ${
          isLight ? 'bg-blue-50 border-blue-200 text-blue-600' : 'bg-indigo-950/40 border-indigo-800/40 text-indigo-400'
        }`}>
          <Music className="w-10 h-10" />
        </div>
        <h3 className={`text-base font-bold mb-1 ${isLight ? 'text-gray-900' : 'text-white'}`}>No Albums Found</h3>
        <p className={`text-xs max-w-sm mb-4 ${isLight ? 'text-gray-600' : 'text-gray-400'}`}>
          Import audio files into ClassiTunes to view your albums in Grid View.
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

  return (
    <div className={`flex-1 overflow-y-auto p-6 select-none custom-scrollbar transition-colors duration-200 ${
      isLight ? 'bg-[#f1f5f9]' : 'bg-[#121212]'
    }`}>
      <div className="max-w-7xl mx-auto">
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
          {albums.map((album) => {
            const isExpanded = expandedAlbumId === album.id;
            const isAlbumPlaying = album.tracks.some(t => t.id === currentTrack?.id);

            return (
              <React.Fragment key={album.id}>
                {/* Album Card */}
                <div
                  draggable
                  onDragStart={(e) => {
                    const trackIds = album.tracks.map(t => t.id);
                    e.dataTransfer.setData('application/classiplayer-tracks', JSON.stringify(trackIds));
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                  onClick={() => setExpandedAlbumId(isExpanded ? null : album.id)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    if (album.tracks.length > 0 && onTrackContextMenu) {
                      onTrackContextMenu(album.tracks[0], e);
                    }
                  }}
                  className={`group relative flex flex-col rounded-xl p-3 border transition-all cursor-pointer shadow-lg ${
                    isExpanded 
                      ? isLight ? 'bg-white border-blue-500 ring-2 ring-blue-500/30' : 'bg-[#1a1a1a] border-indigo-500 ring-2 ring-indigo-500/30' 
                      : isLight ? 'bg-white border-gray-200 hover:border-gray-300 hover:shadow-xl' : 'bg-[#1a1a1a] border-white/10 hover:border-white/20'
                  }`}
                  id={`album-card-${album.id}`}
                >
                  {/* Square Cover Wrapper */}
                  <div className="relative aspect-square w-full rounded-lg overflow-hidden bg-black mb-2.5 shadow-md">
                    <img
                      src={album.coverUrl}
                      alt={album.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      loading="lazy"
                    />

                    {/* Glossy Overlay */}
                    <div className="absolute inset-0 bg-gradient-to-tr from-white/10 via-transparent to-black/30 pointer-events-none" />

                    {/* Play Button Overlay */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (album.tracks.length > 0) {
                          onPlayTrack(album.tracks[0]);
                        }
                      }}
                      className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white"
                      title="Play Album"
                    >
                      <div className={`w-11 h-11 rounded-full text-white flex items-center justify-center shadow-lg hover:scale-105 active:scale-95 transition-transform ${
                        isLight ? 'bg-blue-600' : 'bg-indigo-600'
                      }`}>
                        <Play className="w-5 h-5 fill-current ml-0.5" />
                      </div>
                    </button>

                    {/* Active Playing Indicator */}
                    {isAlbumPlaying && isPlaying && (
                      <div className={`absolute top-2 right-2 p-1 rounded-full shadow ${isLight ? 'bg-blue-600' : 'bg-indigo-600'}`}>
                        <span className="w-2 h-2 rounded-full bg-cyan-300 animate-ping block" />
                      </div>
                    )}
                  </div>

                  {/* Album Details */}
                  <div className="flex flex-col">
                    <h4 className={`text-xs font-bold truncate leading-snug ${isLight ? 'text-gray-900' : 'text-white'}`}>
                      {album.name}
                    </h4>
                    <p className={`text-[11px] truncate mt-0.5 ${isLight ? 'text-blue-700 font-medium' : 'text-gray-400'}`}>
                      {album.artist}
                    </p>
                    <div className={`flex items-center justify-between text-[10px] font-mono mt-1.5 pt-1.5 border-t ${
                      isLight ? 'border-gray-100 text-gray-500' : 'border-white/5 text-gray-500'
                    }`}>
                      <span>{album.year || '—'}</span>
                      <span className="flex items-center gap-1">
                        {album.tracks.length} tracks
                        {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Inline Collapsible Album Drawer when expanded */}
                {isExpanded && (
                  <div className={`col-span-full my-2 rounded-xl border p-4 shadow-xl animate-in fade-in duration-200 ${
                    isLight
                      ? 'bg-white border-gray-200 text-gray-800'
                      : 'bg-[#1c1c1c] border-[#333] text-gray-200 shadow-2xl'
                  }`}>
                    <div className={`flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-3 border-b mb-3 ${
                      isLight ? 'border-gray-200' : 'border-white/10'
                    }`}>
                      <div className="flex items-center gap-3">
                        <img
                          src={album.coverUrl}
                          alt=""
                          className="w-12 h-12 rounded-lg object-cover shadow border border-black/10"
                        />
                        <div>
                          <h3 className={`text-base font-bold ${isLight ? 'text-gray-900' : 'text-white'}`}>{album.name}</h3>
                          <p className={`text-xs font-semibold ${isLight ? 'text-blue-600' : 'text-indigo-400'}`}>{album.artist} {album.year ? `(${album.year})` : ''}</p>
                        </div>
                      </div>
                      
                      <button
                        onClick={() => {
                          if (album.tracks.length > 0) {
                            onPlayTrack(album.tracks[0]);
                          }
                        }}
                        className={`px-3 py-1.5 text-white rounded-md text-xs font-semibold flex items-center gap-1.5 shadow transition-colors ${
                          isLight ? 'bg-blue-600 hover:bg-blue-500' : 'bg-indigo-600 hover:bg-indigo-500'
                        }`}
                      >
                        <Play className="w-3.5 h-3.5 fill-current" />
                        <span>Play All Tracks</span>
                      </button>
                    </div>

                    <div className={`divide-y text-xs ${isLight ? 'divide-gray-100' : 'divide-white/5'}`}>
                      {album.tracks.map((track, idx) => {
                        const isTrackPlaying = currentTrack?.id === track.id;
                        const isSelected = selectedTrackIds.includes(track.id);

                        const handleDragStart = (e: React.DragEvent, trackId: string) => {
                          const idsToDrag = selectedTrackIds.includes(trackId) ? selectedTrackIds : [trackId];
                          e.dataTransfer.setData('application/classiplayer-tracks', JSON.stringify(idsToDrag));
                          e.dataTransfer.effectAllowed = 'copy';
                        };

                        const handleRowClick = (trackId: string, e: React.MouseEvent) => {
                          if (e.shiftKey) {
                            if (selectedTrackIds.includes(trackId)) {
                              setSelectedTrackIds(selectedTrackIds.filter(id => id !== trackId));
                            } else {
                              setSelectedTrackIds([...selectedTrackIds, trackId]);
                            }
                          } else {
                            setSelectedTrackIds([trackId]);
                          }
                        };

                        return (
                          <div
                            key={track.id}
                            draggable
                            onDragStart={(e) => handleDragStart(e, track.id)}
                            onClick={(e) => handleRowClick(track.id, e)}
                            onDoubleClick={() => onPlayTrack(track)}
                            onContextMenu={(e) => {
                              e.preventDefault();
                              if (onTrackContextMenu) onTrackContextMenu(track, e);
                            }}
                            className={`py-2 px-3 flex items-center justify-between rounded transition-colors group cursor-pointer ${
                              isSelected
                                ? isLight ? 'bg-blue-100 text-blue-950 font-bold' : 'bg-indigo-900/60 text-white font-bold'
                                : isTrackPlaying
                                  ? isLight ? 'bg-blue-50 text-blue-900 font-bold' : 'bg-indigo-950/50 text-indigo-300 font-bold'
                                  : isLight ? 'text-gray-800 hover:bg-slate-100' : 'text-gray-300 hover:bg-white/5'
                            }`}
                          >
                            <div className="flex items-center gap-3 truncate">
                              <span className={`w-6 text-right font-mono text-[11px] ${isLight ? 'text-gray-400' : 'text-gray-500'}`}>
                                {idx + 1}
                              </span>
                              <button
                                onClick={() => onPlayTrack(track)}
                                className={`p-1 ${isLight ? 'hover:text-blue-600 text-gray-500' : 'hover:text-indigo-400 text-gray-400'}`}
                              >
                                <Play className="w-3 h-3 fill-current" />
                              </button>
                              <span className="truncate">{track.title}</span>
                            </div>

                            <div className="flex items-center gap-6">
                              {/* Rating */}
                              <div className="flex items-center gap-0.5">
                                {[1, 2, 3, 4, 5].map((s) => (
                                  <Star
                                    key={s}
                                    className={`w-3 h-3 cursor-pointer ${
                                      s <= track.rating
                                        ? 'fill-amber-400 text-amber-400'
                                        : isLight
                                        ? 'text-gray-300 hover:text-gray-500'
                                        : 'text-gray-700 hover:text-gray-500'
                                    }`}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onUpdateRating(track.id, s === track.rating ? 0 : s);
                                    }}
                                  />
                                ))}
                              </div>

                              <span className={`font-mono text-[11px] min-w-[36px] text-right ${isLight ? 'text-gray-500' : 'text-gray-400'}`}>
                                {Math.floor(track.duration / 60)}:{(Math.floor(track.duration % 60) < 10 ? '0' : '') + Math.floor(track.duration % 60)}
                              </span>

                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onOpenGetInfo(track);
                                }}
                                className={`opacity-0 group-hover:opacity-100 text-[11px] hover:underline ${
                                  isLight ? 'text-blue-600' : 'text-indigo-400'
                                }`}
                              >
                                Get Info
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
};

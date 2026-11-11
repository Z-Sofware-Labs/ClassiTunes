import React, { useState, useRef, useCallback, useEffect } from 'react';
import { 
  Music, Clock, Star, Shuffle, Disc, Plus, Trash2, 
  ChevronDown, ChevronRight, ChevronUp, FolderPlus, Folder, FolderOpen, Upload, Library,
  Play, Pause, Maximize2, Info, Image as ImageIcon, X, Sparkles, Sliders, Edit2, HardDrive, Smartphone
} from 'lucide-react';
import { Playlist, Track } from '../types';
import { platformInfo } from '../utils/platform';
import { isTauri, pickTauriFiles, pickTauriDirectory, scanTauriDirectory, readTauriMusicMetadata, resolveNativeCoverUrlSync, Mp3Device } from '../utils/tauriWindow';
import { getArtwork, getCachedArtwork, getMediaFile, setCachedArtwork } from '../services/mediaStorage';

interface SidebarProps {
  playlists: Playlist[];
  selectedPlaylistId: string;
  onSelectPlaylist: (playlistId: string) => void;
  onCreatePlaylist: (parentId?: string) => void;
  onCreateSmartPlaylist?: () => void;
  onEditSmartPlaylist?: (playlist: Playlist) => void;
  onRenamePlaylist?: (id: string, newName: string) => void;
  onDeletePlaylist: (id: string) => void;
  onDropTracksToPlaylist: (trackIds: string[], playlistId: string) => void;
  onReorderPlaylists?: (reorderedPlaylists: Playlist[]) => void;
  onImportFiles: (files: FileList | File[] | string[], targetPlaylistId?: string) => void;
  onStartImporting?: (statusText?: string) => void;
  trackCounts: Record<string, number>;
  currentTrack?: Track | null;
  isPlaying?: boolean;
  onTogglePlay?: () => void;
  onOpenGetInfo?: (track: Track) => void;
  theme?: 'dark' | 'light';
  sidebarWidth?: number;
  devices?: Mp3Device[];
  selectedDeviceId?: string | null;
  onSelectDevice?: (device: Mp3Device) => void;
  onEjectDevice?: (mountPoint: string) => void;
  onDropTracksToDevice?: (trackIds: string[], device: Mp3Device) => void;
  onCreatePlaylistFolder?: (parentId?: string) => void;
  onToggleFolderCollapse?: (folderId: string) => void;
  onMovePlaylistToFolder?: (playlistId: string, parentId?: string) => void;
  onCreatePlaylistInFolder?: (parentId: string) => void;
  onCreateSmartPlaylistInFolder?: (parentId: string) => void;
  editingPlaylistId?: string | null;
  onSetEditingPlaylistId?: (id: string | null) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  playlists,
  selectedPlaylistId,
  onSelectPlaylist,
  onCreatePlaylist,
  onCreateSmartPlaylist,
  onEditSmartPlaylist,
  onRenamePlaylist,
  onDeletePlaylist,
  onDropTracksToPlaylist,
  onReorderPlaylists,
  onImportFiles,
  onStartImporting,
  trackCounts,
  currentTrack,
  isPlaying,
  onTogglePlay,
  onOpenGetInfo,
  theme = 'dark',
  sidebarWidth = 220,
  devices = [],
  selectedDeviceId = null,
  onSelectDevice,
  onEjectDevice,
  onDropTracksToDevice,
  onCreatePlaylistFolder,
  onToggleFolderCollapse,
  onMovePlaylistToFolder,
  onCreatePlaylistInFolder,
  onCreateSmartPlaylistInFolder,
  editingPlaylistId: externalEditingPlaylistId,
  onSetEditingPlaylistId,
}) => {
  const [isArtworkOpen, setIsArtworkOpen] = useState(() => {
    try {
      const saved = localStorage.getItem('classitunes_is_artwork_open');
      return saved !== 'false';
    } catch (e) {
      return true;
    }
  });
  const [showFullArtModal, setShowFullArtModal] = useState(false);
  const [showAddMusicMenu, setShowAddMusicMenu] = useState(false);
  const [dragOverPlaylistId, setDragOverPlaylistId] = useState<string | null>(null);
  const [draggingPlaylistId, setDraggingPlaylistId] = useState<string | null>(null);
  const [dropPosition, setDropPosition] = useState<'before' | 'after' | 'into' | null>(null);

  // Playlist rename state (can be controlled from parent when newly created)
  const [internalEditingPlaylistId, setInternalEditingPlaylistId] = useState<string | null>(null);
  const editingPlaylistId = externalEditingPlaylistId !== undefined ? externalEditingPlaylistId : internalEditingPlaylistId;
  const setEditingPlaylistId = useCallback((id: string | null) => {
    setInternalEditingPlaylistId(id);
    onSetEditingPlaylistId?.(id);
  }, [onSetEditingPlaylistId]);

  const [editPlaylistName, setEditPlaylistName] = useState<string>('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Sidebar Context Menu State
  const [sidebarContextMenu, setSidebarContextMenu] = useState<{
    x: number;
    y: number;
    type: 'playlist' | 'library' | 'sidebar' | 'artwork';
    targetPlaylist?: Playlist;
  } | null>(null);
  const sidebarMenuRef = useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    try {
      localStorage.setItem('classitunes_is_artwork_open', String(isArtworkOpen));
    } catch (e) {}
  }, [isArtworkOpen]);

  const [artworkHeight, setArtworkHeight] = useState(() => {
    const saved = localStorage.getItem('classitunes_artwork_height');
    const height = saved ? parseInt(saved, 10) : 160;
    return Math.max(100, height);
  });

  const startYRef = useRef<number>(0);
  const startHeightRef = useRef<number>(0);
  const isResizingRef = useRef<boolean>(false);

  const handleResize = (e: MouseEvent) => {
    if (!isResizingRef.current) return;
    const dy = startYRef.current - e.clientY;
    const newHeight = Math.max(100, startHeightRef.current + dy);
    setArtworkHeight(newHeight);
    localStorage.setItem('classitunes_artwork_height', String(newHeight));
  };

  const stopResize = () => {
    if (isResizingRef.current) {
      isResizingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', handleResize);
      document.removeEventListener('mouseup', stopResize);
    }
  };

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    startYRef.current = e.clientY;
    startHeightRef.current = artworkHeight;
    isResizingRef.current = true;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', handleResize);
    document.addEventListener('mouseup', stopResize);
  };

  React.useEffect(() => {
    return () => {
      document.removeEventListener('mousemove', handleResize);
      document.removeEventListener('mouseup', stopResize);
    };
  }, []);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const isLight = theme === 'light';
  const isMac = platformInfo.isMacOS;

  const libraryItems = playlists.filter(p => p.systemType && p.systemType !== 'user');
  const userPlaylists = playlists.filter(p => !p.systemType || p.systemType === 'user');

  // Display artwork strictly for the currently playing track
  const displayTrack = currentTrack || null;
  const isDisplayTrackPlaying = !!displayTrack && !!isPlaying;
  const albumKey = (displayTrack?.album || '').trim().toLowerCase();
  
  // Resolve artwork instantly from track, ID cache, or album cache
  const rawCoverUrl = displayTrack?.coverUrl || (displayTrack ? getCachedArtwork(displayTrack.id) || (albumKey ? getCachedArtwork(albumKey) : undefined) : undefined);
  const resolvedCoverUrl = rawCoverUrl ? (resolveNativeCoverUrlSync(rawCoverUrl) || rawCoverUrl) : undefined;

  // Maintain active cover to eliminate blank flash while next track's artwork is resolving
  const [activeCoverUrl, setActiveCoverUrl] = useState<string | undefined>(resolvedCoverUrl);
  const [isImgLoaded, setIsImgLoaded] = useState<boolean>(true);

  React.useEffect(() => {
    if (resolvedCoverUrl) {
      // If it's the exact same URL, keep it
      if (resolvedCoverUrl === activeCoverUrl) return;
      
      // Preload image before switching to guarantee 0ms blank flash
      const img = new Image();
      img.onload = () => {
        setActiveCoverUrl(resolvedCoverUrl);
        setIsImgLoaded(true);
      };
      img.onerror = () => {
        setActiveCoverUrl(resolvedCoverUrl);
        setIsImgLoaded(true);
      };
      img.src = resolvedCoverUrl;
    } else if (!displayTrack) {
      setActiveCoverUrl(undefined);
    } else if (!resolvedCoverUrl && displayTrack) {
      let isMounted = true;
      getMediaFile(`cover_${displayTrack.id}`).then((blob) => {
        if (!isMounted) return;
        if (blob) {
          const url = URL.createObjectURL(blob);
          setCachedArtwork(displayTrack.id, url);
          if (albumKey) setCachedArtwork(albumKey, url);
          setActiveCoverUrl(url);
        } else if (isTauri() && displayTrack.filePath) {
          readTauriMusicMetadata(displayTrack.filePath).then((meta) => {
            if (!isMounted) return;
            if (meta?.coverUrl) {
              const converted = resolveNativeCoverUrlSync(meta.coverUrl) || meta.coverUrl;
              setCachedArtwork(displayTrack.id, converted);
              if (albumKey) setCachedArtwork(albumKey, converted);
              setActiveCoverUrl(converted);
              if (albumKey) setCachedArtwork(albumKey, converted);
              setActiveCoverUrl(converted);
            }
          }).catch(() => {});
        }
      }).catch(() => {});

      return () => {
        isMounted = false;
      };
    }
  }, [resolvedCoverUrl, displayTrack, activeCoverUrl, albumKey]);

  const displayCoverUrl = resolvedCoverUrl || activeCoverUrl;

  const getSystemIcon = (type?: string) => {
    switch (type) {
      case 'all': return <Music className="w-3.5 h-3.5 text-indigo-400" />;
      case 'recently_added': return <Clock className="w-3.5 h-3.5 text-indigo-400" />;
      case 'top_rated': return <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />;
      case 'party_shuffle': return <Shuffle className="w-3.5 h-3.5 text-emerald-400" />;
      default: return <Library className="w-3.5 h-3.5 text-indigo-400" />;
    }
  };

  // --- Sidebar Drag & Drop Handlers ---
  const handlePlaylistDragStart = (e: React.DragEvent, pl: Playlist) => {
    e.dataTransfer.setData('application/classiplayer-playlist-id', pl.id);
    e.dataTransfer.setData('application/classiplayer-tracks', JSON.stringify(pl.trackIds));
    e.dataTransfer.effectAllowed = 'all';
    setDraggingPlaylistId(pl.id);
  };

  const handlePlaylistDragEnd = () => {
    setDraggingPlaylistId(null);
    setDragOverPlaylistId(null);
    setDropPosition(null);
  };

  const handlePlaylistDragOver = (e: React.DragEvent, pl: Playlist) => {
    e.preventDefault();
    e.stopPropagation();

    if (draggingPlaylistId) {
      if (draggingPlaylistId === pl.id) return;
      e.dataTransfer.dropEffect = 'move';
      const rect = e.currentTarget.getBoundingClientRect();
      const relY = e.clientY - rect.top;
      const height = rect.height;

      // If hovering over a folder, middle 50% drops into folder
      if (pl.isFolder && relY > height * 0.25 && relY < height * 0.75) {
        setDropPosition('into');
      } else if (relY < height / 2) {
        setDropPosition('before');
      } else {
        setDropPosition('after');
      }
      setDragOverPlaylistId(pl.id);
    } else {
      if (pl.isSmart) return;
      e.dataTransfer.dropEffect = 'copy';
      setDropPosition('into');
      setDragOverPlaylistId(pl.id);
    }
  };

  const handlePlaylistDragLeave = (e: React.DragEvent, pl: Playlist) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    if (dragOverPlaylistId === pl.id) {
      setDragOverPlaylistId(null);
      setDropPosition(null);
    }
  };

  const handlePlaylistDrop = (e: React.DragEvent, targetPl: Playlist) => {
    e.preventDefault();
    e.stopPropagation();

    // Parse dropped tracks first with fallback to global in-memory store
    let droppedTrackIds: string[] | null = null;
    const rawTrackData = e.dataTransfer.getData('application/classiplayer-tracks') || e.dataTransfer.getData('text/plain');
    if (rawTrackData) {
      try {
        const parsed = JSON.parse(rawTrackData);
        if (Array.isArray(parsed) && parsed.length > 0) {
          droppedTrackIds = parsed;
        }
      } catch {}
    }
    if (!droppedTrackIds && Array.isArray((window as any).__activeDraggedTrackIds) && (window as any).__activeDraggedTrackIds.length > 0) {
      droppedTrackIds = (window as any).__activeDraggedTrackIds;
    }

    const sourcePlaylistId = draggingPlaylistId || e.dataTransfer.getData('application/classiplayer-playlist-id');
    const targetPos = dropPosition;

    setDraggingPlaylistId(null);
    setDragOverPlaylistId(null);
    setDropPosition(null);

    // 1. If dropping tracks onto a playlist or folder
    if (droppedTrackIds && droppedTrackIds.length > 0 && !sourcePlaylistId) {
      if (!targetPl.isSmart) {
        onDropTracksToPlaylist(droppedTrackIds, targetPl.id);
      }
      (window as any).__activeDraggedTrackIds = null;
      return;
    }

    // 2. Moving / nesting / reordering playlists
    if (sourcePlaylistId && sourcePlaylistId !== targetPl.id) {
      const list = [...playlists];
      const fromIdx = list.findIndex(p => p.id === sourcePlaylistId);
      if (fromIdx !== -1) {
        const moved = { ...list[fromIdx] };

        // Prevent dragging a folder into its own descendant!
        if (moved.isFolder) {
          let curr: Playlist | undefined = targetPl;
          let isDescendant = false;
          while (curr && curr.parentId) {
            if (curr.parentId === sourcePlaylistId) {
              isDescendant = true;
              break;
            }
            curr = list.find(p => p.id === curr?.parentId);
          }
          if (isDescendant) return;
        }

        list.splice(fromIdx, 1);

        if (targetPos === 'into' && targetPl.isFolder) {
          moved.parentId = targetPl.id;
          const targetInList = list.find(p => p.id === targetPl.id);
          if (targetInList) targetInList.collapsed = false;
          list.push(moved);
        } else {
          moved.parentId = targetPl.parentId;
          const toIdx = list.findIndex(p => p.id === targetPl.id);
          if (toIdx !== -1) {
            const insertIdx = targetPos === 'after' ? toIdx + 1 : toIdx;
            list.splice(insertIdx, 0, moved);
          } else {
            list.push(moved);
          }
        }

        onReorderPlaylists?.(list);
      }
      return;
    }

    // 3. Fallback: dropping tracks into playlist if sourcePlaylistId was not used
    if (!targetPl.isSmart) {
      if (droppedTrackIds && droppedTrackIds.length > 0) {
        onDropTracksToPlaylist(droppedTrackIds, targetPl.id);
        (window as any).__activeDraggedTrackIds = null;
        return;
      }

      // External files drop directly to playlist
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        onStartImporting?.(`Reading ${e.dataTransfer.files.length} audio file(s) into playlist...`);
        onImportFiles(e.dataTransfer.files, targetPl.id);
      }
    }
  };

  const handleDeviceDragOver = (e: React.DragEvent, dev: Mp3Device) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    setDropPosition('into');
    setDragOverPlaylistId(`device-${dev.id}`);
  };

  const handleDeviceDragLeave = (e: React.DragEvent, dev: Mp3Device) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    if (dragOverPlaylistId === `device-${dev.id}`) {
      setDragOverPlaylistId(null);
      setDropPosition(null);
    }
  };

  const handleDeviceDrop = (e: React.DragEvent, dev: Mp3Device) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverPlaylistId(null);
    setDropPosition(null);

    // 1. Dropping a whole playlist or playlist folder onto a device
    const playlistId = draggingPlaylistId || e.dataTransfer.getData('application/classiplayer-playlist-id');
    if (playlistId) {
      const pl = playlists.find(p => p.id === playlistId);
      if (pl) {
        if (pl.isFolder) {
          const folderTrackIds = new Set<string>();
          const collectTrackIds = (fId: string) => {
            playlists.filter(p => p.parentId === fId).forEach(child => {
              if (child.isFolder) {
                collectTrackIds(child.id);
              } else {
                child.trackIds?.forEach(id => folderTrackIds.add(id));
              }
            });
          };
          collectTrackIds(pl.id);
          pl.trackIds?.forEach(id => folderTrackIds.add(id));
          if (folderTrackIds.size > 0) {
            onDropTracksToDevice?.(Array.from(folderTrackIds), dev);
            return;
          }
        } else if (pl.trackIds && pl.trackIds.length > 0) {
          onDropTracksToDevice?.(pl.trackIds, dev);
          return;
        }
      }
    }

    // 2. Dropping individual tracks onto a device
    let trackIds: string[] | null = null;
    const rawTrackData = e.dataTransfer.getData('application/classiplayer-tracks') || e.dataTransfer.getData('text/plain');
    if (rawTrackData) {
      try {
        const parsed = JSON.parse(rawTrackData);
        if (Array.isArray(parsed) && parsed.length > 0) {
          trackIds = parsed;
        }
      } catch {}
    }
    if (!trackIds && Array.isArray((window as any).__activeDraggedTrackIds) && (window as any).__activeDraggedTrackIds.length > 0) {
      trackIds = (window as any).__activeDraggedTrackIds;
    }

    if (trackIds && trackIds.length > 0) {
      onDropTracksToDevice?.(trackIds, dev);
      (window as any).__activeDraggedTrackIds = null;
      return;
    }

    // 3. External files
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onImportFiles(e.dataTransfer.files);
    }
  };

  const handleLibraryDragOver = (e: React.DragEvent, item: Playlist) => {
    if (item.systemType === 'all') {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'copy';
      setDropPosition('into');
      setDragOverPlaylistId(item.id);
    }
  };

  const handleLibraryDragLeave = (e: React.DragEvent, item: Playlist) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    if (dragOverPlaylistId === item.id) {
      setDragOverPlaylistId(null);
      setDropPosition(null);
    }
  };

  const handleLibraryDrop = (e: React.DragEvent, item: Playlist) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverPlaylistId(null);
    setDropPosition(null);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onStartImporting?.('Reading dropped files into library...');
      onImportFiles(e.dataTransfer.files);
    }
  };



  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const files = e.target.files;
      onStartImporting?.(`Reading ${files.length} selected item${files.length > 1 ? 's' : ''}...`);
      setTimeout(() => {
        onImportFiles(files);
      }, 10);
    }
    e.target.value = '';
  };

  const widthCap = sidebarWidth - 24;
  const heightCap = artworkHeight - 64;
  const maxArtworkSize = Math.max(64, Math.min(widthCap, heightCap));
  const isCompact = artworkHeight < 190;

  // Global click outside to close sidebar context menu
  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (sidebarMenuRef.current && !sidebarMenuRef.current.contains(e.target as Node)) {
        setSidebarContextMenu(null);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSidebarContextMenu(null);
      }
    };

    if (sidebarContextMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [sidebarContextMenu]);

  // Focus and select rename input when editing starts
  React.useEffect(() => {
    if (editingPlaylistId) {
      const pl = playlists.find(p => p.id === editingPlaylistId);
      if (pl) {
        setEditPlaylistName(pl.name);
      }
      const timer = setTimeout(() => {
        if (renameInputRef.current) {
          renameInputRef.current.focus();
          renameInputRef.current.select();
          renameInputRef.current.scrollIntoView({ block: 'nearest' });
        }
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [editingPlaylistId, playlists]);

  const handleStartRename = (playlist: Playlist) => {
    setEditingPlaylistId(playlist.id);
    setEditPlaylistName(playlist.name);
    setSidebarContextMenu(null);
  };

  const handleFinishRename = (playlistId: string) => {
    if (!editingPlaylistId) return;
    const trimmed = editPlaylistName.trim();
    if (trimmed && onRenamePlaylist) {
      onRenamePlaylist(playlistId, trimmed);
    }
    setEditingPlaylistId(null);
    setEditPlaylistName('');
  };

  const handlePlaylistContextMenu = (e: React.MouseEvent, pl: Playlist) => {
    e.preventDefault();
    e.stopPropagation();
    setSidebarContextMenu({
      x: e.clientX,
      y: e.clientY,
      type: 'playlist',
      targetPlaylist: pl,
    });
  };

  const handleLibraryContextMenu = (e: React.MouseEvent, item: Playlist) => {
    e.preventDefault();
    e.stopPropagation();
    setSidebarContextMenu({
      x: e.clientX,
      y: e.clientY,
      type: 'library',
      targetPlaylist: item,
    });
  };

  const handleSidebarAreaContextMenu = (e: React.MouseEvent) => {
    // Only trigger if clicking on the background container
    if (e.target === e.currentTarget || (e.target as HTMLElement).closest('.sidebar-bg-area')) {
      e.preventDefault();
      e.stopPropagation();
      setSidebarContextMenu({
        x: e.clientX,
        y: e.clientY,
        type: 'sidebar',
      });
    }
  };

  const handleArtworkContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setSidebarContextMenu({
      x: e.clientX,
      y: e.clientY,
      type: 'artwork',
    });
  };

  return (
    <aside 
      onDragOver={(e) => e.preventDefault()}
      onContextMenu={handleSidebarAreaContextMenu}
      className={`w-full border-r flex flex-col h-full select-none text-xs overflow-hidden transition-colors duration-200 sidebar-bg-area ${
      isLight
        ? 'bg-gradient-to-b from-[#e3e8f0] via-[#d5dde8] to-[#c7d1e0] border-[#8a96a5] text-gray-800'
        : 'bg-[#1a1a1a] border-black text-gray-300'
    }`}>
      {/* Top Sidebar Scroll Area */}
      <div 
        onDragOver={(e) => e.preventDefault()}
        onContextMenu={handleSidebarAreaContextMenu}
        className="flex-1 overflow-y-auto py-3 px-2 custom-scrollbar min-h-0 sidebar-bg-area"
      >
        
        {/* Section 1: LIBRARY */}
        <div className="mb-4">
          <div className={`text-[10px] font-bold uppercase px-3 mb-1 tracking-wider ${
            isLight ? 'text-[#4c5a6f]' : 'text-gray-500'
          }`}>
            LIBRARY
          </div>
          <div className="space-y-0.5">
            {libraryItems.map((item) => {
              const isSelected = selectedPlaylistId === item.id;
              const isTargeting = dragOverPlaylistId === item.id && dropPosition === 'into';
              return (
                <button
                  key={item.id}
                  onClick={() => onSelectPlaylist(item.id)}
                  onContextMenu={(e) => handleLibraryContextMenu(e, item)}
                  onDragOver={(e) => handleLibraryDragOver(e, item)}
                  onDragLeave={(e) => handleLibraryDragLeave(e, item)}
                  onDrop={(e) => handleLibraryDrop(e, item)}
                  className={`w-full flex items-center justify-between px-3 py-1.5 rounded-md text-[13px] text-left transition-all ${
                    isTargeting
                      ? 'bg-blue-600 text-white ring-2 ring-blue-400 scale-[1.02]'
                      : isSelected
                      ? isLight ? 'bg-gradient-to-b from-[#3b82f6] to-[#1d4ed8] text-white font-medium shadow-sm' : 'bg-[#3a3a3a] text-white font-medium'
                      : isLight ? 'hover:bg-white/50 text-gray-800' : 'hover:bg-white/5 text-gray-300'
                  }`}
                  id={`sidebar-lib-${item.id}`}
                >
                  <div className="flex items-center gap-2 truncate">
                    <span>{getSystemIcon(item.systemType)}</span>
                    <span className="truncate">{item.name}</span>
                  </div>
                  <span className={`text-[10px] ${isTargeting || isSelected ? 'text-white' : isLight ? 'text-gray-600' : 'text-gray-500'}`}>
                    {trackCounts[item.id] || 0}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Section: DEVICES */}
        {devices && devices.length > 0 && (
          <div className="mb-4">
            <div className={`text-[10px] font-bold uppercase px-3 mb-1 tracking-wider ${
              isLight ? 'text-[#4c5a6f]' : 'text-gray-500'
            }`}>
              DEVICES
            </div>
            <div className="space-y-0.5">
              {devices.map((dev) => {
                const isSelected = selectedDeviceId === dev.id;
                const isTargeting = dragOverPlaylistId === `device-${dev.id}` && dropPosition === 'into';
                return (
                  <div
                    key={dev.id}
                    onDragOver={(e) => handleDeviceDragOver(e, dev)}
                    onDragLeave={(e) => handleDeviceDragLeave(e, dev)}
                    onDrop={(e) => handleDeviceDrop(e, dev)}
                    onClick={() => onSelectDevice?.(dev)}
                    className={`w-full flex items-center justify-between px-3 py-1.5 rounded-md text-[13px] text-left transition-all cursor-pointer group ${
                      isTargeting
                        ? 'bg-blue-600 text-white ring-2 ring-blue-400 scale-[1.02]'
                        : isSelected
                        ? isLight ? 'bg-gradient-to-b from-[#3b82f6] to-[#1d4ed8] text-white font-medium shadow-sm' : 'bg-[#3a3a3a] text-white font-medium'
                        : isLight ? 'hover:bg-white/50 text-gray-800' : 'hover:bg-white/5 text-gray-300'
                    }`}
                    id={`sidebar-dev-${dev.id}`}
                  >
                    <div className="flex items-center gap-2 truncate">
                      {dev.category === 'ipod' ? (
                        <Disc className="w-3.5 h-3.5 text-purple-400 flex-shrink-0" />
                      ) : dev.category === 'iphone' ? (
                        <Smartphone className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0" />
                      ) : dev.category === 'android' ? (
                        <Smartphone className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                      ) : dev.category === 'mp3Player' ? (
                        <HardDrive className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />
                      ) : (
                        <HardDrive className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                      )}
                      <span className="truncate">{dev.name}</span>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onEjectDevice?.(dev.mountPoint);
                      }}
                      title="Safely eject device"
                      className={`p-1 rounded opacity-50 group-hover:opacity-100 hover:bg-black/20 text-xs leading-none transition-opacity ${
                        isSelected ? 'text-white' : ''
                      }`}
                    >
                      ⏏
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Section 2: PLAYLISTS */}
        <div className="mb-4">
          <div className={`text-[10px] font-bold uppercase px-3 mb-1 tracking-wider flex items-center justify-between ${
            isLight ? 'text-[#4c5a6f]' : 'text-gray-500'
          }`}>
            <span>PLAYLISTS</span>
            <div className="flex items-center gap-1">
              {onCreateSmartPlaylist && (
                <button
                  onClick={onCreateSmartPlaylist}
                  className={`p-0.5 rounded flex items-center gap-0.5 text-[10px] ${
                    isLight ? 'hover:bg-black/10 text-purple-700 hover:text-purple-900 font-bold' : 'hover:bg-white/10 text-purple-400 hover:text-purple-300 font-bold'
                  }`}
                  title="New Smart Playlist..."
                  id="new-smart-playlist-header-btn"
                >
                  <Sparkles className="w-3 h-3 text-purple-500" />
                </button>
              )}
              {onCreatePlaylistFolder && (
                <button
                  onClick={() => {
                    const activePl = playlists.find(p => p.id === selectedPlaylistId);
                    onCreatePlaylistFolder(activePl?.isFolder ? activePl.id : activePl?.parentId);
                  }}
                  className={`p-0.5 rounded ${isLight ? 'hover:bg-black/10 text-blue-700 hover:text-blue-900' : 'hover:bg-white/10 text-blue-400 hover:text-blue-300'}`}
                  title="New Playlist Folder"
                  id="new-folder-header-btn"
                >
                  <FolderPlus className="w-3.5 h-3.5 text-blue-500" />
                </button>
              )}
              <button
                onClick={() => {
                  const activePl = playlists.find(p => p.id === selectedPlaylistId);
                  onCreatePlaylist(activePl?.isFolder ? activePl.id : activePl?.parentId);
                }}
                className={`p-0.5 rounded ${isLight ? 'hover:bg-black/10 text-gray-700 hover:text-black' : 'hover:bg-white/10 text-gray-400 hover:text-white'}`}
                title="Create New Regular Playlist"
                id="new-playlist-header-btn"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="space-y-0.5">
            {(() => {
              const renderPlaylistItem = (pl: Playlist, depth: number = 0): React.ReactNode => {
                const isSelected = selectedPlaylistId === pl.id;
                const isTargeting = dragOverPlaylistId === pl.id && dropPosition === 'into';
                const isDraggingThis = draggingPlaylistId === pl.id;
                const isSmart = pl.isSmart;
                const isFolder = pl.isFolder;
                const isEditing = editingPlaylistId === pl.id;
                const isCollapsed = pl.collapsed ?? false;
                const count = trackCounts[pl.id] ?? (isFolder ? 0 : pl.trackIds.length);
                const children = isFolder ? userPlaylists.filter(c => c.parentId === pl.id) : [];

                return (
                  <div key={pl.id} className="flex flex-col">
                    <div
                      draggable={!isEditing}
                      onDragStart={(e) => handlePlaylistDragStart(e, pl)}
                      onDragEnd={handlePlaylistDragEnd}
                      onContextMenu={(e) => handlePlaylistContextMenu(e, pl)}
                      onDragOver={(e) => handlePlaylistDragOver(e, pl)}
                      onDragLeave={(e) => handlePlaylistDragLeave(e, pl)}
                      onDrop={(e) => handlePlaylistDrop(e, pl)}
                      style={{ paddingLeft: `${12 + depth * 14}px` }}
                      className={`group relative flex items-center justify-between pr-3 py-1.5 rounded-md text-[13px] cursor-pointer transition-all ${
                        isDraggingThis
                          ? 'opacity-40 border border-dashed border-gray-400'
                          : isTargeting
                          ? 'bg-blue-600 text-white ring-2 ring-blue-400 scale-[1.02]'
                          : isSelected
                          ? isLight ? 'bg-gradient-to-b from-[#3b82f6] to-[#1d4ed8] text-white font-medium shadow-sm' : 'bg-[#3a3a3a] text-white font-medium'
                          : isLight ? 'hover:bg-white/50 text-gray-800' : 'hover:bg-white/5 text-gray-300'
                      }`}
                      onClick={() => {
                        if (!isEditing) onSelectPlaylist(pl.id);
                      }}
                      id={`sidebar-playlist-${pl.id}`}
                    >
                      {/* Insertion Line Indicator Above */}
                      {dragOverPlaylistId === pl.id && dropPosition === 'before' && (
                        <div className="absolute -top-0.5 left-2 right-2 h-[2px] bg-blue-500 rounded-full z-20 pointer-events-none flex items-center shadow-[0_0_8px_rgba(59,130,246,0.8)]">
                          <div className="w-2 h-2 rounded-full bg-blue-500 -ml-1 border border-white" />
                        </div>
                      )}

                      {/* Insertion Line Indicator Below */}
                      {dragOverPlaylistId === pl.id && dropPosition === 'after' && (
                        <div className="absolute -bottom-0.5 left-2 right-2 h-[2px] bg-blue-500 rounded-full z-20 pointer-events-none flex items-center shadow-[0_0_8px_rgba(59,130,246,0.8)]">
                          <div className="w-2 h-2 rounded-full bg-blue-500 -ml-1 border border-white" />
                        </div>
                      )}

                      <div className="flex items-center gap-1.5 truncate pr-2 flex-1 min-w-0">
                        {isFolder && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onToggleFolderCollapse?.(pl.id);
                            }}
                            className={`p-0.5 -ml-1 rounded hover:bg-black/10 dark:hover:bg-white/10 shrink-0 transition-transform ${
                              isSelected ? 'text-white' : isLight ? 'text-gray-500 hover:text-gray-800' : 'text-gray-400 hover:text-white'
                            }`}
                            title={isCollapsed ? 'Expand Folder' : 'Collapse Folder'}
                          >
                            {isCollapsed ? (
                              <ChevronRight className="w-3.5 h-3.5" />
                            ) : (
                              <ChevronDown className="w-3.5 h-3.5" />
                            )}
                          </button>
                        )}

                        {isFolder ? (
                          isCollapsed ? (
                            <Folder className={`w-3.5 h-3.5 shrink-0 ${isSelected ? 'text-white' : 'text-blue-500 dark:text-blue-400'}`} />
                          ) : (
                            <FolderOpen className={`w-3.5 h-3.5 shrink-0 ${isSelected ? 'text-white' : 'text-blue-500 dark:text-blue-400'}`} />
                          )
                        ) : isSmart ? (
                          <Sparkles className={`w-3.5 h-3.5 shrink-0 ${isSelected ? 'text-purple-300' : 'text-purple-500 dark:text-purple-400'}`} />
                        ) : (
                          <FolderPlus className={`w-3.5 h-3.5 shrink-0 ${isSelected ? 'text-white' : isLight ? 'text-gray-600' : 'text-gray-400'}`} />
                        )}

                        {isEditing ? (
                          <input
                            ref={renameInputRef}
                            type="text"
                            value={editPlaylistName}
                            onChange={(e) => setEditPlaylistName(e.target.value)}
                            onBlur={() => handleFinishRename(pl.id)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleFinishRename(pl.id);
                              if (e.key === 'Escape') setEditingPlaylistId(null);
                            }}
                            onClick={(e) => e.stopPropagation()}
                            className={`w-full px-1 py-0.5 text-xs rounded border outline-none font-medium ${
                              isLight
                                ? 'bg-white text-gray-900 border-blue-500 ring-1 ring-blue-400'
                                : 'bg-[#222] text-white border-blue-500 ring-1 ring-blue-400'
                            }`}
                          />
                        ) : (
                          <span 
                            onDoubleClick={(e) => {
                              e.stopPropagation();
                              handleStartRename(pl);
                            }}
                            className={`truncate ${isFolder ? 'font-medium' : ''}`}
                            title={isFolder ? 'Folder (double click to rename)' : 'Playlist (double click to rename)'}
                          >
                            {pl.name}
                          </span>
                        )}
                      </div>

                      {!isEditing && (
                        <div className="flex items-center gap-1 shrink-0">
                          <span className={`text-[10px] ${isSelected ? 'text-white' : isLight ? 'text-gray-600' : 'text-gray-500'}`}>
                            {count}
                          </span>
                          {isSmart && onEditSmartPlaylist && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onEditSmartPlaylist(pl);
                              }}
                              className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-purple-400 text-gray-400 transition-opacity"
                              title="Edit Smart Playlist Rules"
                            >
                              <Sliders className="w-3 h-3" />
                            </button>
                          )}
                          {isFolder && onCreatePlaylistInFolder && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onCreatePlaylistInFolder(pl.id);
                              }}
                              className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-blue-400 text-gray-400 transition-opacity"
                              title="New Playlist in Folder"
                            >
                              <Plus className="w-3 h-3" />
                            </button>
                          )}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onDeletePlaylist(pl.id);
                            }}
                            className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-red-500 text-gray-400 transition-opacity"
                            title={isFolder ? 'Delete Folder' : 'Delete Playlist'}
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Child playlists if folder is expanded */}
                    {isFolder && !isCollapsed && (
                      <div className="relative">
                        {children.length > 0 && (
                          <div 
                            className={`absolute top-0 bottom-1 ${isLight ? 'border-l border-gray-300/80' : 'border-l border-white/10'}`} 
                            style={{ left: `${18 + depth * 14}px` }} 
                          />
                        )}
                        {children.length > 0 ? (
                          children.map(child => renderPlaylistItem(child, depth + 1))
                        ) : (
                          <div 
                            style={{ paddingLeft: `${28 + depth * 14}px` }} 
                            className={`py-1 text-[11px] italic ${isLight ? 'text-gray-600' : 'text-gray-500'}`}
                          >
                            Empty Folder
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              };

              const rootPlaylists = userPlaylists.filter(p => !p.parentId);
              if (rootPlaylists.length === 0) {
                return (
                  <div className={`px-3 py-2 text-[11px] italic ${isLight ? 'text-gray-500' : 'text-gray-500'}`}>
                    No custom playlists yet
                  </div>
                );
              }

              return rootPlaylists.map(pl => renderPlaylistItem(pl, 0));
            })()}
          </div>


        </div>

      </div>

      {/* Collapsible Album Artwork Panel */}
      <div 
        onContextMenu={handleArtworkContextMenu}
        style={isArtworkOpen ? { height: `${artworkHeight}px` } : undefined}
        className={`border-t flex flex-col shrink-0 relative ${
          isLight ? 'border-[#8a96a5] bg-[#d3dbe6]' : 'border-black/60 bg-[#161616]'
        }`}
      >
        {/* Drag to Resize handle bar at the top */}
        {isArtworkOpen && (
          <div
            onMouseDown={startResize}
            className="absolute -top-2 left-0 right-0 h-4 cursor-row-resize z-20 flex items-center justify-center group bg-transparent"
            title="Drag to resize album artwork"
          >
            {/* Hover bar highlight */}
            <div className="absolute inset-x-0 h-0.5 bg-blue-500/0 group-hover:bg-blue-500/50 transition-colors top-1.5" />
            
            {/* Visual Grab Handle Pill */}
            <div className={`w-10 h-1 rounded-full border transition-all shadow-sm ${
              isLight 
                ? 'bg-gray-400 border-gray-400/40 group-hover:bg-blue-500 group-hover:border-blue-600' 
                : 'bg-neutral-700 border-neutral-600 group-hover:bg-blue-400 group-hover:border-blue-500'
            }`} />
          </div>
        )}

        {/* Panel Header */}
        <div className={`px-3 py-1.5 border-b flex items-center justify-between ${
          isLight ? 'bg-[#c5cfe0] border-[#92a0b3] text-gray-800' : 'bg-[#1f1f1f] border-black/40 text-gray-400'
        }`}>
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider">
            <ImageIcon className={`w-3 h-3 ${isLight ? 'text-blue-600' : 'text-indigo-400'}`} />
            <span>ALBUM ARTWORK</span>
          </div>
          <button
            onClick={() => setIsArtworkOpen(!isArtworkOpen)}
            className={`p-1 rounded transition-colors ${
              isLight ? 'text-gray-700 hover:text-black hover:bg-black/10' : 'text-gray-400 hover:text-white hover:bg-white/10'
            }`}
            title={isArtworkOpen ? "Collapse Artwork Panel" : "Expand Artwork Panel"}
            id="sidebar-artwork-toggle-btn"
          >
            {isArtworkOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
          </button>
        </div>

        {/* Panel Content Body */}
        {isArtworkOpen && (
          <div className={`flex flex-col animate-in slide-in-from-bottom-2 duration-200 overflow-y-auto flex-1 custom-scrollbar min-h-0 select-none ${isCompact ? 'p-1.5 gap-1.5' : 'p-2.5 gap-2'}`}>
            {/* Artwork Display Container */}
            {displayTrack ? (
              <div className="flex flex-col gap-1.5 flex-1 min-h-0 items-center justify-center">
                {/* Artwork Box */}
                <div 
                  className={`relative group rounded-lg overflow-hidden border shadow-lg cursor-pointer shrink-0 ${
                    isLight ? 'bg-white border-[#9faebd]' : 'bg-black border-white/10'
                  }`}
                  style={{
                    width: `${maxArtworkSize}px`,
                    height: `${maxArtworkSize}px`
                  }}
                  onClick={() => setShowFullArtModal(true)}
                >
                  {displayCoverUrl ? (
                    <img
                      src={displayCoverUrl}
                      alt={displayTrack.title}
                      className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                      decoding="async"
                    />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-[#2a2e36] to-[#15171a] text-slate-400 p-2">
                      <Disc className="w-10 h-10 stroke-[1.2] opacity-60 animate-spin" style={{ animationDuration: '8s' }} />
                      <span className="text-[10px] mt-1 font-semibold opacity-60 uppercase tracking-wider text-center truncate w-full">
                        {displayTrack.album || displayTrack.title}
                      </span>
                    </div>
                  )}
                  
                  {/* Glossy Overlay Reflection */}
                  <div className="absolute inset-0 bg-gradient-to-tr from-white/10 via-transparent to-black/30 pointer-events-none" />

                  {/* Play/Pause Hover Overlay */}
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                    {onTogglePlay && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onTogglePlay();
                        }}
                        className="p-1.5 rounded-full bg-blue-600 text-white shadow-lg hover:scale-110 active:scale-95 transition-transform"
                        title={isDisplayTrackPlaying ? "Pause" : "Play"}
                      >
                        {isDisplayTrackPlaying ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current ml-0.5" />}
                      </button>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowFullArtModal(true);
                      }}
                      className="p-1.5 rounded-full bg-black/60 text-white hover:bg-black/80 shadow transition-all"
                      title="Enlarge Artwork"
                    >
                      <Maximize2 className="w-3 h-3" />
                    </button>
                    {onOpenGetInfo && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenGetInfo(displayTrack);
                        }}
                        className="p-1.5 rounded-full bg-black/60 text-white hover:bg-black/80 shadow transition-all"
                        title="Get Info"
                      >
                        <Info className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              /* Placeholder Box when no track */
              <div 
                style={{
                  width: `${maxArtworkSize}px`,
                  height: `${maxArtworkSize}px`
                }}
                className={`mx-auto rounded-lg border border-dashed flex flex-col items-center justify-center p-2 text-center overflow-hidden shrink-0 ${
                  isLight ? 'bg-[#c5cfe0] border-[#9aa7b9] text-gray-600' : 'bg-[#111111] border-white/10 text-gray-600'
                }`}
              >
                <Disc className={`animate-spin ${isLight ? 'text-gray-500' : 'text-gray-700'}`} style={{ animationDuration: '12s', width: maxArtworkSize >= 80 ? '28px' : '20px', height: maxArtworkSize >= 80 ? '28px' : '20px' }} />
                {maxArtworkSize >= 100 && (
                  <span className={`text-[11px] font-medium leading-tight mt-1 ${isLight ? 'text-gray-800' : 'text-gray-500'}`}>No Track</span>
                )}
                {maxArtworkSize >= 120 && (
                  <span className={`text-[9px] mt-0.5 leading-tight ${isLight ? 'text-gray-600' : 'text-gray-600'}`}>Select or play a song</span>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bottom Action Footer */}
      <div className={`p-3 border-t flex items-center justify-between gap-1 shrink-0 ${
        isLight ? 'bg-[#cbd5e3] border-[#8a96a5]' : 'bg-[#161616] border-black/30'
      }`}>
        <button
          onClick={() => {
            const activePl = playlists.find(p => p.id === selectedPlaylistId);
            onCreatePlaylist(activePl?.isFolder ? activePl.id : activePl?.parentId);
          }}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 border rounded-md text-[11px] font-medium transition-colors ${
            isLight
              ? 'bg-white border-[#9aa7b9] text-gray-800 hover:bg-[#f0f4f9]'
              : 'bg-[#252525] border-white/5 hover:bg-[#333] text-gray-200'
          }`}
          id="sidebar-add-playlist-btn"
        >
          <Plus className={`w-3 h-3 ${isLight ? 'text-blue-600' : 'text-indigo-400'}`} />
          <span>New Playlist</span>
        </button>

        <div className="relative">
          <button
            onClick={() => setShowAddMusicMenu(!showAddMusicMenu)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 border rounded-md text-[11px] font-medium transition-colors cursor-pointer ${
              isLight
                ? 'bg-blue-600 border-blue-700 text-white hover:bg-blue-500 shadow-sm'
                : 'bg-[#252525] border-white/5 hover:bg-[#333] text-gray-200'
            }`}
            id="sidebar-add-music-btn"
            title="Import Music to Library"
          >
            <Upload className={`w-3 h-3 ${isLight ? 'text-white' : 'text-emerald-400'}`} />
            <span>Add Music</span>
            <ChevronUp className="w-3 h-3 opacity-80" />
          </button>

          {showAddMusicMenu && (
            <>
              <div 
                className="fixed inset-0 z-40" 
                onClick={() => setShowAddMusicMenu(false)} 
              />
              <div className={`absolute bottom-full right-0 mb-1.5 z-50 min-w-[150px] py-1 rounded-lg border shadow-xl backdrop-blur-md animate-in fade-in zoom-in-95 duration-100 ${
                isLight ? 'bg-white/95 border-gray-300 text-gray-800' : 'bg-[#282828]/95 border-white/10 text-gray-200'
              }`}>
                <button
                  type="button"
                  onClick={async () => {
                    setShowAddMusicMenu(false);
                    if (isTauri()) {
                      const paths = await pickTauriFiles();
                      if (paths && paths.length > 0) {
                        onImportFiles(paths);
                      }
                    } else {
                      fileInputRef.current?.click();
                    }
                  }}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left cursor-pointer transition-colors ${
                    isLight ? 'hover:bg-blue-50 text-gray-700 hover:text-blue-600' : 'hover:bg-white/10 text-gray-200'
                  }`}
                >
                  <Upload className="w-3.5 h-3.5 text-blue-500" />
                  <span>Add Files...</span>
                </button>

                <button
                  type="button"
                  onClick={async () => {
                    setShowAddMusicMenu(false);
                    if (isTauri()) {
                      const dir = await pickTauriDirectory();
                      if (dir) {
                        const rootName = dir.split(/[/\\]/).filter(Boolean).pop() || dir;
                        onStartImporting?.(`Preparing to scan: ${rootName}...`);

                        // Give the WebView two paint opportunities to render the
                        // scanning feedback before starting filesystem traversal.
                        await new Promise<void>((resolve) => {
                          requestAnimationFrame((_time) => {
                            requestAnimationFrame(() => resolve());
                          });
                        });

                        const paths = await scanTauriDirectory(dir, (count, folder) => {
                          const fName = folder || rootName;
                          onStartImporting?.(`Scanning: ${fName} (found ${count} audio file${count !== 1 ? 's' : ''})`);
                        });
                        if (paths.length > 0) {
                          onImportFiles(paths);
                        }
                      }
                    } else {
                      folderInputRef.current?.click();
                    }
                  }}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left cursor-pointer transition-colors ${
                    isLight ? 'hover:bg-blue-50 text-gray-700 hover:text-blue-600' : 'hover:bg-white/10 text-gray-200'
                  }`}
                >
                  <FolderPlus className="w-3.5 h-3.5 text-emerald-500" />
                  <span>Add Folder...</span>
                </button>
              </div>
            </>
          )}

          <input
            ref={fileInputRef}
            id="file-upload-input"
            type="file"
            multiple
            accept="audio/*,.mp3,.wav,.flac,.m4a,.aac,.ogg"
            onChange={handleFileInputChange}
            className="hidden"
          />
          <input
            ref={folderInputRef}
            id="folder-upload-input"
            type="file"
            {...({ webkitdirectory: '', directory: '', multiple: true } as any)}
            onChange={handleFileInputChange}
            className="hidden"
          />
        </div>
      </div>

      {/* High-Res Artwork Lightbox Modal */}
      {showFullArtModal && displayTrack && (
        <div 
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-6 animate-in fade-in duration-200"
          onClick={() => setShowFullArtModal(false)}
        >
          <div 
            className={`relative rounded-2xl border p-4 shadow-2xl max-w-lg w-full flex flex-col items-center gap-4 animate-in zoom-in-95 duration-200 ${
              isLight ? 'bg-[#f0f4f9] border-gray-300 text-gray-900' : 'bg-[#1c1c1c] border-white/20 text-gray-200'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className={`w-full flex items-center justify-between pb-2 border-b ${
              isLight ? 'border-gray-300 text-gray-800' : 'border-white/10 text-gray-200'
            }`}>
              <div className="flex items-center gap-2">
                {isMac && (
                  <button 
                    type="button"
                    onClick={() => setShowFullArtModal(false)}
                    className="w-3 h-3 rounded-full bg-[#ff5f56] border border-[#e0443e] hover:bg-[#ff3b30] flex items-center justify-center group cursor-pointer mr-1 shrink-0 transition-opacity"
                    title="Close"
                  >
                    <X className="w-2 h-2 text-black/70 opacity-0 group-hover:opacity-100" />
                  </button>
                )}
                <ImageIcon className={`w-4 h-4 ${isLight ? 'text-blue-600' : 'text-indigo-400'}`} />
                <span className="font-bold text-sm">Album Artwork</span>
              </div>
              {!isMac && (
                <button 
                  type="button"
                  onClick={() => setShowFullArtModal(false)}
                  className={`p-1 rounded-full transition-colors ${
                    isLight ? 'hover:bg-gray-200 text-gray-600 hover:text-black' : 'hover:bg-white/10 text-gray-400 hover:text-white'
                  }`}
                  title="Close"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* High-Res Image Box */}
            <div className="relative w-full aspect-square rounded-xl overflow-hidden shadow-2xl border border-black/20 bg-black">
              <img
                src={displayCoverUrl}
                alt={displayTrack.title}
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-tr from-white/10 via-transparent to-black/30 pointer-events-none" />
            </div>

            {/* Track Info Banner */}
            <div className="w-full text-center flex flex-col gap-0.5">
              <h3 className={`text-base font-bold ${isLight ? 'text-gray-900' : 'text-white'}`}>{displayTrack.title}</h3>
              <p className={`text-sm font-medium ${isLight ? 'text-blue-700' : 'text-indigo-400'}`}>{displayTrack.artist}</p>
              <p className={`text-xs ${isLight ? 'text-gray-600' : 'text-gray-400'}`}>{displayTrack.album} {displayTrack.year ? `(${displayTrack.year})` : ''}</p>
            </div>
          </div>
        </div>
      )}
      {/* Sidebar Right-Click Context Menu */}
      {sidebarContextMenu && (
        <div
          ref={sidebarMenuRef}
          style={{
            left: `${Math.min(sidebarContextMenu.x, window.innerWidth - 200)}px`,
            top: `${Math.min(sidebarContextMenu.y, window.innerHeight - 240)}px`,
          }}
          className={`fixed z-50 w-52 rounded-lg shadow-2xl border py-1.5 text-xs select-none ${
            isLight
              ? 'bg-white/95 backdrop-blur-md border-gray-300 text-gray-800 shadow-[0_10px_25px_rgba(0,0,0,0.15)]'
              : 'bg-[#1e1e1e]/95 backdrop-blur-md border-[#3a3a3a] text-gray-200 shadow-[0_10px_30px_rgba(0,0,0,0.6)]'
          }`}
          onClick={(e) => e.stopPropagation()}
        >
          {/* 1. Target Playlist / Folder Menu */}
          {sidebarContextMenu.type === 'playlist' && sidebarContextMenu.targetPlaylist && (
            <>
              <div className={`px-3 py-1 mb-1 border-b text-[10px] truncate ${
                isLight ? 'border-gray-200 text-gray-500' : 'border-white/10 text-gray-400'
              }`}>
                <span className="font-bold uppercase tracking-wider block text-[9px] opacity-70">
                  {sidebarContextMenu.targetPlaylist.isFolder ? 'Folder Options' : 'Playlist Options'}
                </span>
                <span className={`font-semibold text-xs truncate block ${isLight ? 'text-gray-900' : 'text-white'}`}>
                  {sidebarContextMenu.targetPlaylist.name}
                </span>
              </div>

              {/* Folder Actions */}
              {sidebarContextMenu.targetPlaylist.isFolder ? (
                <>
                  <button
                    onClick={() => {
                      onSelectPlaylist(sidebarContextMenu.targetPlaylist!.id);
                      setSidebarContextMenu(null);
                    }}
                    className={`w-full px-3 py-1.5 flex items-center gap-2.5 transition-colors ${
                      isLight ? 'hover:bg-blue-600 hover:text-white' : 'hover:bg-indigo-600 hover:text-white'
                    }`}
                  >
                    <FolderOpen className="w-3.5 h-3.5 text-blue-500" />
                    <span>Open Folder</span>
                  </button>

                  {onCreatePlaylistInFolder && (
                    <button
                      onClick={() => {
                        const fId = sidebarContextMenu.targetPlaylist!.id;
                        setSidebarContextMenu(null);
                        onCreatePlaylistInFolder(fId);
                      }}
                      className={`w-full px-3 py-1.5 flex items-center gap-2.5 transition-colors ${
                        isLight ? 'hover:bg-blue-600 hover:text-white' : 'hover:bg-indigo-600 hover:text-white'
                      }`}
                    >
                      <Plus className="w-3.5 h-3.5 text-blue-500" />
                      <span>New Playlist in Folder</span>
                    </button>
                  )}

                  {onCreateSmartPlaylistInFolder && (
                    <button
                      onClick={() => {
                        const fId = sidebarContextMenu.targetPlaylist!.id;
                        setSidebarContextMenu(null);
                        onCreateSmartPlaylistInFolder(fId);
                      }}
                      className={`w-full px-3 py-1.5 flex items-center gap-2.5 transition-colors ${
                        isLight ? 'hover:bg-blue-600 hover:text-white' : 'hover:bg-indigo-600 hover:text-white'
                      }`}
                    >
                      <Sparkles className="w-3.5 h-3.5 text-purple-500" />
                      <span>New Smart Playlist in Folder...</span>
                    </button>
                  )}

                  {onCreatePlaylistFolder && (
                    <button
                      onClick={() => {
                        const fId = sidebarContextMenu.targetPlaylist!.id;
                        setSidebarContextMenu(null);
                        onCreatePlaylistFolder(fId);
                      }}
                      className={`w-full px-3 py-1.5 flex items-center gap-2.5 transition-colors ${
                        isLight ? 'hover:bg-blue-600 hover:text-white' : 'hover:bg-indigo-600 hover:text-white'
                      }`}
                    >
                      <FolderPlus className="w-3.5 h-3.5 text-blue-400" />
                      <span>New Subfolder</span>
                    </button>
                  )}

                  {onRenamePlaylist && (
                    <button
                      onClick={() => handleStartRename(sidebarContextMenu.targetPlaylist!)}
                      className={`w-full px-3 py-1.5 flex items-center gap-2.5 transition-colors ${
                        isLight ? 'hover:bg-blue-600 hover:text-white' : 'hover:bg-indigo-600 hover:text-white'
                      }`}
                    >
                      <Edit2 className="w-3.5 h-3.5 text-blue-500" />
                      <span>Rename Folder</span>
                    </button>
                  )}

                  <div className={`border-t my-1 ${isLight ? 'border-gray-200' : 'border-white/10'}`} />

                  <button
                    onClick={() => {
                      const id = sidebarContextMenu.targetPlaylist!.id;
                      setSidebarContextMenu(null);
                      onDeletePlaylist(id);
                    }}
                    className="w-full px-3 py-1.5 flex items-center gap-2.5 text-red-500 hover:bg-red-600 hover:text-white transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete Folder</span>
                  </button>
                </>
              ) : (
                <>
                  {/* Regular / Smart Playlist Actions */}
                  <button
                    onClick={() => {
                      onSelectPlaylist(sidebarContextMenu.targetPlaylist!.id);
                      setSidebarContextMenu(null);
                    }}
                    className={`w-full px-3 py-1.5 flex items-center gap-2.5 transition-colors ${
                      isLight ? 'hover:bg-blue-600 hover:text-white' : 'hover:bg-indigo-600 hover:text-white'
                    }`}
                  >
                    <Music className="w-3.5 h-3.5 text-blue-500" />
                    <span>Open Playlist</span>
                  </button>

                  {!sidebarContextMenu.targetPlaylist.isSmart && onRenamePlaylist && (
                    <button
                      onClick={() => handleStartRename(sidebarContextMenu.targetPlaylist!)}
                      className={`w-full px-3 py-1.5 flex items-center gap-2.5 transition-colors ${
                        isLight ? 'hover:bg-blue-600 hover:text-white' : 'hover:bg-indigo-600 hover:text-white'
                      }`}
                    >
                      <Edit2 className="w-3.5 h-3.5 text-blue-500" />
                      <span>Rename Playlist</span>
                    </button>
                  )}

                  {sidebarContextMenu.targetPlaylist.isSmart && onEditSmartPlaylist && (
                    <button
                      onClick={() => {
                        const pl = sidebarContextMenu.targetPlaylist!;
                        setSidebarContextMenu(null);
                        onEditSmartPlaylist(pl);
                      }}
                      className={`w-full px-3 py-1.5 flex items-center gap-2.5 transition-colors ${
                        isLight ? 'hover:bg-blue-600 hover:text-white' : 'hover:bg-indigo-600 hover:text-white'
                      }`}
                    >
                      <Sliders className="w-3.5 h-3.5 text-purple-500" />
                      <span>Edit Smart Rules...</span>
                    </button>
                  )}

                  {/* Move to Folder Section */}
                  {userPlaylists.some(p => p.isFolder) && onMovePlaylistToFolder && (
                    <>
                      <div className={`border-t my-1 ${isLight ? 'border-gray-200' : 'border-white/10'}`} />
                      <div className={`px-3 py-1 text-[10px] font-bold uppercase tracking-wider ${
                        isLight ? 'text-gray-500' : 'text-gray-400'
                      }`}>
                        Move To Folder:
                      </div>
                      {userPlaylists.filter(p => p.isFolder && p.id !== sidebarContextMenu.targetPlaylist?.parentId).map(folder => (
                        <button
                          key={folder.id}
                          onClick={() => {
                            const plId = sidebarContextMenu.targetPlaylist!.id;
                            setSidebarContextMenu(null);
                            onMovePlaylistToFolder(plId, folder.id);
                          }}
                          className={`w-full px-3 py-1 flex items-center gap-2 pl-4 text-[11px] ${
                            isLight ? 'hover:bg-blue-600 hover:text-white' : 'hover:bg-indigo-600 hover:text-white'
                          }`}
                        >
                          <Folder className="w-3 h-3 text-blue-400 shrink-0" />
                          <span className="truncate">{folder.name}</span>
                        </button>
                      ))}
                      {sidebarContextMenu.targetPlaylist.parentId && (
                        <button
                          onClick={() => {
                            const plId = sidebarContextMenu.targetPlaylist!.id;
                            setSidebarContextMenu(null);
                            onMovePlaylistToFolder(plId, undefined);
                          }}
                          className={`w-full px-3 py-1 flex items-center gap-2 pl-4 text-[11px] italic text-amber-500 ${
                            isLight ? 'hover:bg-amber-100' : 'hover:bg-white/10'
                          }`}
                        >
                          <span>Move to Top Level</span>
                        </button>
                      )}
                    </>
                  )}

                  <div className={`border-t my-1 ${isLight ? 'border-gray-200' : 'border-white/10'}`} />

                  <button
                    onClick={() => {
                      const id = sidebarContextMenu.targetPlaylist!.id;
                      setSidebarContextMenu(null);
                      onDeletePlaylist(id);
                    }}
                    className="w-full px-3 py-1.5 flex items-center gap-2.5 text-red-500 hover:bg-red-600 hover:text-white transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete Playlist</span>
                  </button>
                </>
              )}
            </>
          )}

          {/* 2. Library Item Menu */}
          {sidebarContextMenu.type === 'library' && sidebarContextMenu.targetPlaylist && (
            <>
              <div className={`px-3 py-1 mb-1 border-b text-[10px] truncate ${
                isLight ? 'border-gray-200 text-gray-500' : 'border-white/10 text-gray-400'
              }`}>
                <span className="font-bold uppercase tracking-wider block text-[9px] opacity-70">Library View</span>
                <span className={`font-semibold text-xs truncate block ${isLight ? 'text-gray-900' : 'text-white'}`}>
                  {sidebarContextMenu.targetPlaylist.name}
                </span>
              </div>

              <button
                onClick={() => {
                  onSelectPlaylist(sidebarContextMenu.targetPlaylist!.id);
                  setSidebarContextMenu(null);
                }}
                className={`w-full px-3 py-1.5 flex items-center gap-2.5 transition-colors ${
                  isLight ? 'hover:bg-blue-600 hover:text-white' : 'hover:bg-indigo-600 hover:text-white'
                }`}
              >
                {getSystemIcon(sidebarContextMenu.targetPlaylist.systemType)}
                <span>Show {sidebarContextMenu.targetPlaylist.name}</span>
              </button>

              <div className={`border-t my-1 ${isLight ? 'border-gray-200' : 'border-white/10'}`} />

              <button
                onClick={() => {
                  setSidebarContextMenu(null);
                  onCreatePlaylist();
                }}
                className={`w-full px-3 py-1.5 flex items-center gap-2.5 transition-colors ${
                  isLight ? 'hover:bg-blue-600 hover:text-white' : 'hover:bg-indigo-600 hover:text-white'
                }`}
              >
                <Plus className="w-3.5 h-3.5 text-blue-500" />
                <span>New Playlist</span>
              </button>

              {onCreatePlaylistFolder && (
                <button
                  onClick={() => {
                    setSidebarContextMenu(null);
                    onCreatePlaylistFolder();
                  }}
                  className={`w-full px-3 py-1.5 flex items-center gap-2.5 transition-colors ${
                    isLight ? 'hover:bg-blue-600 hover:text-white' : 'hover:bg-indigo-600 hover:text-white'
                  }`}
                >
                  <FolderPlus className="w-3.5 h-3.5 text-blue-400" />
                  <span>New Playlist Folder</span>
                </button>
              )}

              {onCreateSmartPlaylist && (
                <button
                  onClick={() => {
                    setSidebarContextMenu(null);
                    onCreateSmartPlaylist();
                  }}
                  className={`w-full px-3 py-1.5 flex items-center gap-2.5 transition-colors ${
                    isLight ? 'hover:bg-blue-600 hover:text-white' : 'hover:bg-indigo-600 hover:text-white'
                  }`}
                >
                  <Sparkles className="w-3.5 h-3.5 text-purple-500" />
                  <span>New Smart Playlist...</span>
                </button>
              )}
            </>
          )}

          {/* 3. Empty Sidebar Area Menu */}
          {sidebarContextMenu.type === 'sidebar' && (
            <>
              <div className={`px-3 py-1 mb-1 border-b text-[10px] font-bold uppercase tracking-wider ${
                isLight ? 'border-gray-200 text-gray-500' : 'border-white/10 text-gray-400'
              }`}>
                Sidebar Actions
              </div>

              <button
                onClick={() => {
                  setSidebarContextMenu(null);
                  onCreatePlaylist();
                }}
                className={`w-full px-3 py-1.5 flex items-center gap-2.5 transition-colors ${
                  isLight ? 'hover:bg-blue-600 hover:text-white' : 'hover:bg-indigo-600 hover:text-white'
                }`}
              >
                <Plus className="w-3.5 h-3.5 text-blue-500" />
                <span>New Playlist</span>
              </button>

              {onCreatePlaylistFolder && (
                <button
                  onClick={() => {
                    setSidebarContextMenu(null);
                    onCreatePlaylistFolder();
                  }}
                  className={`w-full px-3 py-1.5 flex items-center gap-2.5 transition-colors ${
                    isLight ? 'hover:bg-blue-600 hover:text-white' : 'hover:bg-indigo-600 hover:text-white'
                  }`}
                >
                  <FolderPlus className="w-3.5 h-3.5 text-blue-400" />
                  <span>New Playlist Folder</span>
                </button>
              )}

              {onCreateSmartPlaylist && (
                <button
                  onClick={() => {
                    setSidebarContextMenu(null);
                    onCreateSmartPlaylist();
                  }}
                  className={`w-full px-3 py-1.5 flex items-center gap-2.5 transition-colors ${
                    isLight ? 'hover:bg-blue-600 hover:text-white' : 'hover:bg-indigo-600 hover:text-white'
                  }`}
                >
                  <Sparkles className="w-3.5 h-3.5 text-purple-500" />
                  <span>New Smart Playlist...</span>
                </button>
              )}

              <div className={`border-t my-1 ${isLight ? 'border-gray-200' : 'border-white/10'}`} />

              <button
                onClick={async () => {
                  setSidebarContextMenu(null);
                  if (isTauri()) {
                    const paths = await pickTauriFiles();
                    if (paths && paths.length > 0) {
                      onImportFiles(paths);
                    }
                  } else {
                    fileInputRef.current?.click();
                  }
                }}
                className={`w-full px-3 py-1.5 flex items-center gap-2.5 transition-colors ${
                  isLight ? 'hover:bg-blue-600 hover:text-white' : 'hover:bg-indigo-600 hover:text-white'
                }`}
              >
                <Upload className="w-3.5 h-3.5 text-blue-500" />
                <span>Add Files...</span>
              </button>

              <button
                onClick={async () => {
                  setSidebarContextMenu(null);
                  if (isTauri()) {
                    const dir = await pickTauriDirectory();
                    if (dir) {
                      const rootName = dir.split(/[/\\]/).filter(Boolean).pop() || dir;
                      onStartImporting?.(`Preparing to scan: ${rootName}...`);
                      const paths = await scanTauriDirectory(dir, (count, folder) => {
                        const fName = folder || rootName;
                        onStartImporting?.(`Scanning: ${fName} (found ${count} audio file${count !== 1 ? 's' : ''})`);
                      });
                      if (paths.length > 0) {
                        onImportFiles(paths);
                      }
                    }
                  } else {
                    folderInputRef.current?.click();
                  }
                }}
                className={`w-full px-3 py-1.5 flex items-center gap-2.5 transition-colors ${
                  isLight ? 'hover:bg-blue-600 hover:text-white' : 'hover:bg-indigo-600 hover:text-white'
                }`}
              >
                <FolderPlus className="w-3.5 h-3.5 text-emerald-500" />
                <span>Add Folder...</span>
              </button>
            </>
          )}

          {/* 4. Artwork Panel Menu */}
          {sidebarContextMenu.type === 'artwork' && (
            <>
              <div className={`px-3 py-1 mb-1 border-b text-[10px] font-bold uppercase tracking-wider ${
                isLight ? 'border-gray-200 text-gray-500' : 'border-white/10 text-gray-400'
              }`}>
                Artwork Options
              </div>

              {displayTrack && (
                <>
                  <button
                    onClick={() => {
                      setSidebarContextMenu(null);
                      setShowFullArtModal(true);
                    }}
                    className={`w-full px-3 py-1.5 flex items-center gap-2.5 transition-colors ${
                      isLight ? 'hover:bg-blue-600 hover:text-white' : 'hover:bg-indigo-600 hover:text-white'
                    }`}
                  >
                    <Maximize2 className="w-3.5 h-3.5 text-blue-500" />
                    <span>Enlarge Artwork</span>
                  </button>

                  {onOpenGetInfo && (
                    <button
                      onClick={() => {
                        setSidebarContextMenu(null);
                        onOpenGetInfo(displayTrack);
                      }}
                      className={`w-full px-3 py-1.5 flex items-center gap-2.5 transition-colors ${
                        isLight ? 'hover:bg-blue-600 hover:text-white' : 'hover:bg-indigo-600 hover:text-white'
                      }`}
                    >
                      <Info className="w-3.5 h-3.5 text-blue-500" />
                      <span>Get Info</span>
                    </button>
                  )}

                  {onTogglePlay && (
                    <button
                      onClick={() => {
                        setSidebarContextMenu(null);
                        onTogglePlay();
                      }}
                      className={`w-full px-3 py-1.5 flex items-center gap-2.5 transition-colors ${
                        isLight ? 'hover:bg-blue-600 hover:text-white' : 'hover:bg-indigo-600 hover:text-white'
                      }`}
                    >
                      {isDisplayTrackPlaying ? (
                        <>
                          <Pause className="w-3.5 h-3.5 fill-current text-blue-500" />
                          <span>Pause</span>
                        </>
                      ) : (
                        <>
                          <Play className="w-3.5 h-3.5 fill-current text-blue-500" />
                          <span>Play</span>
                        </>
                      )}
                    </button>
                  )}

                  <div className={`border-t my-1 ${isLight ? 'border-gray-200' : 'border-white/10'}`} />
                </>
              )}

              <button
                onClick={() => {
                  setIsArtworkOpen(!isArtworkOpen);
                  setSidebarContextMenu(null);
                }}
                className={`w-full px-3 py-1.5 flex items-center gap-2.5 transition-colors ${
                  isLight ? 'hover:bg-blue-600 hover:text-white' : 'hover:bg-indigo-600 hover:text-white'
                }`}
              >
                {isArtworkOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
                <span>{isArtworkOpen ? 'Collapse Panel' : 'Expand Panel'}</span>
              </button>
            </>
          )}
        </div>
      )}
    </aside>
  );
};


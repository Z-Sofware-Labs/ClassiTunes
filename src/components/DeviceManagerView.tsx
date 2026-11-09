import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { 
  HardDrive, Smartphone, Disc, Check, AlertCircle, RefreshCw, Square, XCircle,
  Folder, Music, ListMusic, ArrowRight, ShieldCheck, Trash2,
  Search, Play, Pause, FileAudio, Info, Settings, Sliders,
  HelpCircle, ChevronRight
} from 'lucide-react';
import { 
  Mp3Device, DeviceSyncPayload, DeviceSyncResult, SyncProgressEvent, 
  DeviceTrackItem, syncTracksToDevice, cancelDeviceSync, ejectDevice, listDeviceContents, deleteDeviceFile, deleteTauriFile,
  resolveNativeCoverUrlSync, isTauri
} from '../utils/tauriWindow';
import { Track, Playlist } from '../types';
import { audioEngine } from '../services/audioEngine';
import { getCachedArtwork } from '../services/mediaStorage';
import { evaluateSmartPlaylist } from '../utils/smartPlaylist';
import { ListView, ColumnId } from './ListView';
import { ContextMenu, ContextMenuState } from './ContextMenu';

const DEVICE_DEFAULT_VISIBLE: ColumnId[] = [
  'checkbox',
  'trackNumber',
  'title',
  'duration',
  'artist',
  'album',
  'genre',
  'bitrate',
  'format'
];

interface DeviceManagerViewProps {
  device: Mp3Device;
  tracks: Track[];
  playlists: Playlist[];
  currentTrack?: Track | null;
  isPlaying?: boolean;
  onPlayTrack?: (track: Track, queue?: Track[]) => void;
  onTogglePlay?: () => void;
  onStopPlayback?: () => void;
  onOpenGetInfo?: (track: Track) => void;
  onTrackContextMenu?: (track: Track, e: React.MouseEvent) => void;
  onAddTrackToPlaylist?: (trackId: string, playlistId: string) => void;
  onEjectDevice: (mountPoint: string) => void;
  onRefreshDevices?: () => void;
  theme?: 'dark' | 'light';
  checkedTrackIds?: Set<string>;
  isCheckboxColumnVisible?: boolean;
  onDeviceTracksChange?: (tracks: Track[]) => void;
  deviceCheckedTrackIds?: Set<string>;
  onDeviceCheckedTrackIdsChange?: (next: Set<string>) => void;
  searchQuery?: string;
}

async function scaleCoverTo500(coverUrl: string): Promise<string> {
  if (!coverUrl) return coverUrl;
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        if (img.width <= 500 && img.height <= 500) {
          resolve(coverUrl);
          return;
        }
        const maxDim = 500;
        let w = img.width;
        let h = img.height;
        if (w >= h) {
          h = Math.round((h * maxDim) / w);
          w = maxDim;
        } else {
          w = Math.round((w * maxDim) / h);
          h = maxDim;
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(coverUrl);
          return;
        }
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.88));
      } catch {
        resolve(coverUrl);
      }
    };
    img.onerror = () => resolve(coverUrl);
    img.src = coverUrl;
  });
}

export const DeviceManagerView: React.FC<DeviceManagerViewProps> = ({
  device,
  tracks,
  playlists,
  currentTrack = null,
  isPlaying = false,
  onPlayTrack,
  onTogglePlay,
  onStopPlayback,
  onOpenGetInfo,
  onTrackContextMenu,
  onAddTrackToPlaylist,
  onEjectDevice,
  onRefreshDevices,
  theme = 'dark',
  checkedTrackIds: checkedTrackIdsProp,
  isCheckboxColumnVisible: isCheckboxColumnVisibleProp,
  onDeviceTracksChange,
  deviceCheckedTrackIds: controlledDeviceCheckedTrackIds,
  onDeviceCheckedTrackIdsChange,
  searchQuery = '',
}) => {
  const isLight = theme === 'light';

  // Active top tab: 'summary' | 'contents'
  const [activeTab, setActiveTab] = useState<'summary' | 'contents'>('summary');

  // Sync mode: 'all' | 'playlists'
  const [syncMode, setSyncMode] = useState<'all' | 'playlists'>('all');
  const [selectedPlaylistIds, setSelectedPlaylistIds] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(`classitunes_device_playlists_${device.mountPoint}`);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (e) {}
    return [];
  });
  const [namingTemplate, setNamingTemplate] = useState<string>('{Artist}/{Album}/{TrackNumber} - {Title}');
  const [syncPlaylists, setSyncPlaylists] = useState<boolean>(true);
  const [autoSyncOnConnect, setAutoSyncOnConnect] = useState<boolean>(true);

  // Sync status
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [isStopping, setIsStopping] = useState<boolean>(false);
  const [syncProgress, setSyncProgress] = useState<SyncProgressEvent | null>(null);
  const [syncResult, setSyncResult] = useState<DeviceSyncResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Device contents state (for "Contents" tab)
  const [deviceContents, setDeviceContents] = useState<DeviceTrackItem[]>([]);
  const [isLoadingContents, setIsLoadingContents] = useState<boolean>(false);
  const [deviceSelectedTrackIds, setDeviceSelectedTrackIds] = useState<string[]>([]);
  const [deviceContextMenu, setDeviceContextMenu] = useState<ContextMenuState | null>(null);

  // Track checked songs in Contents tab for operations (delete, copy, etc.)
  const [internalDeviceCheckedTrackIds, setInternalDeviceCheckedTrackIds] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('device_checked_tracks');
      if (saved) return new Set(JSON.parse(saved));
    } catch {}
    return new Set<string>();
  });

  const deviceCheckedTrackIds = controlledDeviceCheckedTrackIds ?? internalDeviceCheckedTrackIds;
  const setDeviceCheckedTrackIds = useCallback((action: Set<string> | ((prev: Set<string>) => Set<string>)) => {
    if (onDeviceCheckedTrackIdsChange) {
      if (typeof action === 'function') {
        const next = action(deviceCheckedTrackIds);
        onDeviceCheckedTrackIdsChange(next);
      } else {
        onDeviceCheckedTrackIdsChange(action);
      }
    } else {
      setInternalDeviceCheckedTrackIds(action);
    }
  }, [controlledDeviceCheckedTrackIds, deviceCheckedTrackIds, onDeviceCheckedTrackIdsChange]);

  const [deviceVisibleColumns, setDeviceVisibleColumns] = useState<ColumnId[]>(() => {
    try {
      const saved = localStorage.getItem('device_visible_columns');
      if (saved) return JSON.parse(saved);
    } catch {}
    return DEVICE_DEFAULT_VISIBLE;
  });

  // Load custom template and settings from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(`classitunes_device_template_${device.mountPoint}`);
      if (saved) setNamingTemplate(saved.replace(/\.?\{ext\}/g, ''));
      const savedMode = localStorage.getItem(`classitunes_device_mode_${device.mountPoint}`) as any;
      if (savedMode === 'all' || savedMode === 'playlists') setSyncMode(savedMode);
      const savedAuto = localStorage.getItem(`classitunes_device_auto_${device.mountPoint}`);
      if (savedAuto !== null) setAutoSyncOnConnect(savedAuto === 'true');
    } catch (e) {}
  }, [device.mountPoint]);

  const fetchContents = async (showSpinner = true) => {
    if (showSpinner) setIsLoadingContents(true);
    try {
      const items = await listDeviceContents(device.mountPoint);
      setDeviceContents(items);
    } catch (err) {
      console.warn('Failed to load device contents:', err);
    } finally {
      if (showSpinner) setIsLoadingContents(false);
    }
  };

  useEffect(() => {
    fetchContents();
  }, [device.mountPoint]);

  const handleTemplateChange = (val: string) => {
    setNamingTemplate(val);
    try {
      localStorage.setItem(`classitunes_device_template_${device.mountPoint}`, val);
    } catch (e) {}
  };

  const handleSyncModeChange = (mode: 'all' | 'playlists') => {
    setSyncMode(mode);
    try {
      localStorage.setItem(`classitunes_device_mode_${device.mountPoint}`, mode);
    } catch (e) {}
    if (mode === 'playlists' && selectedPlaylistIds.length === 0) {
      const userPlaylists = playlists.filter(p => (!p.systemType || p.systemType === 'user') && !p.isFolder);
      if (userPlaylists.length > 0) {
        const defaultIds = [userPlaylists[0].id];
        setSelectedPlaylistIds(defaultIds);
        try {
          localStorage.setItem(`classitunes_device_playlists_${device.mountPoint}`, JSON.stringify(defaultIds));
        } catch (e) {}
      }
    }
  };

  const handleAutoSyncChange = (val: boolean) => {
    setAutoSyncOnConnect(val);
    try {
      localStorage.setItem(`classitunes_device_auto_${device.mountPoint}`, String(val));
    } catch (e) {}
  };

  // Convert device audio items into native ClassiTunes Track objects for ListView reuse
  const deviceTracks: Track[] = useMemo(() => {
    return deviceContents.map((item, idx) => ({
      id: `dev_${item.fullPath}`,
      title: item.title || item.fileName.replace(/\.[^/.]+$/, ''),
      artist: item.artist || 'Unknown Artist',
      album: item.album || 'Unknown Album',
      genre: item.genre || 'Device Audio',
      year: item.year,
      duration: item.durationSecs || 0,
      trackNumber: item.trackNumber || (idx + 1),
      rating: 0,
      playCount: 0,
      coverUrl: resolveNativeCoverUrlSync(item.coverUrl) || item.coverUrl,
      audioUrl: isTauri() ? (resolveNativeCoverUrlSync(item.fullPath) || item.fullPath) : item.fullPath,
      filePath: item.fullPath,
      format: item.format,
      bitrate: item.bitrate,
      sampleRate: item.sampleRate,
      sizeBytes: item.sizeBytes,
      dateAdded: new Date().toISOString(),
    }));
  }, [deviceContents]);

  useEffect(() => {
    onDeviceTracksChange?.(deviceTracks);
  }, [deviceTracks, onDeviceTracksChange]);

  // Scoped search filter for Device Contents
  const filteredDeviceTracks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return deviceTracks;
    return deviceTracks.filter(t =>
      (t.title && t.title.toLowerCase().includes(q)) ||
      (t.artist && t.artist.toLowerCase().includes(q)) ||
      (t.album && t.album.toLowerCase().includes(q)) ||
      (t.genre && t.genre.toLowerCase().includes(q)) ||
      (t.filePath && t.filePath.toLowerCase().includes(q))
    );
  }, [deviceTracks, searchQuery]);

  // Listen for checkbox selection and column visibility changes across tabs / components
  const [checkedStorageTick, setCheckedStorageTick] = useState(0);

  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (
        !e.key ||
        e.key === 'classitunes_checked_tracks' ||
        e.key === 'classitunes_unchecked_tracks' ||
        e.key === 'classitunes_visible_columns' ||
        e.key === 'classitunes_tracks_checked_updated'
      ) {
        setCheckedStorageTick(t => t + 1);
      }
    };
    const handleCustomEvent = () => {
      setCheckedStorageTick(t => t + 1);
    };

    const handleDeviceCheckedChanged = () => {
      try {
        const saved = localStorage.getItem('device_checked_tracks');
        setDeviceCheckedTrackIds(saved ? new Set(JSON.parse(saved)) : new Set<string>());
        const savedCols = localStorage.getItem('device_visible_columns');
        if (savedCols) setDeviceVisibleColumns(JSON.parse(savedCols));
      } catch {}
    };

    window.addEventListener('storage', handleStorage);
    window.addEventListener('classitunes:checked-changed', handleCustomEvent);
    window.addEventListener('device:checked-changed', handleDeviceCheckedChanged);
    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('classitunes:checked-changed', handleCustomEvent);
      window.removeEventListener('device:checked-changed', handleDeviceCheckedChanged);
    };
  }, []);

  // Helper to extract local disk file path from either t.filePath or t.audioUrl
  const getTrackFsPath = (t: Track): string => {
    if (t.filePath && t.filePath.trim().length > 0) return t.filePath.trim();
    if (t.audioUrl) {
      const extracted = audioEngine.extractFsPathFromUrl(t.audioUrl);
      if (extracted && extracted.trim().length > 0) return extracted.trim();
    }
    return '';
  };

  // Determine tracks to sync based on mode (all vs selected playlists) and active checked songs
  const tracksToSync = useMemo(() => {
    const available = tracks.filter(t => Boolean(getTrackFsPath(t)));
    const hasCheckedSelection =
      isCheckboxColumnVisibleProp !== false &&
      Boolean(checkedTrackIdsProp && checkedTrackIdsProp.size > 0);

    if (syncMode === 'all') {
      if (hasCheckedSelection && checkedTrackIdsProp) {
        const checkedSubset = available.filter(t => checkedTrackIdsProp.has(t.id));
        if (checkedSubset.length > 0) return checkedSubset;
      }
      return available;
    }

    if (syncMode === 'playlists') {
      const trackIdSet = new Set<string>();

      const collectPlaylistTracks = (pl: Playlist) => {
        if (pl.isFolder) {
          playlists
            .filter(child => child.parentId === pl.id)
            .forEach(collectPlaylistTracks);
        } else if (pl.isSmart) {
          evaluateSmartPlaylist(pl, tracks).forEach(t => trackIdSet.add(t.id));
        } else if (pl.trackIds) {
          pl.trackIds.forEach(id => trackIdSet.add(id));
        }
      };

      playlists
        .filter(p => selectedPlaylistIds.includes(p.id))
        .forEach(collectPlaylistTracks);

      const playlistTracks = available.filter(t => trackIdSet.has(t.id));
      if (hasCheckedSelection && checkedTrackIdsProp) {
        const checkedPlaylistSubset = playlistTracks.filter(t => checkedTrackIdsProp.has(t.id));
        if (checkedPlaylistSubset.length > 0) return checkedPlaylistSubset;
      }
      return playlistTracks;
    }

    return available;
  }, [syncMode, tracks, playlists, selectedPlaylistIds, checkedTrackIdsProp, isCheckboxColumnVisibleProp, checkedStorageTick]);

  const estimatedAudioBytes = useMemo(() => {
    return tracksToSync.reduce((acc, t) => {
      if (t.sizeBytes && t.sizeBytes > 0) return acc + t.sizeBytes;
      const dur = t.duration || 210;
      return acc + Math.round(dur * 24000);
    }, 0);
  }, [tracksToSync]);

  const previewPath = useMemo(() => {
    const sampleTrack = tracks[0] || {
      title: 'Bohemian Rhapsody',
      artist: 'Queen',
      album: 'A Night at the Opera',
      trackNumber: 4,
      year: 1975,
    };

    const artist = sampleTrack.artist || 'Unknown Artist';
    const album = sampleTrack.album || 'Unknown Album';
    const title = sampleTrack.title || 'Unknown Title';
    const trackNum = sampleTrack.trackNumber ? String(sampleTrack.trackNumber).padStart(2, '0') : '01';
    const year = sampleTrack.year ? String(sampleTrack.year) : '2026';

    const cleanTmpl = (namingTemplate || '{Artist}/{Album}/{TrackNumber} - {Title}')
      .replace(/\.?\{ext\}/gi, '');

    const rendered = cleanTmpl
      .replaceAll('{Artist}', artist)
      .replaceAll('{Album}', album)
      .replaceAll('{Title}', title)
      .replaceAll('{TrackNumber}', trackNum)
      .replaceAll('{Year}', year);

    let normalized = rendered.replace(/\//g, '\\').trim();
    while (normalized.endsWith('\\')) {
      normalized = normalized.slice(0, -1);
    }

    if (!normalized.toLowerCase().endsWith('.mp3')) {
      normalized = normalized.replace(/\.+$/, '') + '.mp3';
    }

    return `Music\\${normalized}`;
  }, [namingTemplate, tracks]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let rafId: number | null = null;
    let latestPayload: SyncProgressEvent | null = null;
    const pendingTracks: DeviceTrackItem[] = [];

    const flushProgress = () => {
      rafId = null;
      const payload = latestPayload;
      if (!payload) return;

      setSyncProgress(payload);
      if (!payload.isComplete) {
        setIsSyncing(true);
      }

      if (pendingTracks.length > 0) {
        const batch = pendingTracks.splice(0, pendingTracks.length);
        setDeviceContents(prev => {
          const updated = [...prev];
          const pathIndexMap = new Map<string, number>();
          updated.forEach((item, idx) => {
            pathIndexMap.set(item.fullPath, idx);
          });

          for (const trackItem of batch) {
            const existingIdx = pathIndexMap.get(trackItem.fullPath);
            if (existingIdx !== undefined) {
              updated[existingIdx] = trackItem;
            } else {
              pathIndexMap.set(trackItem.fullPath, updated.length);
              updated.push(trackItem);
            }
          }
          return updated;
        });
      }

      if (payload.isComplete) {
        setIsSyncing(false);
        setIsStopping(false);
        fetchContents(false);
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('classitunes:device-sync-progress', { detail: null }));
        }, 2500);
      }
    };

    import('@tauri-apps/api/event').then(({ listen }) => {
      listen<SyncProgressEvent>('device-sync-progress', (event) => {
        const payload = event.payload;
        latestPayload = payload;
        if (payload.syncedTrack) {
          pendingTracks.push(payload.syncedTrack);
        }

        if (payload.isComplete) {
          if (rafId !== null) {
            cancelAnimationFrame(rafId);
            rafId = null;
          }
          flushProgress();
        } else if (rafId === null) {
          rafId = requestAnimationFrame(flushProgress);
        }
      }).then(un => { unlisten = un; });
    });

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (unlisten) unlisten();
    };
  }, [device.mountPoint, device.name]);

  const handleStartSync = async () => {
    if (syncMode === 'playlists' && selectedPlaylistIds.length === 0) {
      setErrorMessage('Please select at least one playlist below to sync.');
      return;
    }
    if (tracksToSync.length === 0) {
      setErrorMessage('No valid audio tracks found to sync on this device.');
      return;
    }
    setIsSyncing(true);
    setErrorMessage(null);
    setSyncResult(null);

    window.dispatchEvent(new CustomEvent('classitunes:device-sync-progress', {
      detail: {
        active: true,
        current: 0,
        total: tracksToSync.length,
        title: tracksToSync[0]?.title || 'Preparing tracks...',
        deviceName: device.name,
        isComplete: false,
      }
    }));

    // Read global transcoding preferences from localStorage
    let transcodeEnabled = false;
    let transcodeFormat = 'MP3';
    let transcodeBitrate = 256;
    let transcodeDownmixMono = false;
    let transcodeDownsample44k = true;
    let scaleArtwork500 = true;

    try {
      const savedSettings = localStorage.getItem('classitunes_settings');
      if (savedSettings) {
        const parsed = JSON.parse(savedSettings);
        if (parsed.transcodeOnSync !== undefined) transcodeEnabled = Boolean(parsed.transcodeOnSync);
        if (parsed.transcodeFormat) transcodeFormat = parsed.transcodeFormat;
        if (parsed.transcodeBitrate) transcodeBitrate = parseInt(parsed.transcodeBitrate, 10) || 256;
        if (parsed.transcodeDownmixMono !== undefined) transcodeDownmixMono = Boolean(parsed.transcodeDownmixMono);
        if (parsed.transcodeDownsample44k !== undefined) transcodeDownsample44k = Boolean(parsed.transcodeDownsample44k);
        if (parsed.scaleArtwork500 !== undefined) scaleArtwork500 = Boolean(parsed.scaleArtwork500);
      }
    } catch (e) {}

    const scaledCoverCache = new Map<string, Promise<string>>();
    const preparedTracks = await Promise.all(
      tracksToSync.map(async (t) => {
        let cover = t.coverUrl || getCachedArtwork(t.id) || (t.album ? getCachedArtwork(t.album.trim().toLowerCase()) : undefined);
        // Only scale in browser canvas if it's a blob: or oversized data: URL; Rust natively scales file/asset paths!
        if (scaleArtwork500 && cover && (cover.startsWith('blob:') || (cover.startsWith('data:') && cover.length > 180_000))) {
          let pending = scaledCoverCache.get(cover);
          if (!pending) {
            pending = scaleCoverTo500(cover).catch(() => cover!);
            scaledCoverCache.set(cover, pending);
          }
          cover = await pending;
        }
        return {
          id: t.id,
          filePath: getTrackFsPath(t),
          title: t.title,
          artist: t.artist,
          albumArtist: t.albumArtist,
          album: t.album,
          genre: t.genre,
          trackNumber: t.trackNumber,
          year: t.year,
          coverUrl: cover,
          lyrics: t.lyrics,
          comments: t.comments,
          duration: t.duration,
          bitrate: t.bitrate,
        };
      })
    );

    const payload: DeviceSyncPayload = {
      mountPoint: device.mountPoint,
      tracks: preparedTracks,
      namingTemplate,
      syncPlaylists,
      playlistName: syncMode === 'playlists' ? 'Synced Playlists' : 'Library',
      transcodeEnabled,
      transcodeFormat,
      transcodeBitrate,
      transcodeDownmixMono,
      transcodeDownsample44k,
      scaleArtwork500,
      mirrorSync: true,
    };

    try {
      const res = await syncTracksToDevice(payload);
      setSyncResult(res);
      fetchContents(false);
      if (onRefreshDevices) onRefreshDevices();
    } catch (err: any) {
      setErrorMessage(err?.message || String(err));
    } finally {
      setIsSyncing(false);
      setIsStopping(false);
    }
  };

  const handleStopSync = async () => {
    setIsStopping(true);
    try {
      await cancelDeviceSync();
    } catch (err: any) {
      console.error('Failed to cancel device sync:', err);
    }
  };

  const handleEject = () => {
    onEjectDevice(device.mountPoint);
  };

  const resolveDeviceFilePaths = (ids: string[]): string[] => {
    return ids
      .map(id => {
        const item = deviceTracks.find(t => t.id === id);
        if (item?.filePath) return item.filePath;
        if (id.startsWith('dev_')) return id.slice(4);
        if (id.includes('\\') || id.includes('/')) return id;
        return undefined;
      })
      .filter((fp): fp is string => Boolean(fp));
  };

  const executeDeleteDeviceFiles = async (filePaths: string[]) => {
    try {
      // If currently playing a track from the device that is being deleted, stop playback immediately
      const currentFsPath = currentTrack?.filePath || (currentTrack?.audioUrl ? audioEngine.extractFsPathFromUrl(currentTrack.audioUrl) : '');
      const currentId = currentTrack?.id || '';
      const isCurrentBeingDeleted = filePaths.some(fp => {
        const normFp = fp.toLowerCase().replace(/\\/g, '/');
        const normCurrent = currentFsPath ? currentFsPath.toLowerCase().replace(/\\/g, '/') : '';
        return (normCurrent && normFp === normCurrent) || currentId === `dev_${fp}` || currentId === fp;
      });

      if (isCurrentBeingDeleted) {
        audioEngine.stop();
        onStopPlayback?.();
        window.dispatchEvent(new CustomEvent('classitunes:stop-playback'));
      }

      // Optimistically remove from UI immediately so Delete key / Context Menu feels instantaneous
      setDeviceContents(prev => prev.filter(item => !filePaths.includes(item.fullPath)));
      setDeviceSelectedTrackIds(prev => prev.filter(id => {
        const item = deviceTracks.find(t => t.id === id);
        const path = item?.filePath || (id.startsWith('dev_') ? id.slice(4) : id);
        return !filePaths.includes(path);
      }));
      setDeviceCheckedTrackIds(prev => {
        const next = new Set(prev);
        let changed = false;
        for (const fp of filePaths) {
          const devId = `dev_${fp}`;
          if (next.delete(devId) || next.delete(fp)) {
            changed = true;
          }
        }
        if (changed) {
          try {
            localStorage.setItem('device_checked_tracks', JSON.stringify(Array.from(next)));
            window.dispatchEvent(new CustomEvent('device:checked-changed'));
          } catch {}
        }
        return changed ? next : prev;
      });

      const deletedPaths: string[] = [];
      for (const fp of filePaths) {
        let ok = await deleteDeviceFile(fp);
        if (!ok && !/^mtp:[/\\]/i.test(fp)) {
          try {
            ok = await deleteTauriFile(fp);
          } catch {}
        }
        if (ok) {
          deletedPaths.push(fp);
        }
      }

      if (deletedPaths.length > 0) {
        onRefreshDevices?.();
      }
      // Always refresh actual device contents after deletion completes so cache & UI stay perfectly in sync
      void fetchContents(false);
    } catch (err: any) {
      console.error(`Could not delete file from device: ${err?.message || err}`);
    }
  };

  const promptDeleteDeviceFiles = (filePaths: string[]) => {
    if (!filePaths || filePaths.length === 0) return;
    void executeDeleteDeviceFiles(filePaths);
  };

  const handleDeleteDeviceFiles = async (filePaths: string[]) => {
    promptDeleteDeviceFiles(filePaths);
  };

  const handleDeleteDeviceFile = async (filePath: string) => {
    promptDeleteDeviceFiles([filePath]);
  };

  const insertToken = (token: string) => {
    handleTemplateChange(namingTemplate + token);
  };

  const formatBytes = (bytes: number): string => {
    if (!bytes || bytes <= 0) return '0 GB';
    const gb = bytes / (1024 * 1024 * 1024);
    if (gb >= 1) return `${gb.toFixed(2)} GB`;
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(0)} MB`;
  };

  const totalContentBytes = useMemo(() => {
    return deviceContents.reduce((sum, i) => sum + i.sizeBytes, 0);
  }, [deviceContents]);

  // Capacity calculations for iTunes bar
  const total = device.totalBytes || 1;
  const free = device.availableBytes || 0;
  const usedOther = Math.max(0, device.usedBytes - totalContentBytes);
  
  const audioPercent = Math.min(100, (totalContentBytes / total) * 100);
  const otherPercent = Math.min(100 - audioPercent, (usedOther / total) * 100);
  const freePercent = Math.max(0, 100 - audioPercent - otherPercent);

  // Estimated pending audio sync calculations
  const estimatedSyncBytes = useMemo(() => {
    // Exclude tracks that already exist on the device (by matching title & artist or filename)
    const existingFileNames = new Set(deviceContents.map(c => c.fileName.toLowerCase()));
    const existingTitles = new Set(deviceContents.map(c => (c.title || '').trim().toLowerCase()));

    const pendingTracks = tracksToSync.filter(t => {
      const fileName = t.filePath ? t.filePath.split(/[/\\]/).pop()?.toLowerCase() : '';
      if (fileName && existingFileNames.has(fileName)) return false;
      const title = (t.title || '').trim().toLowerCase();
      if (title && existingTitles.has(title)) return false;
      return true;
    });

    return pendingTracks.reduce((acc, t) => {
      if (t.sizeBytes && t.sizeBytes > 0) return acc + t.sizeBytes;
      const dur = t.duration || 210;
      return acc + Math.round(dur * 24000);
    }, 0);
  }, [tracksToSync, deviceContents]);

  // Estimated capacity percentage (bounded by available free space)
  const estimatedPercent = Math.min(freePercent, (estimatedSyncBytes / total) * 100);
  const remainingFreePercent = Math.max(0, freePercent - estimatedPercent);

  // Model details for the iTunes spec card
  const deviceTypeLabel = useMemo(() => {
    switch (device.category) {
      case 'ipod': return 'iPod';
      case 'iphone': return 'iPhone';
      case 'android': return 'Android Device';
      case 'mp3Player': return 'MP3 Player';
      default: return 'USB Storage Device';
    }
  }, [device.category]);

  return (
    <div className={`h-full flex flex-col overflow-hidden select-none font-sans ${
      isLight ? 'bg-[#f4f5f7] text-[#1c1c1e]' : 'bg-[#1e2023] text-gray-200'
    }`}>
      
      {/* 1. Classic iTunes Segmented Tabs Header */}
      <div className={`px-6 py-2.5 border-b flex items-center justify-between shrink-0 shadow-sm ${
        isLight 
          ? 'bg-gradient-to-b from-[#fdfdfd] to-[#eceef1] border-[#c8ccd3]' 
          : 'bg-gradient-to-b from-[#2d3035] to-[#222428] border-black/40'
      }`}>
        {/* Left: Classic Segmented Button Switcher */}
        <div className="flex items-center">
          <div className={`inline-flex rounded-md p-0.5 border shadow-inner ${
            isLight ? 'bg-gray-200 border-gray-300' : 'bg-black/30 border-white/10'
          }`}>
            <button
              onClick={() => setActiveTab('summary')}
              className={`px-4 py-1 text-xs font-semibold rounded transition-all ${
                activeTab === 'summary'
                  ? isLight
                    ? 'bg-gradient-to-b from-white to-gray-100 text-gray-900 shadow-sm'
                    : 'bg-gradient-to-b from-[#3a3d43] to-[#2a2c31] text-white shadow-sm'
                  : isLight
                    ? 'text-gray-600 hover:text-gray-900'
                    : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              Summary
            </button>

            <button
              onClick={() => setActiveTab('contents')}
              className={`px-4 py-1 text-xs font-semibold rounded transition-all ${
                activeTab === 'contents'
                  ? isLight
                    ? 'bg-gradient-to-b from-white to-gray-100 text-gray-900 shadow-sm'
                    : 'bg-gradient-to-b from-[#3a3d43] to-[#2a2c31] text-white shadow-sm'
                  : isLight
                    ? 'text-gray-600 hover:text-gray-900'
                    : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              Contents ({deviceContents.length})
            </button>
          </div>
        </div>

        {/* Right: Eject Button styled like iTunes Aqua / Metal Button */}
        <button
          onClick={handleEject}
          className={`px-3 py-1 rounded text-xs font-medium flex items-center gap-1.5 border shadow-sm transition-all active:scale-95 ${
            isLight
              ? 'bg-gradient-to-b from-white via-gray-50 to-gray-100 hover:bg-gray-200 text-gray-700 border-gray-300'
              : 'bg-gradient-to-b from-[#3a3d43] to-[#26282d] hover:bg-[#34373d] text-gray-200 border-white/15'
          }`}
          title="Safely unmount and eject device"
        >
          <span className="text-sm leading-none">⏏</span>
          <span>Eject</span>
        </button>
      </div>

      {/* 2. Main Content Area */}
      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">

        {/* TAB 1: SUMMARY (Classic iTunes iPod Summary Page Layout) */}
        {activeTab === 'summary' && (
          <div className="p-6 max-w-5xl mx-auto space-y-5 w-full">
            
            {/* Top Hero Section: Authentic iPod Device Graphic & Spec Table */}
            <div className={`p-6 rounded-xl border shadow-sm flex flex-col sm:flex-row items-center sm:items-start gap-8 ${
              isLight ? 'bg-white border-[#d3d7de]' : 'bg-[#25282d] border-white/10'
            }`}>
              {/* Nostalgic iPod / Device Graphic */}
              <div className="shrink-0 flex flex-col items-center">
                {device.category === 'ipod' ? (
                  /* Classic iPod: White & Silver in Light Mode, Anodized Black in Dark Mode */
                  <div className={`w-24 h-40 rounded-2xl p-2.5 border-2 flex flex-col items-center justify-between relative overflow-hidden ${
                    isLight
                      ? 'bg-gradient-to-b from-gray-100 via-white to-gray-200 border-gray-300 shadow-md'
                      : 'bg-gradient-to-b from-neutral-800 via-neutral-900 to-black border-neutral-600 shadow-xl'
                  }`}>
                    <div className={`absolute inset-0 border rounded-2xl pointer-events-none ${
                      isLight ? 'border-white/80' : 'border-white/10'
                    }`} />
                    
                    {/* iPod Screen */}
                    <div className={`w-full h-15 rounded-md border p-1 flex flex-col justify-between shadow-inner ${
                      isLight
                        ? 'bg-[#c2d7b5] border-gray-400'
                        : 'bg-[#1a2636] border-neutral-600'
                    }`}>
                      <div className={`text-[7px] font-bold tracking-wider ${isLight ? 'text-gray-800' : 'text-sky-300'}`}>ClassiTunes</div>
                      <div className={`text-[8px] font-semibold text-center truncate ${isLight ? 'text-gray-800' : 'text-sky-100'}`}>Now Playing</div>
                      <div className={`flex justify-between items-center text-[6px] font-mono ${isLight ? 'text-gray-700' : 'text-sky-300/80'}`}>
                        <span>▶ 1:23</span>
                        <span>-2:45</span>
                      </div>
                    </div>

                    {/* Classic Click Wheel */}
                    <div className={`w-16 h-16 rounded-full border shadow flex items-center justify-center relative mt-1 ${
                      isLight
                        ? 'bg-gradient-to-b from-gray-200 via-gray-100 to-gray-300 border-gray-300'
                        : 'bg-gradient-to-b from-neutral-700 via-neutral-800 to-neutral-900 border-neutral-600'
                    }`}>
                      <div className={`w-6 h-6 rounded-full border shadow-inner ${
                        isLight
                          ? 'bg-gradient-to-b from-white to-gray-200 border-gray-300'
                          : 'bg-gradient-to-b from-neutral-800 to-neutral-950 border-neutral-600'
                      }`} />
                      <span className={`absolute top-1 text-[7px] font-bold uppercase tracking-widest ${isLight ? 'text-gray-500' : 'text-neutral-300'}`}>MENU</span>
                      <span className={`absolute bottom-1 text-[7px] font-bold ${isLight ? 'text-gray-500' : 'text-neutral-300'}`}>▶❚❚</span>
                      <span className={`absolute left-1.5 text-[7px] font-bold ${isLight ? 'text-gray-500' : 'text-neutral-300'}`}>|◀◀</span>
                      <span className={`absolute right-1.5 text-[7px] font-bold ${isLight ? 'text-gray-500' : 'text-neutral-300'}`}>▶▶|</span>
                    </div>
                  </div>
                ) : device.category === 'iphone' ? (
                  <div className={`w-22 h-40 rounded-2xl p-2 border-2 flex flex-col items-center justify-between ${
                    isLight
                      ? 'bg-gradient-to-b from-[#f8fafc] via-white to-[#e2e8f0] border-[#cbd5e1] shadow-md'
                      : 'bg-gradient-to-b from-gray-800 to-black border-gray-600 shadow-xl'
                  }`}>
                    <div className={`w-8 h-1 rounded-full mt-1 ${isLight ? 'bg-slate-300' : 'bg-gray-600'}`} />
                    <div className={`w-full flex-1 my-2 rounded-lg border flex flex-col items-center justify-center gap-1 ${
                      isLight
                        ? 'bg-indigo-50/90 border-indigo-200'
                        : 'bg-indigo-950/40 border-indigo-500/20'
                    }`}>
                      <Smartphone className={`w-8 h-8 ${isLight ? 'text-indigo-600' : 'text-indigo-400'}`} />
                      <span className={`text-[8px] font-mono font-bold uppercase ${isLight ? 'text-indigo-700' : 'text-indigo-300'}`}>iOS Media</span>
                    </div>
                    <div className={`w-4 h-4 rounded-full border ${isLight ? 'border-slate-300 bg-white shadow-inner' : 'border-gray-600'}`} />
                  </div>
                ) : device.category === 'android' ? (
                  <div className={`w-22 h-40 rounded-2xl p-2 border-2 flex flex-col items-center justify-between ${
                    isLight
                      ? 'bg-gradient-to-b from-[#f8fafc] via-white to-[#ecfdf5] border-emerald-300 shadow-md'
                      : 'bg-gradient-to-b from-emerald-950 to-neutral-900 border-emerald-600/60 shadow-xl'
                  }`}>
                    <div className={`w-3 h-3 rounded-full border mt-1 ${
                      isLight
                        ? 'bg-emerald-100 border-emerald-300'
                        : 'bg-emerald-500/20 border-emerald-400/40'
                    }`} />
                    <div className={`w-full flex-1 my-2 rounded-lg border flex flex-col items-center justify-center gap-1 ${
                      isLight
                        ? 'bg-emerald-50/90 border-emerald-200'
                        : 'bg-emerald-950/50 border-emerald-500/30'
                    }`}>
                      <Smartphone className={`w-8 h-8 ${isLight ? 'text-emerald-600' : 'text-emerald-400'}`} />
                      <span className={`text-[8px] font-mono font-bold uppercase ${isLight ? 'text-emerald-700' : 'text-emerald-300'}`}>Android</span>
                    </div>
                    <div className={`w-6 h-1 rounded-full ${isLight ? 'bg-emerald-400/70' : 'bg-emerald-500/40'}`} />
                  </div>
                ) : device.category === 'mp3Player' ? (
                  <div className={`w-24 h-38 rounded-xl p-2.5 border-2 flex flex-col items-center justify-between ${
                    isLight
                      ? 'bg-gradient-to-b from-[#f8fafc] via-[#f1f5f9] to-[#e2e8f0] border-blue-300 shadow-md'
                      : 'bg-gradient-to-b from-blue-950 via-slate-900 to-neutral-900 border-blue-500/50 shadow-xl'
                  }`}>
                    <div className={`w-full h-12 rounded border p-1 flex flex-col justify-between ${
                      isLight
                        ? 'bg-sky-50 border-sky-200'
                        : 'bg-cyan-950/60 border-cyan-500/40'
                    }`}>
                      <div className={`text-[7px] font-mono font-bold ${isLight ? 'text-sky-700' : 'text-cyan-300'}`}>HiFi Audio</div>
                      <div className={`text-[8px] font-bold truncate ${isLight ? 'text-slate-800' : 'text-cyan-100'}`}>DAP Player</div>
                    </div>
                    <div className={`w-10 h-10 rounded-full border flex items-center justify-center shadow-inner ${
                      isLight
                        ? 'bg-white border-slate-300'
                        : 'bg-slate-800 border-slate-600'
                    }`}>
                      <div className={`w-3.5 h-3.5 rounded-full ${isLight ? 'bg-blue-600' : 'bg-blue-500'}`} />
                    </div>
                    <div className={`text-[8px] font-mono uppercase font-bold ${isLight ? 'text-blue-700' : 'text-blue-300'}`}>MP3 / FLAC</div>
                  </div>
                ) : (
                  <div className={`w-24 h-36 rounded-xl p-3 border-2 flex flex-col items-center justify-center gap-2 ${
                    isLight
                      ? 'bg-gradient-to-b from-[#f8fafc] via-[#edf2f7] to-[#dde4ee] border-[#cbd5e1] shadow-md'
                      : 'bg-gradient-to-b from-gray-700 to-gray-900 border-gray-500 shadow-xl'
                  }`}>
                    <HardDrive className={`w-12 h-12 ${isLight ? 'text-blue-600' : 'text-blue-400'}`} />
                    <div className={`text-[10px] font-mono uppercase font-semibold ${isLight ? 'text-slate-600' : 'text-gray-400'}`}>{device.filesystem}</div>
                  </div>
                )}
              </div>

              {/* Device Spec & Information Grid */}
              <div className="flex-1 w-full space-y-4">
                <div>
                  <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
                    <span>{device.name}</span>
                  </h1>
                  <p className={`text-xs mt-0.5 ${isLight ? 'text-gray-500' : 'text-gray-400'}`}>
                    {device.modelDescription || deviceTypeLabel}
                  </p>
                </div>

                {/* iTunes Classic Two-Column Spec List */}
                <div className={`pt-3 border-t grid grid-cols-1 sm:grid-cols-2 gap-y-2 gap-x-6 text-xs ${
                  isLight ? 'border-gray-200' : 'border-white/10'
                }`}>
                  <div className="flex justify-between sm:justify-start sm:gap-4">
                    <span className={`font-semibold ${isLight ? 'text-gray-500' : 'text-gray-400'}`}>Capacity:</span>
                    <span className="font-medium text-current">{formatBytes(device.totalBytes)}</span>
                  </div>

                  <div className="flex justify-between sm:justify-start sm:gap-4">
                    <span className={`font-semibold ${isLight ? 'text-gray-500' : 'text-gray-400'}`}>Format:</span>
                    <span className="font-mono text-current">{device.filesystem}</span>
                  </div>

                  <div className="flex justify-between sm:justify-start sm:gap-4">
                    <span className={`font-semibold ${isLight ? 'text-gray-500' : 'text-gray-400'}`}>Available:</span>
                    <span className="font-semibold text-emerald-500">{formatBytes(device.availableBytes)}</span>
                  </div>

                  <div className="flex justify-between sm:justify-start sm:gap-4">
                    <span className={`font-semibold ${isLight ? 'text-gray-500' : 'text-gray-400'}`}>
                      {device.mountPoint.toUpperCase().startsWith('MTP:') ? 'Connection:' : 'Drive Letter:'}
                    </span>
                    <span className="font-mono font-bold text-current">{device.mountPoint}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Inset Panel 1: Music Sync Options (iTunes Style) */}
            <div className={`p-5 rounded-xl border shadow-sm space-y-4 ${
              isLight ? 'bg-white border-[#d3d7de]' : 'bg-[#25282d] border-white/10'
            }`}>
              <div className="border-b pb-2 flex items-center justify-between">
                <h2 className="text-sm font-bold text-current tracking-tight flex items-center gap-2">
                  <Music className="w-4 h-4 text-blue-500" />
                  <span>Sync Music</span>
                </h2>
                <span className={`text-[11px] ${isLight ? 'text-gray-500' : 'text-gray-400'}`}>
                  {tracksToSync.length} tracks selected (~{formatBytes(estimatedAudioBytes)})
                </span>
              </div>

              <div className="space-y-3 pl-1">
                <label className="flex items-center gap-3 cursor-pointer text-xs font-medium">
                  <input
                    type="radio"
                    name="itunesSyncMode"
                    checked={syncMode === 'all'}
                    onChange={() => handleSyncModeChange('all')}
                  />
                  <span>Entire music library</span>
                </label>

                <label className="flex items-center gap-3 cursor-pointer text-xs font-medium">
                  <input
                    type="radio"
                    name="itunesSyncMode"
                    checked={syncMode === 'playlists'}
                    onChange={() => handleSyncModeChange('playlists')}
                  />
                  <span>Selected playlists, artists, and albums</span>
                </label>
              </div>

              {/* Checklist when 'selected playlists' is active */}
              {syncMode === 'playlists' && (
                <div className={`mt-3 pt-3 border-t pl-6 space-y-2 ${isLight ? 'border-gray-200' : 'border-white/10'}`}>
                  <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Playlists:</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-40 overflow-y-auto pr-2 custom-scrollbar">
                    {playlists.filter(p => !p.systemType || p.systemType === 'user').map(pl => {
                      const isChecked = selectedPlaylistIds.includes(pl.id);
                      return (
                        <label key={pl.id} className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs border cursor-pointer ${
                          isChecked 
                            ? (isLight ? 'bg-blue-50 border-blue-300 text-blue-900 font-medium' : 'bg-blue-900/30 border-blue-500/40 text-blue-200 font-medium')
                            : (isLight ? 'bg-gray-50 border-gray-200 text-gray-700' : 'bg-white/5 border-white/5 text-gray-300')
                        }`}>
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={(e) => {
                              setSelectedPlaylistIds(prev => {
                                const next = e.target.checked
                                  ? Array.from(new Set([...prev, pl.id]))
                                  : prev.filter(id => id !== pl.id);
                                try {
                                  localStorage.setItem(`classitunes_device_playlists_${device.mountPoint}`, JSON.stringify(next));
                                } catch (err) {}
                                return next;
                              });
                            }}
                          />
                          <span className="truncate">{pl.name}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Inset Panel 2: Options (iTunes Style Checkboxes) */}
            <div className={`p-5 rounded-xl border shadow-sm space-y-3.5 ${
              isLight ? 'bg-white border-[#d3d7de]' : 'bg-[#25282d] border-white/10'
            }`}>
              <div className="border-b pb-2">
                <h2 className="text-sm font-bold text-current tracking-tight flex items-center gap-2">
                  <Settings className="w-4 h-4 text-gray-500" />
                  <span>Options</span>
                </h2>
              </div>

              <div className="space-y-2.5 pl-1 text-xs">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoSyncOnConnect}
                    onChange={(e) => handleAutoSyncChange(e.target.checked)}
                  />
                  <span>Automatically sync when this {deviceTypeLabel} is connected</span>
                </label>

                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={syncPlaylists}
                    onChange={(e) => setSyncPlaylists(e.target.checked)}
                  />
                  <span>Generate <code className="font-mono text-[11px]">.m3u8</code> playlist files in device <code className="font-mono text-[11px]">/Playlists/</code></span>
                </label>

                {/* Customizable Folder Template */}
                <div className={`mt-3 pt-3 border-t space-y-2 ${isLight ? 'border-gray-200' : 'border-white/10'}`}>
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-gray-400 uppercase text-[10px] tracking-wider">Device Folder & Filename Template:</span>
                    <button
                      type="button"
                      onClick={() => handleTemplateChange('{Artist}/{Album}/{TrackNumber} - {Title}')}
                      className={`text-[11px] hover:underline ${isLight ? 'text-blue-600' : 'text-blue-400'}`}
                    >
                      Reset to Default
                    </button>
                  </div>

                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={namingTemplate}
                      onChange={(e) => handleTemplateChange(e.target.value)}
                      placeholder="{Artist}/{Album}/{TrackNumber} - {Title}"
                      className={`flex-1 px-3 py-1.5 text-xs font-mono rounded border focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                        isLight ? 'bg-gray-50 border-gray-300 text-gray-900' : 'bg-[#181a1d] border-white/15 text-gray-100'
                      }`}
                    />
                  </div>

                  {/* Token chips */}
                  <div className="flex flex-wrap gap-1.5 items-center">
                    <span className="text-[10px] text-gray-400 font-semibold mr-1">Insert:</span>
                    {['{Artist}', '{Album}', '{Title}', '{TrackNumber}', '{Year}'].map(tok => (
                      <button
                        key={tok}
                        type="button"
                        onClick={() => insertToken(tok)}
                        className={`text-[10px] font-mono px-2 py-0.5 rounded border transition-colors ${
                          isLight 
                            ? 'bg-gray-100 hover:bg-gray-200 text-gray-700 border-gray-300' 
                            : 'bg-white/10 hover:bg-white/20 text-gray-300 border-white/10'
                        }`}
                      >
                        +{tok}
                      </button>
                    ))}
                  </div>

                  {/* Live Preview Box */}
                  <div className={`p-2 rounded text-[11px] font-mono border flex items-center gap-2 ${
                    isLight ? 'bg-gray-100/70 border-gray-200 text-gray-700' : 'bg-black/30 border-white/10 text-gray-300'
                  }`}>
                    <span className="font-bold opacity-60">Preview:</span>
                    <span className="truncate">{previewPath}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Live Progress Notice during Sync */}
            {isSyncing && syncProgress && (
              <div className={`p-4 rounded-xl border animate-pulse ${
                isLight ? 'bg-blue-50 border-blue-200 text-blue-900' : 'bg-blue-950/40 border-blue-500/30 text-blue-200'
              }`}>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-bold uppercase tracking-wider flex items-center gap-2">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>{isStopping ? `Stopping sync on ${device.name}...` : `Syncing ${device.name}...`}</span>
                  </div>
                  <div className="text-xs font-mono font-semibold">
                    {syncProgress.currentIndex} of {syncProgress.totalTracks}
                  </div>
                </div>

                <div className="w-full bg-black/20 rounded-full h-2 overflow-hidden mb-1.5">
                  <div 
                    className="bg-blue-500 h-full transition-all duration-300 rounded-full"
                    style={{ width: `${Math.round((syncProgress.currentIndex / Math.max(1, syncProgress.totalTracks)) * 100)}%` }}
                  />
                </div>

                <div className="text-xs truncate font-mono opacity-80">
                  Writing: {syncProgress.currentTitle}
                </div>
              </div>
            )}

            {errorMessage && !isSyncing && (
              <div className={`p-3.5 rounded-xl border flex items-start gap-2.5 ${
                isLight ? 'bg-red-50 border-red-200 text-red-900' : 'bg-red-950/30 border-red-500/30 text-red-200'
              }`}>
                <AlertCircle className="w-4 h-4 mt-0.5 text-red-500 shrink-0" />
                <div className="text-xs">
                  <span className="font-bold">Sync Error: </span>
                  <span>{errorMessage}</span>
                </div>
              </div>
            )}

            {syncResult && !isSyncing && (
              <div className={`p-3.5 rounded-xl border flex flex-col gap-1.5 ${
                syncResult.errors.length > 0 
                  ? (isLight ? 'bg-amber-50 border-amber-200 text-amber-900' : 'bg-amber-950/30 border-amber-500/30 text-amber-200')
                  : (isLight ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : 'bg-emerald-950/30 border-emerald-500/30 text-emerald-200')
              }`}>
                <div className="flex items-start gap-2.5">
                  <ShieldCheck className="w-4 h-4 mt-0.5 text-emerald-500 shrink-0" />
                  <div className="text-xs">
                    <span className="font-bold">Sync Completed: </span>
                    <span>
                      {syncResult.tracksSynced} copied ({formatBytes(syncResult.totalBytesTransferred)})
                      {syncResult.tracksUpdated ? `, ${syncResult.tracksUpdated} updated` : ''}
                      {syncResult.tracksDeleted ? `, ${syncResult.tracksDeleted} removed` : ''}
                      , {syncResult.tracksSkipped} already up to date.
                    </span>
                  </div>
                </div>
                {syncResult.errors.length > 0 && (
                  <div className="text-[11px] opacity-80 pl-6 space-y-0.5">
                    {syncResult.errors.slice(0, 3).map((err, i) => (
                      <div key={i} className="truncate">• {err}</div>
                    ))}
                    {syncResult.errors.length > 3 && (
                      <div>...and {syncResult.errors.length - 3} more items skipped</div>
                    )}
                  </div>
                )}
              </div>
            )}

          </div>
        )}

        {/* TAB 2: CONTENTS (Reusing the full native ClassiTunes ListView!) */}
        {activeTab === 'contents' && (
          <div className="flex-1 min-h-0 flex flex-col h-full">
            {/* Live Progress Banner during Active Transfer */}
            {isSyncing && syncProgress && (
              <div className={`px-4 py-2 border-b flex items-center justify-between shrink-0 shadow-sm transition-colors ${
                isLight ? 'bg-blue-50/90 border-blue-200 text-blue-900' : 'bg-blue-950/50 border-blue-500/30 text-blue-200'
              }`}>
                <div className="flex items-center gap-2.5 min-w-0">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-blue-500 shrink-0" />
                  <span className="text-xs font-semibold shrink-0">
                    Transferring to {device.name} ({syncProgress.currentIndex} of {syncProgress.totalTracks}):
                  </span>
                  <span className="text-xs truncate opacity-80 font-mono">
                    {syncProgress.currentTitle}
                  </span>
                </div>
                <div className="flex items-center gap-3 shrink-0 ml-4">
                  <div className="w-28 bg-black/20 rounded-full h-1.5 overflow-hidden">
                    <div 
                      className="bg-blue-500 h-full transition-all duration-300 rounded-full"
                      style={{ width: `${Math.round((syncProgress.currentIndex / Math.max(1, syncProgress.totalTracks)) * 100)}%` }}
                    />
                  </div>
                  <span className="text-[11px] font-mono font-medium opacity-75">
                    {Math.round((syncProgress.currentIndex / Math.max(1, syncProgress.totalTracks)) * 100)}%
                  </span>
                </div>
              </div>
            )}

            {isLoadingContents ? (
              <div className="p-16 text-center text-xs text-gray-400 flex flex-col items-center justify-center gap-2">
                <RefreshCw className="w-6 h-6 animate-spin text-blue-500" />
                <span>Reading audio tracks on {device.name}...</span>
              </div>
            ) : deviceTracks.length === 0 ? (
              <div className="p-16 text-center text-xs text-gray-400 flex flex-col items-center justify-center gap-2">
                {isSyncing ? (
                  <>
                    <RefreshCw className="w-8 h-8 animate-spin text-blue-500 mb-2" />
                    <span className="text-sm font-semibold">Transferring songs to {device.name}...</span>
                    <span className="text-xs opacity-70">
                      {syncProgress ? `${syncProgress.currentIndex} of ${syncProgress.totalTracks} completed` : 'Preparing transfer...'}
                    </span>
                  </>
                ) : (
                  <>
                    <FileAudio className="w-12 h-12 opacity-30 text-gray-400" />
                    <span className="text-sm font-semibold">No audio tracks found on this device.</span>
                    <span className="text-xs opacity-70">
                      Switch to the Summary tab to sync your music library, or drag and drop songs/playlists directly onto this device in the sidebar.
                    </span>
                  </>
                )}
              </div>
            ) : filteredDeviceTracks.length === 0 ? (
              <div className="p-16 text-center text-xs text-gray-400 flex flex-col items-center justify-center gap-2">
                <Search className="w-10 h-10 opacity-30 text-gray-400" />
                <span className="text-sm font-semibold">No songs match "{searchQuery}" on this device.</span>
                <span className="text-xs opacity-70">
                  Search is currently scoped to {device.name}. Clear the search box to view all device tracks.
                </span>
              </div>
            ) : (
              <div className="flex-1 min-h-0 flex flex-col h-full">
                <ListView
                  tracks={filteredDeviceTracks}
                  currentTrack={currentTrack || null}
                  isPlaying={!!isPlaying}
                  playlists={playlists}
                  onPlayTrack={onPlayTrack || (() => {})}
                  onUpdateRating={() => {}}
                  onOpenGetInfo={onOpenGetInfo || (() => {})}
                  selectedTrackIds={deviceSelectedTrackIds}
                  onSelectionChange={setDeviceSelectedTrackIds}
                  checkedTrackIds={deviceCheckedTrackIds}
                  onToggleCheckTrack={(trackId, e) => {
                    e.stopPropagation();
                    setDeviceCheckedTrackIds(prev => {
                      const next = new Set(prev);
                      if (next.has(trackId)) next.delete(trackId);
                      else next.add(trackId);
                      try {
                        localStorage.setItem('device_checked_tracks', JSON.stringify(Array.from(next)));
                        window.dispatchEvent(new CustomEvent('device:checked-changed'));
                      } catch {}
                      return next;
                    });
                  }}
                  onToggleCheckAll={() => {
                    const allIds = deviceTracks.map(t => t.id);
                    const areAll = allIds.length > 0 && allIds.every(id => deviceCheckedTrackIds.has(id));
                    const next = areAll ? new Set<string>() : new Set(allIds);
                    setDeviceCheckedTrackIds(next);
                    try {
                      localStorage.setItem('device_checked_tracks', JSON.stringify(Array.from(next)));
                      window.dispatchEvent(new CustomEvent('device:checked-changed'));
                    } catch {}
                  }}
                  onDeleteTrack={(id) => {
                    const fps = resolveDeviceFilePaths([id]);
                    if (fps.length > 0) promptDeleteDeviceFiles(fps);
                  }}
                  onDeleteTracks={(ids) => {
                    const fps = resolveDeviceFilePaths(ids);
                    if (fps.length > 0) promptDeleteDeviceFiles(fps);
                  }}
                  onAddTrackToPlaylist={onAddTrackToPlaylist || (() => {})}
                  onTrackContextMenu={(track, e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setDeviceContextMenu({
                      x: e.clientX,
                      y: e.clientY,
                      track,
                    });
                  }}
                  theme={theme}
                  storageScope="device"
                  defaultVisibleColumns={DEVICE_DEFAULT_VISIBLE}
                />

                {/* Device-specific Right Click Context Menu */}
                {deviceContextMenu && (
                  <ContextMenu
                    contextMenu={deviceContextMenu}
                    onClose={() => setDeviceContextMenu(null)}
                    isPlaying={!!isPlaying}
                    currentTrack={currentTrack || null}
                    playlists={playlists}
                    onPlayTrack={onPlayTrack || (() => {})}
                    onTogglePlay={onTogglePlay || (() => {})}
                    onOpenGetInfo={onOpenGetInfo || (() => {})}
                    onUpdateRating={() => {}}
                    onAddTrackToPlaylist={onAddTrackToPlaylist || (() => {})}
                    onDeleteTrack={(id) => {
                      const fps = resolveDeviceFilePaths([id]);
                      if (fps.length > 0) promptDeleteDeviceFiles(fps);
                    }}
                    onDeleteTracks={(ids) => {
                      const fps = resolveDeviceFilePaths(ids);
                      if (fps.length > 0) promptDeleteDeviceFiles(fps);
                    }}
                    selectedTrackIds={deviceSelectedTrackIds}
                    checkedTrackIds={deviceCheckedTrackIds}
                    isCheckboxVisible={deviceVisibleColumns.includes('checkbox')}
                    tracks={deviceTracks}
                    theme={theme}
                    isDeviceContext={true}
                  />
                )}
              </div>
            )}
          </div>
        )}

      </div>

      {/* 3. The Iconic Classic iTunes Bottom Capacity Bar */}
      <div className={`border-t px-6 py-2.5 flex items-center justify-between shrink-0 shadow-lg ${
        isLight 
          ? 'bg-gradient-to-b from-[#f2f4f7] via-[#e5e8ec] to-[#d6dade] border-[#b0b5be]' 
          : 'bg-gradient-to-b from-[#2b2e33] via-[#212327] to-[#18191c] border-black/60'
      }`}>
        {/* Full-width Legend & Segmented Glass Bar */}
        <div className="flex-1 mr-6 space-y-1.5 min-w-0">
          {/* Legend */}
          <div className="flex items-center gap-5 text-[11px] font-semibold">
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-gradient-to-b from-blue-400 to-blue-600 shadow-sm border border-blue-700/50 inline-block shrink-0" />
              <span className="truncate">Audio ({formatBytes(totalContentBytes)})</span>
            </div>
            {estimatedSyncBytes > 0 && (
              <div className="flex items-center gap-1.5 animate-pulse">
                <span className="w-2.5 h-2.5 rounded-sm bg-blue-400/40 border border-blue-400/80 border-dashed inline-block shrink-0" />
                <span className="truncate text-blue-400">Estimated ({formatBytes(estimatedSyncBytes)})</span>
              </div>
            )}
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-gradient-to-b from-amber-400 to-amber-600 shadow-sm border border-amber-700/50 inline-block shrink-0" />
              <span className="truncate">Other ({formatBytes(usedOther)})</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-gradient-to-b from-gray-300 to-gray-400 shadow-sm border border-gray-500/50 inline-block shrink-0" />
              <span className="truncate">Free Space ({formatBytes(Math.max(0, device.availableBytes - estimatedSyncBytes))})</span>
            </div>
          </div>

          {/* Glossy Beveled Capacity Bar */}
          <div className="w-full h-3.5 bg-gradient-to-b from-gray-700 to-gray-800 rounded-sm overflow-hidden flex shadow-inner border border-black/40 relative">
            <div className="absolute inset-x-0 top-0 h-1.5 bg-white/20 pointer-events-none z-10" />

            <div 
              className="bg-gradient-to-b from-blue-400 via-blue-500 to-blue-600 h-full transition-all duration-500 border-r border-blue-700" 
              style={{ width: `${audioPercent}%` }} 
              title={`Audio: ${formatBytes(totalContentBytes)}`}
            />
            {estimatedPercent > 0 && (
              <div 
                className="bg-blue-400/35 h-full transition-all duration-500 border-r border-dashed border-blue-400/70 relative" 
                style={{ width: `${estimatedPercent}%` }} 
                title={`Estimated Import: ${formatBytes(estimatedSyncBytes)} (${tracksToSync.length} songs)`}
              >
                {/* Diagonal subtle pinstripe pattern for classic translucent estimation */}
                <div className="absolute inset-0 bg-[linear-gradient(45deg,rgba(255,255,255,0.15)_25%,transparent_25%,transparent_50%,rgba(255,255,255,0.15)_50%,rgba(255,255,255,0.15)_75%,transparent_75%,transparent)] bg-[length:8px_8px]" />
              </div>
            )}
            <div 
              className="bg-gradient-to-b from-amber-400 via-amber-500 to-amber-600 h-full transition-all duration-500 border-r border-amber-700" 
              style={{ width: `${otherPercent}%` }} 
              title={`Other: ${formatBytes(usedOther)}`}
            />
            <div 
              className="bg-gradient-to-b from-gray-300 via-gray-400 to-gray-500 h-full transition-all duration-500" 
              style={{ width: `${remainingFreePercent}%` }} 
              title={`Free Space: ${formatBytes(Math.max(0, device.availableBytes - estimatedSyncBytes))}`}
            />
          </div>
        </div>

        {/* Right: Aqua / Metal Sync Action Button */}
        <button
          onClick={isSyncing ? handleStopSync : handleStartSync}
          disabled={!isSyncing && (isStopping || (syncMode === 'all' && tracksToSync.length === 0))}
          className={`px-6 py-1.5 rounded-md font-bold text-xs transition-all shadow-md flex items-center gap-2 border active:scale-95 shrink-0 ${
            isSyncing
              ? 'bg-gradient-to-b from-red-500 via-red-600 to-red-700 hover:from-red-600 hover:to-red-800 text-white border-red-800 shadow-red-500/20'
              : (!isSyncing && (isStopping || (syncMode === 'all' && tracksToSync.length === 0)))
              ? 'opacity-50 cursor-not-allowed bg-gray-500 text-white border-gray-600'
              : 'bg-gradient-to-b from-blue-500 via-blue-600 to-blue-700 hover:from-blue-400 hover:to-blue-600 text-white border-blue-800 shadow-blue-500/20'
          }`}
          title={isSyncing ? 'Stop current transfer' : 'Synchronize music to device'}
        >
          {isSyncing ? (
            <>
              <XCircle className="w-3 h-3" />
              <span>{isStopping ? 'Stopping...' : 'Stop'}</span>
            </>
          ) : (
            <>
              <RefreshCw className="w-3 h-3" />
              <span>Sync</span>
            </>
          )}
        </button>
      </div>

    </div>
  );
};

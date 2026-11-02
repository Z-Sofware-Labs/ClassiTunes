import React, { useState, useEffect, useMemo } from 'react';
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

  const fetchContents = async () => {
    setIsLoadingContents(true);
    try {
      const items = await listDeviceContents(device.mountPoint);
      setDeviceContents(items);
    } catch (err) {
      console.warn('Failed to load device contents:', err);
    } finally {
      setIsLoadingContents(false);
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

    window.addEventListener('storage', handleStorage);
    window.addEventListener('classitunes:checked-changed', handleCustomEvent);
    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('classitunes:checked-changed', handleCustomEvent);
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

  // Determine tracks to sync based on mode (all vs selected playlists)
  const tracksToSync = useMemo(() => {
    const available = tracks.filter(t => Boolean(getTrackFsPath(t)));

    if (syncMode === 'all') {
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

      return available.filter(t => trackIdSet.has(t.id));
    }

    return available;
  }, [syncMode, tracks, playlists, selectedPlaylistIds]);

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
      .replace(/\.?\{ext\}/g, '');

    const rendered = cleanTmpl
      .replace('{Artist}', artist)
      .replace('{Album}', album)
      .replace('{Title}', title)
      .replace('{TrackNumber}', trackNum)
      .replace('{Year}', year);

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
    import('@tauri-apps/api/event').then(({ listen }) => {
      listen<SyncProgressEvent>('device-sync-progress', (event) => {
        setSyncProgress(event.payload);
        window.dispatchEvent(new CustomEvent('classitunes:device-sync-progress', {
          detail: {
            active: true,
            current: event.payload.currentIndex,
            total: event.payload.totalTracks,
            title: event.payload.currentTitle,
            deviceName: device.name,
            isComplete: event.payload.isComplete,
          }
        }));

        if (event.payload.isComplete) {
          setIsSyncing(false);
          fetchContents();
          setTimeout(() => {
            window.dispatchEvent(new CustomEvent('classitunes:device-sync-progress', { detail: null }));
          }, 2500);
        }
      }).then(un => { unlisten = un; });
    });

    return () => {
      if (unlisten) unlisten();
    };
  }, []);

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

    const preparedTracks = await Promise.all(
      tracksToSync.map(async (t) => {
        let cover = t.coverUrl || getCachedArtwork(t.id) || (t.album ? getCachedArtwork(t.album.trim().toLowerCase()) : undefined);
        if (scaleArtwork500 && cover) {
          try {
            cover = await scaleCoverTo500(cover);
          } catch {}
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
    };

    try {
      const res = await syncTracksToDevice(payload);
      setSyncResult(res);
      fetchContents();
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

  const [deleteConfirmFiles, setDeleteConfirmFiles] = useState<string[] | null>(null);

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

  const promptDeleteDeviceFiles = (filePaths: string[]) => {
    if (!filePaths || filePaths.length === 0) return;
    setDeleteConfirmFiles(filePaths);
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

      const deletedPaths: string[] = [];
      for (const fp of filePaths) {
        let ok = await deleteDeviceFile(fp);
        if (!ok) {
          try {
            ok = await deleteTauriFile(fp);
          } catch {}
        }
        if (ok) {
          deletedPaths.push(fp);
        }
      }

      if (deletedPaths.length > 0) {
        setDeviceContents(prev => prev.filter(item => !deletedPaths.includes(item.fullPath)));
        setDeviceSelectedTrackIds(prev => prev.filter(id => {
          const item = deviceTracks.find(t => t.id === id);
          const path = item?.filePath || (id.startsWith('dev_') ? id.slice(4) : '');
          return !deletedPaths.includes(path);
        }));
        if (onRefreshDevices) onRefreshDevices();
      }
    } catch (err: any) {
      console.error(`Could not delete file from device: ${err?.message || err}`);
    } finally {
      setDeleteConfirmFiles(null);
    }
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
                  /* Classic White & Chrome iPod */
                  <div className="w-24 h-40 rounded-2xl bg-gradient-to-b from-gray-100 via-white to-gray-200 p-2.5 border-2 border-gray-300 shadow-xl flex flex-col items-center justify-between relative overflow-hidden">
                    <div className="absolute inset-0 border border-white/80 rounded-2xl pointer-events-none" />
                    
                    {/* iPod Screen */}
                    <div className="w-full h-15 rounded-md bg-[#c2d7b5] border border-gray-400 p-1 flex flex-col justify-between shadow-inner">
                      <div className="text-[7px] font-bold text-gray-800 tracking-wider">ClassiTunes</div>
                      <div className="text-[8px] font-semibold text-gray-800 text-center truncate">Now Playing</div>
                      <div className="flex justify-between items-center text-[6px] text-gray-700 font-mono">
                        <span>▶ 1:23</span>
                        <span>-2:45</span>
                      </div>
                    </div>

                    {/* Classic Click Wheel */}
                    <div className="w-16 h-16 rounded-full bg-gradient-to-b from-gray-200 via-gray-100 to-gray-300 border border-gray-300 shadow flex items-center justify-center relative mt-1">
                      <div className="w-6 h-6 rounded-full bg-gradient-to-b from-white to-gray-200 border border-gray-300 shadow-inner" />
                      <span className="absolute top-1 text-[7px] font-bold text-gray-500 uppercase tracking-widest">MENU</span>
                      <span className="absolute bottom-1 text-[7px] font-bold text-gray-500">▶❚❚</span>
                      <span className="absolute left-1.5 text-[7px] font-bold text-gray-500">|◀◀</span>
                      <span className="absolute right-1.5 text-[7px] font-bold text-gray-500">▶▶|</span>
                    </div>
                  </div>
                ) : device.category === 'iphone' ? (
                  <div className="w-22 h-40 rounded-2xl bg-gradient-to-b from-gray-800 to-black p-2 border-2 border-gray-600 shadow-xl flex flex-col items-center justify-between">
                    <div className="w-8 h-1 bg-gray-600 rounded-full mt-1" />
                    <div className="w-full flex-1 my-2 rounded-lg bg-indigo-950/40 border border-indigo-500/20 flex flex-col items-center justify-center gap-1">
                      <Smartphone className="w-8 h-8 text-indigo-400" />
                      <span className="text-[8px] font-mono text-indigo-300 font-bold uppercase">iOS Media</span>
                    </div>
                    <div className="w-4 h-4 rounded-full border border-gray-600" />
                  </div>
                ) : device.category === 'android' ? (
                  <div className="w-22 h-40 rounded-2xl bg-gradient-to-b from-emerald-950 to-neutral-900 p-2 border-2 border-emerald-600/60 shadow-xl flex flex-col items-center justify-between">
                    <div className="w-3 h-3 rounded-full bg-emerald-500/20 border border-emerald-400/40 mt-1" />
                    <div className="w-full flex-1 my-2 rounded-lg bg-emerald-950/50 border border-emerald-500/30 flex flex-col items-center justify-center gap-1">
                      <Smartphone className="w-8 h-8 text-emerald-400" />
                      <span className="text-[8px] font-mono text-emerald-300 font-bold uppercase">Android</span>
                    </div>
                    <div className="w-6 h-1 bg-emerald-500/40 rounded-full" />
                  </div>
                ) : device.category === 'mp3Player' ? (
                  <div className="w-24 h-38 rounded-xl bg-gradient-to-b from-blue-950 via-slate-900 to-neutral-900 p-2.5 border-2 border-blue-500/50 shadow-xl flex flex-col items-center justify-between">
                    <div className="w-full h-12 rounded bg-cyan-950/60 border border-cyan-500/40 p-1 flex flex-col justify-between">
                      <div className="text-[7px] font-mono font-bold text-cyan-300">HiFi Audio</div>
                      <div className="text-[8px] text-cyan-100 font-bold truncate">DAP Player</div>
                    </div>
                    <div className="w-10 h-10 rounded-full bg-slate-800 border border-slate-600 flex items-center justify-center shadow-inner">
                      <div className="w-3.5 h-3.5 rounded-full bg-blue-500" />
                    </div>
                    <div className="text-[8px] font-mono uppercase text-blue-300 font-bold">MP3 / FLAC</div>
                  </div>
                ) : (
                  <div className="w-24 h-36 rounded-xl bg-gradient-to-b from-gray-700 to-gray-900 p-3 border-2 border-gray-500 shadow-xl flex flex-col items-center justify-center gap-2">
                    <HardDrive className="w-12 h-12 text-blue-400" />
                    <div className="text-[10px] font-mono uppercase text-gray-400 font-semibold">{device.filesystem}</div>
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
                    <span className={`font-semibold ${isLight ? 'text-gray-500' : 'text-gray-400'}`}>Drive Letter:</span>
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
                    <span>Syncing {device.name}...</span>
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
                    <span>{syncResult.tracksSynced} songs copied ({formatBytes(syncResult.totalBytesTransferred)}), {syncResult.tracksSkipped} songs already up to date.</span>
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
            {isLoadingContents ? (
              <div className="p-16 text-center text-xs text-gray-400 flex flex-col items-center justify-center gap-2">
                <RefreshCw className="w-6 h-6 animate-spin text-blue-500" />
                <span>Reading audio tracks on {device.name}...</span>
              </div>
            ) : deviceTracks.length === 0 ? (
              <div className="p-16 text-center text-xs text-gray-400 flex flex-col items-center justify-center gap-2">
                <FileAudio className="w-12 h-12 opacity-30 text-gray-400" />
                <span className="text-sm font-semibold">No audio tracks found on this device.</span>
                <span className="text-xs opacity-70">
                  Switch to the Summary tab to sync your music library, or drag and drop songs/playlists directly onto this device in the sidebar.
                </span>
              </div>
            ) : (
              <div className="flex-1 min-h-0 flex flex-col h-full">
                <ListView
                  tracks={deviceTracks}
                  currentTrack={currentTrack || null}
                  isPlaying={!!isPlaying}
                  playlists={playlists}
                  onPlayTrack={onPlayTrack || (() => {})}
                  onUpdateRating={() => {}}
                  onOpenGetInfo={onOpenGetInfo || (() => {})}
                  selectedTrackIds={deviceSelectedTrackIds}
                  onSelectionChange={setDeviceSelectedTrackIds}
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

      {/* Delete Confirmation Modal for Device Contents */}
      {deleteConfirmFiles && (
        <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setDeleteConfirmFiles(null)}>
          <div className={`w-full max-w-md rounded-xl border shadow-2xl p-5 ${isLight ? 'bg-white border-gray-300 text-gray-900' : 'bg-[#1c1c1c] border-[#3a3a3a] text-gray-100'}`} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2.5 pb-2 border-b border-black/10 dark:border-white/10">
              <div className="flex items-center gap-2">
                <Trash2 className="w-4 h-4 text-red-500" />
                <h3 className="text-sm font-semibold">Delete from {device.name}</h3>
              </div>
              <button
                type="button"
                onClick={() => setDeleteConfirmFiles(null)}
                className={`p-1 rounded transition-colors ${isLight ? 'hover:bg-gray-200 text-gray-500' : 'hover:bg-white/10 text-gray-400 hover:text-white'}`}
                title="Cancel"
              >
                <XCircle className="w-4 h-4 opacity-50 hover:opacity-100" />
              </button>
            </div>
            <p className={`text-xs leading-5 mb-4 ${isLight ? 'text-gray-600' : 'text-gray-400'}`}>
              Are you sure you want to delete {deleteConfirmFiles.length === 1 ? 'this song' : `these ${deleteConfirmFiles.length} songs`} from <span className="font-semibold text-current">{device.name}</span>?
              The physical audio {deleteConfirmFiles.length === 1 ? 'file' : 'files'} will be permanently removed from the device storage.
              <br /><br />
              <span className="text-emerald-500 font-medium">Your computer's ClassiTunes library will not be affected.</span>
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setDeleteConfirmFiles(null)}
                className={`px-3.5 py-1.5 rounded-md text-xs font-medium border ${isLight ? 'border-gray-300 hover:bg-gray-100' : 'border-[#444] hover:bg-[#2a2a2a]'}`}
              >
                Cancel
              </button>
              <button
                onClick={() => executeDeleteDeviceFiles(deleteConfirmFiles)}
                className="px-3.5 py-1.5 rounded-md text-xs font-medium bg-red-600 hover:bg-red-500 text-white shadow-sm"
              >
                Delete from Device
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

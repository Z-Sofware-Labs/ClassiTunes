import React, { useState, useEffect, useMemo, useCallback, useRef, Suspense, lazy } from 'react';
import { flushSync } from 'react-dom';
import { Track, Album, Playlist, ViewMode, AppSettings, ThemePreference, OptionsTab, DEFAULT_APP_SETTINGS, AlbumSortField } from './types';
import { INITIAL_TRACKS, INITIAL_PLAYLISTS } from './data/demoTracks';
import { audioEngine } from './services/audioEngine';
import { parseAudioFile, extractID3TagsFromTrack, getAudioDuration } from './services/metadataParser';
import { HeaderBar, DeviceSyncProgressInfo } from './components/HeaderBar';
import { Sidebar } from './components/Sidebar';
import { ListView, ColumnId, DEFAULT_VISIBLE } from './components/ListView';
import { AlbumGridView, sortAlbumsList } from './components/AlbumGridView';
import { StatusBar } from './components/StatusBar';
import { evaluateSmartPlaylist } from './utils/smartPlaylist';
import { ContextMenu, ContextMenuState } from './components/ContextMenu';
import { setupWindowStatePersistence, isTauri, processDroppedPaths, organizeTauriMusicFile, relocateTauriMusicFile, deleteTauriFile, writeTauriMusicMetadata, scanTauriDirectory, readTauriMusicMetadataBatch, batchStatFiles, logToFile, resolveNativeCoverUrl, resolveNativeCoverUrlSync, dbUpdateTrackRating, dbDeleteTracks, updateTaskbarThumbnailToolbar, Mp3Device, listConnectedDevices, ejectDevice, syncTracksToDevice, SyncProgressEvent } from './utils/tauriWindow';
import { platformInfo } from './utils/platform';
import { hydrateTrackMedia, saveTracksMetadata, getTracksMetadata, deleteMediaFile, clearAllMediaStorage, getCachedArtwork, setCachedArtwork, clearCachedArtwork, dataURLtoBlob, saveMediaFile, savePlaybackMetadata, getAllPlaybackMetadata, deletePlaybackMetadata, trimArtworkBlobs, internTrackStrings } from './services/mediaStorage';
import { Upload, Music, Disc, X } from 'lucide-react';

// Lazy-loaded dialogs and views to reduce initial bundle size, memory footprint, and startup latency
const EqualizerModal = lazy(() => import('./components/EqualizerModal').then(m => ({ default: m.EqualizerModal })));
const VisualizerModal = lazy(() => import('./components/VisualizerModal').then(m => ({ default: m.VisualizerModal })));
const GetInfoModal = lazy(() => import('./components/GetInfoModal').then(m => ({ default: m.GetInfoModal })));
const SmartPlaylistModal = lazy(() => import('./components/SmartPlaylistModal').then(m => ({ default: m.SmartPlaylistModal })));
const AboutModal = lazy(() => import('./components/AboutModal').then(m => ({ default: m.AboutModal })));
const OptionsModal = lazy(() => import('./components/OptionsModal').then(m => ({ default: m.OptionsModal })));
const DeviceManagerView = lazy(() => import('./components/DeviceManagerView').then(m => ({ default: m.DeviceManagerView })));

export default function App() {
  const isMac = platformInfo.isMacOS;
  // State Initialization with LocalStorage Persistence
  const [tracks, setTracks] = useState<Track[]>(() => {
    try {
      const saved = localStorage.getItem('classitunes_tracks') || localStorage.getItem('itunes_tracks');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          const userTracks = parsed.filter((t: Track) => 
            !t.id.startsWith('demo_') && 
            !t.id.startsWith('sample_')
          );
          return [...INITIAL_TRACKS, ...userTracks];
        }
      }
    } catch (e) {
      console.warn('LocalStorage tracks restore error', e);
    }
    return INITIAL_TRACKS;
  });

  // Playback-volatile metadata (playCount, lastPlayed, coverUrl, audioUrl).
  // Stored separately so mutations during playback do NOT invalidate filteredTracks / albums.
  const [playbackMeta, setPlaybackMeta] = useState<Map<string, Partial<Track>>>(() => new Map());

  // Keep the base track list stable. Playback metadata is merged lazily only for the
  // tracks actually rendered, so a single playCount/lastPlayed change never allocates
  // a new Track object for the entire library.
  const mergedTracks = useMemo(() => tracks, [tracks]);

  const getDisplayTrack = useCallback((track: Track): Track => {
    const meta = playbackMeta.get(track.id);
    return meta ? { ...track, ...meta } : track;
  }, [playbackMeta]);

  const [playlists, setPlaylists] = useState<Playlist[]>(() => {
    try {
      const saved = localStorage.getItem('classitunes_playlists') || localStorage.getItem('itunes_playlists');
      if (saved) {
        let parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          // Check if the user had the previous pre-made playlist 'Late Night Chill'
          const hasLateNightChill = parsed.some((p: Playlist) => 
            p.name === 'Late Night Chill' || 
            p.id === 'smart_late_night_chill'
          );

          // Remove old pre-made playlists
          parsed = parsed.filter((p: Playlist) => 
            p.name !== 'Late Night Chill' && 
            p.id !== 'smart_late_night_chill' &&
            p.id !== 'smart_top_hits' &&
            p.name !== '⭐ 4+ Star Hits'
          );

          // If the user had 'Late Night Chill' on the previous version, upgrade it to 'Top Rated Songs'
          if (hasLateNightChill) {
            const hasTopRated = parsed.some((p: Playlist) => p.name === 'Top Rated Songs' || p.id === 'smart_top_rated_songs');
            if (!hasTopRated) {
              parsed.push({
                id: 'smart_top_rated_songs',
                name: 'Top Rated Songs',
                isSmart: true,
                matchType: 'all',
                rules: [
                  { id: 'top_rule_1', field: 'rating', operator: 'is', value: '5' }
                ],
                trackIds: [],
              });
            }
          }

          // Note: '90s Favorites' is kept as-is if present. If the user didn't have it on the previous version, we do not bring it back.
          return parsed;
        }
      }
    } catch (e) {
      console.warn('LocalStorage playlists restore error', e);
    }
    return [
      ...INITIAL_PLAYLISTS,
      {
        id: 'smart_90s_favorites',
        name: '90s Favorites',
        isSmart: true,
        matchType: 'all',
        rules: [
          { id: '90s_rule_1', field: 'year', operator: 'greater_than', value: '1989' },
          { id: '90s_rule_2', field: 'year', operator: 'less_than', value: '2000' }
        ],
        trackIds: [],
      },
      {
        id: 'smart_top_rated_songs',
        name: 'Top Rated Songs',
        isSmart: true,
        matchType: 'all',
        rules: [
          { id: 'top_rule_1', field: 'rating', operator: 'is', value: '5' }
        ],
        trackIds: [],
      }
    ];
  });

  // Application Options / Theme State
  const [appSettings, setAppSettings] = useState<AppSettings>(() => {
    try {
      const saved = localStorage.getItem('classitunes_settings');
      if (saved) {
        const savedSettings = JSON.parse(saved);
        if (savedSettings && typeof savedSettings === 'object') {
          delete savedSettings.performanceDiagnostics;
        }
        return { ...DEFAULT_APP_SETTINGS, ...savedSettings };
      }
      const legacyTheme = localStorage.getItem('itunes_theme'); // legacy key, kept for migration
      if (legacyTheme === 'light' || legacyTheme === 'dark') {
        return { ...DEFAULT_APP_SETTINGS, defaultTheme: legacyTheme };
      }
    } catch (e) {
      console.warn('LocalStorage settings restore error', e);
    }
    return DEFAULT_APP_SETTINGS;
  });


  // Setup Window Bounds Persistence (Tauri / Web)
  useEffect(() => {
    setupWindowStatePersistence();
    try {
      localStorage.removeItem('classitunes_unchecked_tracks');
    } catch (e) {}
  }, []);

  // Shared visible columns state
  const [visibleColumns, setVisibleColumns] = useState<ColumnId[]>(() => {
    try {
      const saved = localStorage.getItem('classitunes_visible_columns') || localStorage.getItem('itunes_visible_columns');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch (e) {}
    return DEFAULT_VISIBLE;
  });

  const handleVisibleColumnsChange = useCallback((cols: ColumnId[]) => {
    setVisibleColumns(cols);
    try {
      localStorage.setItem('classitunes_visible_columns', JSON.stringify(cols));
      window.dispatchEvent(new CustomEvent('classitunes:checked-changed'));
    } catch (e) {}
  }, []);

  // Shared checked track IDs state (Track Checkbox column, classic style)
  const [checkedTrackIds, setCheckedTrackIds] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('classitunes_checked_tracks');
      if (saved !== null) {
        return new Set(JSON.parse(saved));
      }
    } catch (e) {}
    // If not set yet, initial state is empty Set (0 checked until user checks songs or disables column)
    return new Set<string>();
  });

  const handleToggleCheckTrack = useCallback((trackId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setCheckedTrackIds(prev => {
      const next = new Set(prev);
      if (next.has(trackId)) {
        next.delete(trackId);
      } else {
        next.add(trackId);
      }
      try {
        localStorage.setItem('classitunes_checked_tracks', JSON.stringify(Array.from(next)));
        window.dispatchEvent(new CustomEvent('classitunes:checked-changed'));
      } catch (err) {}
      return next;
    });
  }, []);

  const handleToggleCheckAll = useCallback(() => {
    const allTrackIds = tracks.map(t => t.id);
    const areAllCurrentlyChecked = allTrackIds.length > 0 && allTrackIds.every(id => checkedTrackIds.has(id));

    setCheckedTrackIds(() => {
      const next = areAllCurrentlyChecked ? new Set<string>() : new Set(allTrackIds);
      try {
        localStorage.setItem('classitunes_checked_tracks', JSON.stringify(Array.from(next)));
        window.dispatchEvent(new CustomEvent('classitunes:checked-changed'));
      } catch (err) {}
      return next;
    });
  }, [tracks, checkedTrackIds]);

  // Connected MP3 / iPod Storage Devices
  const [connectedDevices, setConnectedDevices] = useState<Mp3Device[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<Mp3Device | null>(null);
  const selectedDeviceRef = useRef<Mp3Device | null>(null);
  selectedDeviceRef.current = selectedDevice;
  const [deviceSyncProgress, setDeviceSyncProgress] = useState<DeviceSyncProgressInfo | null>(null);

  // Sync Progress Event Listener for LCD Main Player Display
  useEffect(() => {
    const handleCustomSync = (e: Event) => {
      const customEvent = e as CustomEvent<DeviceSyncProgressInfo | null>;
      setDeviceSyncProgress(customEvent.detail);
    };
    window.addEventListener('classitunes:device-sync-progress', handleCustomSync);

    let unlisten: (() => void) | null = null;
    if (isTauri()) {
      import('@tauri-apps/api/event').then(({ listen }) => {
        listen<SyncProgressEvent>('device-sync-progress', (event) => {
          const p = event.payload;
          setDeviceSyncProgress({
            active: true,
            current: p.currentIndex,
            total: p.totalTracks,
            title: p.currentTitle,
            deviceName: selectedDeviceRef.current?.name || 'Device',
            isComplete: p.isComplete,
          });

          if (p.isComplete) {
            setTimeout(() => {
              setDeviceSyncProgress(null);
            }, 2500);
          }
        }).then(un => { unlisten = un; });
      }).catch(() => {});
    }

    return () => {
      window.removeEventListener('classitunes:device-sync-progress', handleCustomSync);
      if (unlisten) unlisten();
    };
  }, [selectedDevice?.name]);

  const refreshDevices = useCallback(async () => {
    if (!isTauri()) return;
    try {
      const devs = await listConnectedDevices();
      setConnectedDevices(prev => {
        if (
          prev.length === devs.length &&
          prev.every((d, i) =>
            d.id === devs[i].id &&
            d.availableBytes === devs[i].availableBytes &&
            d.totalBytes === devs[i].totalBytes &&
            d.name === devs[i].name
          )
        ) {
          return prev;
        }
        return devs;
      });
      setSelectedDevice(prev => {
        if (!prev) return null;
        const matching = devs.find(d => d.id === prev.id);
        if (!matching) return null;
        if (
          matching.id === prev.id &&
          matching.availableBytes === prev.availableBytes &&
          matching.totalBytes === prev.totalBytes &&
          matching.name === prev.name
        ) {
          return prev;
        }
        return matching;
      });
    } catch (err) {
      console.warn('Failed to refresh connected devices:', err);
    }
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    refreshDevices();
    const interval = setInterval(refreshDevices, 4000);
    return () => clearInterval(interval);
  }, [refreshDevices]);

  const handleEjectDevice = async (mountPoint: string) => {
    await ejectDevice(mountPoint);
    await refreshDevices();
  };

  const handleDropTracksToDevice = async (trackIds: string[], dev: Mp3Device) => {
    setSelectedDevice(dev);
    const droppedTracks = tracks.filter(t => trackIds.includes(t.id) && (Boolean(t.filePath) || Boolean(audioEngine.extractFsPathFromUrl(t.audioUrl))));
    if (droppedTracks.length === 0) return;

    setDeviceSyncProgress({
      active: true,
      current: 0,
      total: droppedTracks.length,
      title: droppedTracks[0]?.title || 'Starting transfer...',
      deviceName: dev.name,
      isComplete: false,
    });

    // Load device's configured naming template from localStorage
    const savedTemplate = localStorage.getItem(`classitunes_device_template_${dev.mountPoint}`) || '{Artist}/{Album}/{TrackNumber} - {Title}';

    // Read transcoding preferences
    let transcodeEnabled = false;
    let transcodeFormat = 'MP3';
    let transcodeBitrate = 256;
    let transcodeDownmixMono = false;
    let transcodeDownsample44k = true;
    try {
      const stored = localStorage.getItem('classitunes_transcode_settings');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.transcodeEnabled !== undefined) transcodeEnabled = Boolean(parsed.transcodeEnabled);
        if (parsed.transcodeFormat) transcodeFormat = parsed.transcodeFormat;
        if (parsed.transcodeBitrate) transcodeBitrate = parseInt(parsed.transcodeBitrate, 10) || 256;
        if (parsed.transcodeDownmixMono !== undefined) transcodeDownmixMono = Boolean(parsed.transcodeDownmixMono);
        if (parsed.transcodeDownsample44k !== undefined) transcodeDownsample44k = Boolean(parsed.transcodeDownsample44k);
      }
    } catch (e) {}

    try {
      await syncTracksToDevice({
        mountPoint: dev.mountPoint,
        tracks: droppedTracks.map(t => ({
          id: t.id,
          filePath: t.filePath || audioEngine.extractFsPathFromUrl(t.audioUrl) || '',
          title: t.title,
          artist: t.artist,
          albumArtist: t.albumArtist,
          album: t.album,
          genre: t.genre,
          trackNumber: t.trackNumber,
          year: t.year,
          coverUrl: t.coverUrl,
        })),
        namingTemplate: savedTemplate,
        syncPlaylists: false,
        transcodeEnabled,
        transcodeFormat,
        transcodeBitrate,
        transcodeDownmixMono,
        transcodeDownsample44k,
      });
      setDeviceSyncProgress({
        active: true,
        current: droppedTracks.length,
        total: droppedTracks.length,
        title: 'Transfer complete',
        deviceName: dev.name,
        isComplete: true,
      });
      setTimeout(() => {
        setDeviceSyncProgress(null);
      }, 2500);
      refreshDevices();
    } catch (err) {
      console.error('Failed to sync dropped tracks to device:', err);
      setDeviceSyncProgress(null);
    }
  };

  // Tauri Native Drag-and-Drop listener
  useEffect(() => {
    if (!isTauri()) return;

    let unlisten: (() => void) | null = null;
    let isMounted = true;

    async function setupTauriDragDrop() {
      try {
        const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
        const webview = getCurrentWebviewWindow();
        const unlistener = await webview.onDragDropEvent(async (event) => {
          if (!isMounted) return;
          if (event.payload.type === 'enter' || event.payload.type === 'over') {
            setIsDraggingOverApp(true);
          } else if (event.payload.type === 'leave') {
            setIsDraggingOverApp(false);
          } else if (event.payload.type === 'drop') {
            setIsDraggingOverApp(false);
            const paths = event.payload.paths;
            if (paths && paths.length > 0) {
              flushSync(() => {
                setIsImportingFiles(true);
                setImportProgress({
                  current: 0,
                  total: 0,
                  statusText: 'Preparing to scan dropped folder...',
                  phase: 'scanning'
                });
              });
              await new Promise(r => setTimeout(r, 20));

              const files = await processDroppedPaths(paths, (count, folder) => {
                setImportProgress({
                  current: count,
                  total: 0,
                  statusText: folder 
                    ? `Scanning: ${folder} (found ${count} audio file${count !== 1 ? 's' : ''})`
                    : `Scanning folder... found ${count} audio file${count !== 1 ? 's' : ''}`,
                  phase: 'scanning'
                });
              });

              if (files.length > 0) {
                await handleImportFiles(files);
              } else {
                setIsImportingFiles(false);
                setImportProgress(null);
              }
            }
          }
        });
        unlisten = unlistener;
      } catch (err) {
        console.error('Failed to set up Tauri native drag and drop:', err);
      }
    }

    setupTauriDragDrop();

    return () => {
      isMounted = false;
      if (unlisten) {
        unlisten();
      }
    };
  }, [appSettings.organizeMusicFolders, appSettings.defaultMusicPath]);

  const hasRestoredTracksRef = useRef(false);

  // Restore tracks from IndexedDB & LocalStorage
  // Artwork is loaded strictly on-demand when a song is played or selected
  useEffect(() => {
    async function restoreTracks() {
      try {
        const dbTracks = await getTracksMetadata();
        let restoredTracks: Track[] = Array.isArray(dbTracks) ? dbTracks : [];

        // If native db was wiped or empty, attempt recovery from localStorage or legacy keys
        if (restoredTracks.length === 0) {
          try {
            const saved = localStorage.getItem('classitunes_tracks') || localStorage.getItem('itunes_tracks');
            if (saved) {
              const parsed = JSON.parse(saved);
              if (Array.isArray(parsed) && parsed.length > 0) {
                const recovered = parsed.filter((t: Track) => !t.id.startsWith('demo_') && !t.id.startsWith('sample_'));
                if (recovered.length > 0) {
                  restoredTracks = recovered;
                  // Restore into native db so future launches are instant
                  saveTracksMetadata(recovered);
                }
              }
            }
          } catch (e) {}
        }

        // 1. Immediately display authoritative restored tracks on screen
        if (restoredTracks.length > 0) {
          setTracks(prev => {
            const map = new Map<string, Track>();
            restoredTracks.forEach((t: Track) => {
              const interned = internTrackStrings(t);
              const resolvedCover = interned.coverUrl ? (resolveNativeCoverUrlSync(interned.coverUrl) || interned.coverUrl) : interned.coverUrl;
              const hydratedTrack = resolvedCover && resolvedCover !== interned.coverUrl ? { ...interned, coverUrl: resolvedCover } : interned;
              if (resolvedCover) {
                setCachedArtwork(t.id, resolvedCover);
                const albumKey = (t.album || '').trim().toLowerCase();
                if (albumKey && !getCachedArtwork(albumKey)) {
                  setCachedArtwork(albumKey, resolvedCover);
                }
              }
              map.set(t.id, hydratedTrack);
            });
            // Keep any runtime-added tracks in prev that are not in restoredTracks
            prev.forEach(t => {
              if (!map.has(t.id)) {
                map.set(t.id, t);
              }
            });
            return Array.from(map.values());
          });
        }

      // 2. Asynchronously in the background, check if any albums need artwork backfilling
      if (isTauri() && restoredTracks.length > 0) {
        const albumsWithCover = new Set<string>();
        for (const t of restoredTracks) {
          if (t.coverUrl) {
            albumsWithCover.add((t.album || '').trim().toLowerCase());
          }
        }
        const repTracksByAlbum = new Map<string, Track>();
        for (const t of restoredTracks) {
          if (!t.coverUrl && t.filePath && !t.id.startsWith('demo_') && !t.id.startsWith('sample_')) {
            const key = (t.album || '').trim().toLowerCase() || t.id;
            if (!albumsWithCover.has(key) && !repTracksByAlbum.has(key)) {
              repTracksByAlbum.set(key, t);
            }
          }
        }
        if (repTracksByAlbum.size > 0) {
          void (async () => {
            const repPaths = Array.from(repTracksByAlbum.values()).map(t => t.filePath!);
            const BATCH = 32;
            const albumCoverMap = new Map<string, string>();
            for (let i = 0; i < repPaths.length; i += BATCH) {
              const slice = repPaths.slice(i, i + BATCH);
              const metaMap = await readTauriMusicMetadataBatch(slice);
              for (const [albumKey, repTrack] of repTracksByAlbum.entries()) {
                const meta = repTrack.filePath ? metaMap[repTrack.filePath] : null;
                if (meta?.coverUrl) {
                  const resolved = resolveNativeCoverUrlSync(meta.coverUrl) || (await resolveNativeCoverUrl(meta.coverUrl)) || meta.coverUrl;
                  if (resolved) {
                    albumCoverMap.set(albumKey, resolved);
                    setCachedArtwork(repTrack.id, resolved);
                    setCachedArtwork(albumKey, resolved);
                  }
                }
              }
            }
            if (albumCoverMap.size > 0) {
              setTracks(prev => prev.map(t => {
                if (t.coverUrl) return t;
                const key = (t.album || '').trim().toLowerCase() || t.id;
                const backfilled = albumCoverMap.get(key);
                if (backfilled) {
                  setCachedArtwork(t.id, backfilled);
                  return { ...t, coverUrl: backfilled };
                }
                return t;
              }));
            }
          })();
        }

        // Background backfill for missing or default bitrate / sampleRate / duration
        const tracksNeedingMetadata = restoredTracks.filter(
          t => t.filePath && (!t.bitrate || !t.sampleRate || !t.duration || t.duration <= 0) && !t.id.startsWith('demo_') && !t.id.startsWith('sample_')
        );
        if (tracksNeedingMetadata.length > 0 && isTauri()) {
          void (async () => {
            const BATCH = 64;
            const metaUpdateMap = new Map<string, { bitrate?: number; sampleRate?: number; duration?: number; format?: string }>();
            for (let i = 0; i < tracksNeedingMetadata.length; i += BATCH) {
              const slice = tracksNeedingMetadata.slice(i, i + BATCH);
              const paths = slice.map(t => t.filePath!);
              const metaMap = await readTauriMusicMetadataBatch(paths);
              for (const tr of slice) {
                if (tr.filePath && metaMap[tr.filePath]) {
                  const m = metaMap[tr.filePath];
                  if (m.bitrate || m.sampleRate || m.duration) {
                    metaUpdateMap.set(tr.id, {
                      bitrate: m.bitrate,
                      sampleRate: m.sampleRate,
                      duration: m.duration && m.duration > 0 ? Math.round(m.duration * 100) / 100 : undefined,
                      format: m.format,
                    });
                  }
                }
              }
            }
            if (metaUpdateMap.size > 0) {
              setTracks(prev => {
                let changed = false;
                const next = prev.map(t => {
                  const update = metaUpdateMap.get(t.id);
                  if (update) {
                    changed = true;
                    return {
                      ...t,
                      bitrate: update.bitrate ?? t.bitrate,
                      sampleRate: update.sampleRate ?? t.sampleRate,
                      duration: (t.duration && t.duration > 0) ? t.duration : (update.duration ?? t.duration),
                      format: update.format ?? t.format,
                    };
                  }
                  return t;
                });
                return changed ? next : prev;
              });
            }
          })();
        }
      }
      } catch (err) {
        console.error('Failed to restore tracks:', err);
      }
    }

    restoreTracks().finally(() => {
      hasRestoredTracksRef.current = true;
    });
  }, []);

  const [systemTheme, setSystemTheme] = useState<'dark' | 'light'>(() => {
    if (typeof window !== 'undefined' && window.matchMedia) {
      if (window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
      if (window.matchMedia('(prefers-color-scheme: light)').matches) return 'light';
    }
    return 'dark';
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let isCancelled = false;

    // Helper to update state if not unmounted
    const applySystemTheme = (newTheme: 'dark' | 'light') => {
      if (!isCancelled && (newTheme === 'dark' || newTheme === 'light')) {
        setSystemTheme(newTheme);
      }
    };

    // 1. Standard and legacy media query listeners (works across modern Chromium, WebKitGTK, Safari)
    let removeMediaListener: (() => void) | null = null;
    if (window.matchMedia) {
      const darkMedia = window.matchMedia('(prefers-color-scheme: dark)');
      const lightMedia = window.matchMedia('(prefers-color-scheme: light)');

      const evaluateMedia = () => {
        if (darkMedia.matches) {
          applySystemTheme('dark');
        } else if (lightMedia.matches) {
          applySystemTheme('light');
        }
      };

      evaluateMedia();

      const onMediaChange = () => evaluateMedia();

      if (typeof darkMedia.addEventListener === 'function') {
        darkMedia.addEventListener('change', onMediaChange);
        if (typeof lightMedia.addEventListener === 'function') {
          lightMedia.addEventListener('change', onMediaChange);
        }
        removeMediaListener = () => {
          darkMedia.removeEventListener('change', onMediaChange);
          if (typeof lightMedia.removeEventListener === 'function') {
            lightMedia.removeEventListener('change', onMediaChange);
          }
        };
      } else if (typeof (darkMedia as any).addListener === 'function') {
        // Fallback for older WebKitGTK / Safari engines
        (darkMedia as any).addListener(onMediaChange);
        removeMediaListener = () => {
          (darkMedia as any).removeListener(onMediaChange);
        };
      }
    }

    // 3. Tauri window theme listener (for environments where window theme is reported by OS)
    let tauriUnlisten: (() => void) | null = null;
    if ((window as any).__TAURI__ || (window as any).__TAURI_INTERNALS__ || (window as any).__TAURI_METADATA__) {
      import('@tauri-apps/api/window').then(async ({ getCurrentWindow }) => {
        try {
          const win = getCurrentWindow();
          const winTheme = await win.theme();
          if (winTheme === 'dark' || winTheme === 'light') {
            applySystemTheme(winTheme);
          }
          if (typeof win.onThemeChanged === 'function') {
            const unlisten = await win.onThemeChanged(({ payload }: { payload: 'dark' | 'light' }) => {
              applySystemTheme(payload);
            });
            if (isCancelled) {
              unlisten();
            } else {
              tauriUnlisten = unlisten;
            }
          }
        } catch {}
      }).catch(() => {});
    }

    return () => {
      isCancelled = true;
      if (tauriUnlisten) {
        tauriUnlisten();
      }
      if (removeMediaListener) {
        removeMediaListener();
      }
    };
  }, []);

  const theme: 'dark' | 'light' = appSettings.defaultTheme === 'system'
    ? systemTheme
    : appSettings.defaultTheme;

  // Sync document root classes, styling and meta theme-color with active theme
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    const isLight = theme === 'light';
    if (isLight) {
      root.classList.add('light');
      root.classList.remove('dark');
      root.style.backgroundColor = '#f8fafc';
      root.style.colorScheme = 'light';
    } else {
      root.classList.add('dark');
      root.classList.remove('light');
      root.style.backgroundColor = '#121212';
      root.style.colorScheme = 'dark';
    }
  }, [theme]);

  const handleSaveSettings = useCallback((nextSettings: AppSettings) => {
    setAppSettings(nextSettings);
    try {
      localStorage.setItem('classitunes_settings', JSON.stringify(nextSettings));
    } catch (e) {
      console.warn('LocalStorage settings write error', e);
    }
  }, []);

  const toggleTheme = useCallback(() => {
    const nextTheme: ThemePreference = theme === 'dark' ? 'light' : 'dark';
    handleSaveSettings({ ...appSettings, defaultTheme: nextTheme });
  }, [theme, appSettings, handleSaveSettings]);

  // Active View, Selection & Playback State
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string>(() => {
    try {
      const saved = localStorage.getItem('classitunes_selected_playlist_id');
      if (saved) return saved;
    } catch (e) {
      console.warn('LocalStorage selectedPlaylistId error', e);
    }
    return 'lib_music';
  });
  const [partyShuffleSeed, setPartyShuffleSeed] = useState<number>(() => Date.now());
  const [searchQuery, setSearchQuery] = useState<string>('');
  const handleClearSearch = useCallback(() => {
    setSearchQuery('');
  }, []);
  const [selectedTrackIds, setSelectedTrackIds] = useState<string[]>([]);
  const [albumPlayQueue, setAlbumPlayQueue] = useState<Track[] | null>(null);
  const [activeQueue, setActiveQueue] = useState<Track[] | null>(null);

  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isShuffle, setIsShuffle] = useState<boolean>(false);
  const [repeatMode, setRepeatMode] = useState<'off' | 'all' | 'one'>('off');

  // Context Menu State
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  const [albumSortField, setAlbumSortField] = useState<AlbumSortField>(() => {
    try {
      const saved = localStorage.getItem('classitunes_album_sort');
      if (saved === 'artist' || saved === 'genre' || saved === 'year' || saved === 'album') {
        return saved;
      }
    } catch {}
    return 'album';
  });

  const [isAlbumGrouped, setIsAlbumGrouped] = useState<boolean>(() => {
    try {
      return localStorage.getItem('classitunes_album_grouped') === 'true';
    } catch {}
    return false;
  });

  const handleAlbumSortChange = useCallback((field: AlbumSortField) => {
    setAlbumSortField(field);
    try {
      localStorage.setItem('classitunes_album_sort', field);
    } catch {}
  }, []);

  const handleToggleAlbumGrouped = useCallback((grouped: boolean) => {
    setIsAlbumGrouped(grouped);
    try {
      localStorage.setItem('classitunes_album_grouped', String(grouped));
    } catch {}
  }, []);

  const handleTrackContextMenu = useCallback((track: Track, e: React.MouseEvent, navigationTracks?: Track[]) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      track,
      navigationTracks,
    });
  }, []);

  const handleAlbumBackgroundContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      track: null,
      isBackground: true,
    });
  }, []);

  const handleCreatePlaylistWithTrack = useCallback((track: Track) => {
    const newPl: Playlist = {
      id: `pl_${Date.now()}`,
      name: `${track.title} Playlist`,
      systemType: 'user',
      trackIds: [track.id],
    };
    setPlaylists(prev => [...prev, newPl]);
    setSelectedPlaylistId(newPl.id);
  }, []);

  // Modals State
  const [isEQOpen, setIsEQOpen] = useState<boolean>(false);
  const [isVisualizerOpen, setIsVisualizerOpen] = useState<boolean>(false);
  const [isAboutOpen, setIsAboutOpen] = useState<boolean>(false);
  const [isOptionsOpen, setIsOptionsOpen] = useState<boolean>(false);
  const [optionsInitialTab, setOptionsInitialTab] = useState<OptionsTab>('general');
  const [editingTracks, setEditingTracks] = useState<Track[] | null>(null);
  const [getInfoNavTracks, setGetInfoNavTracks] = useState<Track[] | undefined>(undefined);
  const handleOpenGetInfo = useCallback((trackOrTracks: Track | Track[], navigationContextTracks?: Track[]) => {
    const list = Array.isArray(trackOrTracks) ? trackOrTracks : [trackOrTracks];
    if (list.length > 0) {
      setEditingTracks(list);
      setGetInfoNavTracks(navigationContextTracks);
    }
  }, []);
  // Playlist inline renaming state (shared with Sidebar for newly created playlists/folders)
  const [editingPlaylistId, setEditingPlaylistId] = useState<string | null>(null);
  const [isSmartPlaylistOpen, setIsSmartPlaylistOpen] = useState<boolean>(false);
  const [smartPlaylistParentId, setSmartPlaylistParentId] = useState<string | undefined>(undefined);
  const [editingSmartPlaylist, setEditingSmartPlaylist] = useState<Playlist | null>(null);

  // Sidebar Resizing State
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('classitunes_sidebar_width');
      if (saved) {
        const parsed = parseInt(saved, 10);
        if (!isNaN(parsed)) return Math.max(160, Math.min(450, parsed));
      }
    } catch (e) {
      console.warn('LocalStorage sidebarWidth error', e);
    }
    return 220;
  });
  const [isResizingSidebar, setIsResizingSidebar] = useState<boolean>(false);

  useEffect(() => {
    try {
      localStorage.setItem('classitunes_sidebar_width', String(sidebarWidth));
    } catch (e) {
      console.warn('LocalStorage sidebarWidth write error', e);
    }
  }, [sidebarWidth]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingSidebar) return;
      const newWidth = Math.max(160, Math.min(450, e.clientX));
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizingSidebar(false);
    };

    if (isResizingSidebar) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizingSidebar]);

  // Global Drag & Drop state
  const [isDraggingOverApp, setIsDraggingOverApp] = useState<boolean>(false);
  const [isImportingFiles, setIsImportingFiles] = useState<boolean>(false);
  const [importProgress, setImportProgress] = useState<{ current: number; total: number; statusText?: string; phase?: 'scanning' | 'importing' } | null>(null);

  const handleStartImporting = useCallback((statusText?: string) => {
    
    flushSync(() => {
      setIsImportingFiles(true);
      setImportProgress({ current: 0, total: 0, statusText: statusText || 'Scanning folder & audio files...', phase: 'scanning' });
    });
  }, []);

  useEffect(() => {
    let disposed = false;
    void getAllPlaybackMetadata().then((stored) => {
      if (!disposed) {
        setPlaybackMeta(stored);
      }
    }).catch(() => {});
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    // CRITICAL: NEVER overwrite database before restoreTracks has finished!
    if (!hasRestoredTracksRef.current) return;

    const userTracksOnly = tracks.filter(t =>
      !t.id.startsWith('demo_') && 
      !t.id.startsWith('sample_') &&
      !(t.audioUrl && t.audioUrl.startsWith('synth:'))
    );

    // If tracks is empty, NEVER wipe the user's persistent library
    if (userTracksOnly.length === 0) return;

    const timer = setTimeout(() => {
      try {
        const lightweightTracks = userTracksOnly.map(t => {
          const { file, ...rest } = t;
          let coverUrl = rest.coverUrl;
          if (coverUrl && (coverUrl.startsWith('data:') || coverUrl.startsWith('blob:'))) {
            coverUrl = undefined;
          }
          let audioUrl = rest.audioUrl;
          if (audioUrl && audioUrl.startsWith('blob:')) {
            audioUrl = '';
          }
          return { ...rest, coverUrl, audioUrl };
        });

        try {
          localStorage.setItem('classitunes_tracks', JSON.stringify(lightweightTracks));
        } catch (e) {
          console.warn('LocalStorage snapshot write skipped', e);
        }
        saveTracksMetadata(userTracksOnly);
      } catch (e) {
        console.warn('Failed to save tracks to localStorage/IndexedDB', e);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [tracks]);

  useEffect(() => {
    if (playbackMeta.size === 0) return;
    const timer = setTimeout(() => {
      Array.from(playbackMeta.entries()).forEach(([trackId, meta]) => {
        if (meta && (meta.playCount !== undefined || meta.lastPlayed !== undefined)) {
          const playCount = typeof meta.playCount === 'number' ? meta.playCount : 0;
          const lastPlayed = meta.lastPlayed instanceof Date
            ? meta.lastPlayed.toISOString()
            : (meta.lastPlayed && typeof meta.lastPlayed === 'string' ? new Date(meta.lastPlayed).toISOString() : null);
          void savePlaybackMetadata(trackId, { playCount, lastPlayed });
        }
      });
    }, 120);
    return () => clearTimeout(timer);
  }, [playbackMeta]);

  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        localStorage.setItem('classitunes_playlists', JSON.stringify(playlists));
      } catch (e) {
        console.warn('Failed to save playlists to localStorage', e);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [playlists]);

  useEffect(() => {
    try {
      localStorage.setItem('classitunes_selected_playlist_id', selectedPlaylistId);
    } catch (e) {
      console.warn('LocalStorage selectedPlaylistId write error', e);
    }
  }, [selectedPlaylistId]);

  // Apply playback processing settings to the audio engine immediately.
  useEffect(() => {
    audioEngine.setNormalizationEnabled(appSettings.audioNormalization);
  }, [appSettings.audioNormalization]);

  const handleSelectionChange = useCallback((ids: string[]) => {
    setSelectedTrackIds(ids);
  }, []);

  // Audio Playback Handlers
  const mergedTracksRef = useRef(mergedTracks);
  useEffect(() => {
    mergedTracksRef.current = mergedTracks;
  }, [mergedTracks]);

  const playTrack = useCallback((track: Track, queue?: Track[]) => {
    if (queue && queue.length > 0) {
      setActiveQueue(queue);
      setAlbumPlayQueue(queue);
    }
    // 0. Instantly resolve cover artwork from memory cache or sibling tracks from same album
    const albumKey = (track.album || '').trim().toLowerCase();
    let cachedArt = track.coverUrl || getCachedArtwork(track.id) || (albumKey ? getCachedArtwork(albumKey) : undefined);
    
    // Check if another loaded track with the same album has a valid coverUrl
    if (!cachedArt && albumKey) {
      // Search current mergedTracks (base + playbackMeta) for sibling artwork without invalidating playTrack identity
      const sibling = mergedTracksRef.current.find(t => (t.album || '').trim().toLowerCase() === albumKey && t.coverUrl);
      if (sibling?.coverUrl) {
        cachedArt = sibling.coverUrl;
        setCachedArtwork(albumKey, cachedArt);
      }
    }

    const immediateTrack = cachedArt && !track.coverUrl ? { ...track, coverUrl: cachedArt } : track;

    // 1. Immediately set active playing track and initiate audio
    setCurrentTrack(immediateTrack);
    setIsPlaying(true);
    if (track.audioUrl) {
      void audioEngine.playTrack(track.audioUrl, track.replayGainDb, track.filePath, { sizeBytes: track.sizeBytes });
    }

    // 2. Hydrate artwork & audio URL on-demand immediately (critical for 1st song on launch)
    if (!track.id.startsWith('demo_') && !track.id.startsWith('sample_')) {
      hydrateTrackMedia(immediateTrack).then((hydrated) => {
        if (hydrated) {
          // Guarantee currentTrack gets artwork even if it just started
          setCurrentTrack(prev => {
            if (!prev || prev.id === track.id) {
              return {
                ...track,
                ...prev,
                coverUrl: hydrated.coverUrl || prev?.coverUrl || immediateTrack.coverUrl,
                audioUrl: hydrated.audioUrl || prev?.audioUrl || track.audioUrl,
              };
            }
            return prev;
          });

          // If audio URL was resolved via hydration and wasn't playing yet, start playback
          if (hydrated.audioUrl && (!track.audioUrl || track.audioUrl !== hydrated.audioUrl)) {
            void audioEngine.playTrack(hydrated.audioUrl, track.replayGainDb, track.filePath, { sizeBytes: track.sizeBytes });
          }

          // Cache resolved artwork globally and write into playbackMeta (not base tracks)
          if (hydrated.coverUrl) {
            setCachedArtwork(track.id, hydrated.coverUrl);
            if (albumKey) setCachedArtwork(albumKey, hydrated.coverUrl);
            setPlaybackMeta(prev => {
              const next = new Map(prev);
              const existing: Partial<Track> = next.get(track.id) || {};
              next.set(track.id, {
                ...existing,
                coverUrl: hydrated.coverUrl || existing.coverUrl,
                audioUrl: hydrated.audioUrl || existing.audioUrl || track.audioUrl,
              });
              return next;
            });
          } else if (hydrated.audioUrl && hydrated.audioUrl !== track.audioUrl) {
            setPlaybackMeta(prev => {
              const next = new Map(prev);
              const existing: Partial<Track> = next.get(track.id) || {};
              next.set(track.id, { ...existing, audioUrl: hydrated.audioUrl });
              return next;
            });
          }
        }
      }).catch((err) => {
        console.warn('Failed to hydrate track media on play:', err);
      });
    }

    // 3. Update Play Count — write to playbackMeta only (does not invalidate filteredTracks/albums)
    setPlaybackMeta(prev => {
      const next = new Map(prev);
      const existing: Partial<Track> = next.get(track.id) || {};
      next.set(track.id, {
        ...existing,
        playCount: (existing.playCount ?? track.playCount ?? 0) + 1,
        lastPlayed: new Date(),
      });
      return next;
    });
  }, []);

  const togglePlay = () => {
    if (!currentTrack) {
      if (tracks.length > 0) {
        playTrack(tracks[0]);
      }
      return;
    }

    if (isPlaying) {
      audioEngine.pause();
      setIsPlaying(false);
    } else {
      audioEngine.resume();
      setIsPlaying(true);
    }
  };

  // Filtered Tracks based on Sidebar Selection and Search.
  // Depends on the BASE `tracks` array (not mergedTracks) so playback mutations (playCount,
  // coverUrl via playbackMeta) do NOT cause a recompute. The display layer merges playbackMeta.
  const filteredTracks = useMemo(() => {
    let list = [...tracks];

    // Filter by Playlist / System Library
    const activePlaylist = playlists.find(p => p.id === selectedPlaylistId);
    if (activePlaylist) {
      if (activePlaylist.isFolder) {
        // Collect all track IDs in this folder and any nested subfolders
        const trackIdSet = new Set<string>();
        const collectFolderTrackIds = (fId: string) => {
          const children = playlists.filter(p => p.parentId === fId);
          for (const ch of children) {
            if (ch.isFolder) {
              collectFolderTrackIds(ch.id);
            } else if (ch.isSmart) {
              evaluateSmartPlaylist(ch, tracks).forEach(t => trackIdSet.add(t.id));
            } else {
              ch.trackIds.forEach(id => trackIdSet.add(id));
            }
          }
        };
        collectFolderTrackIds(activePlaylist.id);
        list = list.filter(t => trackIdSet.has(t.id));
      } else if (activePlaylist.isSmart) {
        list = evaluateSmartPlaylist(activePlaylist, list);
      } else if (activePlaylist.systemType === 'all') {
        // All music
      } else if (activePlaylist.systemType === 'recently_added') {
        list = [...list].sort((a, b) => {
          const tA = typeof a.dateAdded === 'number' ? a.dateAdded : Date.parse(a.dateAdded || '');
          const tB = typeof b.dateAdded === 'number' ? b.dateAdded : Date.parse(b.dateAdded || '');
          return tB - tA;
        });
      } else if (activePlaylist.systemType === 'top_rated') {
        // Use mergedTracks so rating updates are reflected without base track mutation
        const mergedMap: Map<string, Track> | null = playbackMeta.size > 0 ? new Map<string, Track>(list.map(t => [t.id, getDisplayTrack(t)])) : null;
        list = list.filter(t => (mergedMap ? (mergedMap.get(t.id)?.rating ?? t.rating) : t.rating) >= 4);
      } else if (activePlaylist.systemType === 'party_shuffle') {
        // Shuffled party mix
        const shuffled = [...list];
        let seed = partyShuffleSeed;
        for (let i = shuffled.length - 1; i > 0; i--) {
          seed = (seed * 9301 + 49297) % 233280;
          const j = Math.floor((seed / 233280) * (i + 1));
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        list = shuffled;
      } else {
        // Custom Playlist (O(1) Set lookup)
        const idSet = new Set(activePlaylist.trackIds);
        list = list.filter(t => idSet.has(t.id));
      }
    }

    // Search Query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(t => 
        t.title.toLowerCase().includes(q) ||
        t.artist.toLowerCase().includes(q) ||
        t.album.toLowerCase().includes(q) ||
        t.genre.toLowerCase().includes(q)
      );
    }

    return list;
  }, [tracks, playlists, selectedPlaylistId, searchQuery, partyShuffleSeed]);

  // Merge playbackMeta into filteredTracks for the actual rendered views.
  // This is cheap: only touches the filtered subset, not the whole library.
  const displayTracks = useMemo(() => {
    if (playbackMeta.size === 0) return filteredTracks;
    return filteredTracks.map(getDisplayTrack);
  }, [filteredTracks, getDisplayTrack]);

// Fast 64-bit deterministic string hash used for unique, collision-resistant album keys
function hashString(str: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c64e6d;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

  // When leaving Album Grid View, proactively trim off-screen artwork blobs to free GPU/heap memory
  useEffect(() => {
    if (viewMode === 'list') {
      trimArtworkBlobs(0);
    }
  }, [viewMode]);

  // Derived Albums for Album Grid View
  // Consolidation rule: tracks consolidate into the same album ONLY if all four attributes match:
  // (1) Album Artist, (2) Album Name, (3) Year, (4) Album Cover.
  // If any of these differ, they are treated as distinct albums.
  // NOTE: defined here (before refs) so albumsRef can reference it without use-before-declaration
  const albums = useMemo(() => {
    if (viewMode !== 'grid') {
      return [];
    }
    const albumMap = new Map<string, Album>();

    filteredTracks.forEach(t => {
      const albumArtist = (t.albumArtist || t.artist || 'Unknown Artist').trim();
      const albumName = (t.album || 'Unknown Album').trim();
      const year = t.year != null && !isNaN(t.year) && t.year > 0 ? String(t.year).trim() : '';
      const rawCover = t.coverUrl ? (resolveNativeCoverUrlSync(t.coverUrl) || t.coverUrl) : (getCachedArtwork(t.id) || '');
      const trimmedCover = rawCover.trim();
      const coverKey = trimmedCover.length > 256 ? `${trimmedCover.slice(0, 128)}_${trimmedCover.length}_${hashString(trimmedCover)}` : trimmedCover;
      const key = `${albumArtist.toLowerCase()}|#|${albumName.toLowerCase()}|#|${year}|#|${coverKey}`;

      if (!albumMap.has(key)) {
        albumMap.set(key, {
          id: `album_${hashString(key)}`,
          name: albumName,
          artist: albumArtist,
          year: t.year && t.year > 0 ? t.year : undefined,
          coverUrl: trimmedCover || undefined,
          tracks: [t],
        });
      } else {
        const existing = albumMap.get(key)!;
        existing.tracks.push(t);
        if (!existing.coverUrl && trimmedCover) {
          existing.coverUrl = trimmedCover;
        }
        if (!existing.year && t.year && t.year > 0) {
          existing.year = t.year;
        }
      }
    });

    // Resolve final album artist & sort tracks properly by disc/track number
    albumMap.forEach((album) => {
      const trackArtists = new Set(album.tracks.map(t => (t.artist || '').trim()).filter(Boolean));
      const albumArtists = new Set(album.tracks.map(t => (t.albumArtist || '').trim()).filter(Boolean));

      if (albumArtists.size === 1 && albumArtists.values().next().value) {
        album.artist = albumArtists.values().next().value!;
      } else if (trackArtists.size > 1 && albumArtists.size === 0) {
        album.artist = 'Various Artists';
      } else if (trackArtists.size === 1) {
        album.artist = trackArtists.values().next().value!;
      }

      // Sort tracks within the album by Disc Number then Track Number
      album.tracks.sort((a, b) => {
        const discA = a.discNumber || 1;
        const discB = b.discNumber || 1;
        if (discA !== discB) return discA - discB;

        const trackA = a.trackNumber ?? 9999;
        const trackB = b.trackNumber ?? 9999;
        if (trackA !== trackB) return trackA - trackB;

        return (a.title || '').localeCompare(b.title || '', undefined, { numeric: true, sensitivity: 'base' });
      });
    });

    return sortAlbumsList(Array.from(albumMap.values()), albumSortField);
  }, [filteredTracks, albumSortField, viewMode]);

  // Determine active playback pool based on view mode and active queue
  // Use displayTracks (filteredTracks + playbackMeta) so next/prev operates on the same
  // track objects the user sees (with up-to-date playCount, coverUrl, etc.)
  const activePlaybackPool = useMemo(() => {
    if (viewMode === 'grid' && albumPlayQueue && albumPlayQueue.length > 0) {
      return albumPlayQueue;
    }
    if (activeQueue && activeQueue.length > 0 && currentTrack && activeQueue.some(t => t.id === currentTrack.id)) {
      return activeQueue;
    }
    return displayTracks.length > 0 ? displayTracks : mergedTracks;
  }, [viewMode, albumPlayQueue, activeQueue, currentTrack, displayTracks, mergedTracks]);

  // Next/Prev logic
  const handleNextTrack = useCallback(() => {
    const activePool = activePlaybackPool;
    if (activePool.length === 0) return;
    
    if (!currentTrack) {
      playTrack(activePool[0]);
      return;
    }

    if (isShuffle) {
      const randomIndex = Math.floor(Math.random() * activePool.length);
      playTrack(activePool[randomIndex]);
      return;
    }

    const currentIndex = activePool.findIndex(t => t.id === currentTrack.id);
    if (currentIndex === -1) {
      playTrack(activePool[0]);
      return;
    }

    if (currentIndex < activePool.length - 1) {
      playTrack(activePool[currentIndex + 1]);
      return;
    }

    // At last track of current pool — in Albums view advance to the next album
    if (viewMode === 'grid' && albumPlayQueue) {
      const albumName = (currentTrack.album || '').trim().toLowerCase();
      const albumIdx = albums.findIndex(a => a.tracks.some(t => t.id === currentTrack.id) || (albumName && a.name.trim().toLowerCase() === albumName));
      if (albumIdx !== -1) {
        const nextIdx = albumIdx < albums.length - 1 ? albumIdx + 1 : 0;
        const nextAlbum = albums[nextIdx];
        if (nextAlbum.tracks.length > 0) {
          playTrack(nextAlbum.tracks[0], nextAlbum.tracks);
          return;
        }
      }
    }
    // Default: wrap to beginning of current pool
    playTrack(activePool[0]);
  }, [activePlaybackPool, currentTrack, isShuffle, playTrack, viewMode, albumPlayQueue, albums]);

  const getCrossfadeTarget = useCallback((): Track | null => {
    const activePool = activePlaybackPool;
    if (!currentTrack || activePool.length < 2) return null;
    if (repeatMode === 'one') return null;

    if (isShuffle) {
      const candidates = activePool.filter(t => t.id !== currentTrack.id);
      return candidates.length ? candidates[Math.floor(Math.random() * candidates.length)] : null;
    }

    const currentIndex = activePool.findIndex(t => t.id === currentTrack.id);
    if (currentIndex >= 0 && currentIndex < activePool.length - 1) return activePool[currentIndex + 1];
    if (repeatMode === 'all') return activePool[0];
    return null;
  }, [activePlaybackPool, currentTrack, isShuffle, repeatMode]);

  const startCrossfade = useCallback(async (target: Track) => {
    setCurrentTrack(target);
    setTracks(prev => prev.map(t => t.id === target.id
      ? { ...t, playCount: (t.playCount || 0) + 1, lastPlayed: new Date() }
      : t
    ));
    await audioEngine.crossfadeTo(target.audioUrl, appSettings.crossfadeSeconds, target.replayGainDb, target.filePath);
    window.setTimeout(() => { crossfadeTriggeredRef.current = false; }, Math.max(500, appSettings.crossfadeSeconds * 1000 + 250));
  }, [appSettings.crossfadeSeconds]);

  const handlePrevTrack = useCallback(() => {
    const activePool = activePlaybackPool;
    if (activePool.length === 0) return;
    if (!currentTrack) {
      playTrack(activePool[0]);
      return;
    }

    const currentIndex = activePool.findIndex(t => t.id === currentTrack.id);
    if (currentIndex <= 0) {
      playTrack(activePool[activePool.length - 1]);
    } else {
      playTrack(activePool[currentIndex - 1]);
    }
  }, [activePlaybackPool, currentTrack, playTrack]);

  // Stable references to prevent constant tear-down/re-binding of audio event listeners
  const repeatModeRef = useRef(repeatMode);
  const currentTrackRef = useRef(currentTrack);
  const isShuffleRef = useRef(isShuffle);
  const activePlaybackPoolRef = useRef(activePlaybackPool);
  const playTrackRef = useRef(playTrack);
  const handleNextTrackRef = useRef(handleNextTrack);
  const handlePrevTrackRef = useRef(handlePrevTrack);
  const togglePlayRef = useRef(togglePlay);
  const crossfadeTriggeredRef = useRef(false);
  // Albums-view next-album progression refs
  const albumsRef = useRef<Album[]>(albums);
  const albumPlayQueueRef = useRef<Track[] | null>(albumPlayQueue);
  const viewModeRef = useRef<ViewMode>(viewMode);

  useEffect(() => {
    repeatModeRef.current = repeatMode;
    currentTrackRef.current = currentTrack;
    isShuffleRef.current = isShuffle;
    activePlaybackPoolRef.current = activePlaybackPool;
    playTrackRef.current = playTrack;
    handleNextTrackRef.current = handleNextTrack;
    handlePrevTrackRef.current = handlePrevTrack;
    togglePlayRef.current = togglePlay;
    albumsRef.current = albums;
    albumPlayQueueRef.current = albumPlayQueue;
    viewModeRef.current = viewMode;
    if (!currentTrack) crossfadeTriggeredRef.current = false;
  });

  // System Media Controls (MediaSession API) Sync
  useEffect(() => {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
      if (currentTrack) {
        const cover = currentTrack.coverUrl;
        navigator.mediaSession.metadata = new MediaMetadata({
          title: currentTrack.title || 'Now Playing',
          artist: currentTrack.artist || 'ClassiPlayer',
          album: currentTrack.album || 'Library',
          artwork: cover && !cover.startsWith('data:image/svg')
            ? [{ src: cover, sizes: '512x512', type: 'image/png' }]
            : [{ src: '/icon.svg', sizes: '512x512', type: 'image/svg+xml' }],
        });
      }
    }
    // Synchronize Windows Taskbar Thumbnail Toolbar
    updateTaskbarThumbnailToolbar(isPlaying);
  }, [isPlaying, currentTrack]);

  // Windows Taskbar Thumbnail Toolbar Action Listeners (VLC style)
  useEffect(() => {
    if (!isTauri()) return;
    let unlistenPlayPause: (() => void) | null = null;
    let unlistenPrev: (() => void) | null = null;
    let unlistenNext: (() => void) | null = null;

    import('@tauri-apps/api/event').then(({ listen }) => {
      listen('taskbar-play-pause', () => {
        togglePlayRef.current();
      }).then(un => { unlistenPlayPause = un; });

      listen('taskbar-prev', () => {
        handlePrevTrackRef.current();
      }).then(un => { unlistenPrev = un; });

      listen('taskbar-next', () => {
        handleNextTrackRef.current();
      }).then(un => { unlistenNext = un; });
    }).catch(err => {
      console.warn('Failed to bind taskbar thumbnail listeners:', err);
    });

    return () => {
      if (unlistenPlayPause) unlistenPlayPause();
      if (unlistenPrev) unlistenPrev();
      if (unlistenNext) unlistenNext();
    };
  }, []);

  // Synchronize actual audio duration whenever loaded in AudioEngine
  useEffect(() => {
    const unsub = audioEngine.onLoadedMetadata(() => {
      const liveDuration = audioEngine.getDuration();
      if (liveDuration && isFinite(liveDuration) && liveDuration > 0 && currentTrack) {
        const roundedDur = Math.round(liveDuration * 100) / 100;
        if (!currentTrack.duration || Math.abs(currentTrack.duration - roundedDur) > 0.5) {
          setCurrentTrack(prev => (prev && prev.id === currentTrack.id ? { ...prev, duration: roundedDur } : prev));
          setTracks(prev => prev.map(t => (t.id === currentTrack.id ? { ...t, duration: roundedDur } : t)));
        }
      }
    });
    return unsub;
  }, [currentTrack]);

  // Background resolver for tracks that have 0:00 duration before playback
  const isResolvingDurationsRef = useRef<boolean>(false);
  useEffect(() => {
    if (isResolvingDurationsRef.current) return;
    // Consider any track with duration <= 1.0 as unmeasured/corrupted (no real song is <= 1 second)
    const unmeasured = tracks.filter(t => (!t.duration || t.duration <= 1.0) && (t.audioUrl || (t as any).filePath));
    if (unmeasured.length === 0) return;

    isResolvingDurationsRef.current = true;
    let cancelled = false;

    const resolveAll = async () => {
      // First pass: instantly resolve any tracks that have sizeBytes and bitrate
      const quickResolutions = new Map<string, number>();
      for (const t of unmeasured) {
        if (t.sizeBytes && t.bitrate) {
          const est = (t.sizeBytes * 8) / (t.bitrate * 1000);
          if (est > 0 && isFinite(est)) {
            quickResolutions.set(t.id, Math.round(est * 100) / 100);
          }
        }
      }

      if (quickResolutions.size > 0 && !cancelled) {
        setTracks(prev => prev.map(t => {
          const d = quickResolutions.get(t.id);
          return d ? { ...t, duration: d } : t;
        }));
      }

      // Second pass: for any remaining without duration, probe via getAudioDuration
      const remaining = unmeasured.filter(t => !quickResolutions.has(t.id));
      for (const track of remaining) {
        if (cancelled) break;
        let resolved = 0;
        if (track.audioUrl) {
          resolved = await getAudioDuration(track.audioUrl);
        }
        if (resolved > 0 && !cancelled) {
          const finalDur = Math.round(resolved * 100) / 100;
          setTracks(prev => prev.map(t => (t.id === track.id ? { ...t, duration: finalDur } : t)));
        }
        await new Promise(r => setTimeout(r, 40));
      }
      isResolvingDurationsRef.current = false;
    };

    const timer = setTimeout(resolveAll, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      isResolvingDurationsRef.current = false;
    };
  }, [tracks.length]);

  // MediaSession Position State & Action Handlers
  useEffect(() => {
    if ('mediaSession' in navigator) {
      try {
        navigator.mediaSession.setActionHandler('play', () => {
          audioEngine.resume();
          setIsPlaying(true);
        });
        navigator.mediaSession.setActionHandler('pause', () => {
          audioEngine.pause();
          setIsPlaying(false);
        });
        navigator.mediaSession.setActionHandler('previoustrack', () => {
          handlePrevTrackRef.current();
        });
        navigator.mediaSession.setActionHandler('nexttrack', () => {
          handleNextTrackRef.current();
        });
        navigator.mediaSession.setActionHandler('stop', () => {
          audioEngine.pause();
          setIsPlaying(false);
        });
        navigator.mediaSession.setActionHandler('seekto', (details) => {
          if (details.seekTime !== undefined && details.seekTime !== null) {
            audioEngine.seek(details.seekTime);
          }
        });
      } catch (e) {}
    }

    const unsubTime = audioEngine.onTimeUpdate(() => {
      const duration = audioEngine.getDuration();
      const position = audioEngine.getCurrentTime();

      // Crossfade must be triggered BEFORE the native `ended` event.
      if (appSettings.crossfadeEnabled && duration > 0 && currentTrackRef.current && !crossfadeTriggeredRef.current) {
        const fadeWindow = Math.max(0.25, Math.min(appSettings.crossfadeSeconds, duration * 0.5));
        if (duration - position <= fadeWindow) {
          const activePool = activePlaybackPoolRef.current;
          const track = currentTrackRef.current;
          let target: Track | null = null;
          if (repeatModeRef.current !== 'one' && activePool.length > 1) {
            if (isShuffleRef.current) {
              const candidates = activePool.filter(t => t.id !== track.id);
              target = candidates.length ? candidates[Math.floor(Math.random() * candidates.length)] : null;
            } else {
              const index = activePool.findIndex(t => t.id === track.id);
              if (index >= 0 && index < activePool.length - 1) {
                target = activePool[index + 1];
              } else {
                // At last track — in Albums view advance to next album for crossfade
                if (viewModeRef.current === 'grid' && albumPlayQueueRef.current) {
                  const albumName = (track.album || '').trim().toLowerCase();
                  const allAlbums = albumsRef.current;
                  const albumIdx = allAlbums.findIndex(a => a.tracks.some(t => t.id === track.id) || (albumName && a.name.trim().toLowerCase() === albumName));
                  if (albumIdx !== -1 && albumIdx < allAlbums.length - 1) {
                    const nextAlbum = allAlbums[albumIdx + 1];
                    setAlbumPlayQueue(nextAlbum.tracks);
                    target = nextAlbum.tracks[0];
                  } else if (repeatModeRef.current === 'all' && allAlbums.length > 0) {
                    const firstAlbum = allAlbums[0];
                    setAlbumPlayQueue(firstAlbum.tracks);
                    target = firstAlbum.tracks[0];
                  }
                } else if (repeatModeRef.current === 'all') {
                  target = activePool[0];
                }
              }
            }
          }
          if (target) {
            crossfadeTriggeredRef.current = true;
            startCrossfade(target).catch(err => {
              console.warn('Crossfade failed; falling back to normal track advance:', err);
              crossfadeTriggeredRef.current = false;
              handleNextTrackRef.current();
            });
          }
        }
      }

      if ('mediaSession' in navigator && currentTrackRef.current) {
        try {
          if (duration && !isNaN(duration) && duration > 0) {
            navigator.mediaSession.setPositionState({ duration, playbackRate: 1.0, position: Math.min(position, duration) });
          }
        } catch (e) {}
      }
    });

    return () => {
      unsubTime();
    };
  }, [appSettings.crossfadeEnabled, appSettings.crossfadeSeconds, startCrossfade]);

  // Handle Track Ended Event
  useEffect(() => {
    const unsub = audioEngine.onEnded(() => {
      const currentTrack = currentTrackRef.current;
      const repeatMode = repeatModeRef.current;
      const isShuffle = isShuffleRef.current;
      const activePool = activePlaybackPoolRef.current;
      const playTrack = playTrackRef.current;

      if (repeatMode === 'one' && currentTrack) {
        audioEngine.seek(0);
        audioEngine.resume();
      } else {
        if (activePool.length === 0) return;
        if (!currentTrack) {
          playTrack(activePool[0]);
          return;
        }

        if (isShuffle) {
          const randomIndex = Math.floor(Math.random() * activePool.length);
          playTrack(activePool[randomIndex]);
          return;
        }

        const currentIndex = activePool.findIndex(t => t.id === currentTrack.id);
        if (currentIndex === activePool.length - 1) {
          // Reached the end of the last song in the current pool
          if (viewModeRef.current === 'grid' && albumPlayQueueRef.current) {
            // Albums view: advance to the first track of the next album
            const albumName = (currentTrack.album || '').trim().toLowerCase();
            const allAlbums = albumsRef.current;
            const albumIdx = allAlbums.findIndex(a => a.tracks.some(t => t.id === currentTrack.id) || (albumName && a.name.trim().toLowerCase() === albumName));
            if (albumIdx !== -1) {
              if (albumIdx < allAlbums.length - 1) {
                const nextAlbum = allAlbums[albumIdx + 1];
                playTrack(nextAlbum.tracks[0], nextAlbum.tracks);
                return;
              } else if (repeatMode === 'all' && allAlbums.length > 0) {
                const firstAlbum = allAlbums[0];
                playTrack(firstAlbum.tracks[0], firstAlbum.tracks);
                return;
              } else {
                // Last album, repeat off — stop
                setCurrentTrack(null);
                setIsPlaying(false);
                audioEngine.pause();
                return;
              }
            }
          }
          // Non-albums-view default
          if (repeatMode === 'all') {
            playTrack(activePool[0]);
          } else {
            // Repeat mode is off: stop playing and do not repeat the playlist/library
            setCurrentTrack(null);
            setIsPlaying(false);
            audioEngine.pause();
          }
        } else if (currentIndex === -1) {
          playTrack(activePool[0]);
        } else {
          playTrack(activePool[currentIndex + 1]);
        }
      }
    });

    return () => unsub();
  }, []);

  // Track Counts for Sidebar
  const trackCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    playlists.forEach(p => {
      if (p.isFolder) {
        const trackIdSet = new Set<string>();
        const collectFolderTrackIds = (fId: string) => {
          const children = playlists.filter(c => c.parentId === fId);
          for (const ch of children) {
            if (ch.isFolder) {
              collectFolderTrackIds(ch.id);
            } else if (ch.isSmart) {
              evaluateSmartPlaylist(ch, tracks).forEach(t => trackIdSet.add(t.id));
            } else {
              ch.trackIds.forEach(id => trackIdSet.add(id));
            }
          }
        };
        collectFolderTrackIds(p.id);
        counts[p.id] = trackIdSet.size;
      } else if (p.isSmart) {
        counts[p.id] = evaluateSmartPlaylist(p, tracks).length;
      } else if (p.systemType === 'all') {
        counts[p.id] = tracks.length;
      } else if (p.systemType === 'recently_added') {
        counts[p.id] = tracks.length;
      } else if (p.systemType === 'top_rated') {
        counts[p.id] = tracks.filter(t => t.rating >= 4).length;
      } else if (p.systemType === 'party_shuffle') {
        counts[p.id] = tracks.length;
      } else {
        counts[p.id] = p.trackIds.length;
      }
    });
    return counts;
  }, [tracks, playlists]);

  // Track Rating Update
  const handleUpdateRating = (trackId: string, rating: number) => {
    setTracks(prev => prev.map(t => t.id === trackId ? { ...t, rating } : t));
    void dbUpdateTrackRating(trackId, rating);
  };

  // Track Metadata Edit (Single or Batch Multi-Track / Album)
  const handleSaveTracks = async (updatedTracks: Array<Track & { artworkDataUrl?: string; artworkRemoved?: boolean }>) => {
    if (updatedTracks.length === 0) return;

    const persistedTracks: Track[] = [];

    for (const updatedTrack of updatedTracks) {
      const { artworkDataUrl, artworkRemoved, ...cleanTrack } = updatedTrack;

      if (isTauri() && cleanTrack.filePath && /\.(mp3|aac|m4a|m4b|m4p|m4r|mp4)$/i.test(cleanTrack.filePath)) {
        try {
          await writeTauriMusicMetadata(cleanTrack.filePath, {
            title: updatedTrack.title ?? '',
            artist: updatedTrack.artist ?? '',
            albumArtist: updatedTrack.albumArtist ?? '',
            album: updatedTrack.album ?? '',
            composer: updatedTrack.composer ?? '',
            publisher: updatedTrack.publisher ?? '',
            lyrics: updatedTrack.lyrics ?? '',
            genre: updatedTrack.genre ?? '',
            year: updatedTrack.year,
            trackNumber: updatedTrack.trackNumber,
            trackTotal: updatedTrack.trackTotal,
            discNumber: updatedTrack.discNumber,
            discTotal: updatedTrack.discTotal,
            bpm: updatedTrack.bpm,
            comments: updatedTrack.comments ?? '',
            mediaKind: updatedTrack.mediaKind ?? 'Music',
            ...(artworkDataUrl !== undefined || artworkRemoved
              ? { artworkDataUrl: artworkRemoved ? '' : (artworkDataUrl || '') }
              : {}),
          });

          let freshCoverUrl: string | undefined = cleanTrack.coverUrl;
          if (artworkRemoved) {
            freshCoverUrl = undefined;
          } else if (artworkDataUrl) {
            freshCoverUrl = artworkDataUrl;
          }

          // The native audio file is the source of truth for embedded artwork.
          // Remove the old IndexedDB artwork/cache entry so a stale cover cannot
          // override the newly embedded image after a restart or re-hydration.
          if (artworkDataUrl !== undefined || artworkRemoved) {
            await deleteMediaFile(`cover_${cleanTrack.id}`);
            clearCachedArtwork();
            if (freshCoverUrl) {
              setCachedArtwork(cleanTrack.id, freshCoverUrl);
              const albumKey = (updatedTrack.album || '').trim().toLowerCase();
              if (albumKey) setCachedArtwork(albumKey, freshCoverUrl);
            }
          }

          let persistedFilePath = cleanTrack.filePath;
          let persistedAudioUrl = cleanTrack.audioUrl;

          // When the library organizer is enabled, metadata changes can change
          // the Artist/Album/Title used by the on-disk organization. Relocate
          // the already-managed file after the metadata write succeeds, then
          // keep the React track path in sync with the physical file.
          if (
            appSettings.organizeMusicFolders &&
            appSettings.defaultMusicPath &&
            cleanTrack.filePath
          ) {
            try {
              const relocatedPath = await relocateTauriMusicFile(
                cleanTrack.filePath,
                appSettings.defaultMusicPath,
                updatedTrack.artist ?? '',
                updatedTrack.album ?? '',
                updatedTrack.title ?? '',
              );
              persistedFilePath = relocatedPath;
              if (isTauri()) {
                try {
                  const { convertFileSrc } = await import('@tauri-apps/api/core');
                  persistedAudioUrl = convertFileSrc(relocatedPath);
                } catch {}
              }
            } catch (relocationError) {
              // Metadata was already saved successfully. Keep the edited track
              // usable at its existing path and report the relocation failure.
              console.error('Failed to reorganize edited music file:', relocationError);
            }
          }

          persistedTracks.push({
            ...cleanTrack,
            filePath: persistedFilePath,
            audioUrl: persistedAudioUrl,
            coverUrl: freshCoverUrl,
          });
        } catch (error) {
          console.error('Failed to write edited music metadata for track:', cleanTrack.filePath, error);
          persistedTracks.push(cleanTrack);
        }
      } else {
        // Browser mode
        persistedTracks.push({
          ...cleanTrack,
          coverUrl: artworkRemoved ? undefined : (artworkDataUrl || cleanTrack.coverUrl),
        });
      }
    }

    // Persist all updated tracks into library state & IndexedDB
    setTracks(prev => {
      const map = new Map(persistedTracks.map(t => [t.id, t]));
      const next = prev.map(t => map.has(t.id) ? { ...t, ...map.get(t.id)! } : t);
      saveTracksMetadata(next).catch(() => {});
      return next;
    });

    if (currentTrack) {
      const match = persistedTracks.find(t => t.id === currentTrack.id);
      if (match) {
        setCurrentTrack(prev => prev ? { ...prev, ...match } : prev);
      }
    }
  };

  const handleSaveTrack = async (updatedTrack: Track & { artworkDataUrl?: string; artworkRemoved?: boolean }) => {
    await handleSaveTracks([updatedTrack]);
  };


  const [deleteRequest, setDeleteRequest] = useState<{ ids: string[]; tracks: Track[] } | null>(null);

  const removeTracksFromLibrary = useCallback((trackIds: string[]) => {
    void dbDeleteTracks(trackIds);
    trackIds.forEach(id => {
      deleteMediaFile(`audio_${id}`);
      deleteMediaFile(`cover_${id}`);
      deletePlaybackMetadata(id).catch(() => {});
      clearCachedArtwork(id);
    });
    setTracks(prev => prev.filter(t => !trackIds.includes(t.id)));
    setSelectedTrackIds(prev => prev.filter(id => !trackIds.includes(id)));
    setPlaylists(prev => prev.map(p => ({ ...p, trackIds: p.trackIds.filter(id => !trackIds.includes(id)) })));
    if (currentTrack && trackIds.includes(currentTrack.id)) {
      setCurrentTrack(null);
      setIsPlaying(false);
      audioEngine.pause();
    }
  }, [currentTrack]);

  const handleDeleteTrack = (trackId: string) => {
    const target = tracks.find(t => t.id === trackId);
    if (target) setDeleteRequest({ ids: [trackId], tracks: [target] });
  };

  const handleDeleteTracks = useCallback((trackIds: string[]) => {
    const targets = tracks.filter(t => trackIds.includes(t.id));
    if (targets.length) setDeleteRequest({ ids: trackIds, tracks: targets });
  }, [tracks]);

  const finishDeleteRequest = useCallback(async (mode: 'library' | 'file' | 'cancel') => {
    if (!deleteRequest || mode === 'cancel') { setDeleteRequest(null); return; }
    const { ids, tracks: targets } = deleteRequest;
    if (mode === 'file') {
      for (const t of targets) {
        if (t.filePath && isTauri()) await deleteTauriFile(t.filePath);
      }
    }
    removeTracksFromLibrary(ids);
    setDeleteRequest(null);
  }, [deleteRequest, removeTracksFromLibrary]);

  // Create Playlist & Folder Handlers (Inline creation with immediate inline rename highlight)
  const handleCreatePlaylist = useCallback((parentId?: string) => {
    let baseName = 'untitled playlist';
    let name = baseName;
    let counter = 2;
    const existingNames = new Set(playlists.map(p => p.name.toLowerCase()));
    while (existingNames.has(name.toLowerCase())) {
      name = `${baseName} ${counter++}`;
    }

    const newPl: Playlist = {
      id: `pl_${Date.now()}`,
      name,
      parentId,
      systemType: 'user',
      trackIds: [],
    };

    setPlaylists(prev => {
      let updated = [...prev, newPl];
      if (parentId) {
        updated = updated.map(p => p.id === parentId ? { ...p, collapsed: false } : p);
      }
      return updated;
    });
    setSelectedDevice(null);
    setSelectedPlaylistId(newPl.id);
    setEditingPlaylistId(newPl.id);
    return newPl.id;
  }, [playlists]);

  const handleCreatePlaylistFolder = useCallback((parentId?: string) => {
    let baseName = 'untitled folder';
    let name = baseName;
    let counter = 2;
    const existingNames = new Set(playlists.map(p => p.name.toLowerCase()));
    while (existingNames.has(name.toLowerCase())) {
      name = `${baseName} ${counter++}`;
    }

    const newFolder: Playlist = {
      id: `folder_${Date.now()}`,
      name,
      isFolder: true,
      parentId,
      collapsed: false,
      systemType: 'user',
      trackIds: [],
    };

    setPlaylists(prev => {
      let updated = [...prev, newFolder];
      if (parentId) {
        updated = updated.map(p => p.id === parentId ? { ...p, collapsed: false } : p);
      }
      return updated;
    });
    setSelectedDevice(null);
    setSelectedPlaylistId(newFolder.id);
    setEditingPlaylistId(newFolder.id);
    return newFolder.id;
  }, [playlists]);

  // Global Keyboard Shortcuts for Playlist/Folder creation (Cmd+N / Ctrl+N)
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement as HTMLElement | null;
      if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable)) {
        return;
      }

      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        const activePl = playlists.find(p => p.id === selectedPlaylistId);
        const parentId = activePl?.isFolder ? activePl.id : activePl?.parentId;
        if (e.shiftKey) {
          handleCreatePlaylistFolder(parentId);
        } else {
          handleCreatePlaylist(parentId);
        }
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [playlists, selectedPlaylistId, handleCreatePlaylist, handleCreatePlaylistFolder]);

  const handleToggleFolderCollapse = useCallback((folderId: string) => {
    setPlaylists(prev => prev.map(p => p.id === folderId ? { ...p, collapsed: !p.collapsed } : p));
  }, []);

  const handleMovePlaylistToFolder = useCallback((playlistId: string, parentId?: string) => {
    setPlaylists(prev => {
      let updated = prev.map(p => p.id === playlistId ? { ...p, parentId } : p);
      if (parentId) {
        updated = updated.map(p => p.id === parentId ? { ...p, collapsed: false } : p);
      }
      return updated;
    });
  }, []);

  // Smart Playlist Handlers
  const handleCreateSmartPlaylist = (parentId?: string) => {
    setEditingSmartPlaylist(null);
    setSmartPlaylistParentId(parentId);
    setIsSmartPlaylistOpen(true);
  };

  const handleEditSmartPlaylist = (playlist: Playlist) => {
    setEditingSmartPlaylist(playlist);
    setSmartPlaylistParentId(playlist.parentId);
    setIsSmartPlaylistOpen(true);
  };

  const handleSaveSmartPlaylist = (smartData: Partial<Playlist>) => {
    if (smartData.id && playlists.some(p => p.id === smartData.id)) {
      setPlaylists(prev => prev.map(p => p.id === smartData.id ? { ...p, ...smartData } as Playlist : p));
      setSelectedPlaylistId(smartData.id);
    } else {
      const newPl: Playlist = {
        id: smartData.id || `smart_pl_${Date.now()}`,
        name: smartData.name || 'Smart Playlist',
        parentId: smartPlaylistParentId,
        isSmart: true,
        matchType: smartData.matchType || 'all',
        rules: smartData.rules || [],
        limit: smartData.limit,
        systemType: 'user',
        trackIds: [],
      };
      setPlaylists(prev => {
        let updated = [...prev, newPl];
        if (smartPlaylistParentId) {
          updated = updated.map(p => p.id === smartPlaylistParentId ? { ...p, collapsed: false } : p);
        }
        return updated;
      });
      setSelectedPlaylistId(newPl.id);
    }
  };

  // Delete Playlist / Folder
  const handleDeletePlaylist = (playlistId: string) => {
    setPlaylists(prev => {
      // If deleting a folder, un-nest its children back to root level so playlists are preserved
      return prev
        .map(p => p.parentId === playlistId ? { ...p, parentId: undefined } : p)
        .filter(p => p.id !== playlistId);
    });
    if (selectedPlaylistId === playlistId) {
      setSelectedPlaylistId('lib_music');
    }
  };

  // Add Tracks to Playlist
  const handleAddTrackToPlaylist = (trackId: string, playlistId: string) => {
    setPlaylists(prev => prev.map(p => {
      if (p.id === playlistId && !p.trackIds.includes(trackId)) {
        return { ...p, trackIds: [...p.trackIds, trackId] };
      }
      return p;
    }));
  };

  const handleDropTracksToPlaylist = (trackIds: string[], playlistId: string) => {
    setPlaylists(prev => {
      const target = prev.find(p => p.id === playlistId);
      if (!target) return prev;

      if (target.isFolder) {
        // If the folder contains an existing standard playlist, add to the first one
        const childPl = prev.find(p => p.parentId === target.id && !p.isFolder && !p.isSmart);
        if (childPl) {
          return prev.map(p => {
            if (p.id === childPl.id) {
              const unique = Array.from(new Set([...p.trackIds, ...trackIds]));
              return { ...p, trackIds: unique };
            }
            if (p.id === target.id) {
              return { ...p, collapsed: false };
            }
            return p;
          });
        } else {
          // If the folder has no standard playlist, create a new playlist inside this folder
          const newChild: Playlist = {
            id: `pl_${Date.now()}`,
            name: 'New Playlist',
            parentId: target.id,
            systemType: 'user',
            trackIds: trackIds,
          };
          return [...prev.map(p => p.id === target.id ? { ...p, collapsed: false } : p), newChild];
        }
      }

      return prev.map(p => {
        if (p.id === playlistId) {
          const unique = Array.from(new Set([...p.trackIds, ...trackIds]));
          return { ...p, trackIds: unique };
        }
        return p;
      });
    });
  };

  const handleReorderPlaylists = useCallback((reordered: Playlist[]) => {
    setPlaylists(reordered);
  }, []);



  // Helper to extract files from dropped items (handles directories recursively)
  const extractFilesFromDataTransfer = async (dataTransfer: DataTransfer): Promise<File[]> => {
    const fileList: File[] = [];

    if (dataTransfer.items && dataTransfer.items.length > 0) {
      const entries: any[] = [];
      for (let i = 0; i < dataTransfer.items.length; i++) {
        const item = dataTransfer.items[i];
        if (item.kind === 'file') {
          const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
          if (entry) {
            entries.push(entry);
          } else {
            const f = item.getAsFile();
            if (f) fileList.push(f);
          }
        }
      }

      if (entries.length > 0) {
        let filesFound = 0;
        const readEntry = async (entry: any): Promise<File[]> => {
          if (entry.isFile) {
            return new Promise((resolve) => {
              entry.file((file: File) => {
                filesFound++;
                if (filesFound % 15 === 0) {
                  setImportProgress({
                    current: 0,
                    total: 0,
                    statusText: `Scanning folder... found ${filesFound} audio files`
                  });
                }
                resolve([file]);
              }, () => resolve([]));
            });
          } else if (entry.isDirectory) {
            const dirReader = entry.createReader();
            const readBatch = (): Promise<any[]> => new Promise(resolve => {
              dirReader.readEntries((res: any[]) => resolve(res), () => resolve([]));
            });
            let allChildren: any[] = [];
            let batch = await readBatch();
            while (batch.length > 0) {
              allChildren = allChildren.concat(batch);
              batch = await readBatch();
            }
            // On macOS / browser, avoid unlimited fan-out: chunk child traversal with concurrency limit
            const results: File[][] = [];
            const CHUNK_SIZE = 4;
            for (let i = 0; i < allChildren.length; i += CHUNK_SIZE) {
              const slice = allChildren.slice(i, i + CHUNK_SIZE);
              const batchFiles = await Promise.all(slice.map(c => readEntry(c)));
              results.push(...batchFiles);
            }
            return results.flat();
          }
          return [];
        };

        const results: File[][] = [];
        const CHUNK_SIZE = 4;
        for (let i = 0; i < entries.length; i += CHUNK_SIZE) {
          const slice = entries.slice(i, i + CHUNK_SIZE);
          const batchFiles = await Promise.all(slice.map(e => readEntry(e)));
          results.push(...batchFiles);
        }
        fileList.push(...results.flat());
        return fileList;
      }
    }

    if (dataTransfer.files && dataTransfer.files.length > 0) {
      for (let i = 0; i < dataTransfer.files.length; i++) {
        fileList.push(dataTransfer.files[i]);
      }
    }

    return fileList;
  };

  // Import Audio Files (Fast Concurrent Batching)
  const handleImportFiles = async (
    inputFiles: FileList | File[] | string[] | null | undefined,
    targetPlaylistId?: string
  ) => {
    if (!inputFiles) return;

    // Immediately trigger importing UI so screen doesn't freeze
    flushSync(() => {
      setIsImportingFiles(true);
      setImportProgress(prev => prev || { current: 0, total: 0, statusText: 'Preparing audio files for import...' });
    });

    // Yield to allow browser to render loading modal on screen immediately
    await new Promise(r => setTimeout(r, 20));

    let pathsArray: string[] = [];
    let fileArray: File[] = [];

    if (Array.isArray(inputFiles)) {
      if (inputFiles.length > 0 && typeof inputFiles[0] === 'string') {
        pathsArray = inputFiles as string[];
      } else {
        fileArray = inputFiles as File[];
      }
    } else if (inputFiles instanceof FileList) {
      fileArray = Array.from(inputFiles);
    }

    // Filter files
    fileArray = fileArray.filter(file => 
      file.type.startsWith('audio/') || /\.(mp3|wav|flac|m4a|aac|ogg|wma|aiff|alac)$/i.test(file.name)
    );

    const totalToProcess = pathsArray.length > 0 ? pathsArray.length : fileArray.length;
    if (totalToProcess === 0) {
      setIsImportingFiles(false);
      setImportProgress(null);
      return;
    }

    setImportProgress({
      current: 0,
      total: totalToProcess,
      statusText: `Processing 0 of ${totalToProcess} tracks (0%)`,
      phase: 'importing'
    });

    const allNewlyParsed: Track[] = [];

    // Pre-import dynamic convertFileSrc for performance on Tauri
    const { convertFileSrc } = isTauri() 
      ? await import('@tauri-apps/api/core') 
      : { convertFileSrc: null };

    // High-speed branch: If importing paths on Tauri, use parallel Rust batch metadata extraction
    if (pathsArray.length > 0 && isTauri()) {
      const BATCH_SIZE = 50;
      const isMac = platformInfo.isMacOS;
      const normalizeFsKey = (p: string) =>
        isMac ? p.replace(/\\/g, '/') : p.replace(/\\/g, '/').toLowerCase();
      const existingByPath = new Map<string, Track>();
      tracks.forEach(t => {
        if (t.filePath) {
          existingByPath.set(normalizeFsKey(t.filePath), t);
        }
      });
      let completed = 0;

      for (let i = 0; i < pathsArray.length; i += BATCH_SIZE) {
        const chunkPaths = pathsArray.slice(i, i + BATCH_SIZE);
        const metadataMap = await readTauriMusicMetadataBatch(chunkPaths);

        for (const originalPath of chunkPaths) {
          try {
            const filename = originalPath.split(/[/\\]/).pop() || 'imported_song.mp3';
            let path = originalPath;

            const shouldOrganize = appSettings.organizeMusicFolders && !!appSettings.defaultMusicPath;
            const nativeMeta = metadataMap[originalPath];

            const alreadyTrackedOrig = existingByPath.get(normalizeFsKey(originalPath));
            if (shouldOrganize && nativeMeta && !alreadyTrackedOrig) {
              path = await organizeTauriMusicFile(
                originalPath,
                appSettings.defaultMusicPath,
                nativeMeta.artist || 'Unknown Artist',
                nativeMeta.album || 'Unknown Album',
                nativeMeta.title || filename.replace(/\.[^.]+$/, ''),
                filename
              );
            }

            const existingTrackForPath =
              existingByPath.get(normalizeFsKey(path)) || alreadyTrackedOrig;
            const cleanFileName = filename.replace(/\.[^/.]+$/, '').trim();
            const finalTitle = nativeMeta?.title?.trim() || cleanFileName;
            const finalArtist = nativeMeta?.artist?.trim() || 'Unknown Artist';
            const finalAlbum = nativeMeta?.album?.trim() || 'Unknown Album';
            let finalCoverUrl = nativeMeta?.coverUrl || '';
            if (finalCoverUrl && !finalCoverUrl.startsWith('data:') && !finalCoverUrl.startsWith('blob:') && !finalCoverUrl.startsWith('asset:') && !finalCoverUrl.startsWith('http:') && !finalCoverUrl.startsWith('https:') && convertFileSrc) {
              try {
                finalCoverUrl = convertFileSrc(finalCoverUrl);
              } catch {}
            }
            const trackId = existingTrackForPath?.id || `track_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            if (finalCoverUrl) {
              setCachedArtwork(trackId, finalCoverUrl);
              const albumKey = finalAlbum.trim().toLowerCase();
              if (albumKey && !getCachedArtwork(albumKey)) {
                setCachedArtwork(albumKey, finalCoverUrl);
              }
              if (finalCoverUrl.startsWith('data:')) {
                const blob = dataURLtoBlob(finalCoverUrl);
                if (blob) {
                  saveMediaFile(`cover_${trackId}`, blob).catch(() => {});
                }
              }
            }

            let objectUrl = '';
            try {
              objectUrl = convertFileSrc ? convertFileSrc(path) : path;
            } catch (e) {
              objectUrl = path;
            }

            let finalDuration = nativeMeta?.duration ? Math.round(nativeMeta.duration * 100) / 100 : 0;
            if ((!finalDuration || finalDuration <= 0) && nativeMeta?.sizeBytes && nativeMeta?.bitrate) {
              const est = (nativeMeta.sizeBytes * 8) / (nativeMeta.bitrate * 1000);
              if (est > 0 && isFinite(est)) finalDuration = Math.round(est * 100) / 100;
            }

            const newTrackEntry: Track = {
              id: trackId,
              title: finalTitle,
              artist: finalArtist,
              albumArtist: nativeMeta?.albumArtist?.trim() || undefined,
              album: finalAlbum,
              composer: nativeMeta?.composer?.trim() || undefined,
              publisher: nativeMeta?.publisher?.trim() || undefined,
              lyrics: nativeMeta?.lyrics?.trim() || undefined,
              genre: nativeMeta?.genre?.trim() || 'Uncategorized',
              duration: finalDuration,
              year: nativeMeta?.year,
              trackNumber: nativeMeta?.trackNumber,
              trackTotal: nativeMeta?.trackTotal,
              discNumber: nativeMeta?.discNumber,
              discTotal: nativeMeta?.discTotal,
              bpm: nativeMeta?.bpm,
              mediaKind: nativeMeta?.mediaKind || 'Music',
              comments: nativeMeta?.comments?.trim() || undefined,
              rating: existingTrackForPath?.rating ?? 0,
              playCount: existingTrackForPath?.playCount ?? 0,
              lastPlayed: existingTrackForPath?.lastPlayed,
              coverUrl: finalCoverUrl || existingTrackForPath?.coverUrl || '',
              audioUrl: objectUrl,
              file: undefined,
              format: nativeMeta?.format || 'Audio file',
              bitrate: nativeMeta?.bitrate || 320,
              sampleRate: nativeMeta?.sampleRate || 44100,
              sizeBytes: nativeMeta?.sizeBytes || 0,
              dateAdded: existingTrackForPath?.dateAdded || new Date().toISOString(),
              filePath: path,
              replayGainDb: nativeMeta?.replayGainDb ?? existingTrackForPath?.replayGainDb,
            };
            existingByPath.set(normalizeFsKey(path), newTrackEntry);
            allNewlyParsed.push(newTrackEntry);
          } catch (err) {
            console.error('Failed to parse item:', originalPath, err);
          }
        }

        completed += chunkPaths.length;
        const currentCount = Math.min(completed, totalToProcess);
        const percent = Math.round((currentCount / totalToProcess) * 100);
        setImportProgress({
          current: currentCount,
          total: totalToProcess,
          statusText: `Importing ${currentCount} of ${totalToProcess} tracks (${percent}%)`,
          phase: 'importing'
        });

        // Yield briefly so UI stays responsive
        await new Promise(r => setTimeout(r, 5));
      }
    } else {
      // Standard File fallback: on macOS bound concurrency to 4 to prevent WKWebView stalls and memory spikes; non-macOS remains 16
      const CONCURRENCY = platformInfo.isMacOS ? 4 : 16;
      let completed = 0;

      for (let i = 0; i < totalToProcess; i += CONCURRENCY) {
        const chunk = fileArray.slice(i, i + CONCURRENCY);
        const results = await Promise.all(
          chunk.map(async (item) => {
            try {
              return await parseAudioFile(item);
            } catch (err) {
              console.error('Failed to parse item:', item, err);
              return null;
            }
          })
        );
        const parsedTracks = results.filter((t): t is Track => t !== null);
        if (parsedTracks.length > 0) {
          allNewlyParsed.push(...parsedTracks);
        }

        completed += chunk.length;
        const currentCount = Math.min(completed, totalToProcess);
        const percent = Math.round((currentCount / totalToProcess) * 100);
        setImportProgress({
          current: currentCount,
          total: totalToProcess,
          statusText: `Processing ${currentCount} of ${totalToProcess} tracks (${percent}%)`,
          phase: 'importing'
        });
      }
    }

    if (allNewlyParsed.length > 0) {
      let finalSortedLibrary: Track[] = [];
      setTracks(prev => {
        const map = new Map<string, Track>();
        [...allNewlyParsed, ...prev].forEach(t => map.set(t.id, internTrackStrings(t)));
        const merged = Array.from(map.values());
        merged.sort((a, b) => (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base', numeric: true }));
        finalSortedLibrary = merged;
        return merged;
      });

      if (targetPlaylistId) {
        const newIds = allNewlyParsed.map(t => t.id);
        if (targetPlaylistId === 'new') {
          const first = allNewlyParsed[0];
          const plName = first?.artist && first.artist !== 'Unknown Artist' ? `${first.artist} Selection` : `New Playlist ${Date.now().toString().slice(-4)}`;
          const newPl: Playlist = {
            id: `pl_${Date.now()}`,
            name: plName,
            trackIds: newIds,
            systemType: 'user',
          };
          setPlaylists(prev => [...prev, newPl]);
          setSelectedDevice(null);
          setSelectedPlaylistId(newPl.id);
        } else {
          setPlaylists(prev => {
            const target = prev.find(p => p.id === targetPlaylistId);
            if (target?.isFolder) {
              const childPl = prev.find(p => p.parentId === target.id && !p.isFolder && !p.isSmart);
              if (childPl) {
                return prev.map(p => {
                  if (p.id === childPl.id) {
                    const unique = Array.from(new Set([...p.trackIds, ...newIds]));
                    return { ...p, trackIds: unique };
                  }
                  if (p.id === target.id) {
                    return { ...p, collapsed: false };
                  }
                  return p;
                });
              } else {
                const newChild: Playlist = {
                  id: `pl_${Date.now()}`,
                  name: 'New Playlist',
                  parentId: target.id,
                  systemType: 'user',
                  trackIds: newIds,
                };
                return [...prev.map(p => p.id === target.id ? { ...p, collapsed: false } : p), newChild];
              }
            }
            return prev.map(p => {
              if (p.id === targetPlaylistId) {
                const unique = Array.from(new Set([...p.trackIds, ...newIds]));
                return { ...p, trackIds: unique };
              }
              return p;
            });
          });
        }
      }

      // Once music is imported, play the top song (index 0 of sorted library)
      const topSong = finalSortedLibrary[0] || allNewlyParsed[0];
      if (topSong && !currentTrack) {
        playTrack(topSong);
      }
    }

    setIsImportingFiles(false);
    setImportProgress(null);
  };

  // Reset entire library (all tracks, custom playlists, IndexedDB, and localStorage)
  const handleResetLibrary = useCallback(async () => {
    // 1. Stop active audio and release audio resources
    audioEngine.releaseResources();
    setIsPlaying(false);
    setCurrentTrack(null);
    setSelectedTrackIds([]);

    // 2. Reset tracks state to empty
    setTracks(INITIAL_TRACKS);

    // 3. Reset playlists state to default system playlists
    setPlaylists(INITIAL_PLAYLISTS);
    setSelectedPlaylistId('lib_music');

    // 4. Clear IndexedDB storage and in-memory artwork cache
    await clearAllMediaStorage();
    clearCachedArtwork();

    // 5. Clear LocalStorage keys
    try {
      localStorage.removeItem('classitunes_tracks');
      localStorage.removeItem('classitunes_playlists');
      localStorage.removeItem('itunes_tracks'); // legacy key cleanup
      localStorage.removeItem('itunes_playlists'); // legacy key cleanup
      localStorage.setItem('classitunes_selected_playlist_id', 'lib_music');
    } catch (e) {
      console.warn('Failed to clear LocalStorage for library reset:', e);
    }
  }, []);

  // Scan music from specified folder or files list
  const handleScanMusic = useCallback(async (folderPathOrFiles?: string | File[]) => {
    if (!folderPathOrFiles) return;

    if (typeof folderPathOrFiles === 'string') {
      if (isTauri()) {
        const rootName = folderPathOrFiles.split(/[/\\]/).filter(Boolean).pop() || folderPathOrFiles;
        flushSync(() => {
          setIsImportingFiles(true);
          setImportProgress({
            current: 0,
            total: 0,
            statusText: `Preparing to scan: ${rootName}...`,
            phase: 'scanning'
          });
        });
        await new Promise(r => setTimeout(r, 20));

        const paths = await scanTauriDirectory(folderPathOrFiles, (count, folder) => {
          const fName = folder || rootName;
          setImportProgress({
            current: count,
            total: 0,
            statusText: `Scanning: ${fName} (found ${count} audio file${count !== 1 ? 's' : ''})`,
            phase: 'scanning'
          });
        });

        if (paths.length > 0) {
          await handleImportFiles(paths);
        } else {
          setIsImportingFiles(false);
          setImportProgress(null);
        }
      }
    } else if (Array.isArray(folderPathOrFiles) && folderPathOrFiles.length > 0) {
      await handleImportFiles(folderPathOrFiles);
    }
  }, []);

  // Refresh default music path (incremetal sync: scan default path, add new tracks, update modified tracks)
  const handleRefreshLibrary = useCallback(async () => {
    const targetPath = appSettings.defaultMusicPath;
    if (!targetPath) {
      window.alert('Please specify a Default Music Path in Options before refreshing.');
      return;
    }

    if (!isTauri()) {
      window.alert('Library refresh for local directories is supported in the desktop app.');
      return;
    }

    const rootName = targetPath.split(/[/\\]/).filter(Boolean).pop() || targetPath;
    flushSync(() => {
      setIsImportingFiles(true);
      setImportProgress({
        current: 0,
        total: 0,
        statusText: `Scanning default music folder: ${rootName}...`,
        phase: 'scanning'
      });
    });
    await new Promise(r => setTimeout(r, 20));

    // 1. Discover all audio file paths currently under default music folder
    const scannedPaths = await scanTauriDirectory(targetPath, (count, folder) => {
      const fName = folder || rootName;
      setImportProgress({
        current: count,
        total: 0,
        statusText: `Discovering files in: ${fName} (${count} found)`,
        phase: 'scanning'
      });
    });

    if (scannedPaths.length === 0) {
      setIsImportingFiles(false);
      setImportProgress(null);
      return;
    }

    // 2. Identify new paths vs existing paths and check for modifications
    // For macOS, do NOT force path.toLowerCase() because macOS filesystems may be case-sensitive.
    // For Windows, toLowerCase is preserved.
    const isMac = platformInfo.isMacOS;
    const existingPathMap = new Map<string, Track>();
    tracks.forEach(t => {
      if (t.filePath) {
        const key = isMac ? t.filePath.replace(/\\/g, '/') : t.filePath.replace(/\\/g, '/').toLowerCase();
        existingPathMap.set(key, t);
      }
    });

    const newPathsToImport: string[] = [];
    const modifiedTracksToUpdate: { path: string; existingTrack: Track }[] = [];

    setImportProgress({
      current: 0,
      total: scannedPaths.length,
      statusText: 'Checking for new and modified audio files...',
      phase: 'scanning'
    });

    // Check which paths already exist in the library vs need importing
    const pathsToStat: { path: string; existingTrack: Track }[] = [];
    for (const filePath of scannedPaths) {
      const key = isMac ? filePath.replace(/\\/g, '/') : filePath.replace(/\\/g, '/').toLowerCase();
      const existing = existingPathMap.get(key);
      if (!existing) {
        newPathsToImport.push(filePath);
      } else {
        pathsToStat.push({ path: filePath, existingTrack: existing });
      }
    }

    // Batch stat check for existing tracks to detect modifications in a single native call
    if (pathsToStat.length > 0) {
      const stats = await batchStatFiles(pathsToStat.map(p => p.path));
      for (let i = 0; i < pathsToStat.length; i++) {
        const { path, existingTrack } = pathsToStat[i];
        const statResult = stats[i];
        if (statResult && statResult.exists) {
          const currentSize = statResult.size;
          const prevSize = existingTrack.sizeBytes;
          const currentMtime = statResult.mtimeMs;
          const prevDateAdded = typeof existingTrack.dateAdded === 'number' 
            ? existingTrack.dateAdded 
            : Date.parse(existingTrack.dateAdded || '');

          // On macOS, check both file size change AND mtime change if available
          let isModified = false;
          if (prevSize && currentSize && Math.abs(currentSize - prevSize) > 0) {
            isModified = true;
          } else if (currentMtime && prevDateAdded && currentMtime > prevDateAdded + 2000) {
            isModified = true;
          }

          if (isModified) {
            modifiedTracksToUpdate.push({ path, existingTrack });
          }
        }
      }
    }

    const totalToProcess = newPathsToImport.length + modifiedTracksToUpdate.length;

    if (totalToProcess === 0) {
      setIsImportingFiles(false);
      setImportProgress(null);
      return;
    }

    // 3. Process new and modified tracks
    setImportProgress({
      current: 0,
      total: totalToProcess,
      statusText: `Refreshing library (${newPathsToImport.length} new, ${modifiedTracksToUpdate.length} modified)...`,
      phase: 'importing'
    });

    const newlyParsedList: Track[] = [];
    const updatedTrackMap = new Map<string, Track>();
    let completed = 0;

    // On macOS / Tauri, process via native Rust metadata reader to avoid giant fetch->Blob->File->JS parser conversions
    if (isTauri()) {
      const MAC_BATCH_SIZE = isMac ? 8 : 50;
      const allPaths = [...newPathsToImport, ...modifiedTracksToUpdate.map(m => m.path)];

      for (let i = 0; i < allPaths.length; i += MAC_BATCH_SIZE) {
        const chunk = allPaths.slice(i, i + MAC_BATCH_SIZE);
        const metaMap = await readTauriMusicMetadataBatch(chunk);
        const { convertFileSrc } = await import('@tauri-apps/api/core');

        for (const p of chunk) {
          const nativeMeta = metaMap[p];
          const filename = p.split(/[/\\]/).pop() || 'song.mp3';
          const cleanFileName = filename.replace(/\.[^/.]+$/, '').trim();
          const finalTitle = nativeMeta?.title?.trim() || cleanFileName;
          const finalArtist = nativeMeta?.artist?.trim() || 'Unknown Artist';
          const finalAlbum = nativeMeta?.album?.trim() || 'Unknown Album';
          let finalCoverUrl = nativeMeta?.coverUrl || '';
          if (finalCoverUrl && !finalCoverUrl.startsWith('data:') && !finalCoverUrl.startsWith('blob:') && !finalCoverUrl.startsWith('asset:') && !finalCoverUrl.startsWith('http:') && !finalCoverUrl.startsWith('https:')) {
            try {
              finalCoverUrl = convertFileSrc(finalCoverUrl);
            } catch {}
          }

          let audioUrl = p;
          try {
            audioUrl = convertFileSrc(p);
          } catch {}

          const isNew = newPathsToImport.includes(p);
          if (isNew) {
            const trackId = `track_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            newlyParsedList.push({
              id: trackId,
              title: finalTitle,
              artist: finalArtist,
              albumArtist: nativeMeta?.albumArtist?.trim() || undefined,
              album: finalAlbum,
              composer: nativeMeta?.composer?.trim() || undefined,
              publisher: nativeMeta?.publisher?.trim() || undefined,
              lyrics: nativeMeta?.lyrics?.trim() || undefined,
              genre: nativeMeta?.genre?.trim() || 'Uncategorized',
              duration: nativeMeta?.duration ? Math.round(nativeMeta.duration * 100) / 100 : 0,
              year: nativeMeta?.year,
              trackNumber: nativeMeta?.trackNumber,
              trackTotal: nativeMeta?.trackTotal,
              discNumber: nativeMeta?.discNumber,
              discTotal: nativeMeta?.discTotal,
              bpm: nativeMeta?.bpm,
              mediaKind: nativeMeta?.mediaKind || 'Music',
              comments: nativeMeta?.comments?.trim() || undefined,
              rating: 0,
              playCount: 0,
              coverUrl: finalCoverUrl,
              audioUrl,
              file: undefined,
              format: nativeMeta?.format || 'Audio file',
              bitrate: nativeMeta?.bitrate || 320,
              sampleRate: nativeMeta?.sampleRate || 44100,
              sizeBytes: nativeMeta?.sizeBytes || 0,
              dateAdded: new Date().toISOString(),
              filePath: p,
              replayGainDb: nativeMeta?.replayGainDb,
            });
          } else {
            const existingMatch = modifiedTracksToUpdate.find(m => m.path === p);
            if (existingMatch) {
              const { existingTrack } = existingMatch;
              updatedTrackMap.set(existingTrack.id, {
                ...existingTrack,
                title: finalTitle,
                artist: finalArtist,
                albumArtist: nativeMeta?.albumArtist?.trim() || existingTrack.albumArtist,
                album: finalAlbum,
                composer: nativeMeta?.composer?.trim() || existingTrack.composer,
                publisher: nativeMeta?.publisher?.trim() || existingTrack.publisher,
                lyrics: nativeMeta?.lyrics?.trim() || existingTrack.lyrics,
                genre: nativeMeta?.genre?.trim() || existingTrack.genre,
                duration: nativeMeta?.duration ? Math.round(nativeMeta.duration * 100) / 100 : existingTrack.duration,
                year: nativeMeta?.year ?? existingTrack.year,
                trackNumber: nativeMeta?.trackNumber ?? existingTrack.trackNumber,
                trackTotal: nativeMeta?.trackTotal ?? existingTrack.trackTotal,
                discNumber: nativeMeta?.discNumber ?? existingTrack.discNumber,
                discTotal: nativeMeta?.discTotal ?? existingTrack.discTotal,
                bpm: nativeMeta?.bpm ?? existingTrack.bpm,
                coverUrl: finalCoverUrl || existingTrack.coverUrl,
                audioUrl: audioUrl || existingTrack.audioUrl,
                format: nativeMeta?.format || existingTrack.format,
                bitrate: nativeMeta?.bitrate || existingTrack.bitrate,
                sampleRate: nativeMeta?.sampleRate || existingTrack.sampleRate,
                sizeBytes: nativeMeta?.sizeBytes || existingTrack.sizeBytes,
                replayGainDb: nativeMeta?.replayGainDb ?? existingTrack.replayGainDb,
              });
            }
          }
        }

        completed += chunk.length;
        setImportProgress({
          current: completed,
          total: totalToProcess,
          statusText: `Refreshing ${completed} of ${totalToProcess} tracks...`,
          phase: 'importing'
        });
        await new Promise(r => setTimeout(r, 10));
      }
    } else {
      // Non-macOS (Windows / Linux) original path remains completely untouched
      const { convertFileSrc } = await import('@tauri-apps/api/core');
      const CONCURRENCY = 8;

      // Process new tracks
      for (let i = 0; i < newPathsToImport.length; i += CONCURRENCY) {
        const chunk = newPathsToImport.slice(i, i + CONCURRENCY);
        const results = await Promise.all(
          chunk.map(async (path) => {
            try {
              const filename = path.split(/[/\\]/).pop() || 'song.mp3';
              const assetUrl = convertFileSrc(path);
              const res = await fetch(assetUrl);
              if (!res.ok) return null;
              const blob = await res.blob();
              const ext = filename.split('.').pop()?.toLowerCase() || '';
              const mimeType = ext === 'm4a' || ext === 'aac' || ext === 'mp4' ? 'audio/mp4' : 'audio/mpeg';
              const file = new File([blob], filename, { type: mimeType });
              Object.defineProperty(file, 'path', { value: path, writable: true, configurable: true, enumerable: true });
              return await parseAudioFile(file);
            } catch (e) {
              return null;
            }
          })
        );
        results.forEach(t => { if (t) newlyParsedList.push(t); });
        completed += chunk.length;
        setImportProgress({
          current: completed,
          total: totalToProcess,
          statusText: `Refreshing ${completed} of ${totalToProcess} tracks...`,
          phase: 'importing'
        });
      }

      // Process modified tracks
      for (let i = 0; i < modifiedTracksToUpdate.length; i += CONCURRENCY) {
        const chunk = modifiedTracksToUpdate.slice(i, i + CONCURRENCY);
        await Promise.all(
          chunk.map(async ({ path, existingTrack }) => {
            try {
              const filename = path.split(/[/\\]/).pop() || 'song.mp3';
              const assetUrl = convertFileSrc(path);
              const res = await fetch(assetUrl);
              if (!res.ok) return;
              const blob = await res.blob();
              const ext = filename.split('.').pop()?.toLowerCase() || '';
              const mimeType = ext === 'm4a' || ext === 'aac' || ext === 'mp4' ? 'audio/mp4' : 'audio/mpeg';
              const file = new File([blob], filename, { type: mimeType });
              Object.defineProperty(file, 'path', { value: path, writable: true, configurable: true, enumerable: true });
              const freshParsed = await parseAudioFile(file);
              const merged: Track = {
                ...freshParsed,
                id: existingTrack.id,
                rating: existingTrack.rating,
                playCount: existingTrack.playCount,
                lastPlayed: existingTrack.lastPlayed,
                dateAdded: existingTrack.dateAdded,
              };
              updatedTrackMap.set(existingTrack.id, merged);
            } catch (e) {}
          })
        );
        completed += chunk.length;
        setImportProgress({
          current: completed,
          total: totalToProcess,
          statusText: `Refreshing ${completed} of ${totalToProcess} tracks...`,
          phase: 'importing'
        });
      }
    }

    // Merge into tracks state
    setTracks(prev => {
      const map = new Map<string, Track>();
      prev.forEach(t => map.set(t.id, t));
      // Update modified
      updatedTrackMap.forEach((track, id) => {
        map.set(id, track);
      });
      // Add new
      newlyParsedList.forEach(t => {
        map.set(t.id, t);
      });
      const merged = Array.from(map.values());
      merged.sort((a, b) => (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base', numeric: true }));
      return merged;
    });

    setIsImportingFiles(false);
    setImportProgress(null);
  }, [appSettings.defaultMusicPath, tracks]);

  // Global Drag and Drop Event Handlers
  const handleDragOverApp = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer && e.dataTransfer.types) {
      const types = Array.from(e.dataTransfer.types);
      if (types.includes('application/classiplayer-tracks') || types.includes('application/classiplayer-playlist-id')) {
        return;
      }
      if (types.includes('Files')) {
        setIsDraggingOverApp(true);
      }
    }
  };

  const handleDragLeaveApp = (e: React.DragEvent) => {
    if (e.clientX === 0 || e.clientY === 0) {
      setIsDraggingOverApp(false);
    }
  };

  const handleDropApp = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOverApp(false);

    if (e.dataTransfer) {
      const types = Array.from(e.dataTransfer.types || []);
      if (types.includes('application/classiplayer-tracks') || types.includes('application/classiplayer-playlist-id')) {
        return;
      }

      // Show overlay INSTANTLY on drop before starting file system traversal
      flushSync(() => {
        setIsImportingFiles(true);
        setImportProgress({
          current: 0,
          total: 0,
          statusText: 'Scanning dropped folder & audio files...',
          phase: 'scanning'
        });
      });

      // Yield execution so React paints the overlay immediately
      await new Promise(r => setTimeout(r, 20));

      const files = await extractFilesFromDataTransfer(e.dataTransfer);
      if (files.length > 0) {
        await handleImportFiles(files);
      } else {
        setIsImportingFiles(false);
        setImportProgress(null);
      }
    }
  };

  // Rename Playlist
  const handleRenamePlaylist = (playlistId: string, newName: string) => {
    if (!newName.trim()) return;
    setPlaylists(prev => prev.map(p => p.id === playlistId ? { ...p, name: newName.trim() } : p));
  };

  return (
    <div 
      onDragOver={handleDragOverApp}
      onDragLeave={handleDragLeaveApp}
      onDrop={handleDropApp}
      onContextMenu={(e) => e.preventDefault()}
      className={`relative flex flex-col h-screen w-full overflow-hidden font-sans select-none transition-colors duration-200 ${
        theme === 'light' ? 'bg-white text-gray-900 light' : 'bg-[#121212] text-gray-100'
      }`}
    >
      {/* Top Header Bar */}
      <HeaderBar
        currentTrack={currentTrack}
        isPlaying={isPlaying}
        onTogglePlay={togglePlay}
        onNextTrack={handleNextTrack}
        onPrevTrack={handlePrevTrack}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        isShuffle={isShuffle}
        onToggleShuffle={() => setIsShuffle(!isShuffle)}
        repeatMode={repeatMode}
        onToggleRepeat={() => {
          if (repeatMode === 'off') setRepeatMode('all');
          else if (repeatMode === 'all') setRepeatMode('one');
          else setRepeatMode('off');
        }}
        onOpenEQ={() => setIsEQOpen(true)}
        onOpenVisualizer={() => setIsVisualizerOpen(true)}
        onUpdateRating={handleUpdateRating}
        theme={theme}
        onToggleTheme={toggleTheme}
        deviceSyncProgress={deviceSyncProgress}
        importProgress={importProgress}
        isImporting={isImportingFiles}
      />

      {/* Main Content Area: Sidebar + Active View */}
      <div className="flex-1 flex overflow-hidden relative">
        <div style={{ width: `${sidebarWidth}px` }} className="flex shrink-0 h-full relative">
          <Sidebar
            playlists={playlists}
            selectedPlaylistId={selectedDevice ? '' : selectedPlaylistId}
            onSelectPlaylist={(id) => {
              setSelectedDevice(null);
              setSelectedPlaylistId(id);
              if (id === 'lib_party_shuffle') {
                setPartyShuffleSeed(Date.now());
              }
            }}
            onCreatePlaylist={handleCreatePlaylist}
            onCreatePlaylistFolder={handleCreatePlaylistFolder}
            onCreatePlaylistInFolder={(pId) => handleCreatePlaylist(pId)}
            onCreateSmartPlaylistInFolder={(pId) => handleCreateSmartPlaylist(pId)}
            editingPlaylistId={editingPlaylistId}
            onSetEditingPlaylistId={setEditingPlaylistId}
            onToggleFolderCollapse={handleToggleFolderCollapse}
            onMovePlaylistToFolder={handleMovePlaylistToFolder}
            onCreateSmartPlaylist={() => handleCreateSmartPlaylist()}
            onEditSmartPlaylist={handleEditSmartPlaylist}
            onRenamePlaylist={handleRenamePlaylist}
            onDeletePlaylist={handleDeletePlaylist}
            onDropTracksToPlaylist={handleDropTracksToPlaylist}
            onReorderPlaylists={handleReorderPlaylists}
            onImportFiles={handleImportFiles}
            onStartImporting={handleStartImporting}
            trackCounts={trackCounts}
            currentTrack={currentTrack}
            isPlaying={isPlaying}
            onTogglePlay={togglePlay}
            onOpenGetInfo={handleOpenGetInfo}
            theme={theme}
            sidebarWidth={sidebarWidth}
            devices={connectedDevices}
            selectedDeviceId={selectedDevice?.id}
            onSelectDevice={(dev) => setSelectedDevice(dev)}
            onEjectDevice={handleEjectDevice}
            onDropTracksToDevice={handleDropTracksToDevice}
          />
          {/* Resize handle */}
          <div
            className="absolute top-0 right-0 w-1.5 h-full cursor-col-resize hover:bg-blue-500/50 transition-colors z-20"
            onMouseDown={() => setIsResizingSidebar(true)}
          />
        </div>

        {/* Main Content Area: Sidebar + Active View */}
        <main className={`flex-1 flex flex-col overflow-hidden relative transition-colors duration-200 ${
          theme === 'light' ? 'bg-white' : 'bg-[#121212]'
        }`}>
          {selectedDevice ? (
            <Suspense fallback={null}>
              <DeviceManagerView
                device={selectedDevice}
                tracks={tracks}
                playlists={playlists}
                currentTrack={currentTrack}
                isPlaying={isPlaying}
                onPlayTrack={playTrack}
                onTogglePlay={togglePlay}
                onOpenGetInfo={handleOpenGetInfo}
                onTrackContextMenu={handleTrackContextMenu}
                onAddTrackToPlaylist={handleAddTrackToPlaylist}
                onEjectDevice={handleEjectDevice}
                onRefreshDevices={refreshDevices}
                theme={theme}
                checkedTrackIds={checkedTrackIds}
                isCheckboxColumnVisible={visibleColumns.includes('checkbox')}
              />
            </Suspense>
          ) : (
            <>
              {viewMode === 'list' && (
                <ListView
                  tracks={displayTracks}
                  currentTrack={currentTrack}
                  isPlaying={isPlaying}
                  playlists={playlists}
                  onPlayTrack={playTrack}
                  onUpdateRating={handleUpdateRating}
                  onOpenGetInfo={handleOpenGetInfo}
                  onDeleteTrack={handleDeleteTrack}
                  onDeleteTracks={handleDeleteTracks}
                  onAddTrackToPlaylist={handleAddTrackToPlaylist}
                  onTrackContextMenu={handleTrackContextMenu}
                  onImportFiles={handleImportFiles}
                  onStartImporting={handleStartImporting}
                  theme={theme}
                  selectedTrackIds={selectedTrackIds}
                  onSelectionChange={handleSelectionChange}
                  searchQuery={searchQuery}
                  onClearSearch={handleClearSearch}
                  checkedTrackIds={checkedTrackIds}
                  onToggleCheckTrack={handleToggleCheckTrack}
                  onToggleCheckAll={handleToggleCheckAll}
                  visibleColumns={visibleColumns}
                  onVisibleColumnsChange={handleVisibleColumnsChange}
                  selectedPlaylist={playlists.find(p => p.id === selectedPlaylistId) || null}
                />
              )}

              {viewMode === 'grid' && (
                <AlbumGridView
                  albums={albums}
                  currentTrack={currentTrack}
                  isPlaying={isPlaying}
                  onPlayTrack={playTrack}
                  onUpdateRating={handleUpdateRating}
                  onOpenGetInfo={handleOpenGetInfo}
                  onTrackContextMenu={handleTrackContextMenu}
                  onBackgroundContextMenu={handleAlbumBackgroundContextMenu}
                  onImportFiles={handleImportFiles}
                  onStartImporting={handleStartImporting}
                  theme={theme}
                  searchQuery={searchQuery}
                  onClearSearch={handleClearSearch}
                  selectedTrackIds={selectedTrackIds}
                  onSelectionChange={handleSelectionChange}
                  albumSortField={albumSortField}
                  onAlbumSortChange={handleAlbumSortChange}
                  isAlbumGrouped={isAlbumGrouped}
                  onToggleAlbumGrouped={handleToggleAlbumGrouped}
                />
              )}
            </>
          )}
        </main>
      </div>

      {/* Right Click Context Menu */}
      <ContextMenu
        contextMenu={contextMenu}
        onClose={() => setContextMenu(null)}
        isPlaying={isPlaying}
        currentTrack={currentTrack}
        playlists={playlists}
        devices={connectedDevices}
        onImportToDevice={handleDropTracksToDevice}
        onPlayTrack={playTrack}
        onTogglePlay={togglePlay}
        onOpenGetInfo={handleOpenGetInfo}
        onUpdateRating={handleUpdateRating}
        onAddTrackToPlaylist={handleAddTrackToPlaylist}
        onCreatePlaylistWithTrack={handleCreatePlaylistWithTrack}
        onDeleteTrack={handleDeleteTrack}
        onDeleteTracks={handleDeleteTracks}
        selectedTrackIds={selectedTrackIds}
        tracks={displayTracks}
        theme={theme}
        isDeviceContext={!!selectedDevice}
        isAlbumView={viewMode === 'grid'}
        albumSortField={albumSortField}
        onAlbumSortChange={handleAlbumSortChange}
        isAlbumGrouped={isAlbumGrouped}
        onToggleAlbumGrouped={handleToggleAlbumGrouped}
        onPlayAllAlbums={() => {
          if (albums.length > 0 && albums[0].tracks.length > 0) {
            const allTracks = albums.flatMap(a => a.tracks);
            playTrack(allTracks[0], allTracks);
          }
        }}
        onShuffleAllAlbums={() => {
          if (albums.length > 0) {
            const allTracks = albums.flatMap(a => a.tracks);
            const shuffled = [...allTracks].sort(() => Math.random() - 0.5);
            if (shuffled.length > 0) {
              playTrack(shuffled[0], shuffled);
            }
          }
        }}
        onSelectAllAlbums={() => {
          if (viewMode === 'grid') {
            const allTrackIds = albums.flatMap(a => a.tracks.map(t => t.id));
            handleSelectionChange(allTrackIds);
          }
        }}
      />

      {/* Bottom Status Bar */}
      <StatusBar
        tracks={displayTracks}
        currentTrack={currentTrack}
        onOpenEQ={() => setIsEQOpen(true)}
        onOpenVisualizer={() => setIsVisualizerOpen(true)}
        onOpenAbout={() => setIsAboutOpen(true)}
        onOpenOptions={() => {
          setOptionsInitialTab('general');
          setIsOptionsOpen(true);
        }}
        isShuffle={isShuffle}
        onToggleShuffle={() => setIsShuffle(!isShuffle)}
        repeatMode={repeatMode}
        onToggleRepeat={() => {
          if (repeatMode === 'off') setRepeatMode('all');
          else if (repeatMode === 'all') setRepeatMode('one');
          else setRepeatMode('off');
        }}
        theme={theme}
      />

      {/* Global Drag & Drop Overlay */}
      {isDraggingOverApp && (
        <div className="absolute inset-0 z-50 bg-indigo-950/90 backdrop-blur-md flex flex-col items-center justify-center text-white p-8 pointer-events-none animate-in fade-in duration-150">
          <Upload className="w-16 h-16 mb-4 text-indigo-400 animate-bounce" />
          <h2 className="text-2xl font-bold tracking-tight">Drop Audio Files to Import into Library</h2>
          <p className="text-sm text-indigo-200 mt-2">Supports MP3, WAV, FLAC, M4A, AAC, OGG files</p>
        </div>
      )}

      {/* File Parsing Loading Overlay */}
      {isImportingFiles && (
        <div className="absolute inset-0 z-50 bg-black/80 backdrop-blur-md flex flex-col items-center justify-center text-white p-8 animate-in fade-in duration-150">
          <div className="relative mb-3">
            <Disc className="w-14 h-14 text-cyan-400 animate-spin" />
            <div className="absolute inset-0 rounded-full bg-cyan-400/20 blur-xl animate-pulse" />
          </div>
          <p className="text-base font-bold tracking-wide">
            {importProgress?.phase === 'importing'
              ? 'Importing Music to ClassiTunes...'
              : 'Scanning Your Music Library...'}
          </p>
          
          <div className="flex flex-col items-center mt-3 w-80">
            {importProgress?.phase === 'importing' ? (
              <>
                <div className="w-full bg-gray-800/80 h-2.5 rounded-full overflow-hidden border border-gray-700/80 shadow-inner">
                  <div 
                    className="bg-gradient-to-r from-cyan-500 to-blue-500 h-full transition-all duration-200 rounded-full"
                    style={{ width: `${Math.round((importProgress.current / importProgress.total) * 100)}%` }}
                  />
                </div>
                <p className="text-xs text-cyan-300 mt-2.5 font-mono font-medium text-center truncate max-w-full px-2">
                  {importProgress.statusText || `Processing ${importProgress.current} of ${importProgress.total} tracks (${Math.round((importProgress.current / importProgress.total) * 100)}%)`}
                </p>
              </>
            ) : (
              <>
                <div className="w-full bg-gray-800/80 h-2.5 rounded-full overflow-hidden border border-gray-700/80 relative">
                  <div className="bg-gradient-to-r from-cyan-500 via-blue-500 to-indigo-500 h-full w-1/2 rounded-full animate-shimmer" />
                </div>
                <p className="text-xs text-cyan-300 mt-2.5 font-mono font-medium text-center truncate max-w-full px-2 animate-pulse">
                  {importProgress?.statusText || 'Scanning directory for audio files...'}
                </p>
              </>
            )}
            <p className="text-[11px] text-gray-400 mt-2 text-center">
              {importProgress && importProgress.total > 0 
                ? 'Please wait while metadata and audio tags are indexed' 
                : 'Traversing folders and discovering music files...'}
            </p>
          </div>
        </div>
      )}

      {/* Dialog Modals (Lazy Loaded on demand with zero memory overhead when idle) */}
      <Suspense fallback={null}>
        {isEQOpen && (
          <EqualizerModal
            isOpen={isEQOpen}
            onClose={() => setIsEQOpen(false)}
          />
        )}

        {isVisualizerOpen && (
          <VisualizerModal
            isOpen={isVisualizerOpen}
            onClose={() => setIsVisualizerOpen(false)}
            trackTitle={currentTrack?.title}
            artistName={currentTrack?.artist}
          />
        )}

        {!!editingTracks && editingTracks.length > 0 && (
          <GetInfoModal
            track={editingTracks?.[0] || null}
            tracks={editingTracks}
            navigationTracks={getInfoNavTracks || displayTracks}
            isOpen={!!editingTracks && editingTracks.length > 0}
            onClose={() => {
              setEditingTracks(null);
              setGetInfoNavTracks(undefined);
            }}
            onSaveTrack={handleSaveTrack}
            onSaveTracks={handleSaveTracks}
            theme={theme}
          />
        )}

        {isSmartPlaylistOpen && (
          <SmartPlaylistModal
            isOpen={isSmartPlaylistOpen}
            onClose={() => setIsSmartPlaylistOpen(false)}
            onSave={handleSaveSmartPlaylist}
            initialPlaylist={editingSmartPlaylist}
          />
        )}

        {isAboutOpen && (
          <AboutModal
            isOpen={isAboutOpen}
            onClose={() => setIsAboutOpen(false)}
            theme={theme}
          />
        )}

        {isOptionsOpen && (
          <OptionsModal
            isOpen={isOptionsOpen}
            onClose={() => setIsOptionsOpen(false)}
            initialTab={optionsInitialTab}
            settings={appSettings}
            onSave={handleSaveSettings}
            theme={theme}
            trackCount={tracks.length}
            onScanMusic={handleScanMusic}
            onRefreshLibrary={handleRefreshLibrary}
            onResetLibrary={handleResetLibrary}
          />
        )}
      </Suspense>

      {deleteRequest && (
        <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => finishDeleteRequest('cancel')}>
          <div className={`w-full max-w-md rounded-xl border shadow-2xl p-5 ${theme === 'light' ? 'bg-white border-gray-300 text-gray-900' : 'bg-[#1c1c1c] border-[#3a3a3a] text-gray-100'}`} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2.5 pb-2 border-b border-black/10 dark:border-white/10">
              <div className="flex items-center gap-2">
                {isMac && (
                  <button
                    type="button"
                    onClick={() => finishDeleteRequest('cancel')}
                    className="w-3 h-3 rounded-full bg-[#ff5f56] border border-[#e0443e] hover:bg-[#ff3b30] flex items-center justify-center group cursor-pointer mr-1 shrink-0 transition-opacity"
                    title="Cancel"
                  >
                    <X className="w-2 h-2 text-black/70 opacity-0 group-hover:opacity-100" />
                  </button>
                )}
                <h3 className="text-sm font-semibold">Delete {deleteRequest.ids.length === 1 ? 'Song' : 'Songs'}</h3>
              </div>
              {!isMac && (
                <button
                  type="button"
                  onClick={() => finishDeleteRequest('cancel')}
                  className={`p-1 rounded transition-colors ${theme === 'light' ? 'hover:bg-gray-200 text-gray-500' : 'hover:bg-white/10 text-gray-400 hover:text-white'}`}
                  title="Cancel"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
            <p className={`text-xs leading-5 mb-4 ${theme === 'light' ? 'text-gray-600' : 'text-gray-400'}`}>
              What would you like to delete? You can remove the {deleteRequest.ids.length === 1 ? 'song' : 'songs'} from the ClassiTunes library only, or delete the physical file{deleteRequest.ids.length === 1 ? '' : 's'} as well.
            </p>
            <div className="flex flex-col gap-2">
              <button onClick={() => finishDeleteRequest('library')} className="px-3 py-2 rounded-md text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white">Remove from Library Only</button>
              <button onClick={() => finishDeleteRequest('file')} className="px-3 py-2 rounded-md text-xs font-medium bg-red-600 hover:bg-red-500 text-white">Delete Library Entry and File</button>
              <button onClick={() => finishDeleteRequest('cancel')} className={`px-3 py-2 rounded-md text-xs font-medium border ${theme === 'light' ? 'border-gray-300 hover:bg-gray-100' : 'border-[#444] hover:bg-[#2a2a2a]'}`}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

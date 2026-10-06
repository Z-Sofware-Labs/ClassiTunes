// IndexedDB storage service to persist imported audio files, album artwork, and track metadata across restarts
import { readTauriMusicMetadata } from '../utils/tauriWindow';

const DB_NAME = 'classitunes_media_db';
const DB_VERSION = 3;
const STORE_NAME = 'media_files';
const METADATA_STORE = 'track_metadata';
const PLAYBACK_METADATA_STORE = 'playback_metadata';
const ARTWORK_CACHE_LIMIT = 48;

export function dataURLtoBlob(dataurl: string): Blob | null {
  try {
    const arr = dataurl.split(',');
    if (arr.length < 2) return null;
    const mimeMatch = arr[0].match(/:(.*?);/);
    const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    return new Blob([u8arr], { type: mime });
  } catch (e) {
    return null;
  }
}

let dbPromise: Promise<IDBDatabase> | null = null;

function getDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      dbPromise = null;
      reject(new Error('IndexedDB not supported'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
      if (!db.objectStoreNames.contains(METADATA_STORE)) {
        db.createObjectStore(METADATA_STORE);
      }
      if (!db.objectStoreNames.contains(PLAYBACK_METADATA_STORE)) {
        db.createObjectStore(PLAYBACK_METADATA_STORE, { keyPath: 'trackId' });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      db.onclose = () => {
        dbPromise = null;
      };
      db.onerror = () => {
        dbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () => {
      dbPromise = null;
      reject(request.error);
    };
    request.onblocked = () => {
      dbPromise = null;
      console.warn('[mediaStorage] IndexedDB upgrade blocked by another connection');
    };
  });

  return dbPromise;
}

export async function saveMediaFile(key: string, blob: Blob): Promise<void> {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(blob, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.warn('Failed to save media blob to IndexedDB:', e);
  }
}

export async function getMediaFile(key: string): Promise<Blob | null> {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    return null;
  }
}

export async function deleteMediaFile(key: string): Promise<void> {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {}
}

export async function clearAllMediaStorage(): Promise<void> {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_NAME, METADATA_STORE, PLAYBACK_METADATA_STORE], 'readwrite');
      tx.objectStore(STORE_NAME).clear();
      tx.objectStore(METADATA_STORE).clear();
      tx.objectStore(PLAYBACK_METADATA_STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.warn('Failed to clear IndexedDB media storage:', e);
  }
}

export async function saveTracksMetadata(tracks: any[]): Promise<void> {
  try {
    const db = await getDB();
    const lightweightTracks = tracks.map((t) => {
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

    return new Promise((resolve, reject) => {
      const tx = db.transaction(METADATA_STORE, 'readwrite');
      tx.objectStore(METADATA_STORE).put(lightweightTracks, 'user_tracks');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.warn('Failed to save tracks metadata to IndexedDB:', e);
  }
}

export async function getTracksMetadata(): Promise<any[]> {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(METADATA_STORE, 'readonly');
      const req = tx.objectStore(METADATA_STORE).get('user_tracks');
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    return [];
  }
}

export async function savePlaybackMetadata(trackId: string, metadata: { playCount?: number; lastPlayed?: string | null }): Promise<void> {
  if (!trackId) return;
  try {
    const db = await getDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(PLAYBACK_METADATA_STORE, 'readwrite');
      const record = {
        trackId,
        playCount: metadata.playCount ?? 0,
        lastPlayed: metadata.lastPlayed ?? null,
      };
      tx.objectStore(PLAYBACK_METADATA_STORE).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.warn('Failed to save playback metadata:', e);
  }
}

export async function getPlaybackMetadata(trackId: string): Promise<{ trackId: string; playCount: number; lastPlayed: string | null } | null> {
  if (!trackId) return null;
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(PLAYBACK_METADATA_STORE, 'readonly');
      const req = tx.objectStore(PLAYBACK_METADATA_STORE).get(trackId);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    return null;
  }
}

export async function getAllPlaybackMetadata(): Promise<Map<string, { playCount?: number; lastPlayed?: Date }>> {
  try {
    const db = await getDB();
    const records = await new Promise<any[]>((resolve, reject) => {
      const tx = db.transaction(PLAYBACK_METADATA_STORE, 'readonly');
      const req = tx.objectStore(PLAYBACK_METADATA_STORE).getAll();
      req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
      req.onerror = () => reject(req.error);
    });

    const map = new Map<string, { playCount?: number; lastPlayed?: Date }>();
    for (const record of records) {
      if (!record || !record.trackId) continue;
      const lastPlayed = record.lastPlayed ? new Date(record.lastPlayed) : undefined;
      map.set(record.trackId, {
        playCount: typeof record.playCount === 'number' ? record.playCount : undefined,
        lastPlayed: Number.isNaN(lastPlayed?.getTime()) ? undefined : lastPlayed,
      });
    }
    return map;
  } catch (e) {
    return new Map();
  }
}

export async function deletePlaybackMetadata(trackId: string): Promise<void> {
  if (!trackId) return;
  try {
    const db = await getDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(PLAYBACK_METADATA_STORE, 'readwrite');
      tx.objectStore(PLAYBACK_METADATA_STORE).delete(trackId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.warn('Failed to delete playback metadata:', e);
  }
}

// Global fast in-memory artwork cache (albumKey/trackId -> objectUrl) plus resource-lifetime tracking.
const globalArtworkCache = new Map<string, string>();
const artworkResourceCache = new Map<string, { url: string; refs: Set<string>; owned: boolean }>();
const artworkAliasMap = new Map<string, string>();

function evictArtworkResourcesIfNeeded(): void {
  while (artworkResourceCache.size > ARTWORK_CACHE_LIMIT) {
    const oldestKey = artworkResourceCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    const entry = artworkResourceCache.get(oldestKey);
    if (entry) {
      for (const alias of [...entry.refs]) {
        globalArtworkCache.delete(alias);
        artworkAliasMap.delete(alias);
      }
      if (entry.owned && entry.url.startsWith('blob:')) {
        try { URL.revokeObjectURL(entry.url); } catch {}
      }
      artworkResourceCache.delete(oldestKey);
    }
  }
}

function registerArtworkReference(aliasKey: string, url: string, owned = false): string {
  if (!aliasKey || !url) return aliasKey;

  const existingAliasResource = artworkAliasMap.get(aliasKey);
  if (existingAliasResource && artworkResourceCache.has(existingAliasResource)) {
    const existingResource = artworkResourceCache.get(existingAliasResource)!;
    if (existingResource.url === url) {
      existingResource.refs.add(aliasKey);
      existingResource.owned = existingResource.owned || owned;
      globalArtworkCache.set(aliasKey, url);
      return existingAliasResource;
    }

    existingResource.refs.delete(aliasKey);
    if (existingResource.refs.size === 0) {
      if (existingResource.owned && existingResource.url.startsWith('blob:')) {
        try { URL.revokeObjectURL(existingResource.url); } catch {}
      }
      artworkResourceCache.delete(existingAliasResource);
    }
  }

  const resourceKey = url;
  const existingResource = artworkResourceCache.get(resourceKey) || { url, refs: new Set<string>(), owned };
  existingResource.url = url;
  existingResource.owned = existingResource.owned || owned;
  existingResource.refs.add(aliasKey);
  artworkResourceCache.set(resourceKey, existingResource);
  artworkAliasMap.set(aliasKey, resourceKey);
  globalArtworkCache.set(aliasKey, url);
  evictArtworkResourcesIfNeeded();
  return resourceKey;
}

export function getCachedArtwork(albumOrTrackKey: string): string | undefined {
  return globalArtworkCache.get(albumOrTrackKey);
}

export function setCachedArtwork(albumOrTrackKey: string, url: string): void {
  if (albumOrTrackKey && url) {
    registerArtworkReference(albumOrTrackKey, url);
  }
}

function createCachedArtworkUrl(trackId: string, blob: Blob): string {
  const objectUrl = URL.createObjectURL(blob);
  registerArtworkReference(trackId, objectUrl, true);
  return objectUrl;
}

export function clearCachedArtwork(key?: string): void {
  if (key) {
    const resourceKey = artworkAliasMap.get(key) || key;
    const resource = artworkResourceCache.get(resourceKey);

    globalArtworkCache.delete(key);
    artworkAliasMap.delete(key);

    if (resource) {
      resource.refs.delete(key);
      if (resource.refs.size === 0) {
        if (resource.owned && resource.url.startsWith('blob:')) {
          try { URL.revokeObjectURL(resource.url); } catch {}
        }
        artworkResourceCache.delete(resourceKey);
      }
    } else if (resourceKey.startsWith('blob:')) {
      try { URL.revokeObjectURL(resourceKey); } catch {}
    }
    return;
  }

  for (const [alias, resourceKey] of [...artworkAliasMap.entries()]) {
    globalArtworkCache.delete(alias);
    artworkAliasMap.delete(alias);
    const resource = artworkResourceCache.get(resourceKey);
    if (resource) {
      resource.refs.delete(alias);
      if (resource.refs.size === 0) {
        if (resource.owned && resource.url.startsWith('blob:')) {
          try { URL.revokeObjectURL(resource.url); } catch {}
        }
        artworkResourceCache.delete(resourceKey);
      }
    }
  }
  artworkAliasMap.clear();
  globalArtworkCache.clear();
}

export async function getArtwork(trackId: string, candidateUrl?: string, filePath?: string): Promise<string | undefined> {
  if (!trackId) return undefined;
  const cached = getCachedArtwork(trackId);
  if (cached && !cached.startsWith('blob:')) return cached;
  if (cached?.startsWith('blob:')) {
    const cachedResource = artworkResourceCache.get(artworkAliasMap.get(trackId) || cached);
    if (cachedResource?.owned) return cached;
    try {
      const response = await fetch(cached);
      if (!response.ok) throw new Error(`Artwork URL returned ${response.status}`);
      const blob = await response.blob();
      await saveMediaFile(`cover_${trackId}`, blob);
      return createCachedArtworkUrl(trackId, blob);
    } catch {
      clearCachedArtwork(trackId);
    }
  }

  if (candidateUrl && candidateUrl.startsWith('blob:')) {
    try {
      const response = await fetch(candidateUrl);
      if (!response.ok) throw new Error(`Artwork URL returned ${response.status}`);
      const blob = await response.blob();
      await saveMediaFile(`cover_${trackId}`, blob);
      return createCachedArtworkUrl(trackId, blob);
    } catch {
      // Continue with persisted artwork and native metadata fallbacks.
    }
  }

  if (candidateUrl && candidateUrl.startsWith('data:image/')) {
    let blob = dataURLtoBlob(candidateUrl);
    if (!blob) {
      try {
        const commaIndex = candidateUrl.indexOf(',');
        if (commaIndex !== -1) {
          const header = candidateUrl.slice(0, commaIndex);
          const mime = header.slice(5).split(';')[0] || 'image/svg+xml';
          const payload = candidateUrl.slice(commaIndex + 1);
          const decoded = header.includes(';base64')
            ? atob(payload)
            : decodeURIComponent(payload);
          const bytes = header.includes(';base64')
            ? Uint8Array.from(decoded, char => char.charCodeAt(0))
            : new TextEncoder().encode(decoded);
          blob = new Blob([bytes], { type: mime });
        }
      } catch {
        blob = null;
      }
    }
    if (blob) {
      await saveMediaFile(`cover_${trackId}`, blob);
      return createCachedArtworkUrl(trackId, blob);
    }
  }

  const coverBlob = await getMediaFile(`cover_${trackId}`);
  if (coverBlob) {
    return createCachedArtworkUrl(trackId, coverBlob);
  }

  if (filePath) {
    try {
      const metadata = await readTauriMusicMetadata(filePath);
      if (metadata?.coverUrl) {
        return getArtwork(trackId, metadata.coverUrl);
      }
    } catch (error) {
      console.warn('Failed to load artwork from native track metadata:', error);
    }
  }

  if (candidateUrl && (candidateUrl.startsWith('http://') || candidateUrl.startsWith('https://') || candidateUrl.startsWith('file://'))) {
    setCachedArtwork(trackId, candidateUrl);
    return candidateUrl;
  }

  return undefined;
}

export async function hydrateTrackMedia(track: any): Promise<any> {
  // Demo or sample tracks don't need IndexedDB rehydration
  if (track.id.startsWith('demo_') || track.id.startsWith('sample_')) {
    return track;
  }

  const updatedTrack = { ...track };
  const isTauri = typeof window !== 'undefined' && !!((window as any).__TAURI__ || (window as any).__TAURI_INTERNALS__ || (window as any).__TAURI_METADATA__);

  if (isTauri && track.filePath) {
    try {
      const { convertFileSrc } = await import('@tauri-apps/api/core');
      updatedTrack.audioUrl = convertFileSrc(track.filePath);
    } catch (e) {
      console.error('Failed to convert file path in hydrateTrackMedia:', e);
    }
  } else {
    // 1. Rehydrate audio file
    const audioBlob = await getMediaFile(`audio_${track.id}`);
    if (audioBlob) {
      updatedTrack.audioUrl = URL.createObjectURL(audioBlob);
      updatedTrack.file = new File([audioBlob], (track.title || 'track') + '.mp3', { type: track.format || 'audio/mpeg' });
    } else if (track.file instanceof File) {
      updatedTrack.audioUrl = URL.createObjectURL(track.file);
      saveMediaFile(`audio_${track.id}`, track.file);
    }
  }

  // 2. Rehydrate artwork (check in-memory cache first for instantaneous return)
  const albumKey = (track.album || '').trim().toLowerCase();
  if (globalArtworkCache.has(track.id)) {
    updatedTrack.coverUrl = globalArtworkCache.get(track.id);
  } else if (albumKey && globalArtworkCache.has(albumKey)) {
    updatedTrack.coverUrl = globalArtworkCache.get(albumKey);
  } else {
    const coverBlob = await getMediaFile(`cover_${track.id}`);
    if (coverBlob) {
      updatedTrack.coverUrl = URL.createObjectURL(coverBlob);
    } else if (updatedTrack.coverUrl && updatedTrack.coverUrl.startsWith('data:')) {
      const b = dataURLtoBlob(updatedTrack.coverUrl);
      if (b) {
        saveMediaFile(`cover_${track.id}`, b);
        updatedTrack.coverUrl = URL.createObjectURL(b);
      }
    } else if ((!updatedTrack.coverUrl || !updatedTrack.coverUrl.startsWith('blob:')) && isTauri && track.filePath) {
      try {
        const meta = await readTauriMusicMetadata(track.filePath);
        if (meta?.coverUrl) {
          if (meta.coverUrl.startsWith('data:')) {
            const b = dataURLtoBlob(meta.coverUrl);
            if (b) {
              saveMediaFile(`cover_${track.id}`, b);
              updatedTrack.coverUrl = URL.createObjectURL(b);
            } else {
              updatedTrack.coverUrl = meta.coverUrl;
            }
          } else {
            updatedTrack.coverUrl = meta.coverUrl;
          }
        }
      } catch (e) {}
    }

    if (updatedTrack.coverUrl) {
      setCachedArtwork(track.id, updatedTrack.coverUrl);
      if (albumKey) {
        setCachedArtwork(albumKey, updatedTrack.coverUrl);
      }
    }
  }

  return updatedTrack;
}

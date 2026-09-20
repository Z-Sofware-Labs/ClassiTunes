// IndexedDB storage service to persist imported audio files, album artwork, and track metadata across restarts

const DB_NAME = 'classitunes_media_db';
const DB_VERSION = 2;
const STORE_NAME = 'media_files';
const METADATA_STORE = 'track_metadata';

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

function getDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB not supported'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
      if (!db.objectStoreNames.contains(METADATA_STORE)) {
        db.createObjectStore(METADATA_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
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
      const tx = db.transaction([STORE_NAME, METADATA_STORE], 'readwrite');
      tx.objectStore(STORE_NAME).clear();
      tx.objectStore(METADATA_STORE).clear();
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

// Global fast in-memory artwork cache (albumKey/trackId -> objectUrl/dataUrl)
const globalArtworkCache = new Map<string, string>();

export function getCachedArtwork(albumOrTrackKey: string): string | undefined {
  return globalArtworkCache.get(albumOrTrackKey);
}

export function setCachedArtwork(albumOrTrackKey: string, url: string): void {
  if (albumOrTrackKey && url) {
    globalArtworkCache.set(albumOrTrackKey, url);
  }
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
        const { readTauriMusicMetadata } = await import('../utils/tauriWindow');
        const meta = await readTauriMusicMetadata(track.filePath);
        if (meta?.coverUrl) {
          updatedTrack.coverUrl = meta.coverUrl;
          if (meta.coverUrl.startsWith('data:')) {
            const b = dataURLtoBlob(meta.coverUrl);
            if (b) {
              saveMediaFile(`cover_${track.id}`, b);
              updatedTrack.coverUrl = URL.createObjectURL(b);
            }
          }
        }
      } catch (e) {}
    }

    if (updatedTrack.coverUrl) {
      globalArtworkCache.set(track.id, updatedTrack.coverUrl);
      if (albumKey) {
        globalArtworkCache.set(albumKey, updatedTrack.coverUrl);
      }
    }
  }

  return updatedTrack;
}

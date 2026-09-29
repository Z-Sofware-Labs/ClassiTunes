export type ViewMode = 'list' | 'grid';

export interface Track {
  id: string;
  title: string;
  artist: string;
  album: string;
  genre: string;
  duration: number; // in seconds
  year?: number;
  trackNumber?: number;
  trackTotal?: number;
  discNumber?: number;
  discTotal?: number;
  composer?: string;
  albumArtist?: string;
  publisher?: string;
  lyrics?: string;
  replayGainDb?: number;
  comments?: string;
  rating: number; // 0 to 5
  playCount: number;
  lastPlayed?: Date;
  coverUrl?: string; // Data URL or URL
  audioUrl: string; // Blob URL or external URL
  file?: File;
  format?: string;
  bpm?: number;
  mediaKind?: 'Music' | 'Podcast' | 'Audiobook' | 'Voice Memo' | string;
  bitrate?: number;
  sampleRate?: number;
  sizeBytes?: number;
  dateAdded: string; // ISO string
  filePath?: string;
}

export interface Album {
  id: string;
  name: string;
  artist: string;
  year?: number;
  coverUrl?: string;
  tracks: Track[];
}

export interface SmartRule {
  id: string;
  field: 'title' | 'artist' | 'album' | 'genre' | 'rating' | 'playCount' | 'year' | 'mediaKind' | 'bpm' | 'format';
  operator: 'contains' | 'is' | 'greater_than' | 'less_than' | 'starts_with';
  value: string;
}

export interface Playlist {
  id: string;
  name: string;
  isSmart?: boolean;
  matchType?: 'all' | 'any';
  rules?: SmartRule[];
  limit?: number;
  systemType?: 'all' | 'recently_added' | 'top_rated' | 'party_shuffle' | 'genre' | 'user';
  genreFilter?: string;
  trackIds: string[];
  icon?: string;
}

export interface EqualizerBands {
  b32: number;
  b64: number;
  b125: number;
  b250: number;
  b500: number;
  b1k: number;
  b2k: number;
  b4k: number;
  b8k: number;
  b16k: number;
}

export type EQPreset = 
  | 'Flat'
  | 'Acoustic'
  | 'Bass Booster'
  | 'Bass Reducer'
  | 'Classical'
  | 'Dance'
  | 'Deep'
  | 'Electronic'
  | 'Hip-Hop'
  | 'Jazz'
  | 'Latin'
  | 'Loudness'
  | 'Pop'
  | 'Rock'
  | 'Small Speakers'
  | 'Spoken Word'
  | 'Treble Booster';

export type VisualizerMode = 'classic_bars' | 'laser_wave' | 'frequency_ring' | 'cosmic_particles';

declare global {
  interface Window {
    electronAPI?: {
      platform: string;
      isElectron: boolean;
      minimize: () => void;
      maximize: () => void;
      close: () => void;
      isMaximized: () => Promise<boolean>;
      showItemInFolder?: (filePath: string) => void;
    };
  }
}

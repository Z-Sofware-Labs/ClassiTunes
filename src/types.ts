export type ViewMode = 'list' | 'grid';
export type AlbumSortField = 'album' | 'artist' | 'genre' | 'year';

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
  isChecked?: boolean;
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
  isFolder?: boolean;
  parentId?: string;
  collapsed?: boolean;
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

export type ThemePreference = 'system' | 'dark' | 'light';

export type TranscodeFormat = 'MP3' | 'AAC' | 'WAV';
export type TranscodeBitrate = '128' | '192' | '256' | '320';

export type OptionsTab = 'general' | 'playback' | 'transcode' | 'appearance' | 'updates';

export interface AppSettings {
  defaultMusicPath: string;
  organizeMusicFolders: boolean;
  crossfadeEnabled: boolean;
  crossfadeSeconds: number;
  audioNormalization: boolean;
  keepAwakeDuringPlayback: boolean;
  defaultTheme: ThemePreference;
  disableTransparency: boolean;
  transcodeOnSync: boolean;
  transcodeFormat: TranscodeFormat;
  transcodeBitrate: TranscodeBitrate;
  transcodeDownmixMono: boolean;
  transcodeDownsample44k: boolean;
  scaleArtwork500: boolean;
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  defaultMusicPath: '',
  organizeMusicFolders: false,
  crossfadeEnabled: false,
  crossfadeSeconds: 5,
  audioNormalization: false,
  keepAwakeDuringPlayback: false,
  defaultTheme: 'system',
  disableTransparency: false,
  transcodeOnSync: false,
  transcodeFormat: 'MP3',
  transcodeBitrate: '256',
  transcodeDownmixMono: false,
  transcodeDownsample44k: true,
  scaleArtwork500: true,
};


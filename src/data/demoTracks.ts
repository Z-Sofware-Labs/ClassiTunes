import { Track, Playlist } from '../types';
import { createSynthesizedSong } from '../services/synthAudio';
import { generateAlbumArtwork } from '../utils/artworkGenerator';

export const INITIAL_TRACKS: Track[] = [];

export const INITIAL_PLAYLISTS: Playlist[] = [
  {
    id: 'lib_music',
    name: 'Music',
    systemType: 'all',
    trackIds: [],
    icon: 'Music',
  },
  {
    id: 'lib_recently_added',
    name: 'Recently Added',
    systemType: 'recently_added',
    trackIds: [],
    icon: 'Clock',
  },
  {
    id: 'lib_top_rated',
    name: 'Top Rated',
    systemType: 'top_rated',
    trackIds: [],
    icon: 'Star',
  },
  {
    id: 'lib_party_shuffle',
    name: 'Party Shuffle',
    systemType: 'party_shuffle',
    trackIds: [],
    icon: 'Shuffle',
  },
];



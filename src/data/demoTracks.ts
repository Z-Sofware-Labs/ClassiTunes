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
    id: 'smart_recently_played',
    name: 'Recently Played',
    isSmart: true,
    matchType: 'all',
    rules: [
      { id: 'rp_rule_1', field: 'lastPlayed', operator: 'greater_than', value: '14' }
    ],
    sortBy: 'lastPlayed',
    sortOrder: 'desc',
    trackIds: [],
  },
  {
    id: 'smart_top_25_most_played',
    name: 'Top 25 Most Played',
    isSmart: true,
    matchType: 'all',
    rules: [
      { id: 'top25_rule_1', field: 'playCount', operator: 'greater_than', value: '0' }
    ],
    limit: 25,
    sortBy: 'playCount',
    sortOrder: 'desc',
    trackIds: [],
  },
  {
    id: 'smart_80s_music',
    name: "80's Music",
    isSmart: true,
    matchType: 'all',
    rules: [
      { id: '80s_rule_1', field: 'year', operator: 'greater_than', value: '1979' },
      { id: '80s_rule_2', field: 'year', operator: 'less_than', value: '1990' }
    ],
    trackIds: [],
  },
  {
    id: 'smart_90s_music',
    name: "90's Music",
    isSmart: true,
    matchType: 'all',
    rules: [
      { id: '90s_rule_1', field: 'year', operator: 'greater_than', value: '1989' },
      { id: '90s_rule_2', field: 'year', operator: 'less_than', value: '2000' }
    ],
    trackIds: [],
  },
  {
    id: 'lib_party_shuffle',
    name: 'Party Shuffle',
    systemType: 'party_shuffle',
    trackIds: [],
    icon: 'Shuffle',
  },
];



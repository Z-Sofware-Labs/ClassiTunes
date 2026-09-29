import { Track, SmartRule, Playlist } from '../types';

export function matchesSmartRule(track: Track, rule: SmartRule): boolean {
  if (!rule || !rule.field) return true;

  let fieldValue: string | number = '';
  if (rule.field === 'title') fieldValue = track.title || '';
  else if (rule.field === 'artist') fieldValue = track.artist || '';
  else if (rule.field === 'album') fieldValue = track.album || '';
  else if (rule.field === 'genre') fieldValue = track.genre || '';
  else if (rule.field === 'rating') fieldValue = track.rating || 0;
  else if (rule.field === 'playCount') fieldValue = track.playCount || 0;
  else if (rule.field === 'year') fieldValue = track.year || 0;
  else if (rule.field === 'mediaKind') fieldValue = track.mediaKind || 'Music';
  else if (rule.field === 'bpm') fieldValue = track.bpm || 0;
  else if (rule.field === 'format') fieldValue = track.format || (track.audioUrl?.split('.').pop() || 'MP3');

  const targetVal = rule.value ? rule.value.trim().toLowerCase() : '';

  if (rule.field === 'rating' || rule.field === 'playCount' || rule.field === 'year' || rule.field === 'bpm') {
    const numField = typeof fieldValue === 'number' ? fieldValue : Number(fieldValue) || 0;
    const numTarget = Number(targetVal) || 0;

    if (rule.operator === 'is') return numField === numTarget;
    if (rule.operator === 'greater_than') return numField > numTarget;
    if (rule.operator === 'less_than') return numField < numTarget;
    return numField === numTarget;
  } else {
    const strField = String(fieldValue).toLowerCase();
    if (rule.operator === 'contains') return strField.includes(targetVal);
    if (rule.operator === 'is') return strField === targetVal;
    if (rule.operator === 'starts_with') return strField.startsWith(targetVal);
    return strField.includes(targetVal);
  }
}

export function evaluateSmartPlaylist(playlist: Playlist, allTracks: Track[]): Track[] {
  if (!playlist.isSmart) {
    return allTracks.filter(t => playlist.trackIds.includes(t.id));
  }

  const rules = playlist.rules || [];
  if (rules.length === 0) return allTracks;

  const matchType = playlist.matchType || 'all';

  let filtered = allTracks.filter(track => {
    if (matchType === 'any') {
      return rules.some(rule => matchesSmartRule(track, rule));
    } else {
      return rules.every(rule => matchesSmartRule(track, rule));
    }
  });

  if (playlist.limit && playlist.limit > 0) {
    filtered = filtered.slice(0, playlist.limit);
  }

  return filtered;
}

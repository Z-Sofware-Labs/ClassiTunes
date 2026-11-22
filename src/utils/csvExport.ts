import { Track } from '../types';
import { ColumnId } from '../components/ListView';
import { isTauri } from './tauriWindow';

// Column metadata for display labels and cell extractors
const COLUMN_DEFS: Record<ColumnId, { label: string; getValue: (t: Track, idx: number) => string | number }> = {
  checkbox: {
    label: 'Checked',
    getValue: (t) => (t.isChecked !== false ? 'Yes' : 'No'),
  },
  trackNumber: {
    label: 'Track Number',
    getValue: (t, idx) => (t.trackNumber !== undefined && t.trackNumber !== null ? t.trackNumber : idx + 1),
  },
  title: {
    label: 'Name',
    getValue: (t) => t.title || '',
  },
  duration: {
    label: 'Time',
    getValue: (t) => {
      const s = Math.round(t.duration || 0);
      const m = Math.floor(s / 60);
      const rem = s % 60;
      return `${m}:${rem.toString().padStart(2, '0')}`;
    },
  },
  artist: {
    label: 'Artist',
    getValue: (t) => t.artist || '',
  },
  album: {
    label: 'Album',
    getValue: (t) => t.album || '',
  },
  genre: {
    label: 'Genre',
    getValue: (t) => t.genre || '',
  },
  rating: {
    label: 'Rating',
    getValue: (t) => t.rating || 0,
  },
  playCount: {
    label: 'Plays',
    getValue: (t) => t.playCount || 0,
  },
  year: {
    label: 'Year',
    getValue: (t) => t.year || '',
  },
  bitrate: {
    label: 'Bit Rate',
    getValue: (t) => (t.bitrate ? `${t.bitrate} kbps` : ''),
  },
  sampleRate: {
    label: 'Sample Rate',
    getValue: (t) => (t.sampleRate ? `${t.sampleRate} Hz` : ''),
  },
  dateAdded: {
    label: 'Date Added',
    getValue: (t) => {
      if (!t.dateAdded) return '';
      const d = new Date(t.dateAdded);
      return isNaN(d.getTime()) ? '' : d.toLocaleDateString();
    },
  },
  format: {
    label: 'Kind',
    getValue: (t) => t.format || 'audio/mpeg',
  },
};

function escapeCsvCell(val: string | number): string {
  const str = String(val ?? '');
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function generatePlaylistCsv(tracks: Track[], visibleColumns: ColumnId[]): string {
  const activeCols = visibleColumns.filter((col) => col in COLUMN_DEFS);
  const header = activeCols.map((col) => escapeCsvCell(COLUMN_DEFS[col].label)).join(',');
  const rows = tracks.map((track, idx) =>
    activeCols.map((col) => escapeCsvCell(COLUMN_DEFS[col].getValue(track, idx))).join(',')
  );
  // UTF-8 BOM (\uFEFF) ensures Excel and text editors across Windows, macOS, and Linux display UTF-8 characters correctly
  return '\uFEFF' + [header, ...rows].join('\r\n');
}

export async function exportPlaylistToDesktopCsv(
  playlistName: string,
  tracks: Track[],
  visibleColumns: ColumnId[]
): Promise<{ success: boolean; filePath?: string; error?: string }> {
  try {
    const csvContent = generatePlaylistCsv(tracks, visibleColumns);
    const sanitizedName = (playlistName || 'Playlist').replace(/[<>:"/\\|?*]/g, '_').trim();
    const fileName = `${sanitizedName}.csv`;

    if (isTauri()) {
      const { desktopDir, join } = await import('@tauri-apps/api/path');
      const { writeTextFile } = await import('@tauri-apps/plugin-fs');

      const desktopPath = await desktopDir();
      const targetFilePath = await join(desktopPath, fileName);
      await writeTextFile(targetFilePath, csvContent);
      return { success: true, filePath: targetFilePath };
    } else {
      // Browser fallback (downloads to user's system)
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', fileName);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      return { success: true, filePath: fileName };
    }
  } catch (err: any) {
    console.error('Failed to export CSV:', err);
    return { success: false, error: err?.message || String(err) };
  }
}

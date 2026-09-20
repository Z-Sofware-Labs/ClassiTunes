import React, { useState, useEffect, useCallback } from 'react';
import { X, Info, Image as ImageIcon, FileText, Sparkles, RefreshCw, CheckCircle2, Music, Tag, Disc, AlertCircle } from 'lucide-react';
import { Track } from '../types';
import { extractID3TagsFromTrack, ExtractedID3Tags } from '../services/metadataParser';

type EditableTrack = Track & { artworkDataUrl?: string; artworkRemoved?: boolean };

export interface GetInfoModalProps {
  track?: Track | null;
  tracks?: Track[] | null;
  isOpen: boolean;
  onClose: () => void;
  onSaveTrack: (updatedTrack: EditableTrack) => void | Promise<void>;
  onSaveTracks?: (updatedTracks: EditableTrack[]) => void | Promise<void>;
  theme?: 'dark' | 'light';
}

export const GetInfoModal: React.FC<GetInfoModalProps> = ({
  track,
  tracks,
  isOpen,
  onClose,
  onSaveTrack,
  onSaveTracks,
  theme = 'dark',
}) => {
  const isLight = theme === 'light';
  const isMac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().indexOf('MAC') >= 0;

  const activeTracks = React.useMemo(() => {
    if (tracks && tracks.length > 0) return tracks;
    if (track) return [track];
    return [];
  }, [tracks, track]);

  const isMulti = activeTracks.length > 1;

  const [activeTab, setActiveTab] = useState<'info' | 'lyrics' | 'summary' | 'artwork'>('info');

  // Metadata form states
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [albumArtist, setAlbumArtist] = useState('');
  const [album, setAlbum] = useState('');
  const [composer, setComposer] = useState('');
  const [publisher, setPublisher] = useState('');
  const [lyrics, setLyrics] = useState('');
  const [genre, setGenre] = useState('');
  const [mediaKind, setMediaKind] = useState('Music');
  const [bpm, setBpm] = useState<string>('');
  const [format, setFormat] = useState('');
  const [year, setYear] = useState<string>('');
  const [trackNumber, setTrackNumber] = useState<string>('');
  const [trackTotal, setTrackTotal] = useState<string>('');
  const [discNumber, setDiscNumber] = useState<string>('');
  const [discTotal, setDiscTotal] = useState<string>('');
  const [comments, setComments] = useState('');
  const [customCoverUrl, setCustomCoverUrl] = useState<string>('');
  const [artworkChanged, setArtworkChanged] = useState(false);
  const [artworkRemoved, setArtworkRemoved] = useState(false);

  // Audio summary details
  const [bitrate, setBitrate] = useState<number | undefined>(undefined);
  const [sampleRate, setSampleRate] = useState<number | undefined>(undefined);
  const [sizeBytes, setSizeBytes] = useState<number | undefined>(undefined);
  const [duration, setDuration] = useState<number | undefined>(undefined);

  // ID3 Tag extraction state
  const [isExtractingID3, setIsExtractingID3] = useState(false);
  const [id3Status, setId3Status] = useState<'idle' | 'extracting' | 'success' | 'error'>('idle');
  const [id3TagInfo, setId3TagInfo] = useState<string>('');

  // Track fields that the user has manually typed in this modal session
  const manuallyEditedRef = React.useRef<Set<string>>(new Set());

  // Helper to extract common string/number across multiple tracks
  const getCommonString = useCallback((getter: (t: Track) => string | undefined): string => {
    if (activeTracks.length === 0) return '';
    const first = (getter(activeTracks[0]) || '').trim();
    const allSame = activeTracks.every(t => (getter(t) || '').trim() === first);
    return allSame ? first : '';
  }, [activeTracks]);

  const getCommonNumber = useCallback((getter: (t: Track) => number | undefined): string => {
    if (activeTracks.length === 0) return '';
    const first = getter(activeTracks[0]);
    const allSame = activeTracks.every(t => getter(t) === first);
    return allSame && first !== undefined ? String(first) : '';
  }, [activeTracks]);

  // Helper to mark a field as manually edited by user
  const handleFieldChange = (fieldName: string, setter: (val: string) => void, val: string) => {
    manuallyEditedRef.current.add(fieldName);
    setter(val);
  };

  // Initialize and auto-extract ID3 tags whenever a track is opened
  const loadTrackAndExtractID3 = useCallback(async (targetTrack: Track, forceOverwrite = false) => {
    if (forceOverwrite) {
      manuallyEditedRef.current.clear();
    }

    // The Get Info editor is intentionally sourced from the metadata embedded in the
    // music file. Do not seed editable tag fields from the library's cached Track
    // object; that cache may contain stale values from an earlier import/edit.
    setTitle('');
    setArtist('');
    setAlbumArtist('');
    setAlbum('');
    setComposer('');
    setPublisher('');
    setLyrics('');
    setGenre('');
    setMediaKind('Music');
    setBpm('');
    setYear('');
    setTrackNumber('');
    setTrackTotal('');
    setDiscNumber('');
    setDiscTotal('');
    setComments('');
    setCustomCoverUrl('');
    setArtworkChanged(false);
    setArtworkRemoved(false);

    setBitrate(targetTrack.bitrate);
    setSampleRate(targetTrack.sampleRate);
    setSizeBytes(targetTrack.sizeBytes);
    setDuration(targetTrack.duration);

    // 2. Automatically retrieve and auto-fill ID3 tags from the underlying audio file / storage
    setIsExtractingID3(true);
    setId3Status('extracting');
    setId3TagInfo('Reading ID3 tags...');

    try {
      const extracted: ExtractedID3Tags = await extractID3TagsFromTrack(targetTrack, { fallbackToTrack: false });
      // Lyrics are a known weak spot for browser-side ID3/MP4 parsers (USLT frame
      // support is patchy). If the file parser returned nothing, fall back to the
      // in-memory track value so previously-saved lyrics are not silently lost.
      let filledCount = 0;

      if (extracted.title && (!manuallyEditedRef.current.has('title') || forceOverwrite)) {
        setTitle(extracted.title);
        filledCount++;
      }
      if (extracted.artist && (!manuallyEditedRef.current.has('artist') || forceOverwrite)) {
        setArtist(extracted.artist);
        filledCount++;
      }
      if (extracted.albumArtist && (!manuallyEditedRef.current.has('albumArtist') || forceOverwrite)) {
        setAlbumArtist(extracted.albumArtist);
        filledCount++;
      }
      if (extracted.album && (!manuallyEditedRef.current.has('album') || forceOverwrite)) {
        setAlbum(extracted.album);
        filledCount++;
      }
      if (extracted.composer && (!manuallyEditedRef.current.has('composer') || forceOverwrite)) {
        setComposer(extracted.composer);
        filledCount++;
      }
      if (extracted.publisher && (!manuallyEditedRef.current.has('publisher') || forceOverwrite)) {
        setPublisher(extracted.publisher);
        filledCount++;
      }
      const resolvedLyrics = extracted.lyrics || targetTrack.lyrics || '';
      if (resolvedLyrics && (!manuallyEditedRef.current.has('lyrics') || forceOverwrite)) {
        setLyrics(resolvedLyrics);
        filledCount++;
      }
      if (extracted.genre && (!manuallyEditedRef.current.has('genre') || forceOverwrite)) {
        setGenre(extracted.genre);
        filledCount++;
      }
      if (extracted.year !== undefined && (!manuallyEditedRef.current.has('year') || forceOverwrite)) {
        setYear(String(extracted.year));
        filledCount++;
      }
      if (extracted.trackNumber !== undefined && (!manuallyEditedRef.current.has('trackNumber') || forceOverwrite)) {
        setTrackNumber(String(extracted.trackNumber));
        filledCount++;
      }
      if (extracted.trackTotal !== undefined && (!manuallyEditedRef.current.has('trackTotal') || forceOverwrite)) {
        setTrackTotal(String(extracted.trackTotal));
        filledCount++;
      }
      if (extracted.discNumber !== undefined && (!manuallyEditedRef.current.has('discNumber') || forceOverwrite)) {
        setDiscNumber(String(extracted.discNumber));
        filledCount++;
      }
      if (extracted.discTotal !== undefined && (!manuallyEditedRef.current.has('discTotal') || forceOverwrite)) {
        setDiscTotal(String(extracted.discTotal));
        filledCount++;
      }
      if (extracted.bpm !== undefined && (!manuallyEditedRef.current.has('bpm') || forceOverwrite)) {
        setBpm(String(extracted.bpm));
        filledCount++;
      }
      if (extracted.mediaKind && (!manuallyEditedRef.current.has('mediaKind') || forceOverwrite)) {
        setMediaKind(extracted.mediaKind);
      }
      if (extracted.format && (!manuallyEditedRef.current.has('format') || forceOverwrite)) {
        setFormat(extracted.format);
      }
      if (extracted.comments && (!manuallyEditedRef.current.has('comments') || forceOverwrite)) {
        setComments(extracted.comments);
        filledCount++;
      }
      if (!manuallyEditedRef.current.has('coverUrl') || forceOverwrite) {
        setCustomCoverUrl(extracted.coverUrl || '');
        setArtworkChanged(false);
        setArtworkRemoved(false);
        if (extracted.coverUrl) filledCount++;
      }
      if (extracted.bitrate) setBitrate(extracted.bitrate);
      if (extracted.sampleRate) setSampleRate(extracted.sampleRate);
      if (extracted.sizeBytes) setSizeBytes(extracted.sizeBytes);
      if (extracted.duration) setDuration(extracted.duration);

      setId3Status('success');
      setId3TagInfo(`ID3 tags auto-filled (${filledCount} tags)`);
    } catch (err) {
      console.warn('ID3 tag extraction error in GetInfoModal:', err);
      setId3Status('error');
      setId3TagInfo('Could not read ID3 tags');
    } finally {
      setIsExtractingID3(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen && activeTracks.length > 0) {
      manuallyEditedRef.current.clear();
      setActiveTab('info');
      if (isMulti) {
        setTitle(getCommonString(t => t.title));
        setArtist(getCommonString(t => t.artist));
        setAlbumArtist(getCommonString(t => t.albumArtist));
        setAlbum(getCommonString(t => t.album));
        setComposer(getCommonString(t => t.composer));
        setPublisher(getCommonString(t => t.publisher));
        setLyrics('');
        setGenre(getCommonString(t => t.genre));
        setMediaKind(getCommonString(t => t.mediaKind) || 'Music');
        setBpm(getCommonNumber(t => t.bpm));
        setFormat(getCommonString(t => t.format));
        setYear(getCommonNumber(t => t.year));
        setTrackNumber(getCommonNumber(t => t.trackNumber));
        setTrackTotal(getCommonNumber(t => t.trackTotal));
        setDiscNumber(getCommonNumber(t => t.discNumber));
        setDiscTotal(getCommonNumber(t => t.discTotal));
        setComments(getCommonString(t => t.comments));
        setCustomCoverUrl(getCommonString(t => t.coverUrl));
        setArtworkChanged(false);
        setArtworkRemoved(false);
        setId3Status('idle');
        setId3TagInfo('');
      } else {
        loadTrackAndExtractID3(activeTracks[0], false);
      }
    } else {
      setId3Status('idle');
      setId3TagInfo('');
      manuallyEditedRef.current.clear();
    }
  }, [isOpen, activeTracks, isMulti, getCommonString, getCommonNumber, loadTrackAndExtractID3]);

  if (!isOpen || activeTracks.length === 0) return null;

  const handleSave = async () => {
    try {
      if (isMulti) {
        const hasTitle = manuallyEditedRef.current.has('title');
        const hasArtist = manuallyEditedRef.current.has('artist');
        const hasAlbumArtist = manuallyEditedRef.current.has('albumArtist');
        const hasAlbum = manuallyEditedRef.current.has('album');
        const hasComposer = manuallyEditedRef.current.has('composer');
        const hasPublisher = manuallyEditedRef.current.has('publisher');
        const hasGenre = manuallyEditedRef.current.has('genre');
        const hasYear = manuallyEditedRef.current.has('year');
        const hasBpm = manuallyEditedRef.current.has('bpm');
        const hasDiscNumber = manuallyEditedRef.current.has('discNumber');
        const hasDiscTotal = manuallyEditedRef.current.has('discTotal');
        const hasTrackTotal = manuallyEditedRef.current.has('trackTotal');
        const hasTrackNumber = manuallyEditedRef.current.has('trackNumber');
        const hasComments = manuallyEditedRef.current.has('comments');
        const hasMediaKind = manuallyEditedRef.current.has('mediaKind');

        const updatedBatch: EditableTrack[] = activeTracks.map(t => ({
          ...t,
          title: hasTitle ? title.trim() : t.title,
          artist: hasArtist ? artist.trim() : t.artist,
          albumArtist: hasAlbumArtist ? albumArtist.trim() : t.albumArtist,
          album: hasAlbum ? album.trim() : t.album,
          composer: hasComposer ? composer.trim() : t.composer,
          publisher: hasPublisher ? publisher.trim() : t.publisher,
          genre: hasGenre ? genre.trim() : t.genre,
          year: hasYear ? (year ? parseInt(year, 10) : undefined) : t.year,
          bpm: hasBpm ? (bpm ? parseInt(bpm, 10) : undefined) : t.bpm,
          discNumber: hasDiscNumber ? (discNumber ? parseInt(discNumber, 10) : undefined) : t.discNumber,
          discTotal: hasDiscTotal ? (discTotal ? parseInt(discTotal, 10) : undefined) : t.discTotal,
          trackTotal: hasTrackTotal ? (trackTotal ? parseInt(trackTotal, 10) : undefined) : t.trackTotal,
          trackNumber: hasTrackNumber ? (trackNumber ? parseInt(trackNumber, 10) : undefined) : t.trackNumber,
          comments: hasComments ? comments.trim() : t.comments,
          mediaKind: hasMediaKind ? (mediaKind || 'Music') : t.mediaKind,
          ...(artworkChanged ? {
            coverUrl: artworkRemoved ? undefined : (customCoverUrl || undefined),
            artworkDataUrl: artworkRemoved ? '' : (customCoverUrl || undefined),
            artworkRemoved: artworkRemoved,
          } : {}),
        }));

        if (onSaveTracks) {
          await onSaveTracks(updatedBatch);
        } else {
          for (const item of updatedBatch) {
            await onSaveTrack(item);
          }
        }
      } else if (activeTracks[0]) {
        const singleTrack = activeTracks[0];
        await onSaveTrack({
          ...singleTrack,
          title: title.trim(),
          artist: artist.trim(),
          albumArtist: albumArtist.trim(),
          album: album.trim(),
          composer: composer.trim(),
          publisher: publisher.trim(),
          lyrics: lyrics,
          genre: genre.trim(),
          mediaKind: mediaKind || 'Music',
          bpm: bpm ? parseInt(bpm, 10) : undefined,
          format: format.trim(),
          year: year ? parseInt(year, 10) : undefined,
          trackNumber: trackNumber ? parseInt(trackNumber, 10) : undefined,
          trackTotal: trackTotal ? parseInt(trackTotal, 10) : undefined,
          discNumber: discNumber ? parseInt(discNumber, 10) : undefined,
          discTotal: discTotal ? parseInt(discTotal, 10) : undefined,
          comments: comments.trim(),
          coverUrl: artworkRemoved ? undefined : (customCoverUrl || undefined),
          artworkDataUrl: artworkChanged ? (artworkRemoved ? '' : customCoverUrl) : undefined,
          artworkRemoved: artworkChanged && artworkRemoved,
          bitrate: bitrate || singleTrack.bitrate,
          sampleRate: sampleRate || singleTrack.sampleRate,
          sizeBytes: sizeBytes || singleTrack.sizeBytes,
          duration: duration || singleTrack.duration,
        });
      }
      onClose();
    } catch (err) {
      console.error('GetInfoModal save error:', err);
    }
  };

  const handleArtworkUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Keep the image as a data URL so the native writer can embed the exact
    // image bytes into the audio file. Object URLs cannot be persisted into
    // ID3/APIC tags after the dialog closes.
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error || new Error('Could not read artwork'));
        reader.readAsDataURL(file);
      });
      setCustomCoverUrl(dataUrl);
      setArtworkChanged(true);
      setArtworkRemoved(false);
    } catch (error) {
      console.error('Could not read selected artwork:', error);
      window.alert('Could not read the selected image.');
    } finally {
      e.target.value = '';
    }
  };

  const handleReExtractArtwork = async () => {
    if (!track) return;
    setIsExtractingID3(true);
    try {
      const tags = await extractID3TagsFromTrack(track, { fallbackToTrack: false });
      setCustomCoverUrl(tags.coverUrl || '');
      setArtworkChanged(false);
      setArtworkRemoved(false);
    } catch (e) {
      console.warn('Failed to extract artwork:', e);
    } finally {
      setIsExtractingID3(false);
    }
  };

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return 'Unknown size';
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDuration = (seconds?: number) => {
    if (!seconds) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150 select-none text-xs">
      {/* Modal Window Container */}
      <div
        className={`w-full max-w-xl max-h-[90vh] rounded-xl shadow-2xl border overflow-hidden flex flex-col transition-colors ${
          isLight
            ? 'bg-[#f6f6f6] border-gray-300 text-gray-800 shadow-[0_20px_50px_rgba(0,0,0,0.25)]'
            : 'bg-[#1c1c1c] border-[#333] text-gray-200 shadow-[0_20px_60px_rgba(0,0,0,0.7)]'
        }`}
      >
        {/* Header Bar */}
        <div
          className={`px-4 py-2.5 border-b flex items-center justify-between transition-colors ${
            isLight ? 'bg-[#ebebeb] border-gray-300' : 'bg-[#242424] border-[#333]'
          }`}
        >
          <div className="flex items-center gap-2 min-w-0">
            {isMac && (
              <div className="flex items-center gap-1.5 mr-1">
                <button
                  onClick={onClose}
                  className="w-3 h-3 rounded-full bg-[#ff5f56] border border-[#e0443e] hover:opacity-80 transition-opacity"
                  title="Close"
                />
                <span className="w-3 h-3 rounded-full bg-[#ffbd2e] border border-[#dea123]" />
                <span className="w-3 h-3 rounded-full bg-[#27c93f] border border-[#1aab29]" />
              </div>
            )}
            <Tag className="w-4 h-4 text-indigo-500 shrink-0" />
            <span
              className={`text-xs font-bold font-sans truncate max-w-[320px] ${
                isLight ? 'text-gray-900' : 'text-gray-100'
              }`}
            >
              {isMulti
                ? album
                  ? `Album: ${album} (${activeTracks.length} items)`
                  : `Multiple Item Information (${activeTracks.length} items)`
                : `${title || activeTracks[0]?.title} — Get Info`}
            </span>
          </div>

          {/* ID3 Tag Auto-fill Status Badge & Refresh */}
          <div className="flex items-center gap-2 shrink-0">
            {id3Status === 'extracting' && (
              <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-cyan-950/60 border border-cyan-800/80 text-cyan-300 text-[10px] animate-pulse">
                <Sparkles className="w-3 h-3 animate-spin text-cyan-400" />
                <span>Reading ID3 tags...</span>
              </div>
            )}

            {id3Status === 'success' && (
              <div
                className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-950/60 border border-emerald-800/70 text-emerald-300 text-[10px] animate-in fade-in"
                title={id3TagInfo}
              >
                <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                <span className="font-medium">ID3 Tags Auto-Filled</span>
              </div>
            )}

            {id3Status === 'error' && (
              <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-950/60 border border-amber-800/70 text-amber-300 text-[10px]">
                <AlertCircle className="w-3 h-3 text-amber-400" />
                <span>Default tags</span>
              </div>
            )}

            <button
              onClick={() => track && loadTrackAndExtractID3(track, true)}
              disabled={isExtractingID3}
              className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-all ${
                isLight
                  ? 'bg-gray-200 hover:bg-gray-300 text-gray-700 border border-gray-300'
                  : 'bg-[#2a2a2a] hover:bg-[#383838] text-gray-200 border border-[#444]'
              }`}
              title="Re-read and auto-fill ID3 tags from audio file"
            >
              <RefreshCw className={`w-3 h-3 ${isExtractingID3 ? 'animate-spin text-indigo-400' : ''}`} />
              <span className="hidden sm:inline">Auto-Fill ID3</span>
            </button>

            {!isMac && (
              <button
                onClick={onClose}
                className={`p-1 rounded transition-colors ${
                  isLight ? 'text-gray-500 hover:text-gray-900 hover:bg-gray-200' : 'text-gray-400 hover:text-white hover:bg-[#333]'
                }`}
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Tab Switcher */}
        <div
          className={`flex items-center justify-center gap-1.5 px-4 py-2 border-b transition-colors ${
            isLight ? 'bg-[#f0f0f0] border-gray-300' : 'bg-[#181818] border-[#2b2b2b]'
          }`}
        >
          <button
            onClick={() => setActiveTab('info')}
            className={`px-4 py-1 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-all ${
              activeTab === 'info'
                ? isLight
                  ? 'bg-white text-indigo-700 border border-gray-300 shadow-sm font-bold'
                  : 'bg-[#2a2a2a] text-white border border-[#444] shadow-sm font-bold'
                : isLight
                ? 'text-gray-600 hover:text-gray-900 hover:bg-gray-200/60'
                : 'text-gray-400 hover:text-gray-200 hover:bg-[#222]'
            }`}
          >
            <Info className="w-3.5 h-3.5 text-indigo-500" />
            <span>Info</span>
          </button>

          {!isMulti && (
            <button
              onClick={() => setActiveTab('lyrics')}
              className={`px-4 py-1 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-all ${
                activeTab === 'lyrics'
                  ? isLight
                    ? 'bg-white text-indigo-700 border border-gray-300 shadow-sm font-bold'
                    : 'bg-[#2a2a2a] text-white border border-[#444] shadow-sm font-bold'
                  : isLight
                  ? 'text-gray-600 hover:text-gray-900 hover:bg-gray-200/60'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-[#222]'
              }`}
            >
              <Music className="w-3.5 h-3.5 text-indigo-500" />
              <span>Lyrics</span>
            </button>
          )}

          {!isMulti && (
            <button
              onClick={() => setActiveTab('summary')}
              className={`px-4 py-1 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-all ${
                activeTab === 'summary'
                  ? isLight
                    ? 'bg-white text-indigo-700 border border-gray-300 shadow-sm font-bold'
                    : 'bg-[#2a2a2a] text-white border border-[#444] shadow-sm font-bold'
                  : isLight
                  ? 'text-gray-600 hover:text-gray-900 hover:bg-gray-200/60'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-[#222]'
              }`}
            >
              <FileText className="w-3.5 h-3.5 text-indigo-500" />
              <span>Summary</span>
            </button>
          )}

          <button
            onClick={() => setActiveTab('artwork')}
            className={`px-4 py-1 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-all ${
              activeTab === 'artwork'
                ? isLight
                  ? 'bg-white text-indigo-700 border border-gray-300 shadow-sm font-bold'
                  : 'bg-[#2a2a2a] text-white border border-[#444] shadow-sm font-bold'
                : isLight
                ? 'text-gray-600 hover:text-gray-900 hover:bg-gray-200/60'
                : 'text-gray-400 hover:text-gray-200 hover:bg-[#222]'
            }`}
          >
            <ImageIcon className="w-3.5 h-3.5 text-indigo-500" />
            <span>Artwork</span>
          </button>
        </div>

        {/* Tab Contents Area */}
        <div
          className={`p-5 min-h-[340px] max-h-[58vh] overflow-y-auto custom-scrollbar flex-1 transition-colors ${
            isLight ? 'bg-[#ffffff] text-gray-800' : 'bg-[#121212] text-gray-200'
          }`}
        >
          {/* TAB 1: INFO (METADATA EDITOR) */}
          {activeTab === 'info' && (
            <div className="space-y-3 max-w-lg mx-auto">
              {/* Song Name / Title */}
              <div className="grid grid-cols-4 items-center gap-2.5">
                <label className={`text-right font-bold ${isLight ? 'text-gray-600' : 'text-gray-400'}`}>Name:</label>
                <input
                  type="text"
                  value={title}
                  placeholder={isMulti ? (title ? "Song Title" : "(Mixed)") : "Song Title"}
                  onChange={(e) => handleFieldChange('title', setTitle, e.target.value)}
                  className={`col-span-3 px-3 py-1.5 rounded-md border text-xs transition-all focus:outline-none focus:ring-1 focus:ring-indigo-500 ${
                    isLight
                      ? 'bg-white border-gray-300 text-gray-900 focus:border-indigo-500'
                      : 'bg-[#1f1f1f] border-[#333] text-gray-100 focus:border-indigo-500'
                  }`}
                />
              </div>

              {/* Artist */}
              <div className="grid grid-cols-4 items-center gap-2.5">
                <label className={`text-right font-bold ${isLight ? 'text-gray-600' : 'text-gray-400'}`}>Artist:</label>
                <input
                  type="text"
                  value={artist}
                  placeholder={isMulti ? (artist ? "Artist / Performer" : "(Mixed)") : "Artist / Performer"}
                  onChange={(e) => handleFieldChange('artist', setArtist, e.target.value)}
                  className={`col-span-3 px-3 py-1.5 rounded-md border text-xs transition-all focus:outline-none focus:ring-1 focus:ring-indigo-500 ${
                    isLight
                      ? 'bg-white border-gray-300 text-gray-900 focus:border-indigo-500'
                      : 'bg-[#1f1f1f] border-[#333] text-gray-100 focus:border-indigo-500'
                  }`}
                />
              </div>

              {/* Album Artist */}
              <div className="grid grid-cols-4 items-center gap-2.5">
                <label className={`text-right font-bold ${isLight ? 'text-gray-600' : 'text-gray-400'}`}>Album Artist:</label>
                <input
                  type="text"
                  value={albumArtist}
                  placeholder={isMulti ? (albumArtist ? "Album Artist" : "(Mixed)") : "Album Artist (Optional)"}
                  onChange={(e) => handleFieldChange('albumArtist', setAlbumArtist, e.target.value)}
                  className={`col-span-3 px-3 py-1.5 rounded-md border text-xs transition-all focus:outline-none focus:ring-1 focus:ring-indigo-500 ${
                    isLight
                      ? 'bg-white border-gray-300 text-gray-900 focus:border-indigo-500'
                      : 'bg-[#1f1f1f] border-[#333] text-gray-100 focus:border-indigo-500'
                  }`}
                />
              </div>

              {/* Album */}
              <div className="grid grid-cols-4 items-center gap-2.5">
                <label className={`text-right font-bold ${isLight ? 'text-gray-600' : 'text-gray-400'}`}>Album:</label>
                <input
                  type="text"
                  value={album}
                  placeholder={isMulti ? (album ? "Album Name" : "(Mixed)") : "Album Name"}
                  onChange={(e) => handleFieldChange('album', setAlbum, e.target.value)}
                  className={`col-span-3 px-3 py-1.5 rounded-md border text-xs transition-all focus:outline-none focus:ring-1 focus:ring-indigo-500 ${
                    isLight
                      ? 'bg-white border-gray-300 text-gray-900 focus:border-indigo-500'
                      : 'bg-[#1f1f1f] border-[#333] text-gray-100 focus:border-indigo-500'
                  }`}
                />
              </div>

              {/* Composer */}
              <div className="grid grid-cols-4 items-center gap-2.5">
                <label className={`text-right font-bold ${isLight ? 'text-gray-600' : 'text-gray-400'}`}>Composer:</label>
                <input
                  type="text"
                  value={composer}
                  placeholder="Composer (Optional)"
                  onChange={(e) => handleFieldChange('composer', setComposer, e.target.value)}
                  className={`col-span-3 px-3 py-1.5 rounded-md border text-xs transition-all focus:outline-none focus:ring-1 focus:ring-indigo-500 ${
                    isLight
                      ? 'bg-white border-gray-300 text-gray-900 focus:border-indigo-500'
                      : 'bg-[#1f1f1f] border-[#333] text-gray-100 focus:border-indigo-500'
                  }`}
                />
              </div>

              {/* Publisher */}
              <div className="grid grid-cols-4 items-center gap-2.5">
                <label className={`text-right font-bold ${isLight ? 'text-gray-600' : 'text-gray-400'}`}>Publisher:</label>
                <input
                  type="text"
                  value={publisher}
                  placeholder="Publisher (Optional)"
                  onChange={(e) => handleFieldChange('publisher', setPublisher, e.target.value)}
                  className={`col-span-3 px-3 py-1.5 rounded-md border text-xs transition-all focus:outline-none focus:ring-1 focus:ring-indigo-500 ${
                    isLight ? 'bg-white border-gray-300 text-gray-900 focus:border-indigo-500' : 'bg-[#1f1f1f] border-[#333] text-gray-100 focus:border-indigo-500'
                  }`}
                />
              </div>

              {/* Genre */}
              <div className="grid grid-cols-4 items-center gap-2.5">
                <label className={`text-right font-bold ${isLight ? 'text-gray-600' : 'text-gray-400'}`}>Genre:</label>
                <input
                  type="text"
                  value={genre}
                  placeholder="e.g. Rock, Pop, Classical, Soundtrack"
                  onChange={(e) => handleFieldChange('genre', setGenre, e.target.value)}
                  className={`col-span-3 px-3 py-1.5 rounded-md border text-xs transition-all focus:outline-none focus:ring-1 focus:ring-indigo-500 ${
                    isLight
                      ? 'bg-white border-gray-300 text-gray-900 focus:border-indigo-500'
                      : 'bg-[#1f1f1f] border-[#333] text-gray-100 focus:border-indigo-500'
                  }`}
                />
              </div>

              {/* Media Kind & Format */}
              <div className="grid grid-cols-4 items-center gap-2.5">
                <label className={`text-right font-bold ${isLight ? 'text-gray-600' : 'text-gray-400'}`}>Media Kind:</label>
                <div className="col-span-3 grid grid-cols-2 gap-2 items-center">
                  <select
                    value={mediaKind}
                    onChange={(e) => handleFieldChange('mediaKind', setMediaKind, e.target.value)}
                    className={`px-3 py-1.5 rounded-md border text-xs transition-all focus:outline-none focus:ring-1 focus:ring-indigo-500 ${
                      isLight
                        ? 'bg-white border-gray-300 text-gray-900 focus:border-indigo-500'
                        : 'bg-[#1f1f1f] border-[#333] text-gray-100 focus:border-indigo-500'
                    }`}
                  >
                    <option value="Music">Music</option>
                    <option value="Podcast">Podcast</option>
                    <option value="Audiobook">Audiobook</option>
                    <option value="Voice Memo">Voice Memo</option>
                  </select>

                  <div
                    title="Audio format is determined by the song's file type and cannot be manually edited."
                    className={`px-3 py-1.5 rounded-md border text-xs flex items-center justify-between cursor-default transition-all ${
                      isLight
                        ? 'bg-gray-100 border-gray-200 text-gray-700'
                        : 'bg-[#181818] border-[#2c2c2c] text-gray-300'
                    }`}
                  >
                    <span className="truncate font-medium">{format || track.format || 'MPEG audio'}</span>
                    <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded uppercase tracking-wider ${
                      isLight ? 'bg-gray-200/80 text-gray-600' : 'bg-[#262626] text-gray-400'
                    }`}>
                      File Type
                    </span>
                  </div>
                </div>
              </div>

              {/* Year & BPM */}
              <div className="grid grid-cols-4 items-center gap-2.5">
                <label className={`text-right font-bold ${isLight ? 'text-gray-600' : 'text-gray-400'}`}>Year & BPM:</label>
                <div className="col-span-3 grid grid-cols-2 gap-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] opacity-70 w-9">Year:</span>
                    <input
                      type="number"
                      placeholder="e.g. 2024"
                      value={year}
                      onChange={(e) => handleFieldChange('year', setYear, e.target.value)}
                      className={`w-full px-2.5 py-1.5 rounded-md border text-xs transition-all focus:outline-none focus:ring-1 focus:ring-indigo-500 ${
                        isLight
                          ? 'bg-white border-gray-300 text-gray-900 focus:border-indigo-500'
                          : 'bg-[#1f1f1f] border-[#333] text-gray-100 focus:border-indigo-500'
                      }`}
                    />
                  </div>

                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] opacity-70 w-9">BPM:</span>
                    <input
                      type="number"
                      placeholder="e.g. 128"
                      value={bpm}
                      onChange={(e) => handleFieldChange('bpm', setBpm, e.target.value)}
                      className={`w-full px-2.5 py-1.5 rounded-md border text-xs transition-all focus:outline-none focus:ring-1 focus:ring-indigo-500 ${
                        isLight
                          ? 'bg-white border-gray-300 text-gray-900 focus:border-indigo-500'
                          : 'bg-[#1f1f1f] border-[#333] text-gray-100 focus:border-indigo-500'
                      }`}
                    />
                  </div>
                </div>
              </div>

              {/* Track Number & Disc Number */}
              <div className="grid grid-cols-4 items-center gap-2.5">
                <label className={`text-right font-bold ${isLight ? 'text-gray-600' : 'text-gray-400'}`}>Track / Disc:</label>
                <div className="col-span-3 grid grid-cols-2 gap-2">
                  {/* Track # of # */}
                  <div className="flex items-center gap-1">
                    <span className="text-[11px] opacity-70 w-9">Track:</span>
                    <input
                      type="number"
                      placeholder="1"
                      value={trackNumber}
                      onChange={(e) => handleFieldChange('trackNumber', setTrackNumber, e.target.value)}
                      className={`w-14 px-2 py-1.5 rounded-md border text-xs text-center transition-all focus:outline-none focus:ring-1 focus:ring-indigo-500 ${
                        isLight
                          ? 'bg-white border-gray-300 text-gray-900 focus:border-indigo-500'
                          : 'bg-[#1f1f1f] border-[#333] text-gray-100 focus:border-indigo-500'
                      }`}
                    />
                    <span className="text-[11px] opacity-60">of</span>
                    <input
                      type="number"
                      placeholder="12"
                      value={trackTotal}
                      onChange={(e) => handleFieldChange('trackTotal', setTrackTotal, e.target.value)}
                      className={`w-14 px-2 py-1.5 rounded-md border text-xs text-center transition-all focus:outline-none focus:ring-1 focus:ring-indigo-500 ${
                        isLight
                          ? 'bg-white border-gray-300 text-gray-900 focus:border-indigo-500'
                          : 'bg-[#1f1f1f] border-[#333] text-gray-100 focus:border-indigo-500'
                      }`}
                    />
                  </div>

                  {/* Disc # of # */}
                  <div className="flex items-center gap-1">
                    <span className="text-[11px] opacity-70 w-9">Disc:</span>
                    <input
                      type="number"
                      placeholder="1"
                      value={discNumber}
                      onChange={(e) => handleFieldChange('discNumber', setDiscNumber, e.target.value)}
                      className={`w-14 px-2 py-1.5 rounded-md border text-xs text-center transition-all focus:outline-none focus:ring-1 focus:ring-indigo-500 ${
                        isLight
                          ? 'bg-white border-gray-300 text-gray-900 focus:border-indigo-500'
                          : 'bg-[#1f1f1f] border-[#333] text-gray-100 focus:border-indigo-500'
                      }`}
                    />
                    <span className="text-[11px] opacity-60">of</span>
                    <input
                      type="number"
                      placeholder="1"
                      value={discTotal}
                      onChange={(e) => handleFieldChange('discTotal', setDiscTotal, e.target.value)}
                      className={`w-14 px-2 py-1.5 rounded-md border text-xs text-center transition-all focus:outline-none focus:ring-1 focus:ring-indigo-500 ${
                        isLight
                          ? 'bg-white border-gray-300 text-gray-900 focus:border-indigo-500'
                          : 'bg-[#1f1f1f] border-[#333] text-gray-100 focus:border-indigo-500'
                      }`}
                    />
                  </div>
                </div>
              </div>

              {/* Comments */}
              <div className="grid grid-cols-4 items-start gap-2.5 pt-1">
                <label className={`text-right font-bold pt-1.5 ${isLight ? 'text-gray-600' : 'text-gray-400'}`}>Comments:</label>
                <textarea
                  rows={2}
                  value={comments}
                  placeholder="ID3 Comments or notes"
                  onChange={(e) => handleFieldChange('comments', setComments, e.target.value)}
                  className={`col-span-3 px-3 py-1.5 rounded-md border text-xs transition-all focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-none ${
                    isLight
                      ? 'bg-white border-gray-300 text-gray-900 focus:border-indigo-500'
                      : 'bg-[#1f1f1f] border-[#333] text-gray-100 focus:border-indigo-500'
                  }`}
                />
              </div>
            </div>
          )}

          {/* TAB 2: LYRICS */}
          {activeTab === 'lyrics' && (
            <div className="space-y-3 max-w-2xl mx-auto">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className={`font-bold text-sm ${isLight ? 'text-gray-900' : 'text-white'}`}>Lyrics</h3>
                  <p className={`text-[11px] ${isLight ? 'text-gray-500' : 'text-gray-400'}`}>Lyrics will be embedded in the music file when you save.</p>
                </div>
              </div>
              <textarea
                autoFocus
                rows={16}
                value={lyrics}
                onChange={(e) => handleFieldChange('lyrics', setLyrics, e.target.value)}
                placeholder="Enter lyrics here..."
                spellCheck={false}
                className={`w-full min-h-[300px] px-3 py-2 rounded-md border text-sm leading-6 resize-y focus:outline-none focus:ring-1 focus:ring-indigo-500 ${
                  isLight ? 'bg-white border-gray-300 text-gray-900 focus:border-indigo-500' : 'bg-[#1f1f1f] border-[#333] text-gray-100 focus:border-indigo-500'
                }`}
              />
            </div>
          )}

          {/* TAB 3: SUMMARY */}
          {activeTab === 'summary' && (
            <div className="space-y-4 max-w-lg mx-auto font-sans">
              {/* Header Preview */}
              <div
                className={`flex items-center gap-4 pb-3.5 border-b ${
                  isLight ? 'border-gray-200' : 'border-white/10'
                }`}
              >
                <img
                  src={customCoverUrl || track.coverUrl}
                  alt={title || track.title}
                  className="w-16 h-16 rounded-md object-cover shadow border border-white/10 bg-black/50 shrink-0"
                />
                <div className="min-w-0">
                  <h3 className={`font-bold text-sm truncate ${isLight ? 'text-gray-900' : 'text-white'}`}>
                    {title || track.title}
                  </h3>
                  <p className={`truncate text-xs ${isLight ? 'text-gray-600' : 'text-gray-300'}`}>
                    {artist || track.artist} — {album || track.album}
                  </p>
                  {composer && (
                    <p className={`truncate text-[11px] ${isLight ? 'text-gray-500' : 'text-gray-400'}`}>
                      Composer: {composer}
                    </p>
                  )}
                </div>
              </div>

              {/* Technical Audio Metadata Grid */}
              <div className="grid grid-cols-2 gap-y-3 gap-x-4 pt-1 text-xs">
                <div>
                  <span className={`font-bold block ${isLight ? 'text-gray-900' : 'text-gray-100'}`}>Kind / Format</span>
                  <span className={isLight ? 'text-gray-600' : 'text-gray-400'}>{format || track.format || 'MPEG audio file'}</span>
                </div>

                <div>
                  <span className={`font-bold block ${isLight ? 'text-gray-900' : 'text-gray-100'}`}>Bit Rate</span>
                  <span className={isLight ? 'text-gray-600' : 'text-gray-400'}>{bitrate || track.bitrate || 320} kbps</span>
                </div>

                <div>
                  <span className={`font-bold block ${isLight ? 'text-gray-900' : 'text-gray-100'}`}>Sample Rate</span>
                  <span className={isLight ? 'text-gray-600' : 'text-gray-400'}>
                    {sampleRate || track.sampleRate ? `${((sampleRate || track.sampleRate || 44100) / 1000).toFixed(1)} kHz` : '44.1 kHz'}
                  </span>
                </div>

                <div>
                  <span className={`font-bold block ${isLight ? 'text-gray-900' : 'text-gray-100'}`}>Size</span>
                  <span className={isLight ? 'text-gray-600' : 'text-gray-400'}>{formatFileSize(sizeBytes || track.sizeBytes)}</span>
                </div>

                <div>
                  <span className={`font-bold block ${isLight ? 'text-gray-900' : 'text-gray-100'}`}>Duration</span>
                  <span className={isLight ? 'text-gray-600' : 'text-gray-400'}>{formatDuration(duration || track.duration)}</span>
                </div>

                <div>
                  <span className={`font-bold block ${isLight ? 'text-gray-900' : 'text-gray-100'}`}>Track / Disc</span>
                  <span className={isLight ? 'text-gray-600' : 'text-gray-400'}>
                    {trackNumber ? `${trackNumber}${trackTotal ? ` of ${trackTotal}` : ''}` : 'N/A'}
                    {discNumber ? ` (Disc ${discNumber}${discTotal ? ` of ${discTotal}` : ''})` : ''}
                  </span>
                </div>

                <div>
                  <span className={`font-bold block ${isLight ? 'text-gray-900' : 'text-gray-100'}`}>Tempo (BPM)</span>
                  <span className={isLight ? 'text-gray-600' : 'text-gray-400'}>{bpm ? `${bpm} BPM` : 'Not set'}</span>
                </div>

                <div>
                  <span className={`font-bold block ${isLight ? 'text-gray-900' : 'text-gray-100'}`}>Plays</span>
                  <span className={isLight ? 'text-gray-600' : 'text-gray-400'}>{track.playCount || 0} times</span>
                </div>

                <div>
                  <span className={`font-bold block ${isLight ? 'text-gray-900' : 'text-gray-100'}`}>Date Added</span>
                  <span className={isLight ? 'text-gray-600' : 'text-gray-400'}>
                    {track.dateAdded ? new Date(track.dateAdded).toLocaleDateString() : 'Today'}
                  </span>
                </div>

                <div>
                  <span className={`font-bold block ${isLight ? 'text-gray-900' : 'text-gray-100'}`}>ID3 Tags</span>
                  <span className="text-emerald-500 font-medium flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" /> Auto-Indexed
                  </span>
                </div>

                {track.filePath && (
                  <div className="col-span-2 pt-2 border-t border-white/5">
                    <span className={`font-bold block ${isLight ? 'text-gray-900' : 'text-gray-100'}`}>Location</span>
                    <span className={`break-all font-mono text-[10px] ${isLight ? 'text-gray-500' : 'text-gray-400'}`}>
                      {track.filePath}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 3: ARTWORK */}
          {activeTab === 'artwork' && (
            <div className="flex flex-col items-center justify-center gap-4 py-3 max-w-sm mx-auto">
              <div className="relative group w-44 h-44 rounded-lg border shadow-xl overflow-hidden bg-black/60 flex items-center justify-center">
                {customCoverUrl ? (
                  <img
                    src={customCoverUrl}
                    alt={title || track.title}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center text-gray-500 gap-2">
                    <Disc className="w-12 h-12" />
                    <span className="text-[11px]">No Artwork</span>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2 flex-wrap justify-center pt-2">
                <label
                  className={`px-3 py-1.5 rounded-md text-xs font-bold cursor-pointer transition-colors border shadow-sm ${
                    isLight
                      ? 'bg-indigo-50 border-indigo-200 text-indigo-700 hover:bg-indigo-100'
                      : 'bg-indigo-950/60 border-indigo-800/80 text-indigo-300 hover:bg-indigo-900/60'
                  }`}
                >
                  Choose Custom Image...
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleArtworkUpload}
                    className="hidden"
                  />
                </label>

                <button
                  onClick={handleReExtractArtwork}
                  disabled={isExtractingID3}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors border shadow-sm ${
                    isLight
                      ? 'bg-gray-100 border-gray-300 text-gray-700 hover:bg-gray-200'
                      : 'bg-[#262626] border-[#3d3d3d] text-gray-200 hover:bg-[#333]'
                  }`}
                  title="Re-extract embedded artwork from audio file ID3 tag"
                >
                  {isExtractingID3 ? 'Extracting...' : 'Extract from ID3'}
                </button>

                {customCoverUrl && (
                  <button
                    onClick={() => { setCustomCoverUrl(''); setArtworkChanged(true); setArtworkRemoved(true); }}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors border shadow-sm ${
                      isLight
                        ? 'bg-red-50 border-red-200 text-red-700 hover:bg-red-100'
                        : 'bg-red-950/40 border-red-900/50 text-red-300 hover:bg-red-900/40'
                    }`}
                  >
                    Remove
                  </button>
                )}
              </div>
              <p className={`text-[11px] text-center ${isLight ? 'text-gray-500' : 'text-gray-400'}`}>
                Embedded ID3 artwork is automatically extracted from ID3v2 APIC or MP4 covr atoms.
              </p>
            </div>
          )}
        </div>

        {/* Footer Buttons */}
        <div
          className={`p-3 border-t flex items-center justify-between transition-colors ${
            isLight ? 'bg-[#ebebeb] border-gray-300' : 'bg-[#161616] border-[#333]'
          }`}
        >
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => track && loadTrackAndExtractID3(track, true)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 ${
                isLight
                  ? 'bg-gray-200 hover:bg-gray-300 text-gray-700'
                  : 'bg-[#262626] hover:bg-[#333] text-gray-300'
              }`}
              title="Reset fields and re-fetch from ID3"
            >
              <RefreshCw className="w-3 h-3" />
              <span>Reset to ID3 Tags</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className={`px-4 py-1.5 rounded-md text-xs font-medium transition-colors border shadow-sm ${
                isLight
                  ? 'bg-white border-gray-300 text-gray-700 hover:bg-gray-100'
                  : 'bg-[#262626] border-[#3d3d3d] text-gray-300 hover:bg-[#333]'
              }`}
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="px-5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-md text-xs font-bold shadow-md transition-colors flex items-center gap-1.5"
            >
              OK
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

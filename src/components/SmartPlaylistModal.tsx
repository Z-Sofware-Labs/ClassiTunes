import React, { useState, useEffect } from 'react';
import { X, Plus, Trash2, Sliders, Sparkles, Check } from 'lucide-react';
import { Playlist, SmartRule } from '../types';

interface SmartPlaylistModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (smartPlaylist: Partial<Playlist>) => void;
  initialPlaylist?: Playlist | null;
  theme?: 'dark' | 'light';
}

const FIELD_OPTIONS: { value: SmartRule['field']; label: string }[] = [
  { value: 'album', label: 'Album' },
  { value: 'artist', label: 'Artist' },
  { value: 'bpm', label: 'BPM (Beats Per Minute)' },
  { value: 'format', label: 'File Format (MP3, AAC, FLAC...)' },
  { value: 'genre', label: 'Genre' },
  { value: 'mediaKind', label: 'Media Kind (Music, Podcast...)' },
  { value: 'playCount', label: 'Play Count' },
  { value: 'rating', label: 'Rating (0-5 Stars)' },
  { value: 'title', label: 'Title' },
  { value: 'year', label: 'Year' },
];

const OPERATOR_OPTIONS: { value: SmartRule['operator']; label: string }[] = [
  { value: 'contains', label: 'contains' },
  { value: 'is', label: 'is' },
  { value: 'starts_with', label: 'starts with' },
  { value: 'greater_than', label: 'is greater than' },
  { value: 'less_than', label: 'is less than' },
];

export const SmartPlaylistModal: React.FC<SmartPlaylistModalProps> = ({
  isOpen,
  onClose,
  onSave,
  initialPlaylist,
  theme = 'dark',
}) => {
  const [name, setName] = useState('Smart Playlist');
  const [matchType, setMatchType] = useState<'all' | 'any'>('all');
  const [rules, setRules] = useState<SmartRule[]>([
    { id: 'rule_1', field: 'rating', operator: 'greater_than', value: '3' },
  ]);
  const [limit, setLimit] = useState<number | undefined>(undefined);
  const [useLimit, setUseLimit] = useState(false);

  useEffect(() => {
    if (initialPlaylist) {
      setName(initialPlaylist.name || 'Smart Playlist');
      setMatchType(initialPlaylist.matchType || 'all');
      setRules(
        initialPlaylist.rules && initialPlaylist.rules.length > 0
          ? initialPlaylist.rules
          : [{ id: 'rule_1', field: 'rating', operator: 'greater_than', value: '3' }]
      );
      if (initialPlaylist.limit) {
        setUseLimit(true);
        setLimit(initialPlaylist.limit);
      } else {
        setUseLimit(false);
        setLimit(undefined);
      }
    } else {
      setName('Smart Playlist');
      setMatchType('all');
      setRules([{ id: 'rule_1', field: 'rating', operator: 'greater_than', value: '3' }]);
      setUseLimit(false);
      setLimit(undefined);
    }
  }, [initialPlaylist, isOpen]);

  const isMac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().indexOf('MAC') >= 0;

  if (!isOpen) return null;

  const handleAddRule = () => {
    const newRule: SmartRule = {
      id: `rule_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
      field: 'genre',
      operator: 'contains',
      value: '',
    };
    setRules(prev => [...prev, newRule]);
  };

  const handleRemoveRule = (id: string) => {
    if (rules.length === 1) return;
    setRules(prev => prev.filter(r => r.id !== id));
  };

  const handleUpdateRule = (id: string, updates: Partial<SmartRule>) => {
    setRules(prev =>
      prev.map(r => (r.id === id ? { ...r, ...updates } : r))
    );
  };

  const handleApplyPreset = (presetName: string, presetRules: SmartRule[], pMatchType: 'all' | 'any' = 'all') => {
    setName(presetName);
    setRules(presetRules);
    setMatchType(pMatchType);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    onSave({
      id: initialPlaylist?.id || `smart_pl_${Date.now()}`,
      name: name.trim(),
      isSmart: true,
      matchType,
      rules,
      limit: useLimit ? limit : undefined,
      trackIds: [],
    });

    onClose();
  };

  const isLight = theme === 'light';

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150 select-none">
      <div className={`w-full max-w-xl max-h-[90vh] rounded-xl shadow-2xl border overflow-hidden flex flex-col transition-all ${
        isLight
          ? 'bg-gradient-to-b from-[#f0f4f9] via-[#dce4ee] to-[#c5d1e2] border-[#7a8aa3] text-gray-900'
          : 'bg-[#1e1e1e] border-[#383838] text-gray-100 shadow-purple-950/20'
      }`}>
        {/* Modal Header */}
        <div className={`px-4 py-3 border-b flex items-center justify-between shadow-sm shrink-0 ${
          isLight ? 'bg-gradient-to-b from-[#e3e9f3] to-[#cbd7e8] border-[#adbcd2]' : 'bg-[#282828] border-[#383838]'
        }`}>
          <div className="flex items-center gap-2">
            {isMac && (
              <>
                <span className="w-3 h-3 rounded-full bg-[#ff5f56] border border-[#e0443e] cursor-pointer" onClick={onClose} />
                <span className="w-3 h-3 rounded-full bg-[#ffbd2e] border border-[#dea123]" />
                <span className="w-3 h-3 rounded-full bg-[#27c93f] border border-[#1aab29]" />
              </>
            )}
            <Sparkles className="w-4 h-4 text-purple-500 dark:text-purple-400" />
            <h3 className="font-bold text-sm">
              {initialPlaylist ? 'Edit Smart Playlist' : 'Smart Playlist Settings'}
            </h3>
          </div>
          {!isMac && (
            <button
              onClick={onClose}
              className={`p-1 rounded-md transition-colors ${
                isLight ? 'hover:bg-black/10 text-gray-700' : 'hover:bg-white/10 text-gray-400'
              }`}
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto custom-scrollbar flex-1">
          {/* Playlist Name Input */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold tracking-wide uppercase text-gray-500 dark:text-gray-400">
              Playlist Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. 90s Rock, Top Rated, High Play Count"
              required
              className={`px-3 py-2 text-sm font-semibold rounded-lg border focus:outline-none focus:ring-2 focus:ring-purple-500 ${
                isLight
                  ? 'bg-white border-gray-300 text-gray-900 shadow-inner'
                  : 'bg-[#121212] border-gray-700 text-white shadow-inner'
              }`}
            />
          </div>

          {/* Preset Buttons Bar */}
          <div className="space-y-1.5">
            <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">Quick Rules Presets</span>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() =>
                  handleApplyPreset('Top Rated Songs', [
                    { id: 'p1', field: 'rating', operator: 'greater_than', value: '3' },
                  ])
                }
                className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
                  isLight
                    ? 'bg-white/80 hover:bg-white border-purple-200 text-purple-900'
                    : 'bg-purple-950/40 hover:bg-purple-900/60 border-purple-800 text-purple-200'
                }`}
              >
                ⭐ Top Rated (4+ Stars)
              </button>
              <button
                type="button"
                onClick={() =>
                  handleApplyPreset('Most Played', [
                    { id: 'p2', field: 'playCount', operator: 'greater_than', value: '5' },
                  ])
                }
                className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
                  isLight
                    ? 'bg-white/80 hover:bg-white border-blue-200 text-blue-900'
                    : 'bg-blue-950/40 hover:bg-blue-900/60 border-blue-800 text-blue-200'
                }`}
              >
                🔥 Most Played
              </button>
              <button
                type="button"
                onClick={() =>
                  handleApplyPreset('Rock Classics', [
                    { id: 'p3', field: 'genre', operator: 'contains', value: 'rock' },
                  ])
                }
                className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
                  isLight
                    ? 'bg-white/80 hover:bg-white border-emerald-200 text-emerald-900'
                    : 'bg-emerald-950/40 hover:bg-emerald-900/60 border-emerald-800 text-emerald-200'
                }`}
              >
                🎸 Rock Genre
              </button>
              <button
                type="button"
                onClick={() =>
                  handleApplyPreset('Fast Tempo Tracks', [
                    { id: 'p5', field: 'bpm', operator: 'greater_than', value: '120' },
                  ])
                }
                className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
                  isLight
                    ? 'bg-white/80 hover:bg-white border-rose-200 text-rose-900'
                    : 'bg-rose-950/40 hover:bg-rose-900/60 border-rose-800 text-rose-200'
                }`}
              >
                ⚡ Fast Tempo (BPM &gt; 120)
              </button>
              <button
                type="button"
                onClick={() =>
                  handleApplyPreset('MP3 Audio Files', [
                    { id: 'p6', field: 'format', operator: 'contains', value: 'mp3' },
                  ])
                }
                className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
                  isLight
                    ? 'bg-white/80 hover:bg-white border-cyan-200 text-cyan-900'
                    : 'bg-cyan-950/40 hover:bg-cyan-900/60 border-cyan-800 text-cyan-200'
                }`}
              >
                🎧 MP3 Files
              </button>
            </div>
          </div>

          {/* Rule Match Type */}
          <div className="flex items-center gap-2 text-xs font-medium pt-1">
            <span>Match</span>
            <select
              value={matchType}
              onChange={(e) => setMatchType(e.target.value as 'all' | 'any')}
              className={`px-2 py-1 rounded border text-xs font-bold focus:outline-none focus:ring-1 focus:ring-purple-500 ${
                isLight ? 'bg-white border-gray-300 text-gray-800' : 'bg-[#252525] border-gray-700 text-white'
              }`}
            >
              <option value="all">all</option>
              <option value="any">any</option>
            </select>
            <span>of the following rules:</span>
          </div>

          {/* Rules Builder Container */}
          <div className={`p-3 rounded-lg border space-y-2.5 max-h-56 overflow-y-auto ${
            isLight ? 'bg-white/70 border-gray-300' : 'bg-[#141414] border-gray-800'
          }`}>
            {rules.map((rule) => (
              <div key={rule.id} className="flex items-center gap-2">
                {/* Field Selector */}
                <select
                  value={rule.field}
                  onChange={(e) => handleUpdateRule(rule.id, { field: e.target.value as SmartRule['field'] })}
                  className={`px-2.5 py-1.5 rounded border text-xs font-medium focus:outline-none ${
                    isLight ? 'bg-white border-gray-300 text-gray-900' : 'bg-[#222] border-gray-700 text-gray-100'
                  }`}
                >
                  {FIELD_OPTIONS.slice().sort((a, b) => a.label.localeCompare(b.label)).map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>

                {/* Operator Selector */}
                <select
                  value={rule.operator}
                  onChange={(e) => handleUpdateRule(rule.id, { operator: e.target.value as SmartRule['operator'] })}
                  className={`px-2.5 py-1.5 rounded border text-xs font-medium focus:outline-none ${
                    isLight ? 'bg-white border-gray-300 text-gray-900' : 'bg-[#222] border-gray-700 text-gray-100'
                  }`}
                >
                  {OPERATOR_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>

                {/* Value Input */}
                <input
                  type={rule.field === 'rating' || rule.field === 'playCount' || rule.field === 'year' || rule.field === 'bpm' ? 'number' : 'text'}
                  value={rule.value}
                  onChange={(e) => handleUpdateRule(rule.id, { value: e.target.value })}
                  placeholder={
                    rule.field === 'rating' 
                      ? '0 to 5' 
                      : rule.field === 'year' 
                      ? 'e.g. 2024' 
                      : rule.field === 'bpm'
                      ? 'e.g. 120'
                      : rule.field === 'mediaKind'
                      ? 'Music, Podcast, Audiobook...'
                      : rule.field === 'format'
                      ? 'MP3, AAC, FLAC, WAV...'
                      : 'e.g. Rock, Pop, Love'
                  }
                  className={`flex-1 min-w-[100px] px-2.5 py-1.5 rounded border text-xs font-medium focus:outline-none focus:ring-1 focus:ring-purple-500 ${
                    isLight ? 'bg-white border-gray-300 text-gray-900' : 'bg-[#222] border-gray-700 text-gray-100'
                  }`}
                />

                {/* Delete Rule Button */}
                <button
                  type="button"
                  onClick={() => handleRemoveRule(rule.id)}
                  disabled={rules.length === 1}
                  className={`p-1.5 rounded transition-colors ${
                    rules.length === 1
                      ? 'opacity-30 cursor-not-allowed'
                      : isLight
                      ? 'hover:bg-red-100 text-red-600'
                      : 'hover:bg-red-950/60 text-red-400'
                  }`}
                  title="Remove Rule"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}

            <button
              type="button"
              onClick={handleAddRule}
              className={`flex items-center gap-1.5 text-xs font-bold transition-colors pt-1 ${
                isLight ? 'text-purple-700 hover:text-purple-900' : 'text-purple-400 hover:text-purple-300'
              }`}
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add another rule</span>
            </button>
          </div>

          {/* Limit Toggle */}
          <div className="flex items-center gap-3 pt-1 text-xs">
            <label className="flex items-center gap-2 cursor-pointer font-medium">
              <input
                type="checkbox"
                checked={useLimit}
                onChange={(e) => setUseLimit(e.target.checked)}
                className="w-4 h-4 rounded text-purple-600 focus:ring-purple-500 accent-purple-600 cursor-pointer"
              />
              <span>Limit to</span>
            </label>
            {useLimit && (
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min={1}
                  max={500}
                  value={limit || 25}
                  onChange={(e) => setLimit(parseInt(e.target.value) || 25)}
                  className={`w-16 px-2 py-1 rounded border text-xs font-bold text-center focus:outline-none ${
                    isLight ? 'bg-white border-gray-300 text-gray-900' : 'bg-[#222] border-gray-700 text-white'
                  }`}
                />
                <span className="text-gray-500">items</span>
              </div>
            )}
          </div>

          {/* Modal Footer Buttons */}
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-gray-300 dark:border-gray-800">
            <button
              type="button"
              onClick={onClose}
              className={`px-4 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                isLight ? 'bg-white hover:bg-gray-100 text-gray-800 border-gray-300' : 'bg-[#282828] hover:bg-[#333] text-gray-300 border-gray-700'
              }`}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex items-center gap-1.5 px-5 py-1.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-lg text-xs font-bold shadow-md transition-all active:scale-95"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Save Smart Playlist</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

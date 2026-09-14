import React, { useState } from 'react';
import { X, FolderPlus } from 'lucide-react';

interface NewPlaylistModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (name: string) => void;
}

export const NewPlaylistModal: React.FC<NewPlaylistModalProps> = ({
  isOpen,
  onClose,
  onCreate,
}) => {
  const [name, setName] = useState('');

  const isMac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().indexOf('MAC') >= 0;

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim()) {
      onCreate(name.trim());
      setName('');
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150 select-none text-xs">
      <div className="w-full max-w-md max-h-[90vh] bg-[#1c1c1c] rounded-xl shadow-2xl border border-[#333] text-gray-200 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="bg-[#242424] px-4 py-2.5 border-b border-[#333] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            {isMac && (
              <>
                <span className="w-3 h-3 rounded-full bg-[#ff5f56] border border-[#e0443e] cursor-pointer" onClick={onClose} />
                <span className="w-3 h-3 rounded-full bg-[#ffbd2e] border border-[#dea123]" />
                <span className="w-3 h-3 rounded-full bg-[#27c93f] border border-[#1aab29]" />
              </>
            )}
            <span className="text-xs font-bold font-sans text-gray-200 ml-2">New Playlist</span>
          </div>
          {!isMac && (
            <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="p-5 bg-[#121212] space-y-4 overflow-y-auto custom-scrollbar flex-1">
          <div className="flex items-center gap-3">
            <FolderPlus className="w-8 h-8 text-indigo-400" />
            <div>
              <h3 className="font-bold text-sm text-white">Create Playlist</h3>
              <p className="text-gray-400 text-[11px]">Enter a name for your custom playlist</p>
            </div>
          </div>

          <div>
            <input
              type="text"
              autoFocus
              placeholder="e.g. Workout Beats, 80s Rock"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 bg-[#1f1f1f] border border-[#333] rounded-md focus:outline-none focus:border-indigo-500 font-medium text-gray-200"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 bg-[#262626] border border-[#3d3d3d] rounded-md text-xs font-medium text-gray-300 hover:bg-[#333] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim()}
              className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-md text-xs font-bold shadow-md transition-colors disabled:opacity-50"
            >
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

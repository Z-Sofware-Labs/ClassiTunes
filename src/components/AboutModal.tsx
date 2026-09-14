import React, { useEffect } from 'react';
import { X, ExternalLink } from 'lucide-react';
import { openExternalUrl } from '../utils/tauriWindow';
import { CURRENT_VERSION } from '../services/updaterService';

interface AboutModalProps {
  isOpen: boolean;
  onClose: () => void;
  theme?: 'dark' | 'light';
}

export const AboutModal: React.FC<AboutModalProps> = ({
  isOpen,
  onClose,
  theme = 'dark',
}) => {
  const isLight = theme === 'light';

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 select-none animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className={`relative w-full max-w-sm rounded-xl shadow-2xl border overflow-hidden transition-all animate-in zoom-in-95 duration-200 ${isLight
          ? 'bg-gradient-to-b from-[#ffffff] via-[#f8fafc] to-[#edf2f7] text-slate-800 border-slate-300 shadow-slate-900/30'
          : 'bg-gradient-to-b from-[#242428] via-[#1a1a1d] to-[#121214] text-slate-200 border-white/10 shadow-black/80'
          }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Header Bar */}
        <div className={`flex items-center justify-between px-3.5 py-2 border-b ${isLight ? 'bg-slate-100/90 border-slate-200' : 'bg-white/5 border-white/10'
          }`}>
          <span className={`text-[11px] font-semibold tracking-wide ${isLight ? 'text-slate-700' : 'text-slate-300'}`}>
            About ClassiTunes
          </span>
          <button
            onClick={onClose}
            className={`p-1 rounded-full transition-colors ${isLight ? 'hover:bg-slate-200 text-slate-500' : 'hover:bg-white/10 text-slate-400 hover:text-white'
              }`}
            title="Close"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 flex flex-col items-center text-center">
          {/* App Icon with Glow */}
          <div className="relative mb-3 group">
            <div className="absolute -inset-1 rounded-full bg-orange-500/20 blur-md" />
            <img
              src="/itunes-icon.png"
              alt="ClassiTunes Icon"
              className="relative w-20 h-20 rounded-full shadow-lg object-contain"
            />
          </div>

          {/* App Title & Version */}
          <h2 className={`text-xl font-bold tracking-tight mb-0.5 ${isLight ? 'text-slate-900' : 'text-white'}`}>
            ClassiTunes
          </h2>
          <p className={`text-xs font-mono font-medium mb-3.5 ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
            Version {CURRENT_VERSION}
          </p>

          {/* Copyright with Z Software Labs Logo */}
          <div className={`flex items-center justify-center gap-1.5 text-[11px] mb-3 flex-wrap ${isLight ? 'text-slate-600' : 'text-slate-300'
            }`}>
            <span>Copyright © 2026</span>
            <img
              src="/z-software-logo.png"
              alt="Z Software Labs"
              className="w-3.5 h-3.5 object-contain inline-block -mt-0.5"
            />
            <span className="font-semibold">Z Software Labs.</span>
            <span>All rights reserved.</span>
          </div>

          {/* Subtle Divider */}
          <div className={`w-full h-px my-2 ${isLight ? 'bg-slate-200' : 'bg-white/10'}`} />

          {/* Description */}
          <p className={`text-xs leading-relaxed max-w-xs mt-2 mb-3.5 ${isLight ? 'text-slate-600' : 'text-slate-300'
            }`}>
            ClassiTunes is a lightweight, utility-driven desktop jukebox application designed for effortless local music management.
          </p>

          {/* License Header / Link */}
          <div className={`text-[11px] mb-3 flex items-center justify-center gap-1 flex-wrap ${isLight ? 'text-slate-500' : 'text-slate-400'
            }`}>
            <span>This application is licensed under</span>
            <button
              type="button"
              onClick={() => openExternalUrl('https://opensource.org/licenses/MIT')}
              className="inline-flex items-center gap-0.5 font-semibold text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 underline underline-offset-2 transition-colors cursor-pointer"
              title="View MIT License"
            >
              MIT <ExternalLink className="w-2.5 h-2.5 ml-0.5 inline" />
            </button>
          </div>

          {/* License Text Snippet */}
          <div className={`w-full max-h-28 overflow-y-auto p-2.5 rounded border text-[10px] leading-relaxed text-left mb-5 select-text ${isLight
            ? 'bg-slate-50/80 border-slate-200 text-slate-600'
            : 'bg-black/30 border-white/10 text-slate-400'
            }`}>
            <p className="mb-2">
              Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the &quot;Software&quot;), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
            </p>
            <p className="mb-2">
              The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
            </p>
            <p>
              THE SOFTWARE IS PROVIDED &quot;AS IS&quot;, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
            </p>
          </div>

          {/* OK Button */}
          <button
            type="button"
            onClick={onClose}
            className={`px-6 py-1 text-xs font-semibold rounded-md shadow-sm border transition-all cursor-pointer ${isLight
              ? 'bg-gradient-to-b from-white to-slate-100 hover:from-slate-50 hover:to-slate-200 text-slate-800 border-slate-300 hover:border-slate-400 active:shadow-inner'
              : 'bg-gradient-to-b from-white/15 to-white/5 hover:from-white/20 hover:to-white/10 text-white border-white/15 hover:border-white/25 active:shadow-inner'
              }`}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
};

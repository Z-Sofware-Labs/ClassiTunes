import React, { useState, useRef, useEffect } from 'react';
import { Upload, FolderPlus, FileAudio, ChevronDown } from 'lucide-react';
import { isTauri, pickTauriFiles, pickTauriDirectory, scanTauriDirectory, convertPathsToFiles } from '../utils/tauriWindow';

interface ImportMusicButtonProps {
  onImportFiles: (files: FileList | File[] | string[]) => void;
  onStartImporting?: (statusText?: string) => void;
  isLight?: boolean;
  className?: string;
  buttonText?: string;
}

export const ImportMusicButton: React.FC<ImportMusicButtonProps> = ({
  onImportFiles,
  onStartImporting,
  isLight = false,
  className = '',
  buttonText = 'Import Music Files',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className={`relative inline-block ${className}`} ref={menuRef}>
      {/* Hidden File and Folder Inputs */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="audio/*,.mp3,.wav,.flac,.m4a,.aac,.ogg,.wma,.aiff,.alac"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            const files = e.target.files;
            onStartImporting?.(`Reading ${files.length} selected item${files.length > 1 ? 's' : ''}...`);
            setTimeout(() => {
              onImportFiles(files);
            }, 10);
            e.target.value = '';
          }
        }}
        className="hidden"
      />
      <input
        ref={folderInputRef}
        type="file"
        {...({ webkitdirectory: '', directory: '', multiple: true } as any)}
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            const files = e.target.files;
            onStartImporting?.('Scanning folder for music files...');
            setTimeout(() => {
              onImportFiles(files);
            }, 10);
            e.target.value = '';
          }
        }}
        className="hidden"
      />

      {/* Button with Dropdown Menu Toggle */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`px-4 py-2.5 rounded-lg font-semibold text-xs cursor-pointer shadow-lg flex items-center gap-2 transition-all hover:scale-105 active:scale-95 ${
          isLight
            ? 'bg-gradient-to-b from-blue-500 to-blue-700 text-white hover:from-blue-600 hover:to-blue-800 shadow-blue-500/20'
            : 'bg-gradient-to-b from-indigo-600 via-indigo-700 to-indigo-800 text-white hover:from-indigo-500 hover:to-indigo-700 shadow-indigo-900/40'
        }`}
      >
        <Upload className="w-4 h-4" />
        <span>{buttonText}</span>
        <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* Options Popover when clicked */}
      {isOpen && (
        <div className={`absolute left-1/2 -translate-x-1/2 mt-2 w-64 rounded-xl shadow-2xl border p-1.5 z-50 animate-in fade-in zoom-in-95 duration-150 ${
          isLight
            ? 'bg-white/95 border-gray-200 text-gray-800 backdrop-blur-md'
            : 'bg-[#252525]/95 border-gray-700 text-gray-100 backdrop-blur-md'
        }`}>
          <button
            type="button"
            onClick={async () => {
              setIsOpen(false);
              if (isTauri()) {
                const dir = await pickTauriDirectory();

                if (dir) {
                    const rootName =
                        dir.split(/[/\\]/).filter(Boolean).pop() || dir;

                    onStartImporting?.(
                        `Preparing to scan: ${rootName}...`
                    );

                    await new Promise<void>((resolve) => {
                        requestAnimationFrame((_time) => {
                            requestAnimationFrame(() => resolve());
                        });
                    });

                    const paths = await scanTauriDirectory(
                        dir,
                        (count, folder) => {
                            console.log(
                                '[ImportMusicButton] scan progress:',
                                count,
                                folder
                            );

                            const fName = folder || rootName;

                            onStartImporting?.(
                                `Scanning: ${fName} (found ${count} audio file${
                                    count !== 1 ? 's' : ''
                                })`
                            );
                        }
                    );

                    if (paths.length > 0) {
                        onImportFiles(paths);
                    }
                }
              } else {
                folderInputRef.current?.click();
              }
            }}
            className={`w-full text-left px-3 py-2 rounded-lg text-xs font-medium flex items-center gap-2.5 transition-colors cursor-pointer ${
              isLight ? 'hover:bg-blue-50 text-blue-900' : 'hover:bg-indigo-900/40 text-indigo-200'
            }`}
          >
            <FolderPlus className="w-4 h-4 text-emerald-500 flex-shrink-0" />
            <div>
              <div className="font-bold">Select Folder</div>
              <div className="text-[10px] text-gray-400">Scans all music files recursively</div>
            </div>
          </button>

          <button
            type="button"
            onClick={async () => {
              setIsOpen(false);
              if (isTauri()) {
                const paths = await pickTauriFiles();
                if (paths && paths.length > 0) {
                  onImportFiles(paths);
                }
              } else {
                fileInputRef.current?.click();
              }
            }}
            className={`w-full text-left px-3 py-2 rounded-lg text-xs font-medium flex items-center gap-2.5 transition-colors cursor-pointer ${
              isLight ? 'hover:bg-blue-50 text-blue-900' : 'hover:bg-indigo-900/40 text-indigo-200'
            }`}
          >
            <Upload className="w-4 h-4 text-blue-500 flex-shrink-0" />
            <div>
              <div className="font-bold">Select Music Files...</div>
              <div className="text-[10px] text-gray-400">Choose individual audio files</div>
            </div>
          </button>
        </div>
      )}
    </div>
  );
};

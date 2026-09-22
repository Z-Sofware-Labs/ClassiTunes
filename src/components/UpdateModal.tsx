import React, { useEffect, useState } from 'react';
import { X, ArrowDownCircle, CheckCircle2, AlertCircle, RefreshCw, Loader2, Sparkles } from 'lucide-react';
import {
  checkForAppUpdate,
  downloadAndInstallUpdate,
  UpdateInfo,
  CURRENT_VERSION,
} from '../services/updaterService';

interface UpdateModalProps {
  isOpen: boolean;
  onClose: () => void;
  theme?: 'dark' | 'light';
}

type UpdateStatus = 'checking' | 'available' | 'latest' | 'downloading' | 'error';

export const UpdateModal: React.FC<UpdateModalProps> = ({
  isOpen,
  onClose,
  theme = 'dark',
}) => {
  const isLight = theme === 'light';

  const [status, setStatus] = useState<UpdateStatus>('checking');
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [progressPercent, setProgressPercent] = useState<number>(0);
  const [progressStatusText, setProgressStatusText] = useState<string>('');

  const checkUpdate = async () => {
    setStatus('checking');
    setErrorMessage(null);
    setProgressPercent(0);
    setProgressStatusText('');

    try {
      const info = await checkForAppUpdate();
      setUpdateInfo(info);
      if (info.available) {
        setStatus('available');
      } else {
        setStatus('latest');
      }
    } catch (err: any) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
      setStatus('error');
    }
  };

  useEffect(() => {
    if (isOpen) {
      checkUpdate();
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && status !== 'downloading') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, status, onClose]);

  const handleStartUpdate = async () => {
    setStatus('downloading');
    setProgressPercent(5);
    setProgressStatusText('Starting download...');

    try {
      await downloadAndInstallUpdate((percent, statusText) => {
        setProgressPercent(percent);
        setProgressStatusText(statusText);
      });
    } catch (err: any) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
      setStatus('error');
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 select-none animate-in fade-in duration-150"
      onClick={status === 'downloading' ? undefined : onClose}
    >
      <div
        className={`relative w-full max-w-md rounded-xl shadow-2xl border overflow-hidden flex flex-col transition-all animate-in zoom-in-95 duration-200 ${
          isLight
            ? 'bg-gradient-to-b from-[#ffffff] via-[#f8fafc] to-[#edf2f7] text-slate-800 border-slate-300 shadow-slate-900/30'
            : 'bg-gradient-to-b from-[#242428] via-[#1a1a1d] to-[#121214] text-slate-200 border-white/10 shadow-black/80'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Strip */}
        <div
          className={`flex items-center justify-between px-4 py-3 border-b ${
            isLight ? 'bg-slate-100/90 border-slate-200' : 'bg-white/5 border-white/10'
          }`}
        >
          <div className="flex items-center gap-2">
            <ArrowDownCircle
              className={`w-4 h-4 ${isLight ? 'text-blue-600' : 'text-blue-400'}`}
            />
            <h2 className="text-xs font-bold tracking-wide uppercase">Software Update</h2>
          </div>
          {status !== 'downloading' && (
            <button
              onClick={onClose}
              className={`p-1 rounded-md transition-colors ${
                isLight
                  ? 'hover:bg-slate-200 text-slate-500'
                  : 'hover:bg-white/10 text-slate-400 hover:text-white'
              }`}
              title="Close"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Modal Content */}
        <div className="p-5 space-y-4">
          {/* Version Comparison Card */}
          <div
            className={`flex items-center justify-between p-3.5 rounded-lg border text-xs ${
              isLight ? 'bg-white border-slate-200' : 'bg-black/30 border-white/5'
            }`}
          >
            <div>
              <span className={`block text-[10px] uppercase font-semibold ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                Installed Version
              </span>
              <span className="font-mono font-bold text-sm">
                v{updateInfo?.currentVersion || CURRENT_VERSION}
              </span>
            </div>

            <div className="text-right">
              <span className={`block text-[10px] uppercase font-semibold ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                Latest Version
              </span>
              <span
                className={`font-mono font-bold text-sm ${
                  status === 'available'
                    ? 'text-emerald-500 font-extrabold'
                    : ''
                }`}
              >
                {status === 'checking'
                  ? 'Checking...'
                  : updateInfo?.version
                  ? `v${updateInfo.version}`
                  : `v${updateInfo?.currentVersion || CURRENT_VERSION}`}
              </span>
            </div>
          </div>

          {/* Status Banners */}
          {status === 'checking' && (
            <div
              className={`flex items-center gap-3 p-3.5 rounded-lg border text-xs ${
                isLight
                  ? 'bg-blue-50/80 border-blue-200 text-blue-800'
                  : 'bg-blue-950/30 border-blue-800/40 text-blue-300'
              }`}
            >
              <Loader2 className="w-4 h-4 animate-spin shrink-0 text-blue-500" />
              <span>Checking for updates from GitHub releases...</span>
            </div>
          )}

          {status === 'latest' && (
            <div
              className={`flex items-center gap-3 p-3.5 rounded-lg border text-xs ${
                isLight
                  ? 'bg-emerald-50/80 border-emerald-200 text-emerald-800'
                  : 'bg-emerald-950/30 border-emerald-800/40 text-emerald-300'
              }`}
            >
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-500" />
              <div>
                <p className="font-semibold">You're running the latest version!</p>
                <p className={`text-[11px] mt-0.5 ${isLight ? 'text-emerald-700' : 'text-emerald-400/80'}`}>
                  ClassiTunes v{updateInfo?.currentVersion || CURRENT_VERSION} is up to date.
                </p>
              </div>
            </div>
          )}

          {status === 'available' && (
            <div
              className={`flex items-center gap-3 p-3.5 rounded-lg border text-xs ${
                isLight
                  ? 'bg-blue-50/80 border-blue-200 text-blue-900'
                  : 'bg-blue-950/40 border-blue-800/50 text-blue-200'
              }`}
            >
              <Sparkles className="w-4 h-4 shrink-0 text-blue-500" />
              <div>
                <p className="font-semibold">New version available: v{updateInfo?.version}</p>
                {updateInfo?.date && (
                  <p className={`text-[10px] mt-0.5 ${isLight ? 'text-blue-700' : 'text-blue-300/80'}`}>
                    Released on {updateInfo.date}
                  </p>
                )}
              </div>
            </div>
          )}

          {status === 'error' && (
            <div
              className={`flex items-start gap-3 p-3.5 rounded-lg border text-xs ${
                isLight
                  ? 'bg-rose-50 border-rose-200 text-rose-900'
                  : 'bg-rose-950/40 border-rose-800/50 text-rose-200'
              }`}
            >
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-500 mt-0.5" />
              <div>
                <p className="font-semibold">Update Check or Installation Failed</p>
                <p className={`text-[10px] mt-0.5 break-words ${isLight ? 'text-rose-700' : 'text-rose-300/80'}`}>
                  {errorMessage || 'Unable to communicate with the update server.'}
                </p>
              </div>
            </div>
          )}



          {/* Download & Install Progress Bar */}
          {status === 'downloading' && (
            <div className="space-y-2 py-1">
              <div className="flex items-center justify-between text-xs font-semibold">
                <span className="flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500" />
                  {progressStatusText || 'Updating ClassiTunes...'}
                </span>
                <span className="font-mono text-blue-500">{progressPercent}%</span>
              </div>
              <div
                className={`w-full h-2 rounded-full overflow-hidden ${
                  isLight ? 'bg-slate-200' : 'bg-white/10'
                }`}
              >
                <div
                  className="h-full bg-blue-600 rounded-full transition-all duration-300 ease-out"
                  style={{ width: `${Math.max(5, progressPercent)}%` }}
                />
              </div>
              <p className={`text-[10px] text-center ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                Please wait. ClassiTunes will restart automatically once the update finishes.
              </p>
            </div>
          )}
        </div>

        {/* Modal Footer / Actions */}
        <div
          className={`flex items-center justify-between px-4 py-3 border-t text-xs ${
            isLight ? 'bg-slate-100/90 border-slate-200' : 'bg-white/5 border-white/10'
          }`}
        >
          {status !== 'downloading' ? (
            <button
              onClick={checkUpdate}
              disabled={status === 'checking'}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border font-medium transition-colors ${
                isLight
                  ? 'bg-white border-slate-300 hover:bg-slate-50 text-slate-700'
                  : 'bg-white/5 border-white/10 hover:bg-white/10 text-slate-300'
              }`}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${status === 'checking' ? 'animate-spin' : ''}`} />
              Check Again
            </button>
          ) : (
            <div />
          )}

          <div className="flex items-center gap-2">
            {status !== 'downloading' && (
              <button
                onClick={onClose}
                className={`px-3 py-1.5 rounded-md border font-medium transition-colors ${
                  isLight
                    ? 'bg-white border-slate-300 hover:bg-slate-50 text-slate-700'
                    : 'bg-white/5 border-white/10 hover:bg-white/10 text-slate-300'
                }`}
              >
                Close
              </button>
            )}

            {status === 'available' && (
              <button
                onClick={handleStartUpdate}
                className="px-4 py-1.5 rounded-md bg-blue-600 hover:bg-blue-500 text-white font-semibold flex items-center gap-1.5 shadow-md shadow-blue-500/20 transition-all cursor-pointer"
              >
                <ArrowDownCircle className="w-3.5 h-3.5" />
                Download & Restart
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

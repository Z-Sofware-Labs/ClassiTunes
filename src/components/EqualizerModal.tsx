import React, { useState } from 'react';
import { X } from 'lucide-react';
import { EqualizerBands, EQPreset } from '../types';
import { EQ_PRESETS, audioEngine } from '../services/audioEngine';

interface EqualizerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const EqualizerModal: React.FC<EqualizerModalProps> = ({ isOpen, onClose }) => {
  const [isEnabled, setIsEnabled] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState<EQPreset>('Flat');
  const [bands, setBands] = useState<EqualizerBands>(EQ_PRESETS['Flat']);

  if (!isOpen) return null;

  const handlePresetChange = (preset: EQPreset) => {
    setSelectedPreset(preset);
    const newBands = EQ_PRESETS[preset];
    setBands(newBands);
    if (isEnabled) {
      audioEngine.setEQPreset(newBands);
    }
  };

  const handleBandChange = (freqKey: keyof EqualizerBands, value: number) => {
    const updated = { ...bands, [freqKey]: value };
    setBands(updated);
    if (isEnabled) {
      audioEngine.setEQPreset(updated);
    }
  };

  const handleToggleEnable = () => {
    const nextState = !isEnabled;
    setIsEnabled(nextState);
    if (nextState) {
      audioEngine.setEQPreset(bands);
    } else {
      audioEngine.setEQPreset(EQ_PRESETS['Flat']);
    }
  };

  const bandKeys: { key: keyof EqualizerBands; label: string }[] = [
    { key: 'b32', label: '32' },
    { key: 'b64', label: '64' },
    { key: 'b125', label: '125' },
    { key: 'b250', label: '250' },
    { key: 'b500', label: '500' },
    { key: 'b1k', label: '1K' },
    { key: 'b2k', label: '2K' },
    { key: 'b4k', label: '4K' },
    { key: 'b8k', label: '8K' },
    { key: 'b16k', label: '16K' },
  ];

  const isMac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().indexOf('MAC') >= 0;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150">
      {/* Dark Theme Metallic Window Box */}
      <div className="w-full max-w-lg max-h-[90vh] bg-[#1c1c1c] rounded-xl shadow-2xl border border-[#333] select-none text-gray-200 overflow-hidden flex flex-col">
        {/* Window Header */}
        <div className="bg-[#242424] px-4 py-2.5 border-b border-[#333] flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-2">
            {isMac && (
              <>
                <span className="w-3 h-3 rounded-full bg-[#ff5f56] border border-[#e0443e] cursor-pointer" onClick={onClose} />
                <span className="w-3 h-3 rounded-full bg-[#ffbd2e] border border-[#dea123]" />
                <span className="w-3 h-3 rounded-full bg-[#27c93f] border border-[#1aab29]" />
              </>
            )}
            <span className="text-xs font-bold font-sans text-gray-200 ml-2">Equalizer</span>
          </div>
          {!isMac && (
            <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* EQ Body */}
        <div className="p-4 flex flex-col gap-4 overflow-y-auto custom-scrollbar flex-1">
          {/* Top Controls: On/Off Checkbox + Preset Dropdown */}
          <div className="flex items-center justify-between bg-[#141414] p-3 rounded-lg border border-[#2b2b2b]">
            <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-gray-200">
              <input
                type="checkbox"
                checked={isEnabled}
                onChange={handleToggleEnable}
                className="w-4 h-4 rounded text-indigo-500 focus:ring-indigo-500 cursor-pointer accent-indigo-500"
              />
              <span>On</span>
            </label>

            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-gray-400">Preset:</span>
              <select
                value={selectedPreset}
                onChange={(e) => handlePresetChange(e.target.value as EQPreset)}
                disabled={!isEnabled}
                className="bg-[#262626] border border-[#3d3d3d] rounded-md px-2.5 py-1 text-xs font-medium text-gray-200 shadow-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
              >
                {Object.keys(EQ_PRESETS).map((p) => (
                  <option key={p} value={p} className="bg-[#262626] text-gray-200">
                    {p}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* 10-Band Vertical Slider Graphic Spectrum */}
          <div className={`bg-[#121212] rounded-lg p-4 border border-[#2b2b2b] shadow-inner flex justify-between items-center overflow-x-auto custom-scrollbar ${
            isEnabled ? 'opacity-100' : 'opacity-40 pointer-events-none'
          }`}>
            <div className="flex flex-col justify-between text-[9px] font-mono text-indigo-400 h-36 pr-2 border-r border-[#222] shrink-0">
              <span>+12dB</span>
              <span>0dB</span>
              <span>-12dB</span>
            </div>

            <div className="flex-1 flex justify-around items-center pl-2 min-w-[420px]">
              {bandKeys.map(({ key, label }) => (
                <div key={key} className="flex flex-col items-center gap-2 h-36">
                  <span className="text-[10px] font-mono text-indigo-300 font-semibold">
                    {bands[key] > 0 ? `+${bands[key]}` : bands[key]}
                  </span>
                  
                  <div className="flex-1 relative flex items-center">
                    <input
                      type="range"
                      min="-12"
                      max="12"
                      step="0.5"
                      value={bands[key]}
                      onChange={(e) => handleBandChange(key, parseFloat(e.target.value))}
                      className="h-24 w-1.5 appearance-none bg-[#1f1f1f] border border-[#333] rounded cursor-pointer accent-indigo-500 [writing-mode:vertical-lr] [direction:rtl]"
                    />
                  </div>

                  <span className="text-[10px] font-mono text-gray-400">
                    {label}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-[#333] bg-[#161616] flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-md text-xs font-bold shadow-md transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

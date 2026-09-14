import React, { useEffect, useRef, useState } from 'react';
import { X, Maximize2, Minimize2, Sparkles, Activity, Radio, Orbit } from 'lucide-react';
import { audioEngine } from '../services/audioEngine';
import { VisualizerMode } from '../types';

interface VisualizerModalProps {
  isOpen: boolean;
  onClose: () => void;
  trackTitle?: string;
  artistName?: string;
}

export const VisualizerModal: React.FC<VisualizerModalProps> = ({
  isOpen,
  onClose,
  trackTitle = 'Now Playing',
  artistName = 'ClassiTunes Visualizer',
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [mode, setMode] = useState<VisualizerMode>('classic_bars');
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    let animationFrameId: number;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const bufferLength = 128;
    const dataArray = new Uint8Array(bufferLength);
    const waveformArray = new Uint8Array(bufferLength);

    let hue = 0;

    const render = () => {
      const parentW = canvas.parentElement?.clientWidth || 800;
      const parentH = canvas.parentElement?.clientHeight || 500;
      if (canvas.width !== parentW) canvas.width = parentW;
      if (canvas.height !== parentH) canvas.height = parentH;

      const width = canvas.width;
      const height = canvas.height;

      audioEngine.getAnalyserData(dataArray);
      audioEngine.getWaveformData(waveformArray);

      hue = (hue + 0.5) % 360;

      // Dark glossy canvas background
      ctx.fillStyle = 'rgba(5, 8, 15, 0.25)';
      ctx.fillRect(0, 0, width, height);

      if (mode === 'classic_bars') {
        // Classic Spectrum Analyzer Bars
        const barWidth = (width / bufferLength) * 2.2;
        let x = 0;

        for (let i = 0; i < bufferLength; i++) {
          const barHeight = (dataArray[i] / 255) * height * 0.75;

          const gradient = ctx.createLinearGradient(0, height, 0, height - barHeight);
          gradient.addColorStop(0, `hsl(${(i * 3 + hue) % 360}, 100%, 50%)`);
          gradient.addColorStop(0.5, `hsl(${(i * 3 + hue + 40) % 360}, 100%, 60%)`);
          gradient.addColorStop(1, `#ffffff`);

          ctx.fillStyle = gradient;
          ctx.fillRect(x, height - barHeight, barWidth - 2, barHeight);

          // Top peak LED dot
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(x, height - barHeight - 4, barWidth - 2, 2);

          x += barWidth;
        }
      } else if (mode === 'laser_wave') {
        // Neon Oscilloscope Sine Wave
        ctx.lineWidth = 3;
        ctx.strokeStyle = `hsl(${hue}, 100%, 65%)`;
        ctx.shadowBlur = 15;
        ctx.shadowColor = `hsl(${hue}, 100%, 50%)`;

        ctx.beginPath();
        const sliceWidth = width / bufferLength;
        let x = 0;

        for (let i = 0; i < bufferLength; i++) {
          const v = waveformArray[i] / 128.0;
          const y = (v * height) / 2;

          if (i === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }

          x += sliceWidth;
        }

        ctx.lineTo(width, height / 2);
        ctx.stroke();
        ctx.shadowBlur = 0;
      } else if (mode === 'frequency_ring') {
        // Circular Radial Frequency Visualizer
        const centerX = width / 2;
        const centerY = height / 2;
        const radius = Math.min(width, height) * 0.22;

        ctx.save();
        ctx.translate(centerX, centerY);

        for (let i = 0; i < bufferLength; i++) {
          const barHeight = (dataArray[i] / 255) * 120;
          const angle = (i / bufferLength) * Math.PI * 2;

          const x1 = Math.cos(angle) * radius;
          const y1 = Math.sin(angle) * radius;
          const x2 = Math.cos(angle) * (radius + barHeight);
          const y2 = Math.sin(angle) * (radius + barHeight);

          ctx.strokeStyle = `hsl(${(i * 4 + hue) % 360}, 90%, 60%)`;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        }

        // Central Pulsing Core
        ctx.beginPath();
        const avgFreq = dataArray.reduce((a, b) => a + b, 0) / bufferLength;
        const pulseRadius = radius * (0.8 + (avgFreq / 255) * 0.3);
        ctx.arc(0, 0, pulseRadius, 0, Math.PI * 2);
        ctx.fillStyle = `hsl(${hue}, 80%, 40%)`;
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.restore();
      } else {
        // Cosmic Particles Starfield Burst
        const centerX = width / 2;
        const centerY = height / 2;

        for (let i = 0; i < bufferLength; i += 2) {
          const val = dataArray[i];
          const angle = (i / bufferLength) * Math.PI * 2 + (hue * Math.PI) / 180;
          const dist = (val / 255) * (Math.min(width, height) * 0.45);

          const px = centerX + Math.cos(angle) * dist;
          const py = centerY + Math.sin(angle) * dist;

          ctx.fillStyle = `hsl(${(i * 5 + hue) % 360}, 100%, 70%)`;
          ctx.beginPath();
          ctx.arc(px, py, (val / 255) * 8 + 2, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [isOpen, mode]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex flex-col justify-between animate-in fade-in duration-200">
      {/* Header Bar */}
      <div className="p-4 bg-gradient-to-b from-gray-900/90 to-transparent flex items-center justify-between z-10">
        <div>
          <h2 className="text-white text-sm font-bold tracking-wide font-sans">{trackTitle}</h2>
          <p className="text-cyan-400 text-xs font-mono">{artistName}</p>
        </div>

        {/* Visualizer Mode Selector */}
        <div className="flex items-center gap-2 bg-gray-800/80 p-1 rounded-lg border border-gray-700">
          <button
            onClick={() => setMode('classic_bars')}
            className={`px-2.5 py-1 rounded text-xs flex items-center gap-1.5 transition-colors ${
              mode === 'classic_bars' ? 'bg-blue-600 text-white font-bold' : 'text-gray-400 hover:text-white'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            <span>Spectrum</span>
          </button>
          <button
            onClick={() => setMode('laser_wave')}
            className={`px-2.5 py-1 rounded text-xs flex items-center gap-1.5 transition-colors ${
              mode === 'laser_wave' ? 'bg-blue-600 text-white font-bold' : 'text-gray-400 hover:text-white'
            }`}
          >
            <Radio className="w-3.5 h-3.5" />
            <span>Oscilloscope</span>
          </button>
          <button
            onClick={() => setMode('frequency_ring')}
            className={`px-2.5 py-1 rounded text-xs flex items-center gap-1.5 transition-colors ${
              mode === 'frequency_ring' ? 'bg-blue-600 text-white font-bold' : 'text-gray-400 hover:text-white'
            }`}
          >
            <Orbit className="w-3.5 h-3.5" />
            <span>Radial Ring</span>
          </button>
          <button
            onClick={() => setMode('cosmic_particles')}
            className={`px-2.5 py-1 rounded text-xs flex items-center gap-1.5 transition-colors ${
              mode === 'cosmic_particles' ? 'bg-blue-600 text-white font-bold' : 'text-gray-400 hover:text-white'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Cosmic</span>
          </button>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="p-2 text-gray-400 hover:text-white rounded bg-gray-800/60 border border-gray-700"
            title="Toggle Fullscreen"
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-white rounded bg-gray-800/60 border border-gray-700 hover:bg-red-600"
            title="Close Visualizer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main Canvas Stage */}
      <div className="flex-1 w-full h-full relative flex items-center justify-center">
        <canvas ref={canvasRef} className="w-full h-full block" />
      </div>

      {/* Footer Instructions */}
      <div className="p-3 text-center text-xs text-gray-500 font-mono">
        Press ESC or click X to return to ClassiTunes
      </div>
    </div>
  );
};

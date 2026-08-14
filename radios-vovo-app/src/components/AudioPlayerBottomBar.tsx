import React from 'react';
import { Play, Pause, Volume2, VolumeX, Moon, AlertCircle, Loader2 } from 'lucide-react';
import type { RadioStation } from '../types';

interface AudioPlayerBottomBarProps {
  currentStation: RadioStation | null;
  isPlaying: boolean;
  isLoading: boolean;
  hasError: boolean;
  onTogglePlay: () => void;
  volume: number;
  isMuted: boolean;
  onAdjustVolume: (delta: number) => void;
  onToggleMute: () => void;
  onOpenSleepTimer: () => void;
  sleepMinutesLeft: number | null;
  bigText: boolean;
}

export const AudioPlayerBottomBar: React.FC<AudioPlayerBottomBarProps> = ({
  currentStation,
  isPlaying,
  isLoading,
  hasError,
  onTogglePlay,
  volume,
  isMuted,
  onAdjustVolume,
  onToggleMute,
  onOpenSleepTimer,
  sleepMinutesLeft,
  bigText
}) => {
  if (!currentStation) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-slate-900/95 border-t-2 border-amber-400/80 shadow-2xl backdrop-blur-xl p-3 sm:p-4">
      <div className="max-w-6xl mx-auto flex items-center justify-between gap-3">
        {/* Left: Station info & Wave visualizer */}
        <div className="flex items-center gap-3 min-w-0 flex-1">
          {/* Animated Wave or Loading Icon */}
          <div className="w-12 h-12 rounded-2xl bg-amber-400/20 border border-amber-400/40 flex items-center justify-center text-amber-400 flex-shrink-0">
            {isLoading ? (
              <Loader2 className="w-6 h-6 animate-spin" />
            ) : isPlaying ? (
              <div className="flex items-end gap-1 h-6">
                <span className="w-1 bg-amber-400 rounded-full wave-bar-1"></span>
                <span className="w-1 bg-amber-400 rounded-full wave-bar-2"></span>
                <span className="w-1 bg-amber-400 rounded-full wave-bar-3"></span>
                <span className="w-1 bg-amber-400 rounded-full wave-bar-4"></span>
                <span className="w-1 bg-amber-400 rounded-full wave-bar-5"></span>
              </div>
            ) : hasError ? (
              <AlertCircle className="w-6 h-6 text-rose-400" />
            ) : (
              <Play className="w-6 h-6" />
            )}
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping"></span>
              <span className="text-[11px] font-black text-emerald-400 uppercase tracking-wider">
                {isLoading ? 'Conectando...' : hasError ? 'Erro no sinal' : 'Tocando ao vivo'}
              </span>
            </div>
            <h4
              className={`font-black text-white truncate ${
                bigText ? 'text-lg' : 'text-base'
              }`}
            >
              {currentStation.name}
            </h4>
            <p className="text-xs text-slate-400 truncate">
              {currentStation.freq ? `${currentStation.freq} • ` : ''}
              {currentStation.city || currentStation.genre}
            </p>
          </div>
        </div>

        {/* Center/Right: Controls */}
        <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
          {/* Volume quick adjustments */}
          <div className="hidden sm:flex items-center gap-1 bg-slate-800/80 rounded-2xl p-1 border border-slate-700">
            <button
              onClick={() => onAdjustVolume(-0.1)}
              className="px-2 py-1 text-slate-300 hover:text-white font-black text-lg"
              title="Diminuir Volume"
            >
              -
            </button>
            <button
              onClick={onToggleMute}
              className="p-1.5 text-sky-400"
              title="Mutar"
            >
              {isMuted || volume === 0 ? <VolumeX className="w-5 h-5 text-rose-400" /> : <Volume2 className="w-5 h-5" />}
            </button>
            <button
              onClick={() => onAdjustVolume(0.1)}
              className="px-2 py-1 text-slate-300 hover:text-white font-black text-lg"
              title="Aumentar Volume"
            >
              +
            </button>
          </div>

          {/* Sleep timer shortcut */}
          <button
            onClick={onOpenSleepTimer}
            className={`p-3 rounded-2xl border transition active:scale-90 ${
              sleepMinutesLeft !== null
                ? 'bg-amber-400 text-slate-950 border-amber-300 shadow-lg shadow-amber-400/20'
                : 'bg-slate-800 text-slate-300 border-slate-700 hover:text-white'
            }`}
            title="Timer Soneca para dormir ouvindo"
          >
            <Moon className="w-6 h-6" />
          </button>

          {/* Huge Play/Pause Button */}
          <button
            onClick={onTogglePlay}
            className={`p-4 rounded-2xl font-black text-slate-950 shadow-xl transition active:scale-90 flex items-center justify-center ${
              isPlaying
                ? 'bg-rose-500 text-white shadow-rose-500/30'
                : 'bg-amber-400 hover:bg-amber-500 shadow-amber-400/30'
            }`}
            title={isPlaying ? 'Pausar' : 'Tocar'}
          >
            {isPlaying ? (
              <Pause className="w-8 h-8 fill-current" />
            ) : (
              <Play className="w-8 h-8 fill-current translate-x-0.5" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

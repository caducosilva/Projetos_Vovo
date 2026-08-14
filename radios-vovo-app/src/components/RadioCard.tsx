import React from 'react';
import { Play, Pause, Heart, Radio, MapPin } from 'lucide-react';
import type { RadioStation } from '../types';

interface RadioCardProps {
  station: RadioStation;
  isPlaying: boolean;
  isCurrent: boolean;
  isFavorite: boolean;
  onPlay: (station: RadioStation) => void;
  onToggleFavorite: (station: RadioStation) => void;
  bigText: boolean;
}

export const RadioCard: React.FC<RadioCardProps> = ({
  station,
  isPlaying,
  isCurrent,
  isFavorite,
  onPlay,
  onToggleFavorite,
  bigText
}) => {
  return (
    <div
      onClick={() => onPlay(station)}
      className={`relative group bg-slate-900/90 rounded-3xl p-4 border transition-all duration-200 cursor-pointer flex flex-col justify-between shadow-lg active:scale-[0.98] ${
        isCurrent
          ? 'border-amber-400/80 bg-slate-850 shadow-amber-500/10 ring-2 ring-amber-400/40'
          : 'border-slate-800/90 hover:border-slate-700 hover:bg-slate-850/80'
      }`}
    >
      {/* Top row: Radio Icon / Logo, Frequency, and Heart button */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-3">
          <div
            className={`w-14 h-14 rounded-2xl flex items-center justify-center font-black transition ${
              isCurrent && isPlaying
                ? 'bg-amber-400 text-slate-950 shadow-md shadow-amber-400/30'
                : 'bg-slate-800 text-amber-400 border border-slate-700'
            }`}
          >
            {station.logo ? (
              <img
                src={station.logo}
                alt={station.name}
                className="w-10 h-10 object-contain rounded-xl"
                onError={(e) => {
                  (e.target as HTMLElement).style.display = 'none';
                }}
              />
            ) : (
              <Radio className="w-7 h-7" />
            )}
          </div>

          <div>
            <div className="flex items-center gap-1.5 flex-wrap">
              {station.freq && (
                <span className="bg-amber-400/15 border border-amber-400/30 text-amber-300 font-extrabold text-xs px-2.5 py-0.5 rounded-full">
                  {station.freq}
                </span>
              )}
              {station.state && (
                <span className="bg-slate-800 text-slate-300 font-bold text-[11px] px-2 py-0.5 rounded-full flex items-center gap-1 border border-slate-700">
                  <MapPin className="w-3 h-3 text-sky-400" />
                  {station.state}
                </span>
              )}
            </div>
            <span className="text-xs text-slate-400 font-medium block mt-1 line-clamp-1">
              {station.city || station.genre}
            </span>
          </div>
        </div>

        {/* Favorite Heart Button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite(station);
          }}
          className={`p-2.5 rounded-2xl transition active:scale-90 ${
            isFavorite
              ? 'bg-rose-500/20 text-rose-400 border border-rose-500/40'
              : 'bg-slate-800/80 text-slate-400 hover:text-white border border-slate-700/60'
          }`}
          title={isFavorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
        >
          <Heart className={`w-5 h-5 ${isFavorite ? 'fill-current text-rose-500' : ''}`} />
        </button>
      </div>

      {/* Station Name */}
      <div className="mb-4">
        <h3
          className={`font-black text-white leading-snug line-clamp-2 ${
            bigText ? 'text-xl' : 'text-base'
          }`}
        >
          {station.name}
        </h3>
        <p className="text-xs text-slate-400 font-medium mt-1 line-clamp-1">
          {station.genre}
        </p>
      </div>

      {/* Big Action Button */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onPlay(station);
        }}
        className={`w-full py-3 px-4 rounded-2xl font-black flex items-center justify-center gap-2.5 transition active:scale-95 shadow-md ${
          isCurrent && isPlaying
            ? 'bg-rose-500 hover:bg-rose-600 text-white shadow-rose-500/20'
            : isCurrent
            ? 'bg-amber-400 hover:bg-amber-500 text-slate-950 shadow-amber-400/20'
            : 'bg-amber-400 hover:bg-amber-500 text-slate-950 shadow-amber-400/20'
        } ${bigText ? 'text-lg' : 'text-base'}`}
      >
        {isCurrent && isPlaying ? (
          <>
            <Pause className="w-6 h-6 fill-current" />
            <span>Pausar Rádio</span>
          </>
        ) : (
          <>
            <Play className="w-6 h-6 fill-current" />
            <span>{isCurrent ? 'Continuar Ouvindo' : 'Ouvir Agora'}</span>
          </>
        )}
      </button>
    </div>
  );
};

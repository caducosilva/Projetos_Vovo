import React from 'react';
import { Play, Star, Tv, Radio } from 'lucide-react';
import type { ChannelWithHealth } from '../types';
import { SignalBars } from './SignalBars';

interface ChannelCardProps {
  channel: ChannelWithHealth;
  isFavorite: boolean;
  onSelect: (channel: ChannelWithHealth) => void;
  onToggleFavorite: (channel: ChannelWithHealth) => void;
}

export const ChannelCard: React.FC<ChannelCardProps> = React.memo(({
  channel,
  isFavorite,
  onSelect,
  onToggleFavorite
}) => {
  const isDead = channel.health === 'dead';
  const isRadio = Boolean(
    channel.isRadio ||
    (channel.group || '').toLowerCase().includes('rádio') ||
    (channel.group || '').toLowerCase().includes('radio') ||
    (channel.name || '').startsWith('📻')
  );

  return (
    <div
      onClick={() => onSelect(channel)}
      className={`group relative bg-slate-800/80 hover:bg-slate-800 border rounded-3xl p-3.5 flex flex-col justify-between gap-2.5 cursor-pointer transition-transform duration-150 active:scale-95 shadow-md overflow-hidden ${
        isDead
          ? 'border-rose-900/40 opacity-60'
          : isRadio
          ? 'border-amber-500/30 hover:border-amber-400'
          : 'border-slate-800 hover:border-amber-400/60'
      }`}
    >
      {/* Top row: Logo + Favorite button */}
      <div className="flex items-start justify-between gap-2">
        <div className="w-12 h-12 bg-slate-900 rounded-2xl p-1.5 flex items-center justify-center border border-slate-700/50 shadow-inner group-hover:scale-105 transition shrink-0">
          {channel.logo ? (
            <img
              src={channel.logo}
              alt={channel.name}
              loading="lazy"
              className="w-full h-full object-contain"
              onError={(e) => {
                (e.target as HTMLElement).style.display = 'none';
              }}
            />
          ) : isRadio ? (
            <Radio className="w-6 h-6 text-amber-400" />
          ) : (
            <Tv className="w-6 h-6 text-slate-500" />
          )}
        </div>

        {/* Favorite Button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite(channel);
          }}
          className={`p-2 rounded-xl transition active:scale-90 ${
            isFavorite
              ? 'bg-amber-400/20 text-amber-400'
              : 'text-slate-400 hover:text-white bg-slate-800/60'
          }`}
          title={isFavorite ? 'Remover dos Favoritos' : 'Adicionar aos Favoritos'}
        >
          <Star className={`w-4 h-4 ${isFavorite ? 'fill-amber-400 text-amber-400' : ''}`} />
        </button>
      </div>

      {/* Middle: Channel Name & Category */}
      <div className="flex-1 flex flex-col justify-center min-w-0">
        <h3 className="text-white text-sm sm:text-base font-black truncate leading-snug group-hover:text-amber-300 transition">
          {channel.name}
        </h3>
        <p className="text-slate-400 text-[11px] font-bold mt-0.5 truncate">
          {channel.group || (isRadio ? 'Rádio ao Vivo' : 'Canais Abertos')}
        </p>
      </div>

      {/* Força do sinal e botão assistir sem vazar da grade */}
      <div className="pt-2 border-t border-slate-800 flex items-center justify-between gap-1.5 overflow-hidden">
        <div className="flex items-center gap-1 shrink-0">
          <SignalBars
            score={channel.signalStrength}
            status={channel.health}
            latencyMs={channel.latencyMs}
            compact
            showText={false}
          />
          <span className="text-[10px] font-bold text-slate-400 truncate max-w-[45px]">
            {channel.latencyMs
              ? `${channel.latencyMs}ms`
              : isDead
              ? 'off'
              : '—'}
          </span>
        </div>

        <span
          className={`flex items-center gap-1 px-2.5 py-1 rounded-xl font-black text-[11px] transition shadow shrink-0 ${
            isDead
              ? 'bg-slate-700 text-slate-300'
              : isRadio
              ? 'bg-amber-500 text-slate-950 group-hover:bg-amber-400'
              : 'bg-amber-400 text-slate-950 group-hover:bg-amber-300'
          }`}
        >
          {isRadio ? <Radio className="w-3 h-3" /> : <Play className="w-3 h-3 fill-current" />}
          {isDead ? 'Tentar' : isRadio ? 'Ouvir' : 'Assistir'}
        </span>
      </div>
    </div>
  );
}, (prev, next) => {
  return (
    prev.channel.url === next.channel.url &&
    prev.channel.health === next.channel.health &&
    prev.channel.signalStrength === next.channel.signalStrength &&
    prev.isFavorite === next.isFavorite
  );
});

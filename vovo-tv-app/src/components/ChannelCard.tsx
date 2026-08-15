import React, { useState } from 'react';
import { Play, Star, Radio, Video } from 'lucide-react';
import type { ChannelWithHealth } from '../types';
import { ehCanalDeCamera } from '../utils/cameras';
import {
  cleanChannelName,
  channelInitials,
  channelColor,
  isRadioChannel,
  ehImagemRemovida
} from '../utils/channelName';

interface ChannelCardProps {
  channel: ChannelWithHealth;
  isFavorite: boolean;
  onSelect: (channel: ChannelWithHealth) => void;
  onToggleFavorite: (channel: ChannelWithHealth) => void;
}

/**
 * Cartao de canal.
 *
 * O cartao inteiro e o botao de assistir. A estrela e o unico alvo separado, e
 * fica no canto oposto com folga grande em volta, porque errar a estrela
 * querendo assistir era o engano mais comum da vovo na versao anterior.
 */
export const ChannelCard: React.FC<ChannelCardProps> = React.memo(
  ({ channel, isFavorite, onSelect, onToggleFavorite }) => {
    const [logoQuebrou, setLogoQuebrou] = useState(false);

    const radio = isRadioChannel(channel);
    const camera = ehCanalDeCamera(channel);
    const nome = cleanChannelName(channel.name);
    const temLogo = Boolean(channel.logo) && channel.logo.startsWith('http') && !logoQuebrou;

    return (
      <div className="relative">
        <button
          onClick={() => onSelect(channel)}
          className="flex w-full flex-col gap-3 rounded-3xl border-2 border-noite-600 bg-noite-700 p-3 text-left transition active:scale-95 active:border-sol-400"
          aria-label={`Assistir ${nome}`}
        >
          {/* Marca do canal: logo real, ou as iniciais em cor fixa quando nao tem */}
          <div className="flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-2xl bg-noite-800">
            {temLogo ? (
              <img
                src={channel.logo}
                alt=""
                loading="lazy"
                decoding="async"
                className="h-full w-full object-contain p-2"
                onError={() => setLogoQuebrou(true)}
                onLoad={(e) => {
                  const img = e.currentTarget;
                  if (ehImagemRemovida(img.naturalWidth, img.naturalHeight)) {
                    setLogoQuebrou(true);
                  }
                }}
              />
            ) : camera ? (
              // Camera de casa nao tem logo e nao deve parecer emissora: o
              // desenho da camera e o que a vovo reconhece de longe.
              <span
                className="flex h-full w-full items-center justify-center bg-noite-600 text-vivo-400"
                aria-hidden="true"
              >
                <Video className="h-14 w-14" strokeWidth={2} />
              </span>
            ) : (
              <span
                className="flex h-full w-full items-center justify-center text-4xl font-black tracking-tight text-white sm:text-5xl"
                style={{ backgroundColor: channelColor(channel.url || nome) }}
                aria-hidden="true"
              >
                {channelInitials(nome)}
              </span>
            )}
          </div>

          <h3 className="duas-linhas min-h-[2.7rem] text-lg leading-snug font-black text-tinta-100">
            {nome}
          </h3>

          <span className="flex h-toque items-center justify-center gap-2 rounded-2xl bg-sol-400 text-xl font-black text-noite-900">
            {radio ? (
              <Radio className="h-6 w-6" strokeWidth={2.5} />
            ) : camera ? (
              <Video className="h-6 w-6" strokeWidth={2.5} />
            ) : (
              <Play className="h-6 w-6 fill-current" />
            )}
            {radio ? 'Ouvir' : camera ? 'Ver' : 'Assistir'}
          </span>
        </button>

        {/* Fora do botao principal para o toque nao vazar de um para o outro */}
        <button
          onClick={() => onToggleFavorite(channel)}
          className={`absolute top-2 right-2 flex h-14 w-14 items-center justify-center rounded-2xl border-2 transition active:scale-90 ${
            isFavorite
              ? 'border-sol-400 bg-sol-400 text-noite-900'
              : 'border-noite-500 bg-noite-900/85 text-tinta-300'
          }`}
          aria-label={isFavorite ? `Tirar ${nome} dos favoritos` : `Guardar ${nome} nos favoritos`}
          aria-pressed={isFavorite}
        >
          <Star className={`h-7 w-7 ${isFavorite ? 'fill-current' : ''}`} strokeWidth={2.5} />
        </button>
      </div>
    );
  },
  (anterior, novo) =>
    anterior.channel.url === novo.channel.url &&
    anterior.channel.name === novo.channel.name &&
    anterior.isFavorite === novo.isFavorite
);

ChannelCard.displayName = 'ChannelCard';

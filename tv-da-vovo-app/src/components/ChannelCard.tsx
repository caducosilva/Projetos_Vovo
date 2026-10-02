import React, { useState } from 'react';
import { Play, Radio, Video } from 'lucide-react';
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
  numero: number;
  isFocused?: boolean;
  onSelect: (channel: ChannelWithHealth) => void;
}

/** Cartao de canal: o cartao inteiro e o botao de assistir. */
export const ChannelCard: React.FC<ChannelCardProps> = React.memo(
  ({ channel, numero, isFocused = false, onSelect }) => {
    const [logoQuebrou, setLogoQuebrou] = useState(false);

    const radio = isRadioChannel(channel);
    const camera = ehCanalDeCamera(channel);
    const nome = cleanChannelName(channel.name);
    const temLogo = Boolean(channel.logo) && channel.logo.startsWith('http') && !logoQuebrou;

    return (
      <button
        onClick={() => onSelect(channel)}
        tabIndex={0}
        data-channel-card="true"
        className={`relative flex w-full flex-col gap-2.5 rounded-3xl p-3 text-left transition-all duration-150 ${
          isFocused
            ? 'scale-[1.06] border-4 border-sol-400 bg-noite-600 shadow-[0_0_35px_rgba(251,191,36,0.9)] z-20'
            : 'border-2 border-noite-600 bg-noite-700 hover:border-noite-500'
        } focus-visible:border-sol-400 focus-visible:scale-[1.06] active:scale-95`}
        aria-label={`Canal ${numero}: Assistir ${nome}`}
      >
        {/* Numero do canal: pra vovo dizer "o 12 nao funciona" em vez do nome */}
        <span className="absolute top-2 left-2 z-10 flex h-8 min-w-8 items-center justify-center rounded-xl bg-noite-900/90 px-1.5 text-base font-black text-sol-400">
          {numero}
        </span>

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
    );
  },
  (anterior, novo) =>
    anterior.channel.url === novo.channel.url &&
    anterior.channel.name === novo.channel.name &&
    anterior.numero === novo.numero &&
    anterior.isFocused === novo.isFocused
);

ChannelCard.displayName = 'ChannelCard';

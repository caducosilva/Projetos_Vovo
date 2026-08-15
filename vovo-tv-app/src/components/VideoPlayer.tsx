import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import Hls from 'hls.js';
import {
  Volume2,
  VolumeX,
  Plus,
  Minus,
  Play,
  Pause,
  Sun,
  Tv,
  Radio,
  Star,
  ChevronLeft,
  RotateCcw,
  List,
  X,
  Search,
  Cast,
  Loader2
} from 'lucide-react';
import type { Channel, ChannelWithHealth } from '../types';
import { tv, isNative } from '../utils/tvBridge';
import { dlna } from '../utils/dlna';
import { ehCanalDeCamera } from '../utils/cameras';
import { cleanChannelName, isRadioChannel } from '../utils/channelName';
import { CastSheet } from './CastSheet';
import { App as CapacitorApp } from '@capacitor/app';

interface VideoPlayerProps {
  channel: ChannelWithHealth | Channel | null;
  channelList?: (ChannelWithHealth | Channel)[];
  onSelectChannel?: (channel: ChannelWithHealth | Channel) => void;
  onClose: () => void;
  onPrevChannel?: () => void;
  onNextChannel?: () => void;
  isFavorite: boolean;
  onToggleFavorite: (channel: Channel) => void;
  onPlaybackOk?: (url: string) => void;
  onPlaybackFail?: (url: string, error: string) => void;
}

type Hud = { tipo: 'volume' | 'brilho' | 'canal' | 'favorito'; valor: number | string } | null;

const PASSOS_BRILHO = [1, 0.7, 0.45, 0.2];

export const VideoPlayer: React.FC<VideoPlayerProps> = ({
  channel,
  channelList = [],
  onSelectChannel,
  onClose,
  onPrevChannel,
  onNextChannel,
  isFavorite,
  onToggleFavorite,
  onPlaybackOk,
  onPlaybackFail
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);

  const [deitado, setDeitado] = useState(false);
  const [volume, setVolume] = useState(() => {
    const salvo = localStorage.getItem('vovo_tv_volume');
    return salvo !== null ? parseFloat(salvo) : 1.0;
  });
  const [brilho, setBrilho] = useState(() => {
    const salvo = localStorage.getItem('vovo_tv_brightness');
    return salvo !== null ? parseFloat(salvo) : 1.0;
  });
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [mostrarControles, setMostrarControles] = useState(true);
  const [tocando, setTocando] = useState(true);
  const [mudo, setMudo] = useState(false);
  /** Sobe a cada "tentar de novo" e refaz a carga do stream do zero. */
  const [tentativa, setTentativa] = useState(0);

  const [gavetaAberta, setGavetaAberta] = useState(false);
  const [buscaGaveta, setBuscaGaveta] = useState('');
  const [castAberto, setCastAberto] = useState(false);

  const [hud, setHud] = useState<Hud>(null);
  const hudTimerRef = useRef<number | null>(null);
  const controlesTimerRef = useRef<number | null>(null);

  const toqueRef = useRef({
    x: 0,
    y: 0,
    volumeInicial: 1.0,
    brilhoInicial: 1.0,
    ladoEsquerdo: false,
    ladoDireito: false,
    centro: false,
    moveu: false
  });

  const radio = isRadioChannel(channel);
  const nomeCanal = channel ? cleanChannelName(channel.name) : '';

  const dispararHud = useCallback((tipo: NonNullable<Hud>['tipo'], valor: number | string) => {
    setHud({ tipo, valor });
    if (hudTimerRef.current !== null) window.clearTimeout(hudTimerRef.current);
    hudTimerRef.current = window.setTimeout(() => setHud(null), 1400);
  }, []);

  // Trava a rolagem do fundo para a grade nao andar junto com o gesto
  useEffect(() => {
    const estilo = document.body.style;
    const anterior = {
      overflow: estilo.overflow,
      touchAction: estilo.touchAction,
      overscrollBehavior: estilo.overscrollBehavior
    };

    estilo.overflow = 'hidden';
    estilo.touchAction = 'none';
    estilo.overscrollBehavior = 'none';

    return () => {
      estilo.overflow = anterior.overflow;
      estilo.touchAction = anterior.touchAction;
      estilo.overscrollBehavior = anterior.overscrollBehavior;
    };
  }, []);

  const reiniciarControles = useCallback(() => {
    setMostrarControles(true);
    if (controlesTimerRef.current !== null) window.clearTimeout(controlesTimerRef.current);
    if (!gavetaAberta && !castAberto) {
      controlesTimerRef.current = window.setTimeout(() => setMostrarControles(false), 5000);
    }
  }, [gavetaAberta, castAberto]);

  useEffect(() => {
    reiniciarControles();
    return () => {
      if (controlesTimerRef.current !== null) window.clearTimeout(controlesTimerRef.current);
    };
  }, [reiniciarControles]);

  useEffect(() => {
    return () => {
      if (hudTimerRef.current !== null) window.clearTimeout(hudTimerRef.current);
    };
  }, []);

  /**
   * Tela acesa e brilho: so no abrir e no fechar do player.
   *
   * Antes isto vivia no mesmo efeito do botao voltar, que dependia da gaveta.
   * Resultado: abrir a lista de canais soltava o wake lock e devolvia o brilho
   * do sistema no meio do programa.
   */
  useEffect(() => {
    tv.keepAwake(true);
    return () => {
      tv.keepAwake(false);
      tv.resetBrightness();
      tv.setLandscape(false);
      tv.setImmersive(false);
    };
  }, []);

  // Refs para o listener do botao voltar ser registrado uma vez so
  const gavetaRef = useRef(gavetaAberta);
  const castRef = useRef(castAberto);
  const fecharRef = useRef(onClose);
  useEffect(() => {
    gavetaRef.current = gavetaAberta;
  }, [gavetaAberta]);
  useEffect(() => {
    castRef.current = castAberto;
  }, [castAberto]);
  useEffect(() => {
    fecharRef.current = onClose;
  }, [onClose]);

  /**
   * Botao voltar do Android.
   *
   * O registro e assincrono: sem a trava de "cancelado", desmontar antes da
   * promessa resolver deixava o listener vivo para sempre. Cada abertura da
   * gaveta empilhava mais um, e um toque no voltar fechava varias camadas de
   * uma vez.
   */
  useEffect(() => {
    let cancelado = false;
    let remover: (() => void) | null = null;

    CapacitorApp.addListener('backButton', () => {
      if (castRef.current) setCastAberto(false);
      else if (gavetaRef.current) setGavetaAberta(false);
      else fecharRef.current();
    })
      .then((handle) => {
        if (cancelado) {
          handle.remove();
          return;
        }
        remover = () => handle.remove();
      })
      .catch(() => {
        /* fora do Android nao existe botao voltar de hardware */
      });

    return () => {
      cancelado = true;
      if (remover) remover();
    };
  }, []);

  /** Carrega o canal. Refaz do zero quando o canal muda ou ao tentar de novo. */
  useEffect(() => {
    const video = videoRef.current;
    if (!channel || !video) return;

    setCarregando(true);
    setErro(null);

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    const endereco = channel.url;
    const ehHls = endereco.includes('.m3u8') || endereco.includes('.m3u');

    let encerrado = false;

    /**
     * Limite de espera.
     *
     * Um stream fora do ar nem sempre devolve erro: as vezes ele so nunca
     * responde. Sem este relogio o app ficava girando a rodinha para sempre e
     * a vovo nao tinha nem como saber que deu errado, nem botao para sair.
     */
    const relogio = window.setTimeout(() => {
      if (!encerrado) falha('tempo esgotado');
    }, 20000);

    const sucesso = () => {
      if (encerrado) return;
      encerrado = true;
      window.clearTimeout(relogio);
      setCarregando(false);
      setErro(null);
      onPlaybackOk?.(endereco);
    };

    const falha = (detalhe: string) => {
      if (encerrado) return;
      encerrado = true;
      window.clearTimeout(relogio);
      setCarregando(false);
      // A camera falha por um motivo so, e "canal fora do ar" mandaria a vovo
      // procurar outro canal em vez de avisar que o computador esta desligado.
      setErro(
        ehCanalDeCamera(channel)
          ? 'A câmera não está aparecendo agora.'
          : 'Este canal não está no ar agora.'
      );
      onPlaybackFail?.(endereco, detalhe);
    };

    video.onplaying = sucesso;
    video.onerror = () => falha('erro no elemento de video');

    if (ehHls && Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        maxBufferLength: 8,
        maxMaxBufferLength: 16,
        backBufferLength: 20,
        capLevelToPlayerSize: true,
        startLevel: -1,
        maxBufferHole: 0.5
      });

      hls.loadSource(endereco);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, (_evento, dados) => {
        // Teto de 720p 30fps: acima disso o celular da vovo engasga
        if (dados.levels?.length) {
          let escolhido = -1;
          let alturaEscolhida = -1;
          let menor = 0;
          let menorAltura = Number.MAX_SAFE_INTEGER;

          dados.levels.forEach((nivel, indice) => {
            const altura = nivel.height || 0;
            const fps = nivel.frameRate || 0;
            if (altura < menorAltura) {
              menorAltura = altura;
              menor = indice;
            }
            const cabeAltura = altura === 0 || altura <= 720;
            const cabeFps = fps === 0 || fps <= 31;
            if (cabeAltura && cabeFps && altura > alturaEscolhida) {
              alturaEscolhida = altura;
              escolhido = indice;
            }
          });

          const teto = escolhido !== -1 ? escolhido : menor;
          hls.autoLevelCapping = teto;
          hls.nextLevel = teto;
        }

        video.play().then(sucesso).catch(() => {
          /* o autoplay pode ser barrado; o onplaying resolve quando destravar */
        });
      });

      hls.on(Hls.Events.ERROR, (_evento, dados) => {
        if (!dados.fatal) return;
        if (dados.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
        else if (dados.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
        else {
          hls.destroy();
          falha(dados.details || 'erro fatal de hls');
        }
      });

      hlsRef.current = hls;
    } else {
      video.src = endereco;
      video.play().then(sucesso).catch(() => {
        video.muted = true;
        video.play().then(sucesso).catch(() => falha('nao consegui iniciar'));
      });
    }

    return () => {
      encerrado = true;
      window.clearTimeout(relogio);
      video.onplaying = null;
      video.onerror = null;
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [channel, tentativa, onPlaybackOk, onPlaybackFail]);

  /**
   * No celular quem manda e o volume do aparelho, igual aos botoes laterais,
   * entao o video fica em 100% para o som nao ser abafado duas vezes.
   */
  useEffect(() => {
    const video = videoRef.current;
    if (video) {
      video.volume = isNative ? 1 : volume;
      video.muted = mudo;
    }
    if (isNative) tv.setVolume(volume);
    localStorage.setItem('vovo_tv_volume', volume.toString());
  }, [volume, mudo]);

  /**
   * Tela cheia pelo giroscopio: deitou o celular, o video ocupa tudo. Sem
   * botao proprio porque a API de fullscreen do WebView brigava com a rotacao
   * nativa e derrubava o app.
   */
  useEffect(() => {
    tv.followSensor();

    const consulta = window.matchMedia('(orientation: landscape)');
    const aplicar = () => {
      setDeitado(consulta.matches);
      tv.setImmersive(consulta.matches);
    };

    aplicar();
    consulta.addEventListener('change', aplicar);
    return () => {
      consulta.removeEventListener('change', aplicar);
      tv.setImmersive(false);
      tv.lockPortrait();
    };
  }, []);

  const alternarPlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play().catch(() => undefined);
      setTocando(true);
    } else {
      video.pause();
      setTocando(false);
    }
    reiniciarControles();
  }, [reiniciarControles]);

  const alternarMudo = useCallback(() => {
    setMudo((anterior) => {
      const proximo = !anterior;
      dispararHud('volume', proximo ? 0 : Math.round(volume * 100));
      return proximo;
    });
    reiniciarControles();
  }, [dispararHud, reiniciarControles, volume]);

  const ajustarVolume = useCallback(
    (delta: number) => {
      setMudo(false);
      setVolume((anterior) => {
        const proximo = Math.min(1, Math.max(0, Math.round((anterior + delta) * 20) / 20));
        dispararHud('volume', Math.round(proximo * 100));
        return proximo;
      });
      reiniciarControles();
    },
    [dispararHud, reiniciarControles]
  );

  /** Brilho em 4 degraus, para a vovo so ir tocando no solzinho. */
  const alternarBrilho = useCallback(() => {
    setBrilho((anterior) => {
      const indice = PASSOS_BRILHO.findIndex((passo) => Math.abs(passo - anterior) < 0.05);
      const proximo = PASSOS_BRILHO[(indice + 1) % PASSOS_BRILHO.length];
      localStorage.setItem('vovo_tv_brightness', proximo.toString());
      tv.setBrightness(proximo);
      dispararHud('brilho', Math.round(proximo * 100));
      return proximo;
    });
    reiniciarControles();
  }, [dispararHud, reiniciarControles]);

  const tentarDeNovo = useCallback(() => {
    setTentativa((anterior) => anterior + 1);
  }, []);

  // --------------------------------------------------------------- gestos

  const inicioToque = (e: React.TouchEvent) => {
    if (gavetaAberta || e.touches.length !== 1) return;
    const toque = e.touches[0];
    const largura = window.innerWidth;

    toqueRef.current = {
      x: toque.clientX,
      y: toque.clientY,
      volumeInicial: volume,
      brilhoInicial: brilho,
      ladoEsquerdo: toque.clientX < largura * 0.35,
      ladoDireito: toque.clientX > largura * 0.65,
      centro: toque.clientX >= largura * 0.35 && toque.clientX <= largura * 0.65,
      moveu: false
    };
  };

  const moverToque = (e: React.TouchEvent) => {
    if (gavetaAberta || e.touches.length !== 1) return;
    if (e.cancelable) e.preventDefault();

    const toque = e.touches[0];
    const inicio = toqueRef.current;
    const dx = toque.clientX - inicio.x;
    const dy = toque.clientY - inicio.y;
    const altura = window.innerHeight;

    if (Math.abs(dx) > 8 || Math.abs(dy) > 8) inicio.moveu = true;

    const verticalDominante = Math.abs(dy) > Math.abs(dx) * 1.2 && Math.abs(dy) > 12;

    if (inicio.ladoEsquerdo && verticalDominante && !radio) {
      const novo = Math.min(1, Math.max(0.1, inicio.brilhoInicial - dy / (altura * 0.45)));
      setBrilho(novo);
      localStorage.setItem('vovo_tv_brightness', novo.toString());
      tv.setBrightness(novo);
      dispararHud('brilho', Math.round(novo * 100));
      return;
    }

    if (inicio.ladoDireito && verticalDominante) {
      const novo = Math.min(1, Math.max(0, inicio.volumeInicial - dy / (altura * 0.45)));
      setVolume(novo);
      dispararHud('volume', Math.round(novo * 100));
    }
  };

  const fimToque = (e: React.TouchEvent) => {
    if (gavetaAberta) return;
    const inicio = toqueRef.current;
    const toque = e.changedTouches[0];
    const dx = toque.clientX - inicio.x;
    const dy = toque.clientY - inicio.y;

    // Toque simples: mostra ou esconde os controles
    if (!inicio.moveu || (Math.abs(dx) < 15 && Math.abs(dy) < 15)) {
      setMostrarControles((anterior) => !anterior);
      if (!mostrarControles) reiniciarControles();
      return;
    }

    const horizontal = Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy);
    const verticalCentro = inicio.centro && Math.abs(dy) > 45 && Math.abs(dy) > Math.abs(dx);

    if (horizontal || verticalCentro) {
      const avancar = horizontal ? dx < 0 : dy < 0;
      if (avancar && onNextChannel) {
        dispararHud('canal', 'Próximo canal');
        onNextChannel();
      } else if (!avancar && onPrevChannel) {
        dispararHud('canal', 'Canal anterior');
        onPrevChannel();
      }
    }
  };

  const alternarFavorito = (e: React.SyntheticEvent) => {
    e.stopPropagation();
    if (!channel) return;
    onToggleFavorite(channel);
    dispararHud('favorito', isFavorite ? 'Tirado dos favoritos' : 'Guardado nos favoritos');
  };

  const canaisGaveta = useMemo(() => {
    const busca = buscaGaveta.trim().toLowerCase();
    if (!busca) return channelList;
    return channelList.filter(
      (c) =>
        (c.name || '').toLowerCase().includes(busca) ||
        (c.group || '').toLowerCase().includes(busca)
    );
  }, [channelList, buscaGaveta]);

  if (!channel) return null;

  const controlesVisiveis = mostrarControles ? 'opacity-100' : 'pointer-events-none opacity-0';
  const pararPropagacao = {
    onClick: (e: React.SyntheticEvent) => e.stopPropagation(),
    onTouchStart: (e: React.SyntheticEvent) => e.stopPropagation(),
    onTouchMove: (e: React.SyntheticEvent) => e.stopPropagation(),
    onTouchEnd: (e: React.SyntheticEvent) => e.stopPropagation()
  };

  return (
    <div
      className="fixed inset-0 z-50 flex touch-none items-center justify-center overflow-hidden bg-black select-none"
      style={{ touchAction: 'none', overscrollBehavior: 'none' }}
      onTouchStart={inicioToque}
      onTouchMove={moverToque}
      onTouchEnd={fimToque}
      onClick={reiniciarControles}
    >
      <video
        ref={videoRef}
        playsInline
        onPlay={() => setTocando(true)}
        onPause={() => setTocando(false)}
        className={`h-full w-full object-contain ${radio ? 'hidden' : 'block'}`}
      />

      {/* Escurecedor do brilho */}
      <div
        className="pointer-events-none absolute inset-0 transition-opacity"
        style={{ backgroundColor: 'black', opacity: 1 - brilho }}
      />

      {/* Tela do radio: sem video, so a marca e o nome */}
      {radio && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 bg-noite-900 p-6 text-center">
          <div className="flex h-36 w-36 items-center justify-center rounded-3xl bg-sol-400 text-noite-900">
            <Radio className="h-20 w-20" strokeWidth={2} />
          </div>
          <h2 className="max-w-sm text-3xl leading-tight font-black text-tinta-100">{nomeCanal}</h2>
          <span className="flex items-center gap-2 rounded-full bg-morto-400 px-4 py-2 text-lg font-black text-noite-900">
            <span className="h-3 w-3 rounded-full bg-noite-900" />
            NO AR
          </span>
        </div>
      )}

      {/* Nome do canal na tarja preta */}
      {!radio && !carregando && !erro && (
        <div
          className={`pointer-events-none absolute left-4 z-30 flex items-center gap-2.5 rounded-2xl border border-white/15 bg-black/75 px-4 py-2 transition-all duration-300 ${
            mostrarControles ? 'top-24' : 'top-6'
          }`}
        >
          <span className="h-3 w-3 shrink-0 rounded-full bg-vivo-400" />
          <span className="max-w-[60vw] truncate text-lg font-black text-white">{nomeCanal}</span>
        </div>
      )}

      {/* Aviso de gesto */}
      {hud && (
        <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center">
          <div className="flex min-w-[12rem] flex-col items-center gap-3 rounded-3xl border border-noite-500 bg-noite-900/95 px-7 py-5">
            {hud.tipo === 'volume' && (
              <>
                <Volume2 className="h-11 w-11 text-sol-400" strokeWidth={2.5} />
                <span className="text-2xl font-black text-white">{hud.valor}%</span>
                <div className="h-3 w-36 overflow-hidden rounded-full bg-noite-700">
                  <div className="h-full bg-sol-400" style={{ width: `${hud.valor}%` }} />
                </div>
                <span className="text-base font-bold text-tinta-300">Volume</span>
              </>
            )}
            {hud.tipo === 'brilho' && (
              <>
                <Sun className="h-11 w-11 text-sol-400" strokeWidth={2.5} />
                <span className="text-2xl font-black text-white">{hud.valor}%</span>
                <div className="h-3 w-36 overflow-hidden rounded-full bg-noite-700">
                  <div className="h-full bg-sol-400" style={{ width: `${hud.valor}%` }} />
                </div>
                <span className="text-base font-bold text-tinta-300">Brilho</span>
              </>
            )}
            {hud.tipo === 'favorito' && (
              <>
                <Star className="h-11 w-11 fill-sol-400 text-sol-400" />
                <span className="text-center text-lg font-black text-white">{hud.valor}</span>
              </>
            )}
            {hud.tipo === 'canal' && (
              <>
                <Tv className="h-11 w-11 text-sol-400" strokeWidth={2.5} />
                <span className="text-center text-xl font-black text-white">{hud.valor}</span>
              </>
            )}
          </div>
        </div>
      )}

      {carregando && (
        <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-black/70">
          <Loader2 className="h-16 w-16 animate-spin text-sol-400" strokeWidth={2.5} />
          <span className="text-xl font-black text-white">Ligando o canal...</span>
        </div>
      )}

      {erro && (
        <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-5 bg-black/90 p-6 text-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-morto-400/15 text-morto-400">
            <Tv className="h-11 w-11" strokeWidth={2.5} />
          </div>
          <p className="text-2xl font-black text-white">{erro}</p>
          <p className="max-w-xs text-lg text-tinta-300">
            {ehCanalDeCamera(channel)
              ? 'Veja se o computador de casa está ligado.'
              : 'Escolha outro canal ou tente de novo.'}
          </p>
          <div className="flex flex-col gap-2.5 sm:flex-row">
            <button
              onClick={(e) => {
                e.stopPropagation();
                tentarDeNovo();
              }}
              className="flex h-toque items-center justify-center gap-2 rounded-2xl bg-sol-400 px-6 text-xl font-black text-noite-900 transition active:scale-95"
            >
              <RotateCcw className="h-6 w-6" strokeWidth={3} />
              Tentar de novo
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
              className="flex h-toque items-center justify-center rounded-2xl border-2 border-noite-500 bg-noite-700 px-6 text-xl font-black text-tinta-100 transition active:scale-95"
            >
              Voltar
            </button>
          </div>
        </div>
      )}

      {/* Barra de cima */}
      <div
        className={`area-segura-topo absolute top-0 right-0 left-0 z-50 flex items-center gap-2 bg-gradient-to-b from-black/95 to-transparent px-3 pb-6 transition-opacity duration-300 ${controlesVisiveis}`}
        {...pararPropagacao}
      >
        <button
          onClick={onClose}
          className="flex h-toque shrink-0 items-center gap-2 rounded-2xl border-2 border-noite-500 bg-noite-900/90 px-4 text-white transition active:scale-95 active:bg-sol-400 active:text-noite-900"
        >
          <ChevronLeft className="h-7 w-7 text-sol-400" strokeWidth={3} />
          <span className="text-lg font-black">Voltar</span>
        </button>

        <div className="flex-1" />

        {dlna.available && !radio && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setCastAberto(true);
            }}
            className="flex h-toque shrink-0 items-center gap-2 rounded-2xl border-2 border-noite-500 bg-noite-900/90 px-4 text-white transition active:scale-95"
            aria-label="Mandar este canal para a TV"
          >
            <Cast className="h-7 w-7 text-sol-400" strokeWidth={2.5} />
            <span className="hidden text-lg font-black sm:inline">TV</span>
          </button>
        )}

        {channelList.length > 0 && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setGavetaAberta((anterior) => !anterior);
            }}
            className={`flex h-toque shrink-0 items-center gap-2 rounded-2xl border-2 px-4 transition active:scale-95 ${
              gavetaAberta
                ? 'border-sol-400 bg-sol-400 text-noite-900'
                : 'border-noite-500 bg-noite-900/90 text-white'
            }`}
            aria-label="Abrir a lista de canais"
          >
            <List className="h-7 w-7" strokeWidth={2.5} />
            <span className="hidden text-lg font-black sm:inline">Canais</span>
          </button>
        )}

        <button
          onClick={alternarFavorito}
          className={`flex h-toque w-toque shrink-0 items-center justify-center rounded-2xl border-2 transition active:scale-95 ${
            isFavorite
              ? 'border-sol-400 bg-sol-400 text-noite-900'
              : 'border-noite-500 bg-noite-900/90 text-tinta-300'
          }`}
          aria-label={isFavorite ? 'Tirar dos favoritos' : 'Guardar nos favoritos'}
          aria-pressed={isFavorite}
        >
          <Star className={`h-7 w-7 ${isFavorite ? 'fill-current' : ''}`} strokeWidth={2.5} />
        </button>
      </div>

      {/* Barra de baixo */}
      <div
        className={`area-segura-base absolute right-0 bottom-0 left-0 z-50 bg-gradient-to-t from-black/95 to-transparent px-3 pt-10 transition-opacity duration-300 ${controlesVisiveis}`}
        {...pararPropagacao}
      >
        {!radio && !deitado && (
          <p className="mb-3 text-center text-base font-bold text-tinta-300">
            Deite o celular para ver em tela cheia
          </p>
        )}

        <div className="flex items-stretch justify-center gap-2">
          <button
            onClick={alternarMudo}
            className={`flex h-16 min-w-16 flex-col items-center justify-center gap-0.5 rounded-2xl border-2 px-3 transition active:scale-95 ${
              mudo
                ? 'border-morto-400 bg-morto-400/20 text-morto-400'
                : 'border-noite-500 bg-noite-900/90 text-white'
            }`}
            aria-label={mudo ? 'Ligar o som' : 'Desligar o som'}
          >
            {mudo ? <VolumeX className="h-7 w-7" strokeWidth={2.5} /> : <Volume2 className="h-7 w-7" strokeWidth={2.5} />}
            <span className="text-xs font-black">{mudo ? 'Sem som' : 'Mudo'}</span>
          </button>

          <button
            onClick={() => ajustarVolume(-0.1)}
            className="flex h-16 min-w-16 flex-col items-center justify-center gap-0.5 rounded-2xl border-2 border-noite-500 bg-noite-900/90 px-3 text-white transition active:scale-95"
            aria-label="Abaixar o volume"
          >
            <Minus className="h-7 w-7 text-sol-400" strokeWidth={3} />
            <span className="text-xs font-black">Volume</span>
          </button>

          <button
            onClick={alternarPlay}
            className="flex h-16 min-w-20 flex-col items-center justify-center gap-0.5 rounded-2xl bg-sol-400 px-4 text-noite-900 transition active:scale-95"
            aria-label={tocando ? 'Pausar' : 'Continuar'}
          >
            {tocando ? <Pause className="h-8 w-8 fill-current" /> : <Play className="h-8 w-8 fill-current" />}
            <span className="text-xs font-black">{tocando ? 'Pausar' : 'Continuar'}</span>
          </button>

          <button
            onClick={() => ajustarVolume(0.1)}
            className="flex h-16 min-w-16 flex-col items-center justify-center gap-0.5 rounded-2xl border-2 border-noite-500 bg-noite-900/90 px-3 text-white transition active:scale-95"
            aria-label="Aumentar o volume"
          >
            <Plus className="h-7 w-7 text-sol-400" strokeWidth={3} />
            <span className="text-xs font-black">Volume</span>
          </button>

          {!radio && (
            <button
              onClick={alternarBrilho}
              className="flex h-16 min-w-16 flex-col items-center justify-center gap-0.5 rounded-2xl border-2 border-noite-500 bg-noite-900/90 px-3 text-white transition active:scale-95"
              aria-label="Mudar o brilho da tela"
            >
              <Sun className="h-7 w-7 text-sol-400" strokeWidth={2.5} />
              <span className="text-xs font-black">{Math.round(brilho * 100)}%</span>
            </button>
          )}
        </div>
      </div>

      {/* Gaveta de canais */}
      {gavetaAberta && (
        <div
          className="area-segura-topo absolute top-0 right-0 bottom-0 z-[60] flex w-80 max-w-[88vw] flex-col border-l-2 border-noite-600 bg-noite-900"
          {...pararPropagacao}
        >
          <div className="flex items-center gap-2 border-b border-noite-600 px-3 pb-3">
            <h3 className="flex-1 text-xl font-black text-tinta-100">Canais</h3>
            <button
              onClick={() => setGavetaAberta(false)}
              className="flex h-12 w-12 items-center justify-center rounded-xl border-2 border-noite-500 bg-noite-700 text-tinta-100 transition active:scale-90"
              aria-label="Fechar a lista"
            >
              <X className="h-6 w-6" strokeWidth={3} />
            </button>
          </div>

          <div className="relative border-b border-noite-600 p-3">
            <Search
              className="pointer-events-none absolute top-1/2 left-6 h-5 w-5 -translate-y-1/2 text-tinta-500"
              strokeWidth={2.5}
            />
            <input
              type="search"
              placeholder="Buscar canal"
              value={buscaGaveta}
              onChange={(e) => setBuscaGaveta(e.target.value)}
              className="h-13 w-full rounded-xl border-2 border-noite-500 bg-noite-700 pr-3 pl-11 text-base font-bold text-tinta-100 placeholder-tinta-500 outline-none focus:border-sol-400"
            />
          </div>

          <div className="flex-1 space-y-2 overflow-y-auto overscroll-contain p-2">
            {canaisGaveta.map((canal) => {
              const ativo = canal.url === channel.url;
              return (
                <button
                  key={canal.url}
                  onClick={() => {
                    onSelectChannel?.(canal);
                    setGavetaAberta(false);
                  }}
                  className={`flex min-h-16 w-full items-center gap-2 rounded-2xl border-2 p-2 text-left transition active:scale-[0.98] ${
                    ativo
                      ? 'border-sol-400 bg-sol-400 text-noite-900'
                      : 'border-noite-600 bg-noite-700 text-tinta-100'
                  }`}
                >
                  <span className="line-clamp-2 flex-1 text-base leading-snug font-black">
                    {cleanChannelName(canal.name)}
                  </span>
                  {ativo && <span className="h-3 w-3 shrink-0 rounded-full bg-noite-900" />}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <CastSheet
        isOpen={castAberto}
        channelName={channel.name}
        channelUrl={channel.url}
        onClose={() => setCastAberto(false)}
      />
    </div>
  );
};

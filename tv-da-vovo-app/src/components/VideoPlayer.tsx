import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import Hls from 'hls.js';
import {
  Play,
  Pause,
  Tv,
  Radio,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  List,
  X,
  Search,
  Cast,
  Square,
  PictureInPicture2,
  Loader2
} from 'lucide-react';
import type { Channel, ChannelWithHealth } from '../types';
import { tv } from '../utils/tvBridge';
import { podeMandarParaTv, mandarParaTv, type TvNaRede } from '../utils/tvsDaCasa';
import { ehCanalDeCamera } from '../utils/cameras';
import { fontesDoCanal } from '../utils/fontes';
import {
  ordenarFontes,
  lembrarFonteBoa,
  esquecerFonte,
  registrarDesempenhoFonte
} from '../utils/corrida';
import { FaixaDoCanal } from './FaixaDoCanal';
import {
  programacaoDoCanal,
  comPassePluto,
  horarioDoPrograma,
  progressoDoPrograma,
  horaCurta,
  type AgoraEDepois
} from '../utils/programacao';

/** Programa no ar do canal em foco no guia. Busca so de quem esta em foco. */
const ProgramaAgora: React.FC<{ epg?: string }> = ({ epg }) => {
  const [guia, setGuia] = useState<AgoraEDepois>({});
  useEffect(() => {
    let vivo = true;
    setGuia({});
    programacaoDoCanal(epg).then((r) => {
      if (vivo) setGuia(r);
    });
    return () => {
      vivo = false;
    };
  }, [epg]);
  if (!guia.agora) return null;
  return (
    <span className="block truncate text-sm font-bold text-sol-400">
      Agora: {guia.agora.titulo} · {horarioDoPrograma(guia.agora)}
    </span>
  );
};
import { cleanChannelName, isRadioChannel } from '../utils/channelName';
import { CastSheet } from './CastSheet';
import { App as CapacitorApp } from '@capacitor/app';

interface VideoPlayerProps {
  channel: ChannelWithHealth | Channel | null;
  numero?: number;
  isTv?: boolean;
  channelList?: (ChannelWithHealth | Channel)[];
  onSelectChannel?: (channel: ChannelWithHealth | Channel) => void;
  onClose: () => void;
  onPrevChannel?: () => void;
  onNextChannel?: () => void;
  onPlaybackOk?: (url: string) => void;
  onPlaybackFail?: (url: string, error: string) => void;
  /** Pede para atualizar a lista de canais do servidor quando todas as fontes falham. */
  onRefreshSources?: () => void;
  /** Acabaram TODAS as fontes deste canal; quem chama decide o que fazer. */
  onChannelExhausted?: () => void;
  /** Numero do primeiro canal da lista (1 na TV Aberta, 101 no Cine Zap). */
  primeiroNumero?: number;
  /** TV atualmente espelhada na mesma rede Wi-Fi (mantida entre trocas de canal). */
  tvConectada?: TvNaRede | null;
  onTvConectada?: (tv: TvNaRede, nomeCanal: string) => void;
  onDesconectarTv?: () => Promise<void> | void;
}

/** Janela para o segundo Voltar contar como "quero sair". */
const JANELA_VOLTAR_MS = 3000;
/** Dois "voltar" mais perto que isso sao o mesmo aperto do controle. */
const REPIQUE_VOLTAR_MS = 400;
/** Espera depois do ultimo digito antes de sintonizar o numero digitado. */
const ESPERA_DIGITO_MS = 1600;

type Hud = { tipo: 'canal'; valor: number | string } | null;

export const VideoPlayer: React.FC<VideoPlayerProps> = ({
  channel,
  numero,
  isTv = false,
  channelList = [],
  onSelectChannel,
  onClose,
  onPrevChannel,
  onNextChannel,
  onPlaybackOk,
  onPlaybackFail,
  onRefreshSources,
  onChannelExhausted,
  primeiroNumero = 1,
  tvConectada = null,
  onTvConectada,
  onDesconectarTv
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);

  const [deitado, setDeitado] = useState(false);
  const [emPip, setEmPip] = useState(false);
  const emPipRef = useRef(false);
  const pausadoPeloUsuarioRef = useRef(false);
  const forcarCorridaRef = useRef(false);
  const tentarDeNovoRef = useRef<() => void>(() => undefined);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [travandoAviso, setTravandoAviso] = useState(false);
  const [mostrarControles, setMostrarControles] = useState(true);
  const [tocando, setTocando] = useState(true);
  /** Sobe a cada "tentar de novo" e refaz a carga do stream do zero. */
  const [tentativa, setTentativa] = useState(0);
  const [reordem, setReordem] = useState(0);
  /** Remonta o elemento <video> apos queda/travamento para zerar tela cinza do decodificador. */
  const [chaveVideo, setChaveVideo] = useState(0);

  /**
   * Fonte do canal em uso. O mesmo canal costuma ter varias URLs; quando a
   * atual nao da imagem, o player anda para a proxima sozinho, sem a vovo
   * precisar sair e voltar. Zera a cada troca de canal.
   */
  // chave em texto: o objeto do canal pode ser recriado a cada render, e a
  // lista de fontes so deve mudar quando as URLs mudarem de verdade
  const chaveFontes = channel ? fontesDoCanal(channel).join('\n') : '';
  const fontes = useMemo(() => (chaveFontes ? chaveFontes.split('\n') : []), [chaveFontes]);
  const [indiceFonte, setIndiceFonte] = useState(0);

  /**
   * Ordem em que as fontes vao ser tentadas. Antes era a ordem fixa da lista,
   * esperando ate 20s em cada URL morta: canal com tres fontes ruins na frente
   * levava mais de um minuto para abrir. Agora a ultima fonte que tocou vai
   * primeiro e, sem ela, todas sao consultadas AO MESMO TEMPO e a primeira que
   * responder com playlist valida e a que toca (ver utils/corrida.ts).
   */
  const [ordem, setOrdem] = useState<string[] | null>(null);
  useEffect(() => {
    setIndiceFonte(0);
    setOrdem(null);
    setTravandoAviso(false);
    setErro(null);
    pausadoPeloUsuarioRef.current = false;
    if (fontes.length === 0) return;
    const forcarCorrida = forcarCorridaRef.current;
    forcarCorridaRef.current = false;
    const controle = new AbortController();
    ordenarFontes(channel?.id || channel?.name || '', fontes, controle.signal, {
      forcarCorrida
    }).then((r) => {
      if (!controle.signal.aborted) setOrdem(r);
    });
    return () => controle.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fontes, reordem]);

  /** URL que esta tocando agora e se ainda ha reserva depois dela. */
  const endereco = ordem ? ordem[Math.min(indiceFonte, ordem.length - 1)] || '' : '';
  const temReserva = !!ordem && indiceFonte + 1 < ordem.length;

  /** Sobe a cada tecla/toque: a faixa com nome e programa reaparece por 3s. */
  const [reacender, setReacender] = useState(0);

  const [gavetaAberta, setGavetaAberta] = useState(false);
  const [buscaGaveta, setBuscaGaveta] = useState('');
  const [castAberto, setCastAberto] = useState(false);

  const ultimaEnviadaRef = useRef<{ tvId: string; url: string } | null>(null);
  const [enviandoParaTv, setEnviandoParaTv] = useState(false);
  const [erroNaTv, setErroNaTv] = useState<string | null>(null);
  const [guiaNoAr, setGuiaNoAr] = useState<AgoraEDepois>({});

  const [hud, setHud] = useState<Hud>(null);
  const hudTimerRef = useRef<number | null>(null);
  const controlesTimerRef = useRef<number | null>(null);

  const toqueRef = useRef({
    x: 0,
    y: 0,
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
    setReacender((n) => n + 1);
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
    tv.setBrightness(1.0);
    return () => {
      tv.setPipAllowed(false);
      tv.setImmersive(false);
    };
  }, []);

  /** Habilita entrada automatica em PiP ao sair do app enquanto assiste no celular. */
  useEffect(() => {
    void tv.setPipAllowed(!isTv && !radio && !tvConectada);
  }, [isTv, radio, tvConectada]);

  /** Mantem estado sincronizado quando o Android entra ou sai do Picture-in-Picture. */
  useEffect(() => {
    let timerCheck: number | null = null;

    const aoMudarPip = (e: Event) => {
      const ativo = Boolean((e as CustomEvent<{ active?: boolean }>).detail?.active);
      emPipRef.current = ativo;
      setEmPip(ativo);
      if (timerCheck !== null) {
        window.clearTimeout(timerCheck);
        timerCheck = null;
      }

      const pausado = pausadoPeloUsuarioRef.current;
      void tv.setPipPlaying(!pausado);

      if (ativo) {
        setGavetaAberta(false);
        setCastAberto(false);
        setMostrarControles(false);
        const v = videoRef.current;
        if (v && !pausado) {
          if (v.paused) {
            v.play().catch(() => undefined);
            setTocando(true);
          }
          const tempoAntes = v.currentTime;
          timerCheck = window.setTimeout(() => {
            if (!emPipRef.current || pausadoPeloUsuarioRef.current) return;
            const atual = videoRef.current;
            if (!atual) return;
            const travou = atual.paused || Math.abs(atual.currentTime - tempoAntes) < 0.05;
            if (travou) {
              try {
                hlsRef.current?.startLoad(-1);
              } catch {
                /* vigia continuo recarrega se persistir */
              }
              atual.play().catch(() => undefined);
            }
          }, 1200);
        }
      } else {
        setMostrarControles(true);
      }
    };

    const aoRecarregarPip = () => {
      if (tvConectada || radio) return;
      tentarDeNovoRef.current();
    };

    const aoIrParaSegundoPlano = () => {
      if (emPipRef.current || tvConectada || radio) return;
      // App foi realmente minimizado/bloqueado ou PiP fechado no X:
      // estaciona o video sem marcar pausa manual para retomar ao reabrir.
      pausadoPeloUsuarioRef.current = false;
      try {
        hlsRef.current?.stopLoad();
      } catch {
        /* ok */
      }
      const v = videoRef.current;
      if (v && !v.paused) {
        v.pause();
      }
    };

    window.addEventListener('vovo:pip', aoMudarPip);
    window.addEventListener('vovo:pip_reload', aoRecarregarPip);
    window.addEventListener('vovo:background', aoIrParaSegundoPlano);
    return () => {
      if (timerCheck !== null) window.clearTimeout(timerCheck);
      window.removeEventListener('vovo:pip', aoMudarPip);
      window.removeEventListener('vovo:pip_reload', aoRecarregarPip);
      window.removeEventListener('vovo:background', aoIrParaSegundoPlano);
    };
  }, [radio, tvConectada]);

  /**
   * Voltar, igual em todo lugar do player:
   *   - com a lista de canais (ou o "mandar pra TV") aberta, fecha ela;
   *   - assistindo, o primeiro Voltar so avisa e o segundo, em ate 3s, leva
   *     para a tela de escolher TV Aberta ou Cine Zap.
   * Assim um Voltar sem querer nao tira a vovo do programa.
   */
  const [avisoVoltar, setAvisoVoltar] = useState(false);
  const ultimoVoltarRef = useRef(0);
  const avisoVoltarTimerRef = useRef<number | null>(null);
  const voltarRef = useRef<() => void>(() => undefined);
  useEffect(() => {
    voltarRef.current = () => {
      if (castRef.current) {
        setCastAberto(false);
        return;
      }
      if (gavetaRef.current) {
        setGavetaAberta(false);
        return;
      }
      const agora = Date.now();
      const desdeOUltimo = agora - ultimoVoltarRef.current;
      // Um aperto so pode chegar duas vezes (botao do Android + tecla do
      // WebView, ou repeticao do controle). Abaixo disso e o mesmo aperto.
      if (desdeOUltimo < REPIQUE_VOLTAR_MS) return;
      if (desdeOUltimo < JANELA_VOLTAR_MS) {
        ultimoVoltarRef.current = 0;
        setAvisoVoltar(false);
        fecharRef.current();
        return;
      }
      ultimoVoltarRef.current = agora;
      setAvisoVoltar(true);
      if (avisoVoltarTimerRef.current !== null) window.clearTimeout(avisoVoltarTimerRef.current);
      avisoVoltarTimerRef.current = window.setTimeout(() => setAvisoVoltar(false), JANELA_VOLTAR_MS);
    };
  });
  useEffect(
    () => () => {
      if (avisoVoltarTimerRef.current !== null) window.clearTimeout(avisoVoltarTimerRef.current);
    },
    []
  );

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

    CapacitorApp.addListener('backButton', () => voltarRef.current())
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

  /** Programacao atual do canal (inicio e fim), atualizada na abertura e a cada 30s. */
  useEffect(() => {
    let vivo = true;
    setGuiaNoAr({});
    const atualizar = () => {
      programacaoDoCanal(channel?.epg).then((r) => {
        if (vivo) setGuiaNoAr(r);
      });
    };
    atualizar();
    const timer = window.setInterval(atualizar, 30_000);
    return () => {
      vivo = false;
      window.clearInterval(timer);
    };
  }, [channel?.epg, reacender]);

  /**
   * Espelhamento continuo: quando ja existe uma TV conectada no Wi-Fi, qualquer
   * troca de canal no app envia o canal escolhido diretamente para essa TV.
   */
  useEffect(() => {
    if (!tvConectada) {
      ultimaEnviadaRef.current = null;
      setEnviandoParaTv(false);
      setErroNaTv(null);
      return;
    }
    if (!channel || !endereco) return;

    const urlEnvio = comPassePluto(endereco);
    if (
      ultimaEnviadaRef.current?.tvId === tvConectada.id &&
      ultimaEnviadaRef.current?.url === urlEnvio
    ) {
      return;
    }

    let cancelado = false;
    setEnviandoParaTv(true);
    setErroNaTv(null);

    mandarParaTv(tvConectada, urlEnvio, nomeCanal)
      .then(() => {
        if (cancelado) return;
        ultimaEnviadaRef.current = { tvId: tvConectada.id, url: urlEnvio };
        setEnviandoParaTv(false);
        setErroNaTv(null);
        lembrarFonteBoa(channel.id || channel.name, endereco);
        onPlaybackOk?.(endereco);
        onTvConectada?.(tvConectada, nomeCanal);
      })
      .catch((e) => {
        if (cancelado) return;
        esquecerFonte(channel.id || channel.name, endereco);
        onPlaybackFail?.(endereco, e instanceof Error ? e.message : 'erro ao espelhar na TV');
        if (temReserva) {
          setIndiceFonte((i) => i + 1);
          return;
        }
        setEnviandoParaTv(false);
        setErroNaTv(e instanceof Error ? e.message : 'A TV não aceitou este canal.');
      });

    return () => {
      cancelado = true;
    };
  }, [
    tvConectada,
    channel,
    endereco,
    nomeCanal,
    tentativa,
    temReserva,
    onPlaybackOk,
    onPlaybackFail,
    onTvConectada
  ]);

  /** Carrega o canal. Refaz do zero quando o canal muda, troca fonte ou destrava. */
  useEffect(() => {
    const video = videoRef.current;
    if (!channel || !video) return;

    if (tvConectada) {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      video.pause();
      video.removeAttribute('src');
      video.load();
      setCarregando(false);
      setErro(null);
      setTravandoAviso(false);
      setTocando(false);
      return;
    }

    setCarregando(true);
    // ainda escolhendo a fonte mais rapida: so mostra "ligando o canal"
    if (!endereco) return;
    setErro(null);
    setTravandoAviso(false);

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    const ehHls = endereco.includes('.m3u8') || endereco.includes('.m3u');
    const iniciadoEm = performance.now();

    let desmontado = false;
    let jaTocou = false;
    let falhouNestaCarga = false;
    let ultimoTempo = video.currentTime || 0;
    let ultimoAvancoEm = Date.now();
    let tentouDestravarEm = 0;
    let vigia: number | undefined;

    /**
     * Limite de espera inicial para o primeiro quadro.
     */
    const relogio = window.setTimeout(() => {
      if (!jaTocou && !desmontado && !falhouNestaCarga) {
        falha('tempo esgotado');
      }
    }, indiceFonte === 0 ? 12000 : 9000);

    const sucesso = () => {
      if (desmontado || falhouNestaCarga) return;
      window.clearTimeout(relogio);
      video.volume = 1.0;
      video.muted = false;
      setCarregando(false);
      setErro(null);
      setTravandoAviso(false);
      ultimoAvancoEm = Date.now();
      tentouDestravarEm = 0;

      if (!jaTocou) {
        jaTocou = true;
        const latenciaMs = Math.round(performance.now() - iniciadoEm);
        lembrarFonteBoa(channel.id || channel.name, endereco, latenciaMs);
        void tv.setPipPlaying(!pausadoPeloUsuarioRef.current);
        onPlaybackOk?.(endereco);
      }
    };

    const falha = (detalhe: string) => {
      if (desmontado || falhouNestaCarga) return;
      falhouNestaCarga = true;
      console.warn('[player] FALHOU', JSON.stringify({ canal: channel.name, detalhe, temReserva, jaTocou }));
      window.clearTimeout(relogio);
      if (vigia !== undefined) window.clearInterval(vigia);

      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }

      esquecerFonte(channel.id || channel.name, endereco);
      registrarDesempenhoFonte(endereco, false);
      onPlaybackFail?.(endereco, detalhe);
      setTravandoAviso(false);

      if (temReserva) {
        // Recria o elemento <video> para liberar camada MediaCodec cinza/travada
        setChaveVideo((k) => k + 1);
        setIndiceFonte((i) => i + 1);
        return;
      }

      video.pause();
      video.removeAttribute('src');
      video.load();
      onRefreshSources?.();
      setCarregando(false);
      setErro(
        ehCanalDeCamera(channel)
          ? 'A câmera não está aparecendo agora.'
          : 'Este canal não está no ar agora.'
      );
      onChannelExhausted?.();
    };

    const aoProgredir = () => {
      if (desmontado || falhouNestaCarga) return;
      if (Math.abs(video.currentTime - ultimoTempo) > 0.04) {
        ultimoTempo = video.currentTime;
        ultimoAvancoEm = Date.now();
        tentouDestravarEm = 0;
        setTravandoAviso(false);
      }
    };

    const aoEncerrarStream = () => {
      if (jaTocou && !pausadoPeloUsuarioRef.current) {
        falha('transmissao interrompida');
      }
    };

    const aoDarPlaying = () => sucesso();
    const aoDarErroElemento = () => falha('erro no elemento de video');

    video.addEventListener('timeupdate', aoProgredir);
    video.addEventListener('playing', aoDarPlaying);
    video.addEventListener('ended', aoEncerrarStream);
    video.addEventListener('error', aoDarErroElemento);

    // Vigia continuo (a cada 1s) para detectar tela cinza / travamento silencioso
    // mesmo quando o HLS nao dispara erro fatal.
    const limiteTravamentoMs = radio ? 14000 : 7500;
    vigia = window.setInterval(() => {
      if (desmontado || falhouNestaCarga) return;
      if (pausadoPeloUsuarioRef.current) {
        ultimoAvancoEm = Date.now();
        return;
      }
      if (document.hidden && !emPipRef.current) return;

      if (Math.abs(video.currentTime - ultimoTempo) > 0.04) {
        ultimoTempo = video.currentTime;
        ultimoAvancoEm = Date.now();
        tentouDestravarEm = 0;
        setTravandoAviso(false);
        return;
      }

      if (!jaTocou) return;

      const paradoMs = Date.now() - ultimoAvancoEm;
      if (paradoMs >= 3500 && tentouDestravarEm === 0) {
        tentouDestravarEm = Date.now();
        setTravandoAviso(true);
        const hls = hlsRef.current;
        if (hls) {
          try {
            hls.startLoad(-1);
          } catch {
            /* fallback abaixo se continuar parado */
          }
        }
        video.play().catch(() => undefined);
      } else if (paradoMs >= limiteTravamentoMs) {
        falha('tela congelada sem avanco');
      }
    }, 1000);

    if (ehHls && Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        // Buffer moderado para aguentar oscilacao de Wi-Fi sem secar e travar em cinza
        lowLatencyMode: false,
        liveSyncDurationCount: 3,
        liveMaxLatencyDurationCount: 6,
        maxBufferLength: 12,
        maxMaxBufferLength: 24,
        backBufferLength: 15,
        highBufferWatchdogPeriod: 2,
        nudgeOffset: 0.2,
        nudgeMaxRetry: 5,
        capLevelToPlayerSize: true,
        startLevel: -1,
        maxBufferHole: 0.5,
        manifestLoadingTimeOut: 6000,
        manifestLoadingMaxRetry: temReserva ? 0 : 2,
        levelLoadingTimeOut: 6000,
        levelLoadingMaxRetry: temReserva ? 0 : 2,
        fragLoadingTimeOut: 6500,
        fragLoadingMaxRetry: temReserva ? 1 : 2,
        fragLoadingRetryDelay: 500
      });

      hls.loadSource(comPassePluto(endereco));
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

        if (video) {
          video.volume = 1.0;
          video.muted = false;
        }

        video.play().then(sucesso).catch(() => {
          /* o autoplay pode ser barrado; o playing resolve quando destravar */
        });
      });

      let recuperouRede = false;
      let recuperouMidia = false;
      let ultimoNudgeEm = 0;
      const errosRecentes: number[] = [];

      hls.on(Hls.Events.ERROR, (_evento, dados) => {
        if (!dados.fatal) {
          if (
            dados.details === 'bufferStalledError' ||
            dados.details === 'bufferNudgeOnStall' ||
            dados.details === 'fragLoadError' ||
            dados.details === 'fragLoadTimeOut' ||
            dados.details === 'levelLoadError' ||
            dados.details === 'levelLoadTimeOut' ||
            dados.details === 'manifestLoadError' ||
            dados.details === 'manifestLoadTimeOut'
          ) {
            const agora = Date.now();
            while (errosRecentes.length > 0 && agora - errosRecentes[0] > 9000) {
              errosRecentes.shift();
            }
            errosRecentes.push(agora);

            if (errosRecentes.length >= 3 && agora - ultimoNudgeEm > 3500) {
              ultimoNudgeEm = agora;
              setTravandoAviso(true);
              try {
                hls.startLoad(-1);
              } catch {
                /* se falhar, cai na escalada abaixo */
              }
            }
            if (errosRecentes.length >= 5) {
              falha('sinal instavel repetido: ' + dados.details);
            }
          }
          return;
        }

        console.warn('[player] hls fatal', JSON.stringify({
          tipo: dados.type,
          detalhe: dados.details,
          codigo: dados.response?.code,
          jaTocou
        }));

        if (dados.type === Hls.ErrorTypes.NETWORK_ERROR && !recuperouRede && (!temReserva || jaTocou)) {
          recuperouRede = true;
          setTravandoAviso(true);
          hls.startLoad(-1);
          return;
        }
        if (dados.type === Hls.ErrorTypes.MEDIA_ERROR && !recuperouMidia) {
          recuperouMidia = true;
          setTravandoAviso(true);
          hls.recoverMediaError();
          return;
        }
        falha(dados.details || 'erro fatal de hls');
      });

      hlsRef.current = hls;
    } else {
      video.src = comPassePluto(endereco);
      video.volume = 1.0;
      video.muted = false;
      video.play().then(sucesso).catch(() => falha('nao consegui iniciar'));
    }

    return () => {
      desmontado = true;
      window.clearTimeout(relogio);
      if (vigia !== undefined) window.clearInterval(vigia);
      video.removeEventListener('timeupdate', aoProgredir);
      video.removeEventListener('playing', aoDarPlaying);
      video.removeEventListener('ended', aoEncerrarStream);
      video.removeEventListener('error', aoDarErroElemento);
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      video.pause();
      video.removeAttribute('src');
      video.load();
    };
    // Depende do ENDERECO e da chaveVideo, nao do objeto `channel`.
  }, [endereco, temReserva, tentativa, chaveVideo, radio, tvConectada, onPlaybackOk, onPlaybackFail, onRefreshSources, onChannelExhausted]);
  // indiceFonte fica de fora de proposito: ele so muda junto com o endereco

  /**
   * Modo imersivo e tela cheia permanente na TV.
   */
  useEffect(() => {
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
    };
  }, []);

  /**
   * O canal esta indo para a TV: o celular cala a boca na hora.
   *
   * Dois motivos. O obvio e o eco, porque o mesmo jogo tocando nos dois
   * aparelhos com meio segundo de diferenca confunde a vovo. O que nao e
   * obvio: a conta do provedor de IPTV permite poucas conexoes ao mesmo
   * tempo, entao enquanto o celular nao larga o canal a TV nem consegue
   * abrir o dela.
   */
  const pausarPorCausaDaTv = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    setTocando(false);
  }, []);

  /** A TV recusou: devolve o canal para o celular, sem a vovo pedir. */
  const voltarATocarNoCelular = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.play().catch(() => undefined);
    setTocando(true);
  }, []);

  const alternarPlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      pausadoPeloUsuarioRef.current = false;
      try {
        hlsRef.current?.startLoad(-1);
      } catch {
        /* fallback com play abaixo */
      }
      video.play().catch(() => undefined);
      setTocando(true);
      void tv.setPipPlaying(true);
    } else {
      pausadoPeloUsuarioRef.current = true;
      video.pause();
      setTocando(false);
      void tv.setPipPlaying(false);
    }
    reiniciarControles();
  }, [reiniciarControles]);

  const tentarDeNovo = useCallback(() => {
    forcarCorridaRef.current = true;
    pausadoPeloUsuarioRef.current = false;
    setErro(null);
    setTravandoAviso(false);
    setChaveVideo((k) => k + 1);
    setReordem((n) => n + 1);
    setTentativa((anterior) => anterior + 1);
  }, []);
  tentarDeNovoRef.current = tentarDeNovo;

  // Reattempt automatico quando todas as fontes falharem ou quando a internet voltar
  useEffect(() => {
    if (!erro || tvConectada) return;
    const relogio = window.setTimeout(() => {
      tentarDeNovo();
    }, 6000);
    return () => window.clearTimeout(relogio);
  }, [erro, tvConectada, tentarDeNovo]);

  useEffect(() => {
    const aoVoltarInternet = () => {
      if (tvConectada) return;
      if (erro) {
        tentarDeNovo();
        return;
      }
      const video = videoRef.current;
      const hls = hlsRef.current;
      if (hls) {
        try {
          hls.startLoad(-1);
        } catch {
          /* watchdog resolve */
        }
      }
      if (video && !pausadoPeloUsuarioRef.current) {
        video.play().catch(() => undefined);
      }
    };
    window.addEventListener('online', aoVoltarInternet);
    return () => window.removeEventListener('online', aoVoltarInternet);
  }, [erro, tvConectada, tentarDeNovo]);

  /** Retoma transmissao ao vivo automaticamente ao voltar para o app ou destravar a tela. */
  useEffect(() => {
    let timerRetomada: number | null = null;
    let ativo = true;

    const recuperarAoVoltar = () => {
      if (!ativo || tvConectada || radio || pausadoPeloUsuarioRef.current) return;
      const video = videoRef.current;
      if (!video) return;

      const hls = hlsRef.current;
      if (hls) {
        try {
          hls.startLoad(-1);
        } catch {
          /* recarrega abaixo se necessario */
        }
      }
      if (video.paused) {
        video.play().catch(() => undefined);
      }
      setTocando(true);
      void tv.setPipPlaying(true);

      const tempoAntes = video.currentTime;
      if (timerRetomada !== null) window.clearTimeout(timerRetomada);
      timerRetomada = window.setTimeout(() => {
        if (!ativo || tvConectada || radio || pausadoPeloUsuarioRef.current) return;
        const v = videoRef.current;
        if (!v) return;
        const congelado = v.paused || v.readyState < 2 || (Math.abs(v.currentTime - tempoAntes) < 0.05 && v.readyState < 3);
        if (congelado) {
          tentarDeNovo();
        }
      }, 1800);
    };

    const onVisibilidade = () => {
      if (!document.hidden) recuperarAoVoltar();
    };

    window.addEventListener('vovo:resume', recuperarAoVoltar);
    document.addEventListener('visibilitychange', onVisibilidade);
    let removerApp: (() => void) | null = null;
    CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive) recuperarAoVoltar();
    })
      .then((h) => {
        if (!ativo) h.remove();
        else removerApp = () => h.remove();
      })
      .catch(() => undefined);

    return () => {
      ativo = false;
      if (timerRetomada !== null) window.clearTimeout(timerRetomada);
      window.removeEventListener('vovo:resume', recuperarAoVoltar);
      document.removeEventListener('visibilitychange', onVisibilidade);
      if (removerApp) removerApp();
    };
  }, [tvConectada, radio, tentarDeNovo]);

  // --------------------------------------------------------------- controle remoto TV
  /**
   * Guia de canais (a gaveta) no controle remoto: cima e baixo andam pela
   * lista, OK sintoniza, Voltar ou direita fecham. Antes cima e baixo trocavam
   * o canal por tras da lista aberta e nao havia como escolher nada nela.
   */
  const [focoGaveta, setFocoGaveta] = useState(0);
  const canaisGavetaRef = useRef<(ChannelWithHealth | Channel)[]>([]);
  const focoGavetaRef = useRef(0);
  focoGavetaRef.current = focoGaveta;
  const selecionarRef = useRef(onSelectChannel);
  selecionarRef.current = onSelectChannel;

  const abrirGuia = useCallback(() => {
    const lista = canaisGavetaRef.current;
    const atual = lista.findIndex((c) => c.url === channel?.url);
    setFocoGaveta(atual >= 0 ? atual : 0);
    setGavetaAberta(true);
  }, [channel?.url]);

  /** Numero digitado no controle, como na TV de operadora: 1 e 2 = canal 12. */
  const [digitos, setDigitos] = useState('');
  const digitosRef = useRef('');
  const digitoTimerRef = useRef<number | null>(null);
  const digitar = useCallback(
    (d: string) => {
      const proximo = (digitosRef.current + d).slice(-3);
      digitosRef.current = proximo;
      setDigitos(proximo);
      if (digitoTimerRef.current !== null) window.clearTimeout(digitoTimerRef.current);
      digitoTimerRef.current = window.setTimeout(() => {
        const alvo = parseInt(digitosRef.current, 10) - primeiroNumero;
        digitosRef.current = '';
        setDigitos('');
        const canal = channelList[alvo];
        if (canal) onSelectChannel?.(canal);
        else dispararHud('canal', 'Esse canal não existe');
      }, ESPERA_DIGITO_MS);
    },
    [channelList, onSelectChannel, primeiroNumero, dispararHud]
  );
  useEffect(
    () => () => {
      if (digitoTimerRef.current !== null) window.clearTimeout(digitoTimerRef.current);
    },
    []
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        if (e.key !== 'Escape' && e.key !== 'GoBack') return;
      }
      const ok = e.key === 'Enter' || e.key === 'Select' || e.key === ' ';

      if (e.key === 'Escape' || e.key === 'Backspace' || e.key === 'GoBack') {
        e.preventDefault();
        voltarRef.current();
        return;
      }

      if (gavetaRef.current) {
        const total = canaisGavetaRef.current.length;
        if (e.key === 'ArrowUp' || e.key === 'ChannelUp' || e.key === 'PageUp') {
          e.preventDefault();
          setFocoGaveta((i) => (total ? (i - 1 + total) % total : 0));
        } else if (e.key === 'ArrowDown' || e.key === 'ChannelDown' || e.key === 'PageDown') {
          e.preventDefault();
          setFocoGaveta((i) => (total ? (i + 1) % total : 0));
        } else if (ok) {
          e.preventDefault();
          const canal = canaisGavetaRef.current[focoGavetaRef.current];
          if (canal) selecionarRef.current?.(canal);
          setGavetaAberta(false);
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          setGavetaAberta(false);
        }
        return;
      }

      if (/^[0-9]$/.test(e.key)) {
        digitar(e.key);
        return;
      }

      if (e.key === 'ArrowUp' || e.key === 'ChannelUp' || e.key === 'PageUp') {
        e.preventDefault();
        onPrevChannel?.();
      } else if (e.key === 'ArrowDown' || e.key === 'ChannelDown' || e.key === 'PageDown') {
        e.preventDefault();
        onNextChannel?.();
      } else if (e.key === 'MediaPlayPause') {
        e.preventDefault();
        alternarPlay();
      } else if (ok && !isTv) {
        e.preventDefault();
        alternarPlay();
      } else if (ok || e.key === 'ArrowLeft') {
        // na TV o OK abre o guia de canais, como no controle da operadora
        e.preventDefault();
        abrirGuia();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        reiniciarControles();
      }
    };

    const handleChannelNext = () => onNextChannel?.();
    const handleChannelPrev = () => onPrevChannel?.();
    const handlePlayPause = () => alternarPlay();
    const handleBack = () => voltarRef.current();

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('vovo:channel_next', handleChannelNext);
    window.addEventListener('vovo:channel_prev', handleChannelPrev);
    window.addEventListener('vovo:play_pause', handlePlayPause);
    window.addEventListener('vovo:back', handleBack);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('vovo:channel_next', handleChannelNext);
      window.removeEventListener('vovo:channel_prev', handleChannelPrev);
      window.removeEventListener('vovo:play_pause', handlePlayPause);
      window.removeEventListener('vovo:back', handleBack);
    };
  }, [isTv, onPrevChannel, onNextChannel, alternarPlay, reiniciarControles, abrirGuia, digitar]);

  // --------------------------------------------------------------- gestos

  const inicioToque = (e: React.TouchEvent) => {
    if (gavetaAberta || e.touches.length !== 1) return;
    const toque = e.touches[0];
    const largura = window.innerWidth;

    toqueRef.current = {
      x: toque.clientX,
      y: toque.clientY,
      centro: toque.clientX >= largura * 0.25 && toque.clientX <= largura * 0.75,
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

    if (Math.abs(dx) > 8 || Math.abs(dy) > 8) inicio.moveu = true;
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

  const canaisGaveta = useMemo(() => {
    const busca = buscaGaveta.trim().toLowerCase();
    if (!busca) return channelList;
    return channelList.filter(
      (c) =>
        (c.name || '').toLowerCase().includes(busca) ||
        (c.group || '').toLowerCase().includes(busca)
    );
  }, [channelList, buscaGaveta]);
  canaisGavetaRef.current = canaisGaveta;

  // o canal em foco no guia sempre a vista
  useEffect(() => {
    if (!gavetaAberta) return;
    document
      .querySelector<HTMLElement>(`[data-guia-indice="${focoGaveta}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [gavetaAberta, focoGaveta]);

  if (!channel) return null;

  // Na TV nao aparece botao nenhum: tudo e pelo controle remoto (Voltar,
  // cima/baixo troca de canal, esquerda abre a lista, volume e o da TV).
  // Em PiP (miniatura flutuante) esconde menus para mostrar so o video limpo.
  const barrasNaTela = mostrarControles && !isTv && !emPip;
  const controlesVisiveis = barrasNaTela ? 'opacity-100' : 'pointer-events-none opacity-0';
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
        key={chaveVideo}
        ref={(el) => {
          (videoRef as any).current = el;
          if (el) {
            el.volume = 1.0;
            el.muted = false;
          }
        }}
        onLoadedMetadata={(e) => {
          e.currentTarget.volume = 1.0;
          e.currentTarget.muted = false;
        }}
        onPlay={(e) => {
          e.currentTarget.volume = 1.0;
          e.currentTarget.muted = false;
          setTocando(true);
          void tv.setPipPlaying(true);
        }}
        onPlaying={(e) => {
          e.currentTarget.volume = 1.0;
          e.currentTarget.muted = false;
        }}
        onPause={() => {
          if (emPipRef.current && !pausadoPeloUsuarioRef.current && videoRef.current) {
            videoRef.current.play().catch(() => undefined);
            return;
          }
          setTocando(false);
          if (pausadoPeloUsuarioRef.current) {
            void tv.setPipPlaying(false);
          }
        }}
        playsInline
        className={`h-full w-full object-contain ${radio ? 'hidden' : 'block'}`}
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

      {/* Modo espelhado na TV: controle remoto simples para trocar de canal ou desconectar */}
      {!isTv && tvConectada && (
        <div
          className="area-segura-topo area-segura-base absolute inset-0 z-30 flex flex-col items-center justify-center gap-5 bg-noite-900 px-5 text-center"
          {...pararPropagacao}
        >
          <div className="inline-flex items-center gap-2 rounded-full border-2 border-vivo-400/50 bg-vivo-400/15 px-4 py-1.5 text-sm font-black text-vivo-400 sm:text-base">
            <Cast className="h-5 w-5" strokeWidth={2.5} />
            ESPELHADO NA {tvConectada.name.toUpperCase()}
          </div>

          <div className="flex flex-col items-center gap-3">
            {channel.logo && (
              <img
                src={channel.logo}
                alt=""
                className="h-20 w-20 rounded-2xl bg-white/10 object-contain p-2"
              />
            )}
            <div className="flex items-center gap-2.5">
              {typeof numero === 'number' && (
                <span className="rounded-xl bg-sol-400 px-3 py-1 text-xl font-black text-noite-900">
                  {numero}
                </span>
              )}
              <h2 className="text-3xl font-black text-tinta-100 sm:text-4xl">{nomeCanal}</h2>
            </div>
          </div>

          {guiaNoAr.agora && (
            <div className="w-full max-w-md rounded-2xl border-2 border-noite-600 bg-noite-800 p-4 text-left">
              <p className="text-xs font-black tracking-wide text-tinta-500 uppercase">Passando agora</p>
              <p className="mt-0.5 text-xl font-black text-sol-400">{guiaNoAr.agora.titulo}</p>
              <p className="mt-1 text-base font-bold text-tinta-100">
                {horarioDoPrograma(guiaNoAr.agora)}
              </p>
              {(() => {
                const pct = progressoDoPrograma(guiaNoAr.agora);
                if (pct === null) return null;
                return (
                  <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-noite-900">
                    <div className="h-full rounded-full bg-sol-400" style={{ width: `${pct}%` }} />
                  </div>
                );
              })()}
              {guiaNoAr.depois && (
                <p className="mt-2 truncate text-sm font-semibold text-tinta-300">
                  Depois ({horaCurta(guiaNoAr.depois.inicio)}): {guiaNoAr.depois.titulo}
                </p>
              )}
            </div>
          )}

          {enviandoParaTv && (
            <div className="flex items-center gap-2.5 rounded-2xl bg-noite-800 px-5 py-3 text-lg font-bold text-sol-400">
              <Loader2 className="h-6 w-6 animate-spin" />
              Mandando {nomeCanal} para a TV...
            </div>
          )}

          {erroNaTv && !enviandoParaTv && (
            <div className="flex max-w-md flex-col items-center gap-2 rounded-2xl border-2 border-morto-400/50 bg-morto-400/10 p-4">
              <p className="text-base font-bold text-morto-400">{erroNaTv}</p>
              <button
                onClick={() => {
                  ultimaEnviadaRef.current = null;
                  setTentativa((t) => t + 1);
                }}
                className="flex h-12 items-center gap-2 rounded-xl bg-sol-400 px-5 text-base font-black text-noite-900 transition active:scale-95"
              >
                <RotateCcw className="h-5 w-5" strokeWidth={2.5} />
                Tentar mandar de novo
              </button>
            </div>
          )}

          <div className="flex w-full max-w-md flex-wrap items-center justify-center gap-2.5">
            {onPrevChannel && (
              <button
                onClick={onPrevChannel}
                className="flex h-16 min-w-[8.5rem] flex-1 items-center justify-center gap-1.5 rounded-2xl border-2 border-noite-500 bg-noite-800 px-4 text-base font-black text-tinta-100 transition active:scale-95"
              >
                <ChevronLeft className="h-6 w-6 text-sol-400" strokeWidth={3} />
                Anterior
              </button>
            )}
            {channelList.length > 0 && (
              <button
                onClick={() => setGavetaAberta(true)}
                className="flex h-16 min-w-[8.5rem] flex-1 items-center justify-center gap-2 rounded-2xl border-2 border-noite-500 bg-noite-800 px-4 text-base font-black text-tinta-100 transition active:scale-95"
              >
                <List className="h-6 w-6 text-sol-400" strokeWidth={2.5} />
                Canais
              </button>
            )}
            {onNextChannel && (
              <button
                onClick={onNextChannel}
                className="flex h-16 min-w-[8.5rem] flex-1 items-center justify-center gap-1.5 rounded-2xl border-2 border-noite-500 bg-noite-800 px-4 text-base font-black text-tinta-100 transition active:scale-95"
              >
                Próximo
                <ChevronRight className="h-6 w-6 text-sol-400" strokeWidth={3} />
              </button>
            )}
          </div>

          {onDesconectarTv && (
            <button
              onClick={() => void onDesconectarTv()}
              className="flex h-16 w-full max-w-md items-center justify-center gap-2 rounded-2xl bg-morto-400 px-6 text-xl font-black text-noite-900 transition active:scale-95"
            >
              <Square className="h-6 w-6 fill-current" />
              Desconectar da TV
            </button>
          )}
        </div>
      )}

      {/* Numero + nome do canal so enquanto liga ou quando deu erro, para a
          vovo saber qual canal tentou abrir. Assistindo, quem mostra o nome e
          a faixa de baixo, que some sozinha em 3 segundos. */}
      <div
        className={`pointer-events-none absolute top-24 left-4 z-50 flex max-w-[70vw] items-center gap-2.5 rounded-2xl border border-white/15 bg-black/75 px-4 py-2 transition-opacity duration-300 ${
          !emPip && (carregando || erro) ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <span
          className={`h-3 w-3 shrink-0 rounded-full ${carregando ? 'bg-alerta-400' : erro ? 'bg-morto-400' : 'bg-vivo-400'}`}
        />
        {typeof numero === 'number' && (
          <span className="shrink-0 rounded-lg bg-sol-400 px-2 py-0.5 text-base font-black text-noite-900">
            {numero}
          </span>
        )}
        <span className="line-clamp-2 text-lg leading-snug font-black text-white">{nomeCanal}</span>
      </div>

      {/* Aviso de troca rapida de canal */}
      {!emPip && hud && hud.tipo === 'canal' && (
        <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center">
          <div className="flex min-w-[12rem] flex-col items-center gap-3 rounded-3xl border border-noite-500 bg-noite-900/95 px-7 py-5">
            <Tv className="h-11 w-11 text-sol-400" strokeWidth={2.5} />
            <span className="text-center text-xl font-black text-white">{hud.valor}</span>
          </div>
        </div>
      )}

      {!carregando && !erro && travandoAviso && !emPip && !tvConectada && (
        <div className="pointer-events-none absolute top-24 right-4 z-30 flex items-center gap-2 rounded-full border border-sol-400/50 bg-black/80 px-4 py-2">
          <Loader2 className="h-4 w-4 animate-spin text-sol-400" strokeWidth={2.5} />
          <span className="text-sm font-black text-tinta-100">Reconectando sinal...</span>
        </div>
      )}

      {carregando && (
        <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-black/70">
          <Loader2 className="h-16 w-16 animate-spin text-sol-400" strokeWidth={2.5} />
          <span className="text-xl font-black text-white">
            {indiceFonte > 0 ? 'Procurando outro sinal deste canal...' : 'Ligando o canal...'}
          </span>
          {indiceFonte > 0 && (
            <span className="text-lg font-bold text-tinta-300">
              tentativa {indiceFonte + 1} de {fontes.length}
            </span>
          )}
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
              ? 'Veja se o computador de casa está ligado. Tentando reconectar automaticamente...'
              : 'Tentando reconectar automaticamente em instantes...'}
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

        {/* Botao de miniatura (Picture-in-Picture) */}
        {!isTv && !radio && !tvConectada && !emPip && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              void tv.enterPip();
            }}
            className="flex h-toque shrink-0 items-center gap-2 rounded-2xl border-2 border-noite-500 bg-noite-900/90 px-3.5 text-white transition active:scale-95"
            aria-label="Assistir em janela flutuante"
          >
            <PictureInPicture2 className="h-6 w-6 text-sol-400" strokeWidth={2.5} />
            <span className="hidden text-base font-black sm:inline">Miniatura</span>
          </button>
        )}

        {/* Rodando direto na TV nao faz sentido "mandar pra TV": ja esta nela */}
        {!isTv && podeMandarParaTv && !radio && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setCastAberto(true);
            }}
            className={`flex h-toque shrink-0 items-center gap-2 rounded-2xl border-2 px-4 transition active:scale-95 ${
              tvConectada
                ? 'border-vivo-400 bg-vivo-400/20 text-vivo-400'
                : 'border-noite-500 bg-noite-900/90 text-white'
            }`}
            aria-label={tvConectada ? 'Opções da TV conectada' : 'Mandar este canal para a TV'}
          >
            <Cast className={`h-7 w-7 ${tvConectada ? 'text-vivo-400' : 'text-sol-400'}`} strokeWidth={2.5} />
            <span className="hidden text-lg font-black sm:inline">
              {tvConectada ? 'Na TV' : 'TV'}
            </span>
          </button>
        )}

        {!isTv && tvConectada && onDesconectarTv && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              void onDesconectarTv();
            }}
            className="flex h-toque shrink-0 items-center gap-1.5 rounded-2xl bg-morto-400 px-3.5 text-noite-900 transition active:scale-95"
            aria-label="Desconectar da TV"
          >
            <Square className="h-5 w-5 fill-current" />
            <span className="text-base font-black">Desconectar</span>
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

      </div>

      {/* Barra unica de baixo no celular: mostra informacoes do programa e botoes essenciais sem sobreposicao */}
      {!tvConectada && !isTv && (
        <div
          className={`area-segura-base absolute right-0 bottom-0 left-0 z-50 bg-gradient-to-t from-black/95 via-black/80 to-transparent px-4 pt-12 transition-opacity duration-300 ${controlesVisiveis}`}
          {...pararPropagacao}
        >
          <div className="mx-auto max-w-xl">
            <div className="mb-3 rounded-2xl border border-white/15 bg-noite-900/90 px-4 py-3">
              <div className="flex items-center gap-2.5">
                {typeof numero === 'number' && (
                  <span className="shrink-0 rounded-lg bg-sol-400 px-2 py-0.5 text-sm font-black text-noite-900">
                    {numero}
                  </span>
                )}
                <p className="truncate text-lg font-black text-white">{nomeCanal}</p>
              </div>
              {!radio && guiaNoAr.agora ? (
                <>
                  <p className="mt-1 truncate text-base font-black text-sol-400">
                    Agora: {guiaNoAr.agora.titulo}
                  </p>
                  <p className="text-sm font-bold text-tinta-100">
                    {horarioDoPrograma(guiaNoAr.agora)}
                  </p>
                  {(() => {
                    const pct = progressoDoPrograma(guiaNoAr.agora);
                    if (pct === null) return null;
                    return (
                      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/15">
                        <div className="h-full rounded-full bg-sol-400" style={{ width: `${pct}%` }} />
                      </div>
                    );
                  })()}
                  {guiaNoAr.depois && (
                    <p className="mt-1 truncate text-xs font-semibold text-tinta-300">
                      Depois ({horaCurta(guiaNoAr.depois.inicio)}): {guiaNoAr.depois.titulo}
                    </p>
                  )}
                </>
              ) : (
                channel.group && <p className="mt-0.5 truncate text-sm font-bold text-tinta-300">{channel.group}</p>
              )}
            </div>

            {!radio && !deitado && (
              <p className="mb-2.5 text-center text-sm font-bold text-tinta-300">
                Deite o celular para ver em tela cheia
              </p>
            )}

            <div className="flex items-stretch justify-center gap-2.5">
              {onPrevChannel && (
                <button
                  onClick={() => {
                    onPrevChannel();
                    reiniciarControles();
                  }}
                  className="flex h-14 flex-1 items-center justify-center gap-1.5 rounded-2xl border-2 border-noite-500 bg-noite-900/90 px-3 text-white transition active:scale-95"
                  aria-label="Canal anterior"
                >
                  <ChevronLeft className="h-6 w-6 text-sol-400" strokeWidth={3} />
                  <span className="text-sm font-black">Anterior</span>
                </button>
              )}

              <button
                onClick={alternarPlay}
                className="flex h-14 min-w-[7rem] flex-1 items-center justify-center gap-2 rounded-2xl bg-sol-400 px-4 text-noite-900 transition active:scale-95"
                aria-label={tocando ? 'Pausar' : 'Continuar'}
              >
                {tocando ? <Pause className="h-6 w-6 fill-current" /> : <Play className="h-6 w-6 fill-current" />}
                <span className="text-sm font-black">{tocando ? 'Pausar' : 'Continuar'}</span>
              </button>

              {onNextChannel && (
                <button
                  onClick={() => {
                    onNextChannel();
                    reiniciarControles();
                  }}
                  className="flex h-14 flex-1 items-center justify-center gap-1.5 rounded-2xl border-2 border-noite-500 bg-noite-900/90 px-3 text-white transition active:scale-95"
                  aria-label="Próximo canal"
                >
                  <span className="text-sm font-black">Próximo</span>
                  <ChevronRight className="h-6 w-6 text-sol-400" strokeWidth={3} />
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Gaveta de canais */}
      {gavetaAberta && (
        <div
          className={`area-segura-topo absolute top-0 right-0 bottom-0 z-[70] flex max-w-[88vw] flex-col border-l-2 border-noite-600 bg-noite-900 ${isTv ? 'w-[34rem]' : 'w-80'}`}
          {...pararPropagacao}
        >
          <div className="flex items-center gap-2 border-b border-noite-600 px-3 pb-3">
            <h3 className="flex-1 text-xl font-black text-tinta-100">
              {isTv ? 'Canais · OK para assistir' : 'Canais'}
            </h3>
            <button
              onClick={() => setGavetaAberta(false)}
              className="flex h-12 w-12 items-center justify-center rounded-xl border-2 border-noite-500 bg-noite-700 text-tinta-100 transition active:scale-90"
              aria-label="Fechar a lista"
            >
              <X className="h-6 w-6" strokeWidth={3} />
            </button>
          </div>

          {!isTv && (
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
          )}

          <div className="flex-1 space-y-2 overflow-y-auto overscroll-contain p-2">
            {canaisGaveta.map((canal, indice) => {
              const ativo = canal.url === channel.url;
              const focado = isTv && indice === focoGaveta;
              const numeroDoCanal = channelList.indexOf(canal) + primeiroNumero;
              return (
                <button
                  key={canal.url}
                  data-guia-indice={indice}
                  onClick={() => {
                    onSelectChannel?.(canal);
                    setGavetaAberta(false);
                  }}
                  className={`flex min-h-16 w-full items-center gap-3 rounded-2xl border-2 p-2 text-left transition active:scale-[0.98] ${
                    ativo
                      ? 'border-sol-400 bg-sol-400 text-noite-900'
                      : 'border-noite-600 bg-noite-700 text-tinta-100'
                  } ${focado ? 'ring-4 ring-white' : ''}`}
                >
                  <span className="w-12 shrink-0 text-center font-mono text-lg font-black opacity-80">
                    {numeroDoCanal}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`line-clamp-2 leading-snug font-black ${isTv ? 'text-xl' : 'text-base'}`}>
                      {cleanChannelName(canal.name)}
                    </span>
                    {focado && <ProgramaAgora epg={canal.epg} />}
                  </span>
                  {ativo && <span className="h-3 w-3 shrink-0 rounded-full bg-noite-900" />}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {avisoVoltar && (
        <div className="pointer-events-none absolute top-[8vh] left-1/2 z-[80] -translate-x-1/2 rounded-2xl border-2 border-sol-400 bg-noite-900/95 px-7 py-4 text-center text-2xl font-black text-sol-400 shadow-2xl">
          Aperte Voltar de novo para escolher outra TV
        </div>
      )}

      {digitos && (
        <div className="pointer-events-none absolute top-[8vh] right-[6vw] z-[80] rounded-2xl bg-sol-400 px-6 py-3 font-mono text-5xl font-black text-noite-900 shadow-2xl">
          {digitos}
        </div>
      )}

      {isTv && !radio && !tvConectada && (
        <FaixaDoCanal
          numero={numero}
          nome={nomeCanal}
          logo={channel.logo}
          categoria={channel.group}
          epg={channel.epg}
          reacender={reacender}
          acimaDosControles={false}
        />
      )}

      <CastSheet
        isOpen={castAberto}
        channelName={channel.name}
        channelUrl={comPassePluto(endereco || channel.url)}
        connectedTv={tvConectada}
        onClose={() => setCastAberto(false)}
        onVaiParaTv={pausarPorCausaDaTv}
        onVoltaProCelular={voltarATocarNoCelular}
        onTvConectada={(tvEscolhida, sentUrl) => {
          ultimaEnviadaRef.current = { tvId: tvEscolhida.id, url: sentUrl };
          onTvConectada?.(tvEscolhida, nomeCanal);
        }}
        onTvDesconectada={() => {
          ultimaEnviadaRef.current = null;
          void onDesconectarTv?.();
        }}
      />
    </div>
  );
};

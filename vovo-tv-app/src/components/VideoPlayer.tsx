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
  ChevronLeft,
  RotateCcw,
  List,
  X,
  Search,
  Cast,
  Loader2
} from 'lucide-react';
import type { Channel, ChannelWithHealth } from '../types';
import { tv } from '../utils/tvBridge';
import { podeMandarParaTv } from '../utils/tvsDaCasa';
import { ehCanalDeCamera } from '../utils/cameras';
import { fontesDoCanal } from '../utils/fontes';
import { ordenarFontes, lembrarFonteBoa } from '../utils/corrida';
import { FaixaDoCanal } from './FaixaDoCanal';
import { programacaoDoCanal, comPassePluto, type AgoraEDepois } from '../utils/programacao';

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
  return <span className="block truncate text-base font-bold text-sol-400">Agora: {guia.agora.titulo}</span>;
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
  /** Acabaram TODAS as fontes deste canal; quem chama decide o que fazer. */
  onChannelExhausted?: () => void;
  /** Numero do primeiro canal da lista (1 na TV Aberta, 101 no Cine Zap). */
  primeiroNumero?: number;
}

/** Janela para o segundo Voltar contar como "quero sair". */
const JANELA_VOLTAR_MS = 3000;
/** Dois "voltar" mais perto que isso sao o mesmo aperto do controle. */
const REPIQUE_VOLTAR_MS = 400;
/** Espera depois do ultimo digito antes de sintonizar o numero digitado. */
const ESPERA_DIGITO_MS = 1600;

type Hud = { tipo: 'volume' | 'brilho' | 'canal'; valor: number | string } | null;

const PASSOS_BRILHO = [1, 0.7, 0.45, 0.2];

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
  onChannelExhausted,
  primeiroNumero = 1
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);

  const [deitado, setDeitado] = useState(false);
  const [volume, setVolume] = useState(() => {
    // Sempre le o volume salvo, TV ou celular. Antes a TV ignorava o valor
    // salvo e forcava 100% a cada canal reaberto: parecia que o volume
    // "pulava" sozinho, quando na verdade era o app jogando fora o nivel
    // que a pessoa tinha deixado.
    const salvo = localStorage.getItem('vovo_tv_volume');
    if (salvo !== null) {
      const v = parseFloat(salvo);
      if (!isNaN(v) && v >= 0 && v <= 1) return v;
    }
    return isTv ? 1.0 : 0.5; // sem nada salvo ainda: TV comeca no maximo, celular em 50%
  });
  const volumeRef = useRef(volume);
  useEffect(() => {
    volumeRef.current = volume;
  }, [volume]);

  const [brilho, setBrilho] = useState(() => {
    const salvo = localStorage.getItem('vovo_tv_brightness');
    return salvo !== null ? parseFloat(salvo) : 1.0;
  });
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [mostrarControles, setMostrarControles] = useState(true);
  const [tocando, setTocando] = useState(true);
  const [mudo, setMudo] = useState(false);
  const mudoRef = useRef(mudo);
  useEffect(() => {
    mudoRef.current = mudo;
  }, [mudo]);
  /** Sobe a cada "tentar de novo" e refaz a carga do stream do zero. */
  const [tentativa, setTentativa] = useState(0);

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
    if (fontes.length === 0) return;
    const controle = new AbortController();
    ordenarFontes(channel?.id || channel?.name || '', fontes, controle.signal).then((r) => {
      if (!controle.signal.aborted) setOrdem(r);
    });
    return () => controle.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fontes]);

  /** URL que esta tocando agora e se ainda ha reserva depois dela. */
  const endereco = ordem ? ordem[Math.min(indiceFonte, ordem.length - 1)] || '' : '';
  const temReserva = !!ordem && indiceFonte + 1 < ordem.length;

  /** Sobe a cada tecla/toque: a faixa com nome e programa reaparece por 3s. */
  const [reacender, setReacender] = useState(0);

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
    return () => {
      tv.keepAwake(false);
      tv.resetBrightness();
      tv.setImmersive(false);
    };
  }, []);

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

  /** Carrega o canal. Refaz do zero quando o canal muda ou ao tentar de novo. */
  useEffect(() => {
    const video = videoRef.current;
    if (!channel || !video) return;

    setCarregando(true);
    // ainda escolhendo a fonte mais rapida: so mostra "ligando o canal"
    if (!endereco) return;
    setErro(null);

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

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
    }, indiceFonte === 0 ? 12000 : 9000);


    const sucesso = () => {
      if (encerrado) return;
      encerrado = true;
      window.clearTimeout(relogio);
      if (video) {
        video.volume = volumeRef.current;
        video.muted = mudoRef.current;
      }
      setCarregando(false);
      setErro(null);
      lembrarFonteBoa(channel.id || channel.name, endereco);
      onPlaybackOk?.(endereco);
    };

    const falha = (detalhe: string) => {
      if (encerrado) return;
      encerrado = true;
      console.warn('[player] FALHOU', JSON.stringify({ canal: channel.name, detalhe, temReserva }));
      window.clearTimeout(relogio);
      // marca ESTA fonte como ruim (a saude e por URL), nao o canal inteiro
      onPlaybackFail?.(endereco, detalhe);

      if (temReserva) {
        // ainda ha outra URL deste mesmo canal: troca sem mostrar erro
        setIndiceFonte((i) => i + 1);
        return;
      }

      setCarregando(false);
      setErro(
        ehCanalDeCamera(channel)
          ? 'A câmera não está aparecendo agora.'
          : 'Este canal não está no ar agora.'
      );
      onChannelExhausted?.();
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
        maxBufferHole: 0.5,
        // Desistir rapido de fonte ruim: o padrao do hls.js tenta de novo por
        // quase um minuto antes de admitir erro, e so depois disso o player
        // ia para a proxima URL do canal.
        manifestLoadingTimeOut: 6000,
        manifestLoadingMaxRetry: temReserva ? 0 : 2,
        levelLoadingTimeOut: 6000,
        levelLoadingMaxRetry: temReserva ? 0 : 2,
        fragLoadingTimeOut: 8000,
        fragLoadingMaxRetry: temReserva ? 1 : 3
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
          video.volume = volumeRef.current;
          video.muted = mudoRef.current;
        }

        video.play().then(sucesso).catch(() => {
          /* o autoplay pode ser barrado; o onplaying resolve quando destravar */
        });
      });

      // Uma tentativa de recuperar por tipo de erro. Sem esse limite o
      // startLoad/recoverMediaError repetia para sempre numa fonte quebrada e
      // o canal nunca chegava a tentar a proxima URL.
      let recuperouRede = false;
      let recuperouMidia = false;

      hls.on(Hls.Events.ERROR, (_evento, dados) => {
        if (!dados.fatal) return;
        // fica no log: e por onde se descobre canal quebrado na TV, que nao
        // tem console do navegador para abrir
        console.warn('[player] hls', JSON.stringify({
          tipo: dados.type,
          detalhe: dados.details,
          codigo: dados.response?.code
        }));
        // com outra fonte na reserva, nao insiste: trocar e mais rapido
        if (dados.type === Hls.ErrorTypes.NETWORK_ERROR && !recuperouRede && !temReserva) {
          recuperouRede = true;
          hls.startLoad();
          return;
        }
        if (dados.type === Hls.ErrorTypes.MEDIA_ERROR && !recuperouMidia) {
          recuperouMidia = true;
          hls.recoverMediaError();
          return;
        }
        hls.destroy();
        falha(dados.details || 'erro fatal de hls');
      });

      hlsRef.current = hls;
    } else {
      video.src = comPassePluto(endereco);
      video.volume = volumeRef.current;
      video.muted = mudoRef.current;
      video.play().then(sucesso).catch(() => falha('nao consegui iniciar'));
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
      // Canal sem hls.js (URL sem .m3u8, vai direto pro <video>): sem isto a
      // conexao do stream anterior nao fecha de verdade ao trocar ou sair,
      // e em provedor de IPTV com limite de conexao simultanea isso segura
      // a vaga da conta e trava o proximo canal a abrir.
      video.pause();
      video.removeAttribute('src');
      video.load();
    };
    // Depende do ENDERECO, nao do objeto `channel`: quem monta o canal pode
    // recriar o objeto a cada render sem querer, e ai o player se remontava
    // no meio da exibicao. Endereco igual = nada para refazer.
  }, [endereco, temReserva, tentativa, onPlaybackOk, onPlaybackFail, onChannelExhausted]);
  // indiceFonte fica de fora de proposito: ele so muda junto com o endereco

  /**
   * Mantem o volume persistido e ajusta no elemento de video.
   */
  useEffect(() => {
    const video = videoRef.current;
    if (video) {
      video.volume = volume;
      video.muted = mudo;
    }
    localStorage.setItem('vovo_tv_volume', volume.toString());
  }, [volume, mudo]);

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
        if (videoRef.current) {
          videoRef.current.volume = proximo;
          videoRef.current.muted = false;
        }
        localStorage.setItem('vovo_tv_volume', proximo.toString());
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
    setIndiceFonte(0);
    setTentativa((anterior) => anterior + 1);
  }, []);

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
      } else if (e.key === 'm' || e.key === 'M' || e.key === 'VolumeMute') {
        e.preventDefault();
        alternarMudo();
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
  }, [isTv, onPrevChannel, onNextChannel, alternarPlay, alternarMudo, reiniciarControles, abrirGuia, digitar]);

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
  // Os botoes na tela sao so para o celular, que nao tem controle.
  const barrasNaTela = mostrarControles && !isTv;
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
        ref={(el) => {
          (videoRef as any).current = el;
          if (el) {
            el.volume = volumeRef.current;
            el.muted = mudoRef.current;
          }
        }}
        onLoadedMetadata={(e) => {
          e.currentTarget.volume = volumeRef.current;
          e.currentTarget.muted = mudoRef.current;
        }}
        onPlay={(e) => {
          e.currentTarget.volume = volumeRef.current;
          e.currentTarget.muted = mudoRef.current;
          setTocando(true);
        }}
        onPlaying={(e) => {
          e.currentTarget.volume = volumeRef.current;
          e.currentTarget.muted = mudoRef.current;
        }}
        onPause={() => setTocando(false)}
        playsInline
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

      {/* Numero + nome do canal so enquanto liga ou quando deu erro, para a
          vovo saber qual canal tentou abrir. Assistindo, quem mostra o nome e
          a faixa de baixo, que some sozinha em 3 segundos. */}
      <div
        className={`pointer-events-none absolute top-24 left-4 z-50 flex max-w-[70vw] items-center gap-2.5 rounded-2xl border border-white/15 bg-black/75 px-4 py-2 transition-opacity duration-300 ${
          carregando || erro ? 'opacity-100' : 'opacity-0'
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

        {/* Rodando direto na TV nao faz sentido "mandar pra TV": ja esta nela */}
        {!isTv && podeMandarParaTv && !radio && (
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

      </div>

      {/* Barra de baixo */}
      <div
        className={`area-segura-base absolute right-0 bottom-0 left-0 z-50 bg-gradient-to-t from-black/95 to-transparent px-3 pt-10 transition-opacity duration-300 ${controlesVisiveis}`}
        {...pararPropagacao}
      >
        {!isTv && !radio && !deitado && (
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

          {!isTv && (
            <button
              onClick={() => ajustarVolume(-0.1)}
              className="flex h-16 min-w-16 flex-col items-center justify-center gap-0.5 rounded-2xl border-2 border-noite-500 bg-noite-900/90 px-3 text-white transition active:scale-95"
              aria-label="Abaixar o volume"
            >
              <Minus className="h-7 w-7 text-sol-400" strokeWidth={3} />
              <span className="text-xs font-black">Volume</span>
            </button>
          )}

          {/* Canal ao vivo: pausar e retomar so pula pra frente no tempo (nao
              existe "de onde parei"), confunde mais do que ajuda na TV. */}
          {!isTv && (
            <button
              onClick={alternarPlay}
              className="flex h-16 min-w-20 flex-col items-center justify-center gap-0.5 rounded-2xl bg-sol-400 px-4 text-noite-900 transition active:scale-95"
              aria-label={tocando ? 'Pausar' : 'Continuar'}
            >
              {tocando ? <Pause className="h-8 w-8 fill-current" /> : <Play className="h-8 w-8 fill-current" />}
              <span className="text-xs font-black">{tocando ? 'Pausar' : 'Continuar'}</span>
            </button>
          )}

          {!isTv && (
            <button
              onClick={() => ajustarVolume(0.1)}
              className="flex h-16 min-w-16 flex-col items-center justify-center gap-0.5 rounded-2xl border-2 border-noite-500 bg-noite-900/90 px-3 text-white transition active:scale-95"
              aria-label="Aumentar o volume"
            >
              <Plus className="h-7 w-7 text-sol-400" strokeWidth={3} />
              <span className="text-xs font-black">Volume</span>
            </button>
          )}

          {!isTv && !radio && (
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

      {!radio && (
        <FaixaDoCanal
          numero={numero}
          nome={nomeCanal}
          logo={channel.logo}
          categoria={channel.group}
          epg={channel.epg}
          reacender={reacender}
          acimaDosControles={barrasNaTela}
        />
      )}

      <CastSheet
        isOpen={castAberto}
        channelName={channel.name}
        channelUrl={channel.url}
        onClose={() => setCastAberto(false)}
        onVaiParaTv={pausarPorCausaDaTv}
        onVoltaProCelular={voltarATocarNoCelular}
      />
    </div>
  );
};

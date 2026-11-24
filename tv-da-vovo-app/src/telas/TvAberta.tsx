import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import defaultChannelsData from '../data/canais_abertos.json';
import type { Channel, ChannelWithHealth } from '../types';
import {
  loadHealth,
  saveHealth,
  applyProbeResult,
  markConfirmed,
  markPlaybackFail,
  runBatchProbe,
  isStale
} from '../utils/health';
import type { HealthMap, ProbeResult } from '../utils/health';
import type { AvailableUpdate } from '../utils/updater';
import { dedupe } from '../utils/channelList';
import { fontesDoCanal, saudeDoCanal, compararPorNome } from '../utils/fontes';
import { limparCacheAntigoDeFontes, registrarDesempenhoFonte } from '../utils/corrida';
import { buscarCanaisDeCamera, ehCanalDeCamera } from '../utils/cameras';
import { carregarCanaisEmCache, buscarCanaisRemotos } from '../utils/canaisRemotos';
import { tv } from '../utils/tvBridge';
import { pararNaTv, type TvNaRede } from '../utils/tvsDaCasa';
import { cleanChannelName } from '../utils/channelName';
import { App as CapacitorApp } from '@capacitor/app';
import { Header } from '../components/Header';
import { ChannelCard } from '../components/ChannelCard';
import { VideoPlayer } from '../components/VideoPlayer';
import { SettingsSheet } from '../components/SettingsSheet';
import { UpdatePrompt } from '../components/UpdatePrompt';
import { SearchX, Plus, WifiOff } from 'lucide-react';

const PROBE_WORKERS = 4;
const PROBE_LOTE = 80;
const INTERVALO_PROBE_MS = 2 * 60_000;
const INTERVALO_REMOTO_MS = 5 * 60_000;
// Todos os canais de uma vez: sem botao de "mostrar mais" na tela da vovo
const PAGINA = 500;
const COLS = 5;

/**
 * Ordem da grade, igual a do painel do PC:
 *   1. cameras de casa (o que a vovo mais abre)
 *   2. canais abertos, de A a Z
 *   3. canais do Pluto TV, de A a Z
 *
 * Antes a fila era por sinal medido, entao a mesma grade mudava de lugar a
 * cada teste de saude e a vovo perdia a referencia de onde o canal estava.
 */
const CONHECIDAS = ['globo', 'record', 'sbt', 'band', 'redetv'];
const ORDEM_PADRAO = new Map(
  (defaultChannelsData as Channel[]).map((c, idx) => [c.id || c.url, idx])
);

function pesoDoCanal(canal: Channel): number {
  if (ehCanalDeCamera(canal)) return -1;
  const pos = ORDEM_PADRAO.get(canal.id || canal.url);
  if (pos !== undefined) return pos;
  const nome = (canal.name || '').toLowerCase();
  if (CONHECIDAS.some((marca) => nome.includes(marca))) return 500;
  return 1000;
}

type CategoriaFiltro = 'todos' | 'abertos' | 'noticias';

export default function TvAberta({ onVoltarInicio }: { onVoltarInicio: () => void }) {
  const [channels, setChannels] = useState<Channel[]>(() => {
    const base = carregarCanaisEmCache() ?? (defaultChannelsData as Channel[]);
    try {
      const salvos = localStorage.getItem('vovo_tv_custom_channels');
      const proprios: Channel[] = salvos ? JSON.parse(salvos) : [];
      return dedupe([...base, ...proprios]);
    } catch {
      return dedupe(base);
    }
  });

  const [health, setHealth] = useState<HealthMap>(() => {
    limparCacheAntigoDeFontes('4');
    return loadHealth();
  });
  const [semInternet, setSemInternet] = useState(
    () => typeof navigator !== 'undefined' && navigator.onLine === false
  );
  const [categoria, setCategoria] = useState<CategoriaFiltro>('todos');
  const [avisoSair, setAvisoSair] = useState(false);
  const ultimoVoltarRef = useRef(0);
  const avisoTimerRef = useRef<number | null>(null);
  const healthRef = useRef<HealthMap>(health);
  const [probeState, setProbeState] = useState({ running: false, done: 0, total: 0 });
  const pararRef = useRef(false);

  const [visibleCount, setVisibleCount] = useState(PAGINA);

  // Navegacao D-Pad precisa para Smart TV
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [topNav, setTopNav] = useState<'none' | 'settings'>('none');

  const [activeChannel, setActiveChannel] = useState<ChannelWithHealth | null>(null);
  const activeChannelRef = useRef<ChannelWithHealth | null>(null);
  activeChannelRef.current = activeChannel;
  const [playerList, setPlayerList] = useState<ChannelWithHealth[]>([]);

  const [ajustesAbertos, setAjustesAbertos] = useState(false);
  const [atualizacao, setAtualizacao] = useState<AvailableUpdate | null>(null);
  const [tvConectada, setTvConectada] = useState<TvNaRede | null>(null);
  const [canalNaTv, setCanalNaTv] = useState('');

  const desconectarTv = useCallback(async () => {
    const atual = tvConectada;
    setTvConectada(null);
    setCanalNaTv('');
    if (atual) {
      try {
        await pararNaTv(atual);
      } catch {
        /* a TV pode ter sido desligada */
      }
    }
  }, [tvConectada]);

  // Smart TV (sem toque, controlada por controle remoto) x celular
  const [souTv, setSouTv] = useState(false);
  useEffect(() => {
    tv.getDeviceType().then((resultado) => {
      if (resultado?.isTv) setSouTv(true);
    });
  }, []);

  // Na grade principal, pede Voltar duas vezes para sair do app sem fechar por engano.
  const tentarSairDoApp = useCallback(() => {
    const agora = Date.now();
    if (agora - ultimoVoltarRef.current < 2000) {
      onVoltarInicio();
      return;
    }
    ultimoVoltarRef.current = agora;
    setAvisoSair(true);
    if (avisoTimerRef.current) window.clearTimeout(avisoTimerRef.current);
    avisoTimerRef.current = window.setTimeout(() => setAvisoSair(false), 2000);
  }, [onVoltarInicio]);

  useEffect(() => {
    return () => {
      if (avisoTimerRef.current) window.clearTimeout(avisoTimerRef.current);
    };
  }, []);

  // Fecha modais ou sai do app ao apertar Voltar 2x no controle remoto ou ESC no teclado
  useEffect(() => {
    const handleGlobalBack = (e: KeyboardEvent) => {
      if (activeChannel) return;

      if (e.key === 'Escape' || e.key === 'Backspace' || e.key === 'GoBack') {
        e.preventDefault();
        if (ajustesAbertos) {
          setAjustesAbertos(false);
        } else {
          tentarSairDoApp();
        }
      }
    };

    let cancelado = false;
    let remover: (() => void) | null = null;
    CapacitorApp.addListener('backButton', () => {
      if (activeChannel) return;
      if (ajustesAbertos) {
        setAjustesAbertos(false);
      } else {
        tentarSairDoApp();
      }
    }).then((h) => {
      if (cancelado) h.remove();
      else remover = () => h.remove();
    }).catch(() => undefined);

    window.addEventListener('keydown', handleGlobalBack);
    return () => {
      cancelado = true;
      if (remover) remover();
      window.removeEventListener('keydown', handleGlobalBack);
    };
  }, [ajustesAbertos, activeChannel, tentarSairDoApp]);

  const flushTimerRef = useRef<number | null>(null);
  const commitHealth = useCallback((proximo: HealthMap) => {
    healthRef.current = proximo;
    if (flushTimerRef.current !== null) return;
    flushTimerRef.current = window.setTimeout(() => {
      flushTimerRef.current = null;
      setHealth({ ...healthRef.current });
      saveHealth(healthRef.current);
    }, 1500);
  }, []);

  useEffect(() => {
    return () => {
      if (flushTimerRef.current !== null) window.clearTimeout(flushTimerRef.current);
      pararRef.current = true;
    };
  }, []);

  const handleProbeResult = useCallback(
    (url: string, resultado: ProbeResult) => {
      registrarDesempenhoFonte(url, resultado.ok, resultado.latency_ms);
      const proximo = { ...healthRef.current };
      proximo[url] = applyProbeResult(proximo[url], resultado);
      commitHealth(proximo);
      setProbeState((anterior) => ({ ...anterior, done: anterior.done + 1 }));
    },
    [commitHealth]
  );

  const handlePlaybackOk = useCallback(
    (url: string) => {
      registrarDesempenhoFonte(url, true);
      const proximo = { ...healthRef.current };
      proximo[url] = markConfirmed(proximo[url]);
      commitHealth(proximo);
    },
    [commitHealth]
  );

  const handlePlaybackFail = useCallback(
    (url: string, erro: string) => {
      registrarDesempenhoFonte(url, false);
      const proximo = { ...healthRef.current };
      proximo[url] = markPlaybackFail(proximo[url], erro);
      commitHealth(proximo);
    },
    [commitHealth]
  );

  const rodandoRef = useRef(false);
  const startProbe = useCallback(
    async (urls: string[]) => {
      if (urls.length === 0 || rodandoRef.current) return;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      rodandoRef.current = true;
      pararRef.current = false;
      setProbeState({ running: true, done: 0, total: urls.length });

      const workers = activeChannelRef.current ? 2 : PROBE_WORKERS;
      await runBatchProbe(urls, workers, handleProbeResult, () => pararRef.current);

      rodandoRef.current = false;
      setProbeState((anterior) => ({ ...anterior, running: false }));
      setHealth({ ...healthRef.current });
      saveHealth(healthRef.current);
    },
    [handleProbeResult]
  );

  const stopProbe = useCallback(() => {
    pararRef.current = true;
    rodandoRef.current = false;
    setProbeState((anterior) => ({ ...anterior, running: false }));
  }, []);

  const urlsPendentes = useCallback(
    (incluirFracas = false) => {
      const vistas = new Set<string>();
      const prioritarias: string[] = [];
      const secundarias: string[] = [];

      const adicionar = (url: string, prioritaria: boolean) => {
        if (!url || vistas.has(url)) return;
        vistas.add(url);
        if (prioritaria) prioritarias.push(url);
        else secundarias.push(url);
      };

      // 1. Reservas do canal assistido agora tem prioridade maxima
      if (activeChannelRef.current) {
        for (const url of fontesDoCanal(activeChannelRef.current)) {
          const entrada = healthRef.current[url];
          if (incluirFracas || !entrada || isStale(entrada, 3)) {
            adicionar(url, true);
          }
        }
      }

      // 2. Canais sem nenhuma fonte boa e links instaveis/vencidos
      for (const canal of channels) {
        const fontes = fontesDoCanal(canal);
        const temBoa = fontes.some((u) => {
          const e = healthRef.current[u];
          return e && (e.status === 'ok' || e.status === 'confirmed') && !isStale(e);
        });
        for (const url of fontes) {
          const entrada = healthRef.current[url];
          const fraca = !entrada || entrada.status === 'doubt' || entrada.status === 'dead';
          if (!entrada || !temBoa || (incluirFracas && fraca) || entrada.status !== 'confirmed' || isStale(entrada)) {
            adicionar(url, !temBoa || fraca);
          }
        }
      }

      return [...prioritarias, ...secundarias];
    },
    [channels]
  );

  const handleStartProbe = useCallback(() => {
    const pendentes = urlsPendentes(true);
    const alvo = pendentes.length > 0 ? pendentes : channels.flatMap((c) => fontesDoCanal(c));
    startProbe(alvo.slice(0, PROBE_LOTE));
  }, [channels, startProbe, urlsPendentes]);

  /**
   * Monitoramento continuo e silencioso em segundo plano:
   * - verifica os sinais a cada 2 minutos (2 workers se um canal estiver aberto, 4 na grade)
   * - revalida na hora quando a internet cai e volta ('online') ou o app volta do segundo plano
   * - alimenta corrida.ts para as fontes mais rapidas e estaveis subirem sozinhas.
   */
  useEffect(() => {
    const rodarSeTiverPendente = (forcarFracas = false) => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      if (document.hidden && !activeChannelRef.current) return;
      const pendentes = urlsPendentes(forcarFracas);
      if (pendentes.length > 0) void startProbe(pendentes.slice(0, PROBE_LOTE));
    };

    const aoFicarOffline = () => setSemInternet(true);
    const aoVoltarOnline = () => {
      setSemInternet(false);
      rodarSeTiverPendente(true);
    };
    const aoRetomar = () => rodarSeTiverPendente(false);

    const primeiro = window.setTimeout(() => rodarSeTiverPendente(false), 2500);
    const periodico = window.setInterval(() => rodarSeTiverPendente(false), INTERVALO_PROBE_MS);
    window.addEventListener('online', aoVoltarOnline);
    window.addEventListener('offline', aoFicarOffline);
    window.addEventListener('vovo:resume', aoRetomar);

    return () => {
      window.clearTimeout(primeiro);
      window.clearInterval(periodico);
      window.removeEventListener('online', aoVoltarOnline);
      window.removeEventListener('offline', aoFicarOffline);
      window.removeEventListener('vovo:resume', aoRetomar);
    };
  }, [urlsPendentes, startProbe]);

  /**
   * Ajustes sem botao na tela: o zero apertado tres vezes seguidas abre.
   * O botao de engrenagem saiu porque a vovo clicava nele sem querer e caia
   * numa tela que nao tem nada para ela fazer.
   */
  useEffect(() => {
    let contador = 0;
    let ultimo = 0;
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key !== '0') {
        contador = 0;
        return;
      }
      const agora = Date.now();
      contador = agora - ultimo < 1500 ? contador + 1 : 1;
      ultimo = agora;
      if (contador >= 3) {
        contador = 0;
        // fecha o player para os ajustes nao ficarem escondidos atras do video
        setActiveChannel(null);
        setAjustesAbertos(true);
      }
    };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, []);

  // a busca automatica de atualizacao fica no App, para valer nas duas TVs

  const carregarCameras = useCallback(async (sinal?: AbortSignal) => {
    const cameras = await buscarCanaisDeCamera(sinal);
    setChannels((anterior) => {
      const semCameras = anterior.filter((c) => !ehCanalDeCamera(c));
      const iguais =
        cameras.length === anterior.length - semCameras.length &&
        cameras.every((cam) => anterior.some((c) => c.url === cam.url));
      if (iguais) return anterior;
      return dedupe([...cameras, ...semCameras]);
    });
  }, []);

  useEffect(() => {
    const controle = new AbortController();
    void carregarCameras(controle.signal);
    const relogio = window.setInterval(() => void carregarCameras(), 60_000);
    return () => {
      controle.abort();
      window.clearInterval(relogio);
    };
  }, [carregarCameras]);

  // Busca grade atualizada no GitHub sempre que abre ou volta ao aplicativo,
  // para que qualquer link novo de canal entre sem precisar reinstalar APK.
  const sincronizarCanaisRemotos = useCallback(async (sinal?: AbortSignal) => {
    const remotos = await buscarCanaisRemotos(sinal);
    if (!remotos) return;
    setChannels((anterior) => {
      const cameras = anterior.filter((c) => ehCanalDeCamera(c));
      const proprios = anterior.filter((c) => c.isCustom && !ehCanalDeCamera(c));
      return dedupe([...cameras, ...remotos, ...proprios]);
    });
  }, []);

  useEffect(() => {
    const controle = new AbortController();
    let ativo = true;
    void sincronizarCanaisRemotos(controle.signal);

    const periodico = window.setInterval(() => {
      if (ativo && (typeof navigator === 'undefined' || navigator.onLine !== false)) {
        void sincronizarCanaisRemotos();
      }
    }, INTERVALO_REMOTO_MS);

    const aoVoltarOnline = () => {
      if (ativo) void sincronizarCanaisRemotos();
    };
    window.addEventListener('online', aoVoltarOnline);

    let remover: (() => void) | null = null;
    CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive && ativo) void sincronizarCanaisRemotos();
    })
      .then((h) => {
        if (!ativo) h.remove();
        else remover = () => h.remove();
      })
      .catch(() => undefined);

    return () => {
      ativo = false;
      controle.abort();
      window.clearInterval(periodico);
      window.removeEventListener('online', aoVoltarOnline);
      if (remover) remover();
    };
  }, [sincronizarCanaisRemotos]);

  const handleImportChannels = useCallback((novos: Channel[]) => {
    setChannels((anterior) => {
      const unicos = dedupe([...novos, ...anterior]);
      try {
        localStorage.setItem(
          'vovo_tv_custom_channels',
          JSON.stringify(unicos.filter((c) => c.isCustom && !ehCanalDeCamera(c)))
        );
      } catch {
        /* sem espaco */
      }
      return unicos;
    });
  }, []);

  const enrichedChannels = useMemo<ChannelWithHealth[]>(() => {
    return channels.map((canal) => {
      // vale a MELHOR fonte do canal: com cinco URLs, quatro mortas nao
      // derrubam o canal da grade enquanto uma ainda tocar
      const saude = saudeDoCanal(canal, health);
      return {
        ...canal,
        health: saude.status,
        signalStrength: saude.signal,
        latencyMs: saude.latencyMs
      };
    });
  }, [channels, health]);

  const healthCounts = useMemo(() => {
    let ok = 0;
    let doubt = 0;
    let dead = 0;
    let untested = 0;
    for (const canal of enrichedChannels) {
      if (canal.health === 'ok' || canal.health === 'confirmed') ok++;
      else if (canal.health === 'doubt') doubt++;
      else if (canal.health === 'dead') dead++;
      else untested++;
    }
    return { ok, doubt, dead, untested };
  }, [enrichedChannels]);

  const filteredChannels = useMemo<ChannelWithHealth[]>(() => {
    const saida = enrichedChannels.filter((canal) => {
      if (canal.health === 'dead' && !ehCanalDeCamera(canal)) return false;
      if (categoria === 'noticias' && canal.group !== 'Notícias') return false;
      if (categoria === 'abertos' && canal.group === 'Notícias') return false;
      return true;
    });

    saida.sort((a, b) => {
      const pesoA = pesoDoCanal(a);
      const pesoB = pesoDoCanal(b);
      if (pesoA !== pesoB) return pesoA - pesoB;
      return compararPorNome(a, b);
    });

    return saida;
  }, [enrichedChannels, categoria]);

  const visibleChannels = useMemo(
    () => filteredChannels.slice(0, visibleCount),
    [filteredChannels, visibleCount]
  );

  const abrirCanal = useCallback(
    (canal: ChannelWithHealth) => {
      setPlayerList(filteredChannels);
      setActiveChannel(canal);
    },
    [filteredChannels]
  );

  /**
   * Liga ja num canal, sem passar pela grade.
   *
   * A vovo liga a TV e a Globo aparece; para trocar e so cima e baixo. A grade
   * continua existindo atras (o Voltar leva ate ela), mas ninguem precisa
   * passar por ela para assistir.
   */
  const jaAbriuSozinhoRef = useRef(false);
  useEffect(() => {
    if (!souTv || jaAbriuSozinhoRef.current || filteredChannels.length === 0) return;
    jaAbriuSozinhoRef.current = true;
    const globo = enrichedChannels.find((c) => /globo/i.test(c.name || ''));
    abrirCanal(globo ?? filteredChannels[0]);
  }, [souTv, enrichedChannels, filteredChannels, abrirCanal]);


  const indiceAtual = useMemo(() => {
    if (!activeChannel) return -1;
    return playerList.findIndex((c) => c.url === activeChannel.url);
  }, [activeChannel, playerList]);

  const irParaCanal = useCallback(
    (passo: number) => {
      if (playerList.length === 0 || indiceAtual === -1) return;
      const proximo = (indiceAtual + passo + playerList.length) % playerList.length;
      setActiveChannel(playerList[proximo]);
    },
    [indiceAtual, playerList]
  );

  // Rola o item em foco para a visualizacao na grade
  useEffect(() => {
    if (!activeChannel && !ajustesAbertos) {
      if (topNav === 'none') {
        const card = document.querySelector<HTMLElement>(`[data-card-index="${focusedIndex}"]`);
        if (card) {
          card.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
        }
      }
    }
  }, [focusedIndex, topNav, activeChannel, ajustesAbertos]);

  // Navegacao D-Pad 100% Precisa para Smart TV
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (activeChannel || ajustesAbertos) return;

      if (topNav !== 'none') {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setTopNav('none');
          setFocusedIndex(0);
        } else if (e.key === 'Enter' || e.key === ' ' || e.key === 'Select') {
          e.preventDefault();
          setAjustesAbertos(true);
        }
        return;
      }

      const total = filteredChannels.length;
      if (total === 0) return;

      if (e.key === 'ArrowRight') {
        e.preventDefault();
        setFocusedIndex((prev) => {
          const next = prev + 1;
          if (next < total) {
            if (next >= visibleCount) setVisibleCount((c) => c + 30);
            return next;
          }
          return prev;
        });
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setFocusedIndex((prev) => Math.max(0, prev - 1));
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusedIndex((prev) => {
          const next = prev + COLS;
          if (next < total) {
            if (next >= visibleCount) setVisibleCount((c) => c + 30);
            return next;
          }
          return prev;
        });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusedIndex((prev) => {
          if (prev < COLS) {
            setTopNav('settings');
            return prev;
          }
          return prev - COLS;
        });
      } else if (e.key === 'Enter' || e.key === ' ' || e.key === 'Select') {
        e.preventDefault();
        if (visibleChannels[focusedIndex]) {
          abrirCanal(visibleChannels[focusedIndex]);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    activeChannel,
    ajustesAbertos,
    topNav,
    filteredChannels.length,
    visibleChannels,
    focusedIndex,
    visibleCount,
    abrirCanal
  ]);

  return (
    <div className="flex min-h-screen flex-col bg-noite-900 text-tinta-100">
      <div className="sticky top-0 z-40">
        <Header
          channelCount={filteredChannels.length}
          tvConectadaNome={tvConectada?.name}
          canalNaTvNome={canalNaTv}
          onDesconectarTv={() => void desconectarTv()}
        />
      </div>

      <main className="area-segura-lados area-segura-base mx-auto w-full max-w-[1750px] flex-1 overflow-x-hidden px-4 py-4 sm:px-6">
        {semInternet && (
          <div
            role="status"
            className="mb-4 flex items-center gap-3 rounded-2xl border-2 border-alerta-400/60 bg-alerta-400/15 px-4 py-3 text-base font-black text-tinta-100"
          >
            <WifiOff className="h-6 w-6 shrink-0 text-alerta-400" strokeWidth={2.5} />
            <span>Sem internet no momento. Reconectando automaticamente assim que o Wi-Fi voltar.</span>
          </div>
        )}

        <div className="mb-4 flex gap-2">
          {(
            [
              ['todos', 'Todos'],
              ['abertos', 'TV Aberta'],
              ['noticias', 'Notícias'],
            ] as const
          ).map(([id, label]) => {
            const ativo = categoria === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setCategoria(id);
                  setFocusedIndex(0);
                }}
                className={`min-h-12 flex-1 rounded-2xl border-2 px-3 py-2 text-base font-black transition active:scale-95 sm:flex-none sm:px-5 ${
                  ativo
                    ? 'border-sol-400 bg-sol-400 text-noite-900'
                    : 'border-noite-500 bg-noite-800 text-tinta-100'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>

        {filteredChannels.length > 0 ? (
          <>
            {/* Grade responsiva: 2 colunas grandes no celular, 3 no tablet, 5 na TV */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-5">
              {visibleChannels.map((canal, idx) => (
                <div key={canal.url} data-card-index={idx}>
                  <ChannelCard
                    channel={canal}
                    numero={idx + 1}
                    isFocused={souTv && topNav === 'none' && idx === focusedIndex}
                    onSelect={(c) => {
                      setFocusedIndex(idx);
                      abrirCanal(c);
                    }}
                  />
                </div>
              ))}
            </div>

            {visibleCount < filteredChannels.length && (
              <button
                onClick={() => setVisibleCount((anterior) => anterior + 30)}
                className="mt-6 flex h-14 w-full items-center justify-center gap-2 rounded-2xl border-2 border-noite-500 bg-noite-700 text-lg font-black text-tinta-100 transition active:scale-95"
              >
                <Plus className="h-6 w-6 text-sol-400" strokeWidth={3} />
                Mostrar mais canais
              </button>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center gap-5 py-20 text-center">
            <div className="flex h-24 w-24 items-center justify-center rounded-3xl bg-noite-700 text-tinta-500">
              <SearchX className="h-12 w-12" strokeWidth={2} />
            </div>
            <p className="text-2xl font-black text-tinta-100">Nenhum canal disponível agora</p>
          </div>
        )}
      </main>

      {activeChannel && (
        <VideoPlayer
          channel={activeChannel}
          numero={indiceAtual + 1}
          isTv={souTv}
          channelList={playerList}
          tvConectada={tvConectada}
          onTvConectada={(aparelho, nome) => {
            setTvConectada(aparelho);
            setCanalNaTv(nome);
          }}
          onDesconectarTv={desconectarTv}
          onSelectChannel={(canal) => {
            setActiveChannel(canal as ChannelWithHealth);
            if (tvConectada) setCanalNaTv(cleanChannelName(canal.name));
          }}
          onClose={() => setActiveChannel(null)}
          onPrevChannel={playerList.length > 1 ? () => irParaCanal(-1) : undefined}
          onNextChannel={playerList.length > 1 ? () => irParaCanal(1) : undefined}
          onPlaybackOk={handlePlaybackOk}
          onPlaybackFail={handlePlaybackFail}
          onRefreshSources={() => void sincronizarCanaisRemotos()}
        />
      )}

      {avisoSair && (
        <div
          role="status"
          className="fixed bottom-10 left-1/2 z-50 -translate-x-1/2 rounded-full border-2 border-sol-400 bg-noite-800 px-6 py-3 text-base font-black text-tinta-100 shadow-2xl sm:text-xl"
        >
          Aperte Voltar de novo para sair
        </div>
      )}

      <SettingsSheet
        isOpen={ajustesAbertos}
        onClose={() => setAjustesAbertos(false)}
        onImportChannels={handleImportChannels}
        probeRunning={probeState.running}
        probeDone={probeState.done}
        probeTotal={probeState.total}
        healthCounts={healthCounts}
        onStartProbe={handleStartProbe}
        onStopProbe={stopProbe}
        onUpdateFound={setAtualizacao}
        onCamerasChanged={() => void carregarCameras()}
      />

      <UpdatePrompt update={atualizacao} onDismiss={() => setAtualizacao(null)} />
    </div>
  );
}

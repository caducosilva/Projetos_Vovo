import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import defaultChannelsData from './data/default_channels.json';
import type { Channel, ChannelWithHealth } from './types';
import {
  loadHealth,
  saveHealth,
  applyProbeResult,
  markConfirmed,
  markPlaybackFail,
  runBatchProbe,
  isStale
} from './utils/health';
import type { HealthMap, ProbeResult } from './utils/health';
import { checkForUpdate, type AvailableUpdate } from './utils/updater';
import { dedupe } from './utils/channelList';
import { fontesDoCanal, saudeDoCanal, compararPorNome } from './utils/fontes';
import { buscarCanaisDeCamera, ehCanalDeCamera } from './utils/cameras';
import { tv } from './utils/tvBridge';
import { App as CapacitorApp } from '@capacitor/app';
import { Header } from './components/Header';
import { ChannelCard } from './components/ChannelCard';
import { VideoPlayer } from './components/VideoPlayer';
import { SettingsSheet } from './components/SettingsSheet';
import { UpdatePrompt } from './components/UpdatePrompt';
import { SearchX, Plus } from 'lucide-react';

const PROBE_WORKERS = 4;
const PROBE_LOTE = 60;
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

function blocoDoCanal(canal: Channel): number {
  if (ehCanalDeCamera(canal)) return 0;
  const nome = (canal.name || '').toLowerCase();
  if (CONHECIDAS.some((marca) => nome.includes(marca))) return 1;
  return 2;
}

export default function App() {
  const [channels, setChannels] = useState<Channel[]>(() => {
    try {
      const salvos = localStorage.getItem('vovo_tv_custom_channels');
      const proprios: Channel[] = salvos ? JSON.parse(salvos) : [];
      return dedupe([...(defaultChannelsData as Channel[]), ...proprios]);
    } catch {
      return dedupe(defaultChannelsData as Channel[]);
    }
  });

  const [health, setHealth] = useState<HealthMap>(() => loadHealth());
  const healthRef = useRef<HealthMap>(health);
  const [probeState, setProbeState] = useState({ running: false, done: 0, total: 0 });
  const pararRef = useRef(false);

  const [visibleCount, setVisibleCount] = useState(PAGINA);

  // Navegacao D-Pad precisa para Smart TV
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [topNav, setTopNav] = useState<'none' | 'settings'>('none');

  const [activeChannel, setActiveChannel] = useState<ChannelWithHealth | null>(null);
  const [playerList, setPlayerList] = useState<ChannelWithHealth[]>([]);

  const [ajustesAbertos, setAjustesAbertos] = useState(false);
  const [atualizacao, setAtualizacao] = useState<AvailableUpdate | null>(null);

  // Smart TV (sem toque, controlada por controle remoto) x celular
  const [souTv, setSouTv] = useState(false);
  useEffect(() => {
    tv.getDeviceType().then((resultado) => {
      if (resultado?.isTv) setSouTv(true);
    });
  }, []);

  // Sair do app com duplo clique em Voltar / ESC
  const ultimoVoltarRef = useRef<number>(0);
  const [avisoSair, setAvisoSair] = useState(false);
  const avisoSairTimerRef = useRef<number | null>(null);

  const tentarSairDoApp = useCallback(() => {
    const agora = Date.now();
    if (agora - ultimoVoltarRef.current < 2200) {
      // So um jeito de sair: tv.exitApp() (finishAffinity) ja fecha tudo e
      // volta pro launcher da TV. Chamar CapacitorApp.exitApp() em seguida
      // brigava com a mesma activity ja em finalizacao e deixava o app
      // preso na tela, sem sair de verdade.
      tv.exitApp();
    } else {
      ultimoVoltarRef.current = agora;
      setAvisoSair(true);
      if (avisoSairTimerRef.current !== null) window.clearTimeout(avisoSairTimerRef.current);
      avisoSairTimerRef.current = window.setTimeout(() => setAvisoSair(false), 2000);
    }
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
      const proximo = { ...healthRef.current };
      proximo[url] = applyProbeResult(proximo[url], resultado);
      commitHealth(proximo);
      setProbeState((anterior) => ({ ...anterior, done: anterior.done + 1 }));
    },
    [commitHealth]
  );

  const handlePlaybackOk = useCallback(
    (url: string) => {
      const proximo = { ...healthRef.current };
      proximo[url] = markConfirmed(proximo[url]);
      commitHealth(proximo);
    },
    [commitHealth]
  );

  const handlePlaybackFail = useCallback(
    (url: string, erro: string) => {
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
      rodandoRef.current = true;
      pararRef.current = false;
      setProbeState({ running: true, done: 0, total: urls.length });

      await runBatchProbe(urls, PROBE_WORKERS, handleProbeResult, () => pararRef.current);

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

  const urlsPendentes = useCallback(() => {
    return channels
      .flatMap((c) => fontesDoCanal(c))
      .filter((url) => {
        const entrada = healthRef.current[url];
        return !entrada || entrada.status !== 'confirmed' || isStale(entrada);
      });
  }, [channels]);

  const handleStartProbe = useCallback(() => {
    const pendentes = urlsPendentes();
    const alvo = pendentes.length > 0 ? pendentes : channels.flatMap((c) => fontesDoCanal(c));
    startProbe(alvo.slice(0, PROBE_LOTE));
  }, [channels, startProbe, urlsPendentes]);

  /**
   * Testa os canais sozinho, em segundo plano, sem a vovo precisar pedir.
   *
   * Primeiro teste 2.5s depois de abrir o app; depois disso, de tempos em
   * tempos, revê os que ficaram "velhos" (STALE_MINUTES) ou nunca foram
   * confirmados. Canal marcado como morto some da grade sozinho, porque
   * filteredChannels ja esconde health === 'dead'. Nada disso aparece na
   * tela: so roda quieto, a nao ser que a vovo abra os Ajustes.
   */
  useEffect(() => {
    const rodarSeTiverPendente = () => {
      const pendentes = urlsPendentes();
      if (pendentes.length > 0) startProbe(pendentes.slice(0, PROBE_LOTE));
    };

    const primeiro = window.setTimeout(rodarSeTiverPendente, 2500);
    const periodico = window.setInterval(rodarSeTiverPendente, 30 * 60_000);
    return () => {
      window.clearTimeout(primeiro);
      window.clearInterval(periodico);
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
        setAjustesAbertos(true);
      }
    };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, []);

  useEffect(() => {
    checkForUpdate().then((nova) => {
      if (nova) setAtualizacao(nova);
    });
  }, []);

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
      return true;
    });

    saida.sort((a, b) => {
      const blocoA = blocoDoCanal(a);
      const blocoB = blocoDoCanal(b);
      if (blocoA !== blocoB) return blocoA - blocoB;
      return compararPorNome(a, b);
    });

    return saida;
  }, [enrichedChannels]);

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
    if (jaAbriuSozinhoRef.current || filteredChannels.length === 0) return;
    jaAbriuSozinhoRef.current = true;
    // Procura a Globo na lista INTEIRA, nao na filtrada: um "morto" antigo no
    // mapa de saude escondia a Globo da grade e o app abria noutro canal. Se
    // uma fonte dela estiver fora, o proprio player cai para a seguinte.
    const globo = enrichedChannels.find((c) => /globo/i.test(c.name || ''));
    abrirCanal(globo ?? filteredChannels[0]);
  }, [enrichedChannels, filteredChannels, abrirCanal]);


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
        <Header channelCount={filteredChannels.length} />
      </div>

      <main className="area-segura-lados area-segura-base mx-auto w-full max-w-[1750px] flex-1 px-5 py-4">
        {filteredChannels.length > 0 ? (
          <>
            {/* Grade de exatamente 5 canais por linha para Smart TV */}
            <div className="grid grid-cols-5 gap-4">
              {visibleChannels.map((canal, idx) => (
                <div key={canal.url} data-card-index={idx}>
                  <ChannelCard
                    channel={canal}
                    numero={idx + 1}
                    isFocused={topNav === 'none' && idx === focusedIndex}
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

      {/* Aviso de saída com duplo Voltar */}
      {avisoSair && (
        <div className="fixed bottom-10 left-1/2 z-50 -translate-x-1/2 rounded-2xl border-2 border-sol-400 bg-noite-800/95 px-6 py-3 text-lg font-black text-sol-400 shadow-2xl backdrop-blur-md">
          Pressione Voltar novamente para sair do Vovô TV
        </div>
      )}

      {activeChannel && (
        <VideoPlayer
          channel={activeChannel}
          numero={indiceAtual + 1}
          isTv={souTv}
          channelList={playerList}
          onSelectChannel={(canal) => setActiveChannel(canal as ChannelWithHealth)}
          onClose={() => setActiveChannel(null)}
          onPrevChannel={playerList.length > 1 ? () => irParaCanal(-1) : undefined}
          onNextChannel={playerList.length > 1 ? () => irParaCanal(1) : undefined}
          onPlaybackOk={handlePlaybackOk}
          onPlaybackFail={handlePlaybackFail}
        />
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

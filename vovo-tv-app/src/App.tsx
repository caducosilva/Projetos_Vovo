import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import defaultChannelsData from './data/default_channels.json';
import type { Channel, ChannelWithHealth, CategoryKey } from './types';
import { getChannelCategory, CATEGORIES } from './utils/categories';
import {
  loadHealth,
  saveHealth,
  applyProbeResult,
  markConfirmed,
  markPlaybackFail,
  runBatchProbe,
  signalScore,
  isStale,
  emptyEntry
} from './utils/health';
import type { HealthMap, ProbeResult } from './utils/health';
import { checkForUpdate, type AvailableUpdate } from './utils/updater';
import { dedupe, migrarFavoritos } from './utils/channelList';
import { buscarCanaisDeCamera, ehCanalDeCamera } from './utils/cameras';
import { Header } from './components/Header';
import { CategoryBar } from './components/CategoryBar';
import { CategorySheet } from './components/CategorySheet';
import { ChannelCard } from './components/ChannelCard';
import { VideoPlayer } from './components/VideoPlayer';
import { SettingsSheet } from './components/SettingsSheet';
import { UpdatePrompt } from './components/UpdatePrompt';
import { SearchX, Plus } from 'lucide-react';

const PROBE_WORKERS = 4;
const PROBE_LOTE = 60;
const PAGINA = 40;

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

  const [favorites, setFavorites] = useState<string[]>(() => {
    try {
      const salvo = localStorage.getItem('vovo_tv_favorites');
      return migrarFavoritos(salvo ? JSON.parse(salvo) : [], channels);
    } catch {
      return [];
    }
  });

  const [health, setHealth] = useState<HealthMap>(() => loadHealth());
  const healthRef = useRef<HealthMap>(health);
  const [probeState, setProbeState] = useState({ running: false, done: 0, total: 0 });
  const pararRef = useRef(false);

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<CategoryKey>('abertos');
  const [visibleCount, setVisibleCount] = useState(PAGINA);

  const [activeChannel, setActiveChannel] = useState<ChannelWithHealth | null>(null);
  /**
   * Lista congelada no momento em que o canal abre.
   *
   * A lista da grade se reordena sozinha conforme o teste de sinal chega. Se o
   * player usasse ela ao vivo, "proximo canal" pularia para um lugar aleatorio
   * no meio da novela. O congelamento mantem a ordem estavel ate fechar.
   */
  const [playerList, setPlayerList] = useState<ChannelWithHealth[]>([]);

  const [categoriaAberta, setCategoriaAberta] = useState(false);
  const [ajustesAbertos, setAjustesAbertos] = useState(false);
  const [atualizacao, setAtualizacao] = useState<AvailableUpdate | null>(null);

  useEffect(() => {
    setVisibleCount(PAGINA);
  }, [selectedCategory, searchTerm]);

  useEffect(() => {
    try {
      localStorage.setItem('vovo_tv_favorites', JSON.stringify(favorites));
    } catch {
      /* sem espaco em disco: os favoritos seguem valendo nesta sessao */
    }
  }, [favorites]);

  // Grava a saude no ref na hora e joga pra tela em lotes
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

  /** Canais que nunca foram testados ou cujo teste ja envelheceu. */
  const urlsPendentes = useCallback(() => {
    return channels
      .map((c) => c.url)
      .filter((url) => {
        const entrada = healthRef.current[url];
        return !entrada || entrada.status !== 'confirmed' || isStale(entrada);
      });
  }, [channels]);

  const handleStartProbe = useCallback(() => {
    const pendentes = urlsPendentes();
    const alvo = pendentes.length > 0 ? pendentes : channels.map((c) => c.url);
    startProbe(alvo.slice(0, PROBE_LOTE));
  }, [channels, startProbe, urlsPendentes]);

  /**
   * Teste automatico ao abrir.
   *
   * A vovo nao deve precisar apertar "verificar sinal": o app testa sozinho e
   * usa o resultado so para ordenar a grade. O atraso deixa a primeira tela
   * desenhar antes de disputar a rede.
   */
  useEffect(() => {
    const agendado = window.setTimeout(() => {
      const pendentes = urlsPendentes();
      if (pendentes.length > 0) startProbe(pendentes.slice(0, PROBE_LOTE));
    }, 2500);
    return () => window.clearTimeout(agendado);
    // Roda uma vez por abertura do app, de proposito.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Procura versao nova em segundo plano; falhar aqui nunca incomoda a vovo
  useEffect(() => {
    checkForUpdate().then((nova) => {
      if (nova) setAtualizacao(nova);
    });
  }, []);

  /**
   * Cameras de casa.
   *
   * A lista vem do servidor que roda no computador, entao ela e recarregada de
   * tempos em tempos: se o computador estava desligado quando o app abriu, os
   * canais aparecem sozinhos assim que ele voltar, sem a vovo fazer nada.
   */
  const carregarCameras = useCallback(async (sinal?: AbortSignal) => {
    const cameras = await buscarCanaisDeCamera(sinal);
    setChannels((anterior) => {
      const semCameras = anterior.filter((c) => !ehCanalDeCamera(c));
      const iguais =
        cameras.length === anterior.length - semCameras.length &&
        cameras.every((cam) => anterior.some((c) => c.url === cam.url));
      // Sem mudanca real nao troca o estado, senao a grade repinta a cada minuto
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

  const favoriteSet = useMemo(() => new Set(favorites), [favorites]);

  const isFavorite = useCallback(
    (canal: Channel) => favoriteSet.has((canal.url || '').trim()),
    [favoriteSet]
  );

  const handleToggleFavorite = useCallback((canal: Channel) => {
    const chave = (canal.url || '').trim();
    if (!chave) return;
    setFavorites((anterior) =>
      anterior.includes(chave) ? anterior.filter((u) => u !== chave) : [...anterior, chave]
    );
  }, []);

  const handleImportChannels = useCallback((novos: Channel[]) => {
    setChannels((anterior) => {
      const unicos = dedupe([...novos, ...anterior]);
      try {
        // Camera fica de fora: ela e montada a partir do servidor a cada
        // abertura, e gravar aqui deixaria camera antiga presa na lista.
        localStorage.setItem(
          'vovo_tv_custom_channels',
          JSON.stringify(unicos.filter((c) => c.isCustom && !ehCanalDeCamera(c)))
        );
      } catch {
        /* sem espaco: os canais valem nesta sessao */
      }
      return unicos;
    });
  }, []);

  const enrichedChannels = useMemo<ChannelWithHealth[]>(() => {
    return channels.map((canal) => {
      const entrada = health[canal.url];
      const nota = entrada ? (entrada.signal ?? signalScore(entrada)) : signalScore(emptyEntry());
      return {
        ...canal,
        health: entrada?.status ?? 'unknown',
        signalStrength: nota,
        latencyMs: entrada?.latency_ms
      };
    });
  }, [channels, health]);

  const categoryCounts = useMemo(() => {
    const contagem: Record<string, number> = {
      todos: channels.length,
      brasil: 0,
      latam: 0,
      favoritos: 0
    };

    for (const canal of channels) {
      const pais = (canal.country || 'br').toLowerCase();
      if (pais === 'br') contagem.brasil++;
      else contagem.latam++;

      if (favoriteSet.has(canal.url)) contagem.favoritos++;

      for (const categoria of getChannelCategory(canal)) {
        contagem[categoria] = (contagem[categoria] || 0) + 1;
      }
    }

    return contagem;
  }, [channels, favoriteSet]);

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

  /**
   * Lista da grade: filtra, esconde o que ja provou estar morto e ordena pelo
   * sinal. Canal sem sinal so aparece se for favorito, senao a vovo abre a
   * pasta de favoritos e nao acha o que guardou.
   */
  const filteredChannels = useMemo<ChannelWithHealth[]>(() => {
    const busca = searchTerm.trim().toLowerCase();

    const saida = enrichedChannels.filter((canal) => {
      if (busca) {
        return (
          (canal.name || '').toLowerCase().includes(busca) ||
          (canal.group || '').toLowerCase().includes(busca)
        );
      }

      // Camera nunca some da grade. Se o computador estiver desligado ela seria
      // marcada como morta e sumiria, e a vovo nao teria como saber que existe
      // nem quando voltasse. Melhor mostrar e explicar ao tocar.
      if (canal.health === 'dead' && !isFavorite(canal) && !ehCanalDeCamera(canal)) return false;

      if (selectedCategory === 'todos') return true;
      if (selectedCategory === 'brasil') return (canal.country || 'br').toLowerCase() === 'br';
      if (selectedCategory === 'latam') return (canal.country || 'br').toLowerCase() !== 'br';
      if (selectedCategory === 'favoritos') return isFavorite(canal);

      return getChannelCategory(canal).includes(selectedCategory);
    });

    saida.sort((a, b) => {
      if (b.signalStrength !== a.signalStrength) return b.signalStrength - a.signalStrength;
      const latenciaA = a.latencyMs ?? 99_999;
      const latenciaB = b.latencyMs ?? 99_999;
      if (latenciaA !== latenciaB) return latenciaA - latenciaB;
      return (a.name || '').toLowerCase().localeCompare((b.name || '').toLowerCase());
    });

    return saida;
  }, [enrichedChannels, searchTerm, selectedCategory, isFavorite]);

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

  const rotuloCategoria = useMemo(() => {
    if (searchTerm.trim()) return `Busca: ${searchTerm.trim()}`;
    return CATEGORIES.find((c) => c.key === selectedCategory)?.label ?? 'Canais';
  }, [selectedCategory, searchTerm]);

  return (
    <div className="flex min-h-screen flex-col bg-noite-900 text-tinta-100">
      <div className="sticky top-0 z-40">
        <Header
          searchTerm={searchTerm}
          onSearchChange={setSearchTerm}
          onOpenSettings={() => setAjustesAbertos(true)}
        />
        <CategoryBar
          label={rotuloCategoria}
          count={filteredChannels.length}
          onOpenPicker={() => setCategoriaAberta(true)}
        />
      </div>

      <main className="area-segura-lados area-segura-base mx-auto w-full max-w-7xl flex-1 px-4 py-4">
        {filteredChannels.length > 0 ? (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              {visibleChannels.map((canal) => (
                <ChannelCard
                  key={canal.url}
                  channel={canal}
                  isFavorite={isFavorite(canal)}
                  onSelect={abrirCanal}
                  onToggleFavorite={handleToggleFavorite}
                />
              ))}
            </div>

            {visibleCount < filteredChannels.length && (
              <button
                onClick={() => setVisibleCount((anterior) => anterior + 30)}
                className="mt-5 flex h-16 w-full items-center justify-center gap-2 rounded-2xl border-2 border-noite-500 bg-noite-700 text-xl font-black text-tinta-100 transition active:scale-95"
              >
                <Plus className="h-7 w-7 text-sol-400" strokeWidth={3} />
                Mostrar mais canais
              </button>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center gap-5 py-20 text-center">
            <div className="flex h-24 w-24 items-center justify-center rounded-3xl bg-noite-700 text-tinta-500">
              <SearchX className="h-12 w-12" strokeWidth={2} />
            </div>
            <p className="text-2xl font-black text-tinta-100">Nenhum canal aqui</p>
            <p className="max-w-sm text-lg leading-snug text-tinta-300">
              Tente apagar a busca ou escolher outra categoria.
            </p>
            <button
              onClick={() => {
                setSearchTerm('');
                setSelectedCategory('abertos');
              }}
              className="flex h-toque items-center rounded-2xl bg-sol-400 px-6 text-xl font-black text-noite-900 transition active:scale-95"
            >
              Ver canais de TV
            </button>
          </div>
        )}
      </main>

      {activeChannel && (
        <VideoPlayer
          channel={activeChannel}
          channelList={playerList}
          onSelectChannel={(canal) => setActiveChannel(canal as ChannelWithHealth)}
          onClose={() => setActiveChannel(null)}
          onPrevChannel={playerList.length > 1 ? () => irParaCanal(-1) : undefined}
          onNextChannel={playerList.length > 1 ? () => irParaCanal(1) : undefined}
          isFavorite={isFavorite(activeChannel)}
          onToggleFavorite={handleToggleFavorite}
          onPlaybackOk={handlePlaybackOk}
          onPlaybackFail={handlePlaybackFail}
        />
      )}

      <CategorySheet
        isOpen={categoriaAberta}
        selected={selectedCategory}
        counts={categoryCounts}
        onSelect={(categoria) => {
          setSelectedCategory(categoria);
          setSearchTerm('');
        }}
        onClose={() => setCategoriaAberta(false)}
      />

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

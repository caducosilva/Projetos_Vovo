import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import defaultChannelsData from './data/default_channels.json';
import type { Channel, ChannelWithHealth, CategoryKey } from './types';
import { getChannelCategory } from './utils/categories';
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
import { Header } from './components/Header';
import { CategoryFilter } from './components/CategoryFilter';
import { CountryFilter } from './components/CountryFilter';
import { HealthBar } from './components/HealthBar';
import { ChannelCard } from './components/ChannelCard';
import { VideoPlayer } from './components/VideoPlayer';
import { ImportModal } from './components/ImportModal';
import { Sparkles, AlertCircle, Plus } from 'lucide-react';

const COUNTRY_NAMES: Record<string, { label: string; flag: string }> = {
  br: { label: 'Brasil', flag: '🇧🇷' },
  ar: { label: 'Argentina', flag: '🇦🇷' },
  uy: { label: 'Uruguai', flag: '🇺🇾' },
  cl: { label: 'Chile', flag: '🇨🇱' },
  co: { label: 'Colômbia', flag: '🇨🇴' },
  mx: { label: 'México', flag: '🇲🇽' },
  pe: { label: 'Peru', flag: '🇵🇪' },
  pt: { label: 'Portugal', flag: '🇵🇹' }
};

const PROBE_WORKERS = 4;
const INITIAL_PAGE_SIZE = 40;

/** Remove canais repetidos pela URL, mantendo o primeiro. */
function dedupe(list: Channel[]): Channel[] {
  const seen = new Set<string>();
  const out: Channel[] = [];
  for (const ch of list) {
    const key = (ch.url || '').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(ch);
  }
  return out;
}

export default function App() {
  // Channels state
  const [channels, setChannels] = useState<Channel[]>(() => {
    try {
      const savedCustom = localStorage.getItem('vovo_tv_custom_channels');
      const custom: Channel[] = savedCustom ? JSON.parse(savedCustom) : [];
      return dedupe([...(defaultChannelsData as Channel[]), ...custom]);
    } catch {
      return dedupe(defaultChannelsData as Channel[]);
    }
  });

  /**
   * Favoritos guardados SO pela URL do canal.
   * Antes salvava pelo id tambem, mas a lista tem id repetido (ex: o mesmo
   * "RecordNews.br@SD" em 11 canais), entao favoritar um marcava todos e a
   * estrela piscava. Aqui tambem converte os favoritos antigos salvos por id.
   */
  const [favorites, setFavorites] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('vovo_tv_favorites');
      const raw: string[] = saved ? JSON.parse(saved) : [];
      if (raw.length === 0) return [];

      const urls = new Set(channels.map((c) => c.url));
      const firstUrlById = new Map<string, string>();
      for (const c of channels) {
        if (c.id && !firstUrlById.has(c.id)) firstUrlById.set(c.id, c.url);
      }

      const migrated = new Set<string>();
      for (const value of raw) {
        if (urls.has(value)) migrated.add(value);
        else if (firstUrlById.has(value)) migrated.add(firstUrlById.get(value)!);
      }
      return [...migrated];
    } catch {
      return [];
    }
  });

  // Saude / força de sinal dos canais
  const [health, setHealth] = useState<HealthMap>(() => loadHealth());
  const healthRef = useRef<HealthMap>(health);
  const [probeState, setProbeState] = useState({ running: false, done: 0, total: 0 });
  const stopRef = useRef(false);
  const [hideDead, setHideDead] = useState<boolean>(() => {
    return localStorage.getItem('vovo_tv_hide_dead') === '1';
  });

  // Filters state
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<CategoryKey>('abertos');
  const [selectedCountry, setSelectedCountry] = useState<string>('br');

  // Progressive rendering for high performance
  const [visibleCount, setVisibleCount] = useState<number>(INITIAL_PAGE_SIZE);

  // Player state
  const [activeChannel, setActiveChannel] = useState<ChannelWithHealth | null>(null);

  // Modal state
  const [isImportModalOpen, setIsImportModalOpen] = useState<boolean>(false);

  // Reset pagination on filter change
  useEffect(() => {
    setVisibleCount(INITIAL_PAGE_SIZE);
  }, [selectedCategory, selectedCountry, searchTerm]);

  // Save favorites to localStorage
  useEffect(() => {
    localStorage.setItem('vovo_tv_favorites', JSON.stringify(favorites));
  }, [favorites]);

  useEffect(() => {
    localStorage.setItem('vovo_tv_hide_dead', hideDead ? '1' : '0');
  }, [hideDead]);

  /** Grava a saude no ref na hora e joga pra tela em lotes */
  const flushTimerRef = useRef<number | null>(null);
  const commitHealth = useCallback((next: HealthMap) => {
    healthRef.current = next;
    if (flushTimerRef.current !== null) return;
    flushTimerRef.current = window.setTimeout(() => {
      flushTimerRef.current = null;
      setHealth({ ...healthRef.current });
      saveHealth(healthRef.current);
    }, 1500);
  }, []);

  const handleProbeResult = useCallback(
    (url: string, result: ProbeResult) => {
      const next = { ...healthRef.current };
      next[url] = applyProbeResult(next[url], result);
      commitHealth(next);
      setProbeState((prev) => ({ ...prev, done: prev.done + 1 }));
    },
    [commitHealth]
  );

  const handlePlaybackOk = useCallback(
    (url: string) => {
      const next = { ...healthRef.current };
      next[url] = markConfirmed(next[url]);
      commitHealth(next);
    },
    [commitHealth]
  );

  const handlePlaybackFail = useCallback(
    (url: string, error: string) => {
      const next = { ...healthRef.current };
      next[url] = markPlaybackFail(next[url], error);
      commitHealth(next);
    },
    [commitHealth]
  );

  const startProbe = useCallback(
    async (urls: string[]) => {
      if (urls.length === 0 || probeState.running) return;
      stopRef.current = false;
      setProbeState({ running: true, done: 0, total: urls.length });
      await runBatchProbe(urls, PROBE_WORKERS, handleProbeResult, () => stopRef.current);
      setProbeState((prev) => ({ ...prev, running: false }));
      setHealth({ ...healthRef.current });
      saveHealth(healthRef.current);
    },
    [handleProbeResult, probeState.running]
  );

  const stopProbe = useCallback(() => {
    stopRef.current = true;
    setProbeState((prev) => ({ ...prev, running: false }));
  }, []);

  const favoriteSet = useMemo(() => new Set(favorites), [favorites]);

  const isFavorite = useCallback(
    (channel: Channel) => favoriteSet.has((channel.url || '').trim()),
    [favoriteSet]
  );

  const handleToggleFavorite = useCallback((channel: Channel) => {
    const key = (channel.url || '').trim();
    if (!key) return;
    setFavorites((prev) => {
      const next = prev.includes(key) ? prev.filter((u) => u !== key) : [...prev, key];
      try {
        localStorage.setItem('vovo_tv_favorites', JSON.stringify(next));
      } catch {
        /* sem espaço: mantem so em memoria */
      }
      return next;
    });
  }, []);

  const handleImportChannels = useCallback((newChannels: Channel[]) => {
    setChannels((prev) => {
      const unique = dedupe([...newChannels, ...prev]);
      const customOnly = unique.filter((c) => c.isCustom);
      localStorage.setItem('vovo_tv_custom_channels', JSON.stringify(customOnly));
      return unique;
    });
  }, []);

  // Canais + saude memoized
  const enrichedChannels = useMemo<ChannelWithHealth[]>(() => {
    return channels.map((ch) => {
      const entry = health[ch.url];
      const score = entry ? (entry.signal ?? signalScore(entry)) : signalScore(emptyEntry());
      return {
        ...ch,
        health: entry?.status ?? 'unknown',
        signalStrength: score,
        latencyMs: entry?.latency_ms
      };
    });
  }, [channels, health]);

  // Category counts calculation
  const categoryCounts = useMemo(() => {
    const scopedChannels =
      selectedCountry === 'todos'
        ? channels
        : channels.filter((c) => (c.country || 'br').toLowerCase() === selectedCountry.toLowerCase());

    const counts: Record<string, number> = {
      todos: scopedChannels.length,
      brasil: channels.filter((c) => (c.country || 'br').toLowerCase() === 'br').length,
      latam: channels.filter((c) => (c.country || 'br').toLowerCase() !== 'br').length,
      favoritos: 0
    };

    for (const ch of scopedChannels) {
      if (favoriteSet.has(ch.url)) {
        counts.favoritos = (counts.favoritos || 0) + 1;
      }
      const cats = getChannelCategory(ch);
      for (const cat of cats) {
        counts[cat] = (counts[cat] || 0) + 1;
      }
    }

    return counts;
  }, [channels, favorites, selectedCountry]);

  const healthCounts = useMemo(() => {
    let ok = 0;
    let doubt = 0;
    let dead = 0;
    let untested = 0;
    for (const ch of enrichedChannels) {
      if (ch.health === 'ok' || ch.health === 'confirmed') ok++;
      else if (ch.health === 'doubt') doubt++;
      else if (ch.health === 'dead') dead++;
      else untested++;
    }
    return { ok, doubt, dead, untested };
  }, [enrichedChannels]);

  // Available countries calculation
  const availableCountries = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const ch of channels) {
      const c = (ch.country || 'br').toLowerCase();
      counts[c] = (counts[c] || 0) + 1;
    }

    const list = [
      { code: 'todos', label: 'Todos os Países', flag: '🌍', count: channels.length },
      ...Object.entries(counts).map(([code, count]) => ({
        code,
        label: COUNTRY_NAMES[code]?.label || code.toUpperCase(),
        flag: COUNTRY_NAMES[code]?.flag || '🏳️',
        count
      }))
    ];

    return list;
  }, [channels]);

  const handleSelectCategory = useCallback((cat: CategoryKey) => {
    setSelectedCategory(cat);
    if (cat === 'brasil') {
      setSelectedCountry('br');
    } else if (cat === 'latam') {
      setSelectedCountry('todos');
    }
  }, []);

  // Filtered + ordenado por força de sinal
  const filteredChannels = useMemo<ChannelWithHealth[]>(() => {
    const out = enrichedChannels.filter((ch) => {
      // 1. Search filter: When searching, search across ALL channels
      if (searchTerm.trim()) {
        const query = searchTerm.toLowerCase().trim();
        const matchesName = (ch.name || '').toLowerCase().includes(query);
        const matchesGroup = (ch.group || '').toLowerCase().includes(query);
        return matchesName || matchesGroup;
      }

      // 2. Esconder canais mortos
      if (hideDead && ch.health === 'dead' && !isFavorite(ch)) return false;

      // 3. Category filter
      if (selectedCategory === 'todos') {
        if (selectedCountry !== 'todos') {
          return (ch.country || 'br').toLowerCase() === selectedCountry.toLowerCase();
        }
        return true;
      } else if (selectedCategory === 'brasil') {
        return (ch.country || 'br').toLowerCase() === 'br';
      } else if (selectedCategory === 'latam') {
        return (ch.country || 'br').toLowerCase() !== 'br';
      } else if (selectedCategory === 'favoritos') {
        return isFavorite(ch);
      } else {
        const cats = getChannelCategory(ch);
        const matchesCategory = cats.includes(selectedCategory);
        if (!matchesCategory) return false;

        if (selectedCountry !== 'todos') {
          return (ch.country || 'br').toLowerCase() === selectedCountry.toLowerCase();
        }
        return true;
      }
    });

    out.sort((a, b) => {
      if (b.signalStrength !== a.signalStrength) return b.signalStrength - a.signalStrength;
      const la = a.latencyMs ?? 99_999;
      const lb = b.latencyMs ?? 99_999;
      if (la !== lb) return la - lb;
      return (a.name || '').toLowerCase().localeCompare((b.name || '').toLowerCase());
    });

    return out;
  }, [
    enrichedChannels,
    searchTerm,
    selectedCategory,
    selectedCountry,
      favorites,
    hideDead,
    isFavorite
  ]);

  // Visible sliced list for fast rendering
  const visibleChannels = useMemo(() => {
    return filteredChannels.slice(0, visibleCount);
  }, [filteredChannels, visibleCount]);

  const hasMore = visibleCount < filteredChannels.length;

  const handleLoadMore = useCallback(() => {
    setVisibleCount((prev) => prev + 30);
  }, []);

  // Navegacao de canal dentro do player (swipe e gaveta de canais)
  const currentChannelIndex = useMemo(() => {
    if (!activeChannel) return -1;
    return filteredChannels.findIndex((c) => c.url === activeChannel.url);
  }, [activeChannel, filteredChannels]);

  const handlePrevChannel = useCallback(() => {
    if (filteredChannels.length === 0 || currentChannelIndex === -1) return;
    const prevIdx = (currentChannelIndex - 1 + filteredChannels.length) % filteredChannels.length;
    setActiveChannel(filteredChannels[prevIdx]);
  }, [currentChannelIndex, filteredChannels]);

  const handleNextChannel = useCallback(() => {
    if (filteredChannels.length === 0 || currentChannelIndex === -1) return;
    const nextIdx = (currentChannelIndex + 1) % filteredChannels.length;
    setActiveChannel(filteredChannels[nextIdx]);
  }, [currentChannelIndex, filteredChannels]);

  // Category Header Info
  const categoryHeaderInfo = useMemo(() => {
    switch (selectedCategory) {
      case 'favoritos':
        return {
          title: '⭐ Meus Canais Favoritos',
          desc: 'Canais que você marcou com a estrelinha para achar rápido.'
        };
      case 'abertos':
        return {
          title: '📺 Canais Abertos Nacionais',
          desc: 'Globo, SBT, Record, Band, TV Cultura, RedeTV e emissoras abertas de todo o Brasil.'
        };
      case 'radios-todas':
        return {
          title: '📻 Rádios do Brasil (Ao Vivo)',
          desc: 'Centenas de emissoras de rádio online ordenadas da melhor força de sinal para o pior.'
        };
      case 'radios-sp':
        return {
          title: '📍 Rádios de São Paulo (SP)',
          desc: 'Alpha FM, 89 Rock, Antena 1, Jovem Pan, Band FM, Nativa FM, Gazeta, Metropolitana e rádios paulistas.'
        };
      case 'radios-mg':
        return {
          title: '☕ Rádios de Minas Gerais (Belo Horizonte)',
          desc: 'Rádio Itatiaia, Alvorada FM, 98 FM, Inconfidência, CDL FM e rádios mineiras.'
        };
      case 'radios-ba':
        return {
          title: '🌴 Rádios da Bahia (Salvador)',
          desc: 'Rádio Sociedade da Bahia, Piatã FM, Bahia FM, Salvador FM, Itapoan e emissoras baianas.'
        };
      case 'radios-rj':
        return {
          title: '🏖️ Rádios do Rio de Janeiro',
          desc: 'JB FM, FM O Dia, Rádio Tupi, Rádio Melodia, Rádio Cidade, Paradiso e rádios cariocas.'
        };
      case 'radios-sul':
        return {
          title: '🧉 Rádios da Região Sul (RS, PR, SC)',
          desc: 'Rádio Gaúcha, Atlântida, Guaíba, Massa FM, Mundo Livre FM, Regional FM e rádios do Sul.'
        };
      case 'radios-co':
        return {
          title: '🏛️ Rádios Centro-Oeste & Brasília',
          desc: 'Rádio Senado, Rádio Câmara, BandNews Brasília, Clube FM, Positiva FM e rádios do Centro-Oeste.'
        };
      case 'radios-ne':
        return {
          title: '☀️ Rádios Nordeste (Recife, Fortaleza, Natal)',
          desc: 'Rádio Jornal Recife, Verdes Mares, Jangadeiro FM, 96 FM Natal, Mirante FM e rádios nordestinas.'
        };
      case 'radios-norte':
        return {
          title: '🌳 Rádios Norte (Manaus, Belém)',
          desc: 'Rádio Liberal, Difusora Manaus, Boas Novas e rádios da Região Norte e Amazônia.'
        };
      case 'brasil':
        return {
          title: '🇧🇷 Todos os Canais do Brasil',
          desc: 'Lista completa de canais brasileiros (Abertos, Notícias, Filmes, Religiosos, Regionais).'
        };
      case 'sp-mogi':
        return {
          title: '📍 São Paulo & Mogi das Cruzes',
          desc: 'TV Diário Mogi, Globo SP, Record SP, Band SP, TV Gazeta e emissoras paulistas.'
        };
      case 'religioso':
        return {
          title: '🙏 Religiosos, Missas & Fé',
          desc: 'TV Aparecida, Canção Nova, Rede Vida, Evangelizar, RIT e canais de oração.'
        };
      case 'noticias':
        return {
          title: '📰 Notícias & Jornalismo',
          desc: 'Record News, BandNews, CNN Brasil, Jovem Pan News e canais informativos.'
        };
      case 'filmes':
        return {
          title: '🎬 Filmes & Cinema',
          desc: 'Canais de filmes, clássicos e cinema 24 horas.'
        };
      case 'series':
        return {
          title: '🍿 Séries & Novelas',
          desc: 'Novelas clássicas e séries completas.'
        };
      case 'infantil':
        return {
          title: '🧸 Infantil & Desenhos Animados',
          desc: 'Pluto TV Kids, Nickelodeon, desenhos e programação infantil.'
        };
      case 'esportes':
        return {
          title: '⚽ Futebol & Esportes',
          desc: 'BandSports, canais esportivos e futebol ao vivo.'
        };
      case 'bahia':
        return {
          title: '🌴 Bahia & Região Nordeste',
          desc: 'TVE Bahia, TV Aratu, canais de Salvador e do Nordeste.'
        };
      case 'latam':
        return {
          title: '🌎 América Latina & Portugal',
          desc: 'Emissoras de países vizinhos: Argentina, Uruguai, Chile, Colômbia, México e Portugal.'
        };
      case 'musica':
        return {
          title: '🎵 Música & Shows',
          desc: 'Canais de videoclipes, shows e transmissões musicais.'
        };
      case 'documentarios':
        return {
          title: '📚 Documentários & Cultura',
          desc: 'Natureza, história, ciência e canais educativos.'
        };
      default:
        return {
          title: '🌐 Todos os Canais',
          desc: 'Todos os canais disponíveis no aplicativo.'
        };
    }
  }, [selectedCategory]);

  /** Botão "Verificar sinal": re-testa o que está velho ou nunca testado */
  const handleStartProbe = useCallback(() => {
    const urls = channels
      .map((c) => c.url)
      .filter((url) => {
        const entry = healthRef.current[url];
        return !entry || entry.status !== 'confirmed' || isStale(entry);
      });
    startProbe(urls.length > 0 ? urls.slice(0, 50) : channels.map((c) => c.url).slice(0, 50));
  }, [channels, startProbe]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans select-none antialiased">
      {/* Header */}
      <Header
        searchTerm={searchTerm}
        onSearchChange={setSearchTerm}
        onOpenImport={() => setIsImportModalOpen(true)}
        totalChannels={channels.length}
      />

      {/* Category Rail Filter */}
      <div className="bg-slate-900/90 border-b border-slate-800 sticky top-[73px] z-30 backdrop-blur-md">
        <CategoryFilter
          selectedCategory={selectedCategory}
          onSelectCategory={handleSelectCategory}
          categoryCounts={categoryCounts}
        />
        <CountryFilter
          selectedCountry={selectedCountry}
          onSelectCountry={setSelectedCountry}
          availableCountries={availableCountries}
        />
        <HealthBar
          running={probeState.running}
          done={probeState.done}
          total={probeState.total}
          counts={healthCounts}
          hideDead={hideDead}
          onToggleHideDead={() => setHideDead((v) => !v)}
          onStart={handleStartProbe}
          onStop={stopProbe}
        />
      </div>

      {/* Main Channel Grid */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-6 pb-20">
        {/* Active Category Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4 bg-slate-900 border border-slate-800 p-3.5 rounded-2xl">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-amber-400" />
              <h2 className="text-xl md:text-2xl font-black text-white">
                {categoryHeaderInfo.title}
              </h2>
            </div>
            <p className="text-xs text-slate-400 font-medium mt-0.5">
              {categoryHeaderInfo.desc}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {selectedCategory !== 'brasil' && (
              <button
                onClick={() => handleSelectCategory('brasil')}
                className="text-xs font-bold bg-amber-400/20 text-amber-300 border border-amber-400/40 px-3 py-1.5 rounded-xl hover:bg-amber-400 hover:text-slate-950 transition"
              >
                Ver todos os {categoryCounts['brasil'] || 666} do Brasil
              </button>
            )}
            <span className="text-xs font-bold bg-slate-800 text-slate-300 px-3 py-1.5 rounded-xl border border-slate-700">
              {filteredChannels.length} canais
            </span>
          </div>
        </div>

        {/* Channels Grid */}
        {filteredChannels.length > 0 ? (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 md:gap-4">
              {visibleChannels.map((channel) => (
                <ChannelCard
                  key={channel.url}
                  channel={channel}
                  isFavorite={isFavorite(channel)}
                  onSelect={(ch) => setActiveChannel(ch)}
                  onToggleFavorite={handleToggleFavorite}
                />
              ))}
            </div>

            {/* Load More Channels Button */}
            {hasMore && (
              <div className="flex justify-center mt-6">
                <button
                  onClick={handleLoadMore}
                  className="flex items-center gap-2 bg-slate-800/80 hover:bg-slate-800 border border-slate-700 text-white font-black px-6 py-3.5 rounded-2xl transition active:scale-95 shadow-md text-sm md:text-base"
                >
                  <Plus className="w-5 h-5 text-amber-400" />
                  <span>Carregar mais canais ({filteredChannels.length - visibleCount} restantes)</span>
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center justify-center py-20 text-center px-4">
            <div className="w-20 h-20 bg-slate-800 rounded-3xl flex items-center justify-center text-slate-500 mb-4">
              <AlertCircle className="w-10 h-10" />
            </div>
            <h3 className="text-xl font-bold text-white mb-2">Nenhum canal encontrado</h3>
            <p className="text-slate-400 max-w-md text-sm mb-6">
              Não encontramos nenhum canal com os filtros aplicados. Tente limpar a busca ou selecionar outra categoria.
            </p>
            <button
              onClick={() => {
                setSearchTerm('');
                setSelectedCategory('brasil');
                setSelectedCountry('br');
              }}
              className="bg-amber-400 hover:bg-amber-500 text-slate-950 font-black px-6 py-3 rounded-2xl transition shadow-lg active:scale-95"
            >
              Ver Todos os Canais do Brasil
            </button>
          </div>
        )}
      </main>

      {/* Floating Video Player Modal */}
      {activeChannel && (
        <VideoPlayer
          channel={activeChannel}
          channelList={filteredChannels}
          onSelectChannel={(ch) => setActiveChannel(ch as ChannelWithHealth)}
          onClose={() => setActiveChannel(null)}
          onPrevChannel={filteredChannels.length > 1 ? handlePrevChannel : undefined}
          onNextChannel={filteredChannels.length > 1 ? handleNextChannel : undefined}
          isFavorite={isFavorite(activeChannel)}
          onToggleFavorite={handleToggleFavorite}
          onPlaybackOk={handlePlaybackOk}
          onPlaybackFail={handlePlaybackFail}
        />
      )}

      {/* Import M3U Modal */}
      <ImportModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        onImportChannels={handleImportChannels}
      />
    </div>
  );
}

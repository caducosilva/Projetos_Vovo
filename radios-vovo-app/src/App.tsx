import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import radiosData from './data/radios_brasil.json';
import type { RadioStation, RadioCategoryKey } from './types';
import { getRadioCategories } from './utils/categories';
import { Header } from './components/Header';
import { CategoryFilter } from './components/CategoryFilter';
import { RadioCard } from './components/RadioCard';
import { AudioPlayerBottomBar } from './components/AudioPlayerBottomBar';
import { SleepTimerModal } from './components/SleepTimerModal';
import { Sparkles, Radio as RadioIcon, AlertCircle } from 'lucide-react';
import Hls from 'hls.js';

export default function App() {
  // Radio stations data
  const stations: RadioStation[] = useMemo(() => radiosData as RadioStation[], []);

  // UI & Search State
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<RadioCategoryKey>('destaques');
  const [bigText, setBigText] = useState<boolean>(() => {
    return localStorage.getItem('vovo_radios_big_text') === '1';
  });

  // Favorites State
  const [favorites, setFavorites] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('vovo_radios_favorites');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // Audio Player State
  const [currentStation, setCurrentStation] = useState<RadioStation | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [hasError, setHasError] = useState<boolean>(false);
  const [volume, setVolume] = useState<number>(() => {
    const saved = localStorage.getItem('vovo_radios_volume');
    return saved ? parseFloat(saved) : 1.0;
  });
  const [isMuted, setIsMuted] = useState<boolean>(false);

  // Sleep Timer State
  const [isSleepModalOpen, setIsSleepModalOpen] = useState<boolean>(false);
  const [sleepMinutes, setSleepMinutes] = useState<number | null>(null);
  const [sleepSecondsRemaining, setSleepSecondsRemaining] = useState<number | null>(null);

  // Audio & HLS references
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);

  // Initialize Audio element once
  useEffect(() => {
    const audio = new Audio();
    audio.preload = 'none';
    audioRef.current = audio;

    const onWaiting = () => setIsLoading(true);
    const onPlaying = () => {
      setIsLoading(false);
      setIsPlaying(true);
      setHasError(false);
    };
    const onPause = () => setIsPlaying(false);
    const onError = () => {
      setIsLoading(false);
      setIsPlaying(false);
      setHasError(true);
    };

    audio.addEventListener('waiting', onWaiting);
    audio.addEventListener('playing', onPlaying);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('error', onError);

    return () => {
      audio.removeEventListener('waiting', onWaiting);
      audio.removeEventListener('playing', onPlaying);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('error', onError);
      audio.pause();
      if (hlsRef.current) {
        hlsRef.current.destroy();
      }
    };
  }, []);

  // Save favorites to localStorage
  useEffect(() => {
    localStorage.setItem('vovo_radios_favorites', JSON.stringify(favorites));
  }, [favorites]);

  // Save big text mode to localStorage
  useEffect(() => {
    localStorage.setItem('vovo_radios_big_text', bigText ? '1' : '0');
  }, [bigText]);

  // Save volume
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = isMuted ? 0 : volume;
    }
    localStorage.setItem('vovo_radios_volume', volume.toString());
  }, [volume, isMuted]);

  // Play / Stop station handler
  const playStation = useCallback((station: RadioStation) => {
    const audio = audioRef.current;
    if (!audio) return;

    if (currentStation?.name === station.name && isPlaying) {
      audio.pause();
      setIsPlaying(false);
      return;
    }

    if (currentStation?.name === station.name && !isPlaying && !hasError) {
      audio.play().catch(() => {});
      setIsPlaying(true);
      return;
    }

    setCurrentStation(station);
    setIsLoading(true);
    setHasError(false);

    // Clean up previous HLS instance if any
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    const isHls = station.url.includes('.m3u8') || station.url.includes('hls');

    if (isHls && Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true
      });
      hls.loadSource(station.url);
      hls.attachMedia(audio);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        audio.play().catch(() => {});
      });
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (data.fatal) {
          setIsLoading(false);
          setHasError(true);
        }
      });
      hlsRef.current = hls;
    } else {
      audio.src = station.url;
      audio.load();
      audio.play().catch(() => {
        setIsLoading(false);
        setHasError(true);
      });
    }
  }, [currentStation, hasError, isPlaying]);

  const togglePlay = useCallback(() => {
    if (!currentStation) return;
    playStation(currentStation);
  }, [currentStation, playStation]);

  const adjustVolume = useCallback((delta: number) => {
    setVolume((prev) => {
      const next = Math.min(1.0, Math.max(0.0, prev + delta));
      if (next > 0) setIsMuted(false);
      return next;
    });
  }, []);

  const toggleFavorite = useCallback((station: RadioStation) => {
    setFavorites((prev) => {
      if (prev.includes(station.name)) {
        return prev.filter((n) => n !== station.name);
      } else {
        return [...prev, station.name];
      }
    });
  }, []);

  const isFavorite = useCallback(
    (station: RadioStation) => {
      return favorites.includes(station.name);
    },
    [favorites]
  );

  // Sleep Timer logic
  const handleSetSleepTimer = useCallback((minutes: number | null) => {
    setSleepMinutes(minutes);
    if (minutes !== null) {
      setSleepSecondsRemaining(minutes * 60);
    } else {
      setSleepSecondsRemaining(null);
    }
  }, []);

  useEffect(() => {
    if (sleepSecondsRemaining === null) return;
    if (sleepSecondsRemaining <= 0) {
      // Time is up! Stop audio gently
      if (audioRef.current) {
        audioRef.current.pause();
      }
      setIsPlaying(false);
      setSleepMinutes(null);
      setSleepSecondsRemaining(null);
      return;
    }

    const interval = setInterval(() => {
      setSleepSecondsRemaining((prev) => (prev !== null && prev > 0 ? prev - 1 : 0));
    }, 1000);

    return () => clearInterval(interval);
  }, [sleepSecondsRemaining]);

  const sleepMinutesLeft = useMemo(() => {
    if (sleepSecondsRemaining === null) return null;
    return Math.ceil(sleepSecondsRemaining / 60);
  }, [sleepSecondsRemaining]);

  // Category counts
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {
      todos: stations.length,
      favoritos: 0
    };

    for (const st of stations) {
      if (favorites.includes(st.name)) {
        counts.favoritos = (counts.favoritos || 0) + 1;
      }
      const cats = getRadioCategories(st);
      for (const cat of cats) {
        counts[cat] = (counts[cat] || 0) + 1;
      }
    }

    return counts;
  }, [favorites, stations]);

  // Filtered stations
  const filteredStations = useMemo(() => {
    return stations.filter((st) => {
      // 1. Search Query
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase().trim();
        const matchesName = (st.name || '').toLowerCase().includes(q);
        const matchesCity = (st.city || '').toLowerCase().includes(q);
        const matchesState = (st.state || '').toLowerCase().includes(q);
        const matchesGenre = (st.genre || '').toLowerCase().includes(q);
        const matchesFreq = (st.freq || '').toLowerCase().includes(q);
        if (!matchesName && !matchesCity && !matchesState && !matchesGenre && !matchesFreq) {
          return false;
        }
      }

      // 2. Category
      if (selectedCategory === 'todos') {
        return true;
      } else if (selectedCategory === 'favoritos') {
        return favorites.includes(st.name);
      } else {
        const cats = getRadioCategories(st);
        return cats.includes(selectedCategory);
      }
    });
  }, [favorites, searchTerm, selectedCategory, stations]);

  return (
    <div className={`min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans select-none antialiased ${bigText ? 'text-lg' : ''}`}>
      {/* Header */}
      <Header
        searchTerm={searchTerm}
        onSearchChange={setSearchTerm}
        totalRadios={stations.length}
        bigText={bigText}
        onToggleBigText={() => setBigText((v) => !v)}
        onOpenSleepTimer={() => setIsSleepModalOpen(true)}
        sleepMinutesLeft={sleepMinutesLeft}
      />

      {/* Category Tabs */}
      <CategoryFilter
        selectedCategory={selectedCategory}
        onSelectCategory={setSelectedCategory}
        categoryCounts={categoryCounts}
        bigText={bigText}
      />

      {/* Main Grid */}
      <main className="flex-1 max-w-6xl w-full mx-auto p-4 md:p-6 pb-32">
        {/* Category Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-amber-400" />
            <h2 className={`font-black text-white ${bigText ? 'text-2xl' : 'text-xl'}`}>
              {selectedCategory === 'favoritos'
                ? '❤️ Minhas Rádios Favoritas'
                : selectedCategory === 'sp-mogi'
                ? '📍 São Paulo & Mogi das Cruzes'
                : selectedCategory === 'religioso'
                ? '🙏 Missas, Orações e Terço'
                : selectedCategory === 'sertanejo'
                ? '🤠 Sertanejo Raiz & Moda de Viola'
                : selectedCategory === 'destaques'
                ? '⭐ Rádios Mais Ouvidas do Brasil'
                : selectedCategory === 'noticias'
                ? '📰 Notícias e Esportes'
                : selectedCategory === 'flashback'
                ? '📻 Clássicos dos Anos 70, 80 e 90'
                : selectedCategory === 'rj'
                ? '🏖️ Rádios do Rio de Janeiro'
                : selectedCategory === 'mg'
                ? '☕ Rádios de Minas Gerais'
                : selectedCategory === 'nordeste'
                ? '🌵 Rádios da Bahia e Nordeste'
                : selectedCategory === 'sul'
                ? '🧉 Rádios da Região Sul'
                : '🌐 Todas as Rádios do Brasil'}
            </h2>
          </div>
          <span className="text-xs font-bold bg-slate-800 text-slate-300 px-3 py-1.5 rounded-full border border-slate-700">
            {filteredStations.length} rádios
          </span>
        </div>

        {/* Stations Grid */}
        {filteredStations.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 md:gap-4">
            {filteredStations.map((st) => (
              <RadioCard
                key={st.name}
                station={st}
                isPlaying={isPlaying && currentStation?.name === st.name}
                isCurrent={currentStation?.name === st.name}
                isFavorite={isFavorite(st)}
                onPlay={playStation}
                onToggleFavorite={toggleFavorite}
                bigText={bigText}
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-20 text-center px-4">
            <div className="w-20 h-20 bg-slate-800 rounded-3xl flex items-center justify-center text-slate-500 mb-4">
              <RadioIcon className="w-10 h-10" />
            </div>
            <h3 className="text-xl font-bold text-white mb-2">Nenhuma rádio encontrada</h3>
            <p className="text-slate-400 max-w-md text-sm mb-6">
              Não encontramos nenhuma rádio com o termo buscado. Tente procurar por outra cidade ou nome de emissora.
            </p>
            <button
              onClick={() => {
                setSearchTerm('');
                setSelectedCategory('destaques');
              }}
              className="bg-amber-400 hover:bg-amber-500 text-slate-950 font-black px-6 py-3 rounded-2xl transition shadow-lg active:scale-95"
            >
              Ver Rádios Mais Ouvidas
            </button>
          </div>
        )}
      </main>

      {/* Sticky Bottom Audio Player */}
      <AudioPlayerBottomBar
        currentStation={currentStation}
        isPlaying={isPlaying}
        isLoading={isLoading}
        hasError={hasError}
        onTogglePlay={togglePlay}
        volume={volume}
        isMuted={isMuted}
        onAdjustVolume={adjustVolume}
        onToggleMute={() => setIsMuted((v) => !v)}
        onOpenSleepTimer={() => setIsSleepModalOpen(true)}
        sleepMinutesLeft={sleepMinutesLeft}
        bigText={bigText}
      />

      {/* Sleep Timer Modal */}
      <SleepTimerModal
        isOpen={isSleepModalOpen}
        onClose={() => setIsSleepModalOpen(false)}
        currentMinutes={sleepMinutes}
        onSetTimer={handleSetSleepTimer}
        bigText={bigText}
      />
    </div>
  );
}

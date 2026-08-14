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
  Cast
} from 'lucide-react';
import type { Channel, ChannelWithHealth } from '../types';
import { SignalBars } from './SignalBars';
import { tv, isNative } from '../utils/tvBridge';
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
  const containerRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<Hls | null>(null);

  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [volume, setVolume] = useState<number>(() => {
    const saved = localStorage.getItem('vovo_tv_volume');
    return saved !== null ? parseFloat(saved) : 1.0;
  });
  const [brightness, setBrightness] = useState<number>(() => {
    const saved = localStorage.getItem('vovo_tv_brightness');
    return saved !== null ? parseFloat(saved) : 1.0;
  });
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showControls, setShowControls] = useState<boolean>(true);
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const controlsTimeoutRef = useRef<any>(null);

  // Favorito vem sempre do App (fonte unica); copia local dessincronizava a estrela.
  const isFav = isFavorite;

  // Quick Channel List Drawer on the Right
  const [isDrawerOpen, setIsDrawerOpen] = useState<boolean>(false);
  const [drawerSearch, setDrawerSearch] = useState<string>('');

  // HUD Feedback State for Gestures
  const [hudMessage, setHudMessage] = useState<{
    type: 'volume' | 'brightness' | 'channel' | 'favorite' | 'cast';
    value: number | string;
  } | null>(null);
  const hudTimeoutRef = useRef<any>(null);

  // Touch Gesture tracking refs
  const touchStartRef = useRef<{
    x: number;
    y: number;
    time: number;
    initialVolume: number;
    initialBrightness: number;
    isLeftHalf: boolean;
    isRightHalf: boolean;
    isCenter: boolean;
    hasMoved: boolean;
  }>({
    x: 0,
    y: 0,
    time: 0,
    initialVolume: 1.0,
    initialBrightness: 1.0,
    isLeftHalf: false,
    isRightHalf: false,
    isCenter: false,
    hasMoved: false
  });

  const isRadio = Boolean(
    channel &&
    (channel.isRadio ||
     (channel.group || '').toLowerCase().includes('rádio') ||
     (channel.group || '').toLowerCase().includes('radio') ||
     (channel.name || '').startsWith('📻'))
  );

  const triggerHud = useCallback((type: 'volume' | 'brightness' | 'channel' | 'favorite' | 'cast', value: number | string) => {
    setHudMessage({ type, value });
    if (hudTimeoutRef.current) clearTimeout(hudTimeoutRef.current);
    hudTimeoutRef.current = setTimeout(() => {
      setHudMessage(null);
    }, 1400);
  }, []);

  // Lock body scrolling and overscroll so background list doesn't move when swiping
  useEffect(() => {
    const origOverflow = document.body.style.overflow;
    const origTouchAction = document.body.style.touchAction;
    const origOverscroll = (document.body.style as any).overscrollBehavior;

    document.body.style.overflow = 'hidden';
    document.body.style.touchAction = 'none';
    (document.body.style as any).overscrollBehavior = 'none';

    return () => {
      document.body.style.overflow = origOverflow;
      document.body.style.touchAction = origTouchAction;
      (document.body.style as any).overscrollBehavior = origOverscroll;
    };
  }, []);

  // Auto-hide controls after 4 seconds of inactivity
  const resetControlsTimeout = useCallback(() => {
    setShowControls(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    if (!isDrawerOpen) {
      controlsTimeoutRef.current = setTimeout(() => {
        setShowControls(false);
      }, 4000);
    }
  }, [isDrawerOpen]);

  useEffect(() => {
    resetControlsTimeout();
    return () => {
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
      if (hudTimeoutRef.current) clearTimeout(hudTimeoutRef.current);
    };
  }, [resetControlsTimeout]);

  // Keep screen awake and handle Android hardware back button
  useEffect(() => {
    tv.keepAwake(true);

    let removeListener: (() => void) | null = null;
    CapacitorApp.addListener('backButton', () => {
      if (isDrawerOpen) {
        setIsDrawerOpen(false);
      } else {
        onClose();
      }
    }).then((handle) => {
      removeListener = () => handle.remove();
    }).catch(() => {});

    return () => {
      tv.keepAwake(false);
      tv.resetBrightness();
      tv.setLandscape(false);
      tv.setImmersive(false);
      if (removeListener) {
        removeListener();
      }
    };
  }, [onClose, isDrawerOpen]);

  // Load Channel Stream with strict 720p 30fps level capping for smooth performance
  useEffect(() => {
    if (!channel || !videoRef.current) return;

    setIsLoading(true);
    setErrorMessage(null);

    const video = videoRef.current;
    video.volume = volume;

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    const streamUrl = channel.url;
    const isHls = streamUrl.includes('.m3u8') || streamUrl.includes('.m3u');

    const handleSuccess = () => {
      setIsLoading(false);
      setErrorMessage(null);
      onPlaybackOk?.(streamUrl);
    };

    const handleFailure = (errDetail: string) => {
      setIsLoading(false);
      setErrorMessage('Sinal temporariamente instável neste canal. Tente outra emissora.');
      onPlaybackFail?.(streamUrl, errDetail);
    };

    video.onplaying = () => {
      handleSuccess();
    };

    video.onerror = () => {
      handleFailure('video element error');
    };

    if (isHls && Hls.isSupported()) {
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

      hls.loadSource(streamUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
        // Enforce 720p maximum resolution for lightweight, stutter-free playback
        if (data.levels && data.levels.length > 0) {
          // Maior qualidade permitida: ate 720p e ate 30fps.
          let chosen = -1;
          let chosenHeight = -1;
          let lowest = 0;
          let lowestHeight = Number.MAX_SAFE_INTEGER;

          data.levels.forEach((lvl, idx) => {
            const h = lvl.height || 0;
            const fps = lvl.frameRate || 0;
            if (h < lowestHeight) {
              lowestHeight = h;
              lowest = idx;
            }
            const fitsHeight = h === 0 || h <= 720;
            const fitsFps = fps === 0 || fps <= 31;
            if (fitsHeight && fitsFps && h > chosenHeight) {
              chosenHeight = h;
              chosen = idx;
            }
          });

          // So tem 1080p+? entao usa a menor faixa disponivel (menos travamento).
          const cap = chosen !== -1 ? chosen : lowest;
          // Limita o ABR no teto, mas deixa ele cair sozinho se a internet piorar.
          hls.autoLevelCapping = cap;
          hls.nextLevel = cap;
        }

        video
          .play()
          .then(handleSuccess)
          .catch(() => {});
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              hls.recoverMediaError();
              break;
            default:
              hls.destroy();
              handleFailure(data.details || 'fatal hls error');
              break;
          }
        }
      });

      hlsRef.current = hls;
    } else {
      video.src = streamUrl;
      video
        .play()
        .then(handleSuccess)
        .catch(() => {
          video.muted = true;
          video.play().then(handleSuccess).catch(() => {});
        });
    }

    return () => {
      video.onplaying = null;
      video.onerror = null;
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [channel, onPlaybackFail, onPlaybackOk]);

  /**
   * Volume: no celular quem manda e o volume do aparelho (igual aos botoes
   * laterais), entao o video fica em 100% pra nao abafar duas vezes.
   */
  useEffect(() => {
    const video = videoRef.current;
    if (video) {
      video.volume = isNative ? 1 : volume;
      video.muted = isMuted;
    }
    if (isNative) tv.setVolume(volume);
    localStorage.setItem('vovo_tv_volume', volume.toString());
  }, [volume, isMuted]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play().catch(() => {});
      setIsPlaying(true);
    } else {
      video.pause();
      setIsPlaying(false);
    }
    resetControlsTimeout();
  }, [resetControlsTimeout]);

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const next = !prev;
      triggerHud('volume', next ? 0 : Math.round(volume * 100));
      return next;
    });
    resetControlsTimeout();
  }, [resetControlsTimeout, triggerHud, volume]);

  const nudgeVolume = useCallback(
    (delta: number) => {
      setIsMuted(false);
      setVolume((prev) => {
        const next = Math.min(1, Math.max(0, Math.round((prev + delta) * 20) / 20));
        triggerHud('volume', Math.round(next * 100));
        return next;
      });
      resetControlsTimeout();
    },
    [resetControlsTimeout, triggerHud]
  );

  /** Brilho em 4 degraus, pra vovo so ir tocando no solzinho. */
  const cycleBrightness = useCallback(() => {
    const steps = [1, 0.7, 0.45, 0.2];
    setBrightness((prev) => {
      const idx = steps.findIndex((s) => Math.abs(s - prev) < 0.05);
      const next = steps[(idx + 1) % steps.length];
      localStorage.setItem('vovo_tv_brightness', next.toString());
      tv.setBrightness(next);
      triggerHud('brightness', Math.round(next * 100));
      return next;
    });
    resetControlsTimeout();
  }, [resetControlsTimeout, triggerHud]);

  /**
   * Tela cheia automatica pelo giroscopio: deitou o celular, o video ocupa
   * a tela toda em 16:9 e as barras do sistema saem; levantou, volta ao normal.
   * (Sem botao de tela cheia: a API de fullscreen do WebView brigava com a
   * rotacao nativa e derrubava o app.)
   */
  useEffect(() => {
    tv.followSensor();

    const media = window.matchMedia('(orientation: landscape)');
    const apply = () => {
      const landscape = media.matches;
      setIsFullscreen(landscape);
      tv.setImmersive(landscape);
    };

    apply();
    media.addEventListener('change', apply);

    return () => {
      media.removeEventListener('change', apply);
      tv.setImmersive(false);
      tv.lockPortrait();
    };
  }, []);

  // Handle Casting to Smart TV / DLNA devices on Wi-Fi
  const handleCastToTv = useCallback(async (e: React.SyntheticEvent) => {
    e.stopPropagation();
    if (!channel) return;

    triggerHud('cast', '📡 Conectando à TV (DLNA / Cast)...');
    try {
      await tv.sendToExternalPlayer(channel.url, channel.name);
    } catch {
      await tv.openCastPicker();
    }
  }, [channel, triggerHud]);

  // Touch Gesture Handlers (MX Player / VLC style)
  const handleTouchStart = (e: React.TouchEvent) => {
    if (isDrawerOpen) return;
    if (e.touches.length !== 1) return;
    const touch = e.touches[0];
    const width = window.innerWidth;

    touchStartRef.current = {
      x: touch.clientX,
      y: touch.clientY,
      time: Date.now(),
      initialVolume: volume,
      initialBrightness: brightness,
      isLeftHalf: touch.clientX < width * 0.35,
      isRightHalf: touch.clientX > width * 0.65,
      isCenter: touch.clientX >= width * 0.35 && touch.clientX <= width * 0.65,
      hasMoved: false
    };
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (isDrawerOpen) return;
    if (e.touches.length !== 1) return;

    if (e.cancelable) {
      e.preventDefault();
    }

    const touch = e.touches[0];
    const start = touchStartRef.current;

    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;
    const height = window.innerHeight;

    if (Math.abs(deltaX) > 8 || Math.abs(deltaY) > 8) {
      start.hasMoved = true;
    }

    // 1. Horizontal Swipe feedback (Next / Prev Channel)
    if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 15) {
      if (deltaX < 0) {
        triggerHud('channel', 'Próximo Canal ⏭️');
      } else {
        triggerHud('channel', 'Canal Anterior ⏮️');
      }
      return;
    }

    // 2. Vertical Drag on Left side: Brightness
    if (start.isLeftHalf && Math.abs(deltaY) > Math.abs(deltaX) * 1.2 && Math.abs(deltaY) > 12 && !isRadio) {
      const step = -(deltaY / (height * 0.45));
      const newBright = Math.min(1.0, Math.max(0.1, start.initialBrightness + step));
      setBrightness(newBright);
      localStorage.setItem('vovo_tv_brightness', newBright.toString());
      tv.setBrightness(newBright);
      triggerHud('brightness', Math.round(newBright * 100));
      return;
    }

    // 3. Vertical Drag on Right side: Volume
    if (start.isRightHalf && Math.abs(deltaY) > Math.abs(deltaX) * 1.2 && Math.abs(deltaY) > 12) {
      const step = -(deltaY / (height * 0.45));
      const newVol = Math.min(1.0, Math.max(0.0, start.initialVolume + step));
      setVolume(newVol);
      tv.setVolume(newVol);
      triggerHud('volume', Math.round(newVol * 100));
      return;
    }

    // 4. Vertical Drag in Center: Channel Navigation
    if (start.isCenter && Math.abs(deltaY) > Math.abs(deltaX) * 1.2 && Math.abs(deltaY) > 15) {
      if (deltaY < 0) {
        triggerHud('channel', 'Próximo Canal ⏭️');
      } else {
        triggerHud('channel', 'Canal Anterior ⏮️');
      }
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (isDrawerOpen) return;
    const start = touchStartRef.current;
    const touch = e.changedTouches[0];
    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;

    if (!start.hasMoved || (Math.abs(deltaX) < 15 && Math.abs(deltaY) < 15)) {
      setShowControls((prev) => !prev);
      if (!showControls) resetControlsTimeout();
      return;
    }

    // Horizontal Swipe (Next / Prev Channel)
    if (Math.abs(deltaX) > 25 && Math.abs(deltaX) > Math.abs(deltaY)) {
      if (deltaX < 0 && onNextChannel) {
        triggerHud('channel', 'Próximo Canal ⏭️');
        onNextChannel();
      } else if (deltaX > 0 && onPrevChannel) {
        triggerHud('channel', 'Canal Anterior ⏮️');
        onPrevChannel();
      }
      return;
    }

    // Center Vertical Drag (Next / Prev Channel)
    if (start.isCenter && Math.abs(deltaY) > 30 && Math.abs(deltaY) > Math.abs(deltaX)) {
      if (deltaY < 0 && onNextChannel) {
        triggerHud('channel', 'Próximo Canal ⏭️');
        onNextChannel();
      } else if (deltaY > 0 && onPrevChannel) {
        triggerHud('channel', 'Canal Anterior ⏮️');
        onPrevChannel();
      }
    }
  };

  const handleToggleFavAction = (e: React.SyntheticEvent) => {
    e.stopPropagation();
    if (!channel) return;
    const next = !isFav;
    onToggleFavorite(channel);
    triggerHud('favorite', next ? '⭐ Canal Adicionado aos Favoritos' : 'Removido dos Favoritos');
  };

  const retryPlayback = () => {
    if (!channel || !videoRef.current) return;
    setIsLoading(true);
    setErrorMessage(null);
    videoRef.current.load();
    videoRef.current.play().catch(() => {});
  };

  // Filtered channels for drawer
  const drawerChannels = useMemo(() => {
    if (!drawerSearch.trim()) return channelList;
    const q = drawerSearch.toLowerCase().trim();
    return channelList.filter(
      (c) => (c.name || '').toLowerCase().includes(q) || (c.group || '').toLowerCase().includes(q)
    );
  }, [channelList, drawerSearch]);

  if (!channel) return null;

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black select-none overflow-hidden touch-none"
      style={{ touchAction: 'none', overscrollBehavior: 'none' }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onClick={resetControlsTimeout}
    >
      {/* Video / Audio Engine */}
      <video
        ref={videoRef}
        playsInline
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        className={`w-full h-full object-contain ${isRadio ? 'hidden' : 'block'}`}
      />

      {/* Brightness Filter Overlay */}
      <div
        className="absolute inset-0 pointer-events-none transition-opacity"
        style={{
          backgroundColor: 'black',
          opacity: 1 - brightness
        }}
      />

      {/* PERMANENT CHANNEL WATERMARK IN BLACK LETTERBOX AREA */}
      {!isRadio && (
        <div
          className={`absolute left-4 z-30 pointer-events-none flex items-center gap-2.5 bg-black/70 backdrop-blur-md px-4 py-2 rounded-2xl border border-white/15 shadow-xl transition-all duration-300 ${
            showControls ? 'top-22' : 'top-6'
          }`}
        >
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
          {channel.logo && channel.logo.startsWith('http') && (
            <img
              src={channel.logo}
              alt=""
              className="w-5 h-5 object-contain rounded-md"
              onError={(e) => {
                (e.target as HTMLElement).style.display = 'none';
              }}
            />
          )}
          <span className="text-white font-black text-sm md:text-base tracking-wide drop-shadow truncate max-w-[200px]">
            {channel.name}
          </span>
          <span className="bg-amber-400 text-slate-950 font-black text-[10px] px-2 py-0.5 rounded-full">
            720p AO VIVO
          </span>
        </div>
      )}

      {/* HUD GESTURE / FAVORITE / CAST FEEDBACK OVERLAY */}
      {hudMessage && (
        <div className="absolute inset-0 z-40 pointer-events-none flex items-center justify-center animate-in fade-in zoom-in-95 duration-150">
          <div className="bg-slate-950/95 border border-slate-700/80 backdrop-blur-md px-6 py-4 rounded-3xl flex flex-col items-center gap-3 shadow-2xl min-w-[170px]">
            {hudMessage.type === 'volume' ? (
              <>
                <Volume2 className="w-10 h-10 text-amber-400 animate-bounce" />
                <span className="text-white font-black text-xl">{hudMessage.value}%</span>
                <div className="w-32 h-2.5 bg-slate-800 rounded-full overflow-hidden border border-slate-700">
                  <div
                    className="h-full bg-amber-400 rounded-full transition-all"
                    style={{ width: `${hudMessage.value}%` }}
                  />
                </div>
                <span className="text-xs text-slate-400 font-bold">Volume</span>
              </>
            ) : hudMessage.type === 'brightness' ? (
              <>
                <Sun className="w-10 h-10 text-sky-400 animate-pulse" />
                <span className="text-white font-black text-xl">{hudMessage.value}%</span>
                <div className="w-32 h-2.5 bg-slate-800 rounded-full overflow-hidden border border-slate-700">
                  <div
                    className="h-full bg-sky-400 rounded-full transition-all"
                    style={{ width: `${hudMessage.value}%` }}
                  />
                </div>
                <span className="text-xs text-slate-400 font-bold">Brilho</span>
              </>
            ) : hudMessage.type === 'favorite' ? (
              <>
                <Star className="w-10 h-10 text-amber-400 fill-amber-400 animate-bounce" />
                <span className="text-white font-black text-sm text-center">{hudMessage.value}</span>
              </>
            ) : hudMessage.type === 'cast' ? (
              <>
                <Cast className="w-10 h-10 text-sky-400 animate-pulse" />
                <span className="text-white font-black text-sm text-center max-w-xs">{hudMessage.value}</span>
              </>
            ) : (
              <>
                <Tv className="w-10 h-10 text-amber-400" />
                <span className="text-white font-black text-lg text-center">{hudMessage.value}</span>
              </>
            )}
          </div>
        </div>
      )}

      {/* RADIO DEDICATED PLAYER UI */}
      {isRadio && (
        <div className="absolute inset-0 flex flex-col items-center justify-center p-6 bg-gradient-to-b from-slate-900 via-slate-950 to-black text-white">
          <div className="absolute w-72 h-72 rounded-full bg-amber-500/15 blur-3xl pointer-events-none animate-pulse" />

          <div className="relative z-10 flex flex-col items-center max-w-sm text-center">
            <div className="relative mb-6">
              <div className="w-32 h-32 rounded-3xl bg-gradient-to-br from-amber-500 to-amber-700 p-1 shadow-2xl shadow-amber-500/30 flex items-center justify-center">
                {channel.logo && channel.logo.startsWith('http') ? (
                  <img
                    src={channel.logo}
                    alt={channel.name}
                    className="w-full h-full rounded-[22px] object-cover bg-slate-900"
                    onError={(e) => {
                      (e.target as HTMLElement).style.display = 'none';
                    }}
                  />
                ) : (
                  <Radio className="w-16 h-16 text-white drop-shadow" />
                )}
              </div>

              <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 bg-red-600 border-2 border-slate-900 text-white text-xs font-black px-3 py-1 rounded-full uppercase tracking-wider flex items-center gap-1.5 shadow-lg">
                <span className="w-2 h-2 rounded-full bg-white animate-ping" />
                NO AR
              </div>
            </div>

            <h2 className="text-2xl font-black text-white leading-tight mb-2 tracking-tight">
              {channel.name}
            </h2>

            <div className="flex items-center gap-2 mb-6">
              <span className="bg-slate-800 border border-slate-700 text-amber-400 text-xs font-bold px-3 py-1 rounded-full flex items-center gap-1">
                <Radio className="w-3.5 h-3.5" />
                {channel.group || 'Rádio ao Vivo'}
              </span>
              {'signalStrength' in channel && (
                <div className="bg-slate-800 border border-slate-700 px-2.5 py-1 rounded-full flex items-center gap-1">
                  <SignalBars
                    score={(channel as ChannelWithHealth).signalStrength}
                    status={(channel as ChannelWithHealth).health}
                    latencyMs={(channel as ChannelWithHealth).latencyMs}
                    compact
                    showText={false}
                  />
                </div>
              )}
            </div>

            <div className="flex items-end justify-center gap-1.5 h-12 mb-6">
              {[40, 75, 55, 90, 65, 80, 45, 95, 60, 85, 50, 70].map((h, i) => (
                <div
                  key={i}
                  className="w-1.5 bg-gradient-to-t from-amber-500 to-amber-300 rounded-full transition-all"
                  style={{
                    height: !isLoading ? `${h}%` : '20%',
                    animation: !isLoading ? `pulse ${0.6 + (i % 5) * 0.15}s infinite ease-in-out alternate` : 'none'
                  }}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Loading Spinner */}
      {isLoading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm z-20 pointer-events-none">
          <div className="w-14 h-14 border-4 border-amber-500 border-t-transparent rounded-full animate-spin mb-4" />
          <span className="text-white text-lg font-bold drop-shadow">
            {isRadio ? 'Sintonizando rádio...' : 'Sintonizando canal 720p...'}
          </span>
        </div>
      )}

      {/* Error Card */}
      {errorMessage && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/85 z-40 p-6 text-center">
          <div className="w-16 h-16 rounded-full bg-red-900/40 border border-red-500 flex items-center justify-center mb-4 text-red-400">
            <Tv className="w-8 h-8" />
          </div>
          <h3 className="text-xl font-black text-white mb-2">Estação Fora do Ar</h3>
          <p className="text-slate-400 text-sm max-w-xs mb-6">{errorMessage}</p>
          <div className="flex gap-3">
            <button
              onClick={(e) => {
                e.stopPropagation();
                retryPlayback();
              }}
              onTouchEnd={(e) => {
                e.stopPropagation();
                retryPlayback();
              }}
              className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black px-5 py-3 rounded-2xl transition shadow-lg"
            >
              <RotateCcw className="w-5 h-5" />
              Tentar Novamente
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
              onTouchEnd={(e) => {
                e.stopPropagation();
                onClose();
              }}
              className="bg-slate-800 hover:bg-slate-700 text-white font-bold px-5 py-3 rounded-2xl transition"
            >
              Voltar
            </button>
          </div>
        </div>
      )}

      {/* Top Header Controls (Auto-hiding, Safe Area Top Padding, Independent Click Handling) */}
      <div
        className={`absolute top-0 left-0 right-0 pt-8 pb-4 px-4 bg-gradient-to-b from-black/95 via-black/70 to-transparent flex items-center justify-between z-50 transition-opacity duration-300 ${
          showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
        onTouchEnd={(e) => e.stopPropagation()}
      >
        {/* BIG RELIABLE VOLTAR BUTTON */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          onTouchEnd={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="flex items-center gap-2 bg-slate-900/90 active:bg-amber-400 active:text-slate-950 border border-slate-700 text-white font-black px-4 py-3 rounded-2xl backdrop-blur-md shadow-xl transition active:scale-95 shrink-0"
          title="Voltar para a lista de canais"
        >
          <ChevronLeft className="w-6 h-6 text-amber-400" />
          <span className="text-base font-black">Voltar</span>
        </button>

        <div className="text-center px-2 truncate max-w-[28%] pointer-events-none">
          <h1 className="text-white font-black text-base md:text-lg truncate drop-shadow">{channel.name}</h1>
          <p className="text-slate-400 text-xs truncate">{channel.group || 'Ao Vivo'}</p>
        </div>

        {/* RIGHT TOP ACTIONS: ESPELHAR TV (DLNA) + LISTA DE CANAIS + FAVORITOS */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Cast / DLNA Button */}
          <button
            onClick={handleCastToTv}
            onTouchEnd={handleCastToTv}
            className="p-3 rounded-2xl border bg-slate-900/90 border-slate-700 text-sky-400 hover:text-sky-300 backdrop-blur-md transition active:scale-95 shadow-xl"
            title="Transmitir na TV / DLNA"
          >
            <Cast className="w-6 h-6" />
          </button>

          {/* Quick Channels Drawer Button */}
          {channelList.length > 0 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setIsDrawerOpen((prev) => !prev);
              }}
              onTouchEnd={(e) => {
                e.stopPropagation();
                setIsDrawerOpen((prev) => !prev);
              }}
              className={`flex items-center gap-2 px-3.5 py-3 rounded-2xl border backdrop-blur-md transition active:scale-95 shadow-xl ${
                isDrawerOpen
                  ? 'bg-amber-400 text-slate-950 border-amber-400 font-black'
                  : 'bg-slate-900/90 border-slate-700 text-white font-bold'
              }`}
              title="Abrir Lista de Canais"
            >
              <List className="w-6 h-6 text-amber-400" />
              <span className="text-sm font-black hidden sm:inline">Canais</span>
            </button>
          )}

          {/* Favorito Button */}
          <button
            onClick={handleToggleFavAction}
            onTouchEnd={handleToggleFavAction}
            className={`p-3 rounded-2xl border backdrop-blur-md transition active:scale-95 shadow-xl ${
              isFav
                ? 'bg-amber-400/25 border-amber-400 text-amber-400 shadow-amber-400/20'
                : 'bg-slate-900/90 border-slate-700 text-slate-300'
            }`}
            title={isFav ? 'Remover dos Favoritos' : 'Adicionar aos Favoritos'}
          >
            <Star className={`w-6 h-6 ${isFav ? 'fill-amber-400 text-amber-400' : ''}`} />
          </button>
        </div>
      </div>

      {/* BOTOES GRANDES: mudo, volume, pausar e brilho */}
      <div
        className={`absolute bottom-0 left-0 right-0 z-50 px-3 pb-5 pt-10 bg-gradient-to-t from-black/95 via-black/70 to-transparent transition-opacity duration-300 ${
          showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
        onTouchEnd={(e) => e.stopPropagation()}
      >
        {/* Dica de tela cheia: aparece so em pe, some quando o celular deita */}
        {!isRadio && !isFullscreen && (
          <div className="flex justify-center mb-3">
            <span className="flex items-center gap-2 bg-slate-900/90 border border-slate-700 text-slate-200 font-bold text-xs px-3.5 py-2 rounded-2xl backdrop-blur-md shadow-xl">
              <RotateCcw className="w-4 h-4 text-amber-400" />
              Deite o celular para ver em tela cheia
            </span>
          </div>
        )}

        <div className="flex items-end justify-center gap-2.5">
          {/* Mudo */}
          <button
            onClick={toggleMute}
            className={`flex flex-col items-center gap-1 px-4 py-3 rounded-2xl border backdrop-blur-md shadow-xl active:scale-95 transition ${
              isMuted
                ? 'bg-rose-500/25 border-rose-500 text-rose-300'
                : 'bg-slate-900/90 border-slate-700 text-white'
            }`}
            title={isMuted ? 'Ligar o som' : 'Desligar o som'}
          >
            {isMuted ? <VolumeX className="w-7 h-7" /> : <Volume2 className="w-7 h-7" />}
            <span className="text-[11px] font-black">{isMuted ? 'Sem som' : 'Mudo'}</span>
          </button>

          {/* Volume - */}
          <button
            onClick={() => nudgeVolume(-0.1)}
            className="flex flex-col items-center gap-1 px-4 py-3 rounded-2xl bg-slate-900/90 border border-slate-700 text-white backdrop-blur-md shadow-xl active:scale-95 transition"
            title="Abaixar o volume"
          >
            <Minus className="w-7 h-7 text-sky-400" />
            <span className="text-[11px] font-black">Volume</span>
          </button>

          {/* Pausar / Continuar */}
          <button
            onClick={togglePlay}
            className="flex flex-col items-center gap-1 px-5 py-3 rounded-2xl bg-amber-400 border border-amber-300 text-slate-950 shadow-2xl active:scale-95 transition"
            title={isPlaying ? 'Pausar' : 'Continuar'}
          >
            {isPlaying ? (
              <Pause className="w-8 h-8 fill-current" />
            ) : (
              <Play className="w-8 h-8 fill-current" />
            )}
            <span className="text-[11px] font-black">{isPlaying ? 'Pausar' : 'Continuar'}</span>
          </button>

          {/* Volume + */}
          <button
            onClick={() => nudgeVolume(0.1)}
            className="flex flex-col items-center gap-1 px-4 py-3 rounded-2xl bg-slate-900/90 border border-slate-700 text-white backdrop-blur-md shadow-xl active:scale-95 transition"
            title="Aumentar o volume"
          >
            <Plus className="w-7 h-7 text-sky-400" />
            <span className="text-[11px] font-black">Volume</span>
          </button>

          {/* Brilho (4 degraus) */}
          {!isRadio && (
            <button
              onClick={cycleBrightness}
              className="flex flex-col items-center gap-1 px-4 py-3 rounded-2xl bg-slate-900/90 border border-slate-700 text-white backdrop-blur-md shadow-xl active:scale-95 transition"
              title="Mudar o brilho da tela"
            >
              <Sun className="w-7 h-7 text-amber-400" />
              <span className="text-[11px] font-black">{Math.round(brightness * 100)}%</span>
            </button>
          )}
        </div>
      </div>

      {/* QUICK CHANNELS SLIDE-OVER DRAWER ON THE RIGHT */}
      {isDrawerOpen && (
        <div
          className="absolute top-0 right-0 bottom-0 w-80 max-w-[85vw] bg-slate-950/95 border-l border-slate-800 backdrop-blur-xl z-55 flex flex-col shadow-2xl animate-in slide-in-from-right duration-200"
          onClick={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          onTouchMove={(e) => e.stopPropagation()}
          onTouchEnd={(e) => e.stopPropagation()}
        >
          {/* Drawer Header */}
          <div className="pt-8 pb-3 px-4 border-b border-slate-800 flex items-center justify-between gap-2 bg-slate-900/90">
            <div className="flex items-center gap-2">
              <List className="w-5 h-5 text-amber-400" />
              <h3 className="text-white font-black text-base">Lista de Canais</h3>
              <span className="text-xs bg-slate-800 px-2 py-0.5 rounded-full font-bold text-slate-300">
                {drawerChannels.length}
              </span>
            </div>
            <button
              onClick={() => setIsDrawerOpen(false)}
              className="p-2 rounded-xl text-slate-400 hover:text-white bg-slate-800 border border-slate-700 active:scale-95 transition"
              title="Fechar Lista"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Search Box */}
          <div className="p-3 border-b border-slate-800 bg-slate-900/50">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Buscar canal..."
                value={drawerSearch}
                onChange={(e) => setDrawerSearch(e.target.value)}
                className="w-full bg-slate-900 text-white text-sm pl-9 pr-3 py-2.5 rounded-xl border border-slate-700 focus:outline-none focus:border-amber-400 font-medium"
              />
            </div>
          </div>

          {/* Channels Scrollable List */}
          <div className="flex-1 overflow-y-auto p-2 space-y-1.5 custom-scrollbar">
            {drawerChannels.map((ch) => {
              const isActive = ch.url === channel.url;
              return (
                <button
                  key={ch.url}
                  onClick={() => {
                    onSelectChannel?.(ch);
                    setIsDrawerOpen(false);
                  }}
                  className={`w-full p-2.5 rounded-2xl flex items-center gap-3 text-left transition active:scale-98 ${
                    isActive
                      ? 'bg-amber-400 text-slate-950 font-black shadow-lg border border-amber-400'
                      : 'bg-slate-900/80 hover:bg-slate-800 text-white border border-slate-800'
                  }`}
                >
                  <div className="w-10 h-10 rounded-xl bg-slate-950 flex items-center justify-center p-1 shrink-0 border border-slate-800/80">
                    {ch.logo ? (
                      <img
                        src={ch.logo}
                        alt=""
                        className="w-full h-full object-contain"
                        onError={(e) => {
                          (e.target as HTMLElement).style.display = 'none';
                        }}
                      />
                    ) : (
                      <Tv className={`w-5 h-5 ${isActive ? 'text-slate-950' : 'text-slate-500'}`} />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold truncate leading-snug">{ch.name}</p>
                    <p className={`text-[11px] truncate ${isActive ? 'text-slate-900 font-bold' : 'text-slate-400'}`}>
                      {ch.group || 'Ao Vivo'}
                    </p>
                  </div>
                  {isActive && (
                    <span className="w-2.5 h-2.5 rounded-full bg-slate-950 animate-ping shrink-0" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

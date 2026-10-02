import type { HealthStatus } from './utils/health';

export interface Channel {
  id: string;
  name: string;
  logo: string;
  group: string;
  country: string;
  url: string;
  /**
   * Todas as URLs deste mesmo canal, melhor primeiro. Quando a que esta
   * tocando para, o player pula sozinho para a proxima.
   */
  sources?: string[];
  /** 'abertos' = emissora aberta, 'pluto' = canal 24h do Pluto TV */
  origem?: 'abertos' | 'pluto' | 'fast';
  /** Guia de programacao: "epgpw:<id>" ou "pluto:<id>" (ver utils/programacao.ts) */
  epg?: string;
  isCustom?: boolean;
  isRadio?: boolean;
  region?: string;
  state?: string;
}

/** Canal + saude do sinal (usado na lista ordenada por força). */
export interface ChannelWithHealth extends Channel {
  health: HealthStatus;
  signalStrength: number;
  latencyMs?: number;
}

export interface PlayerState {
  isPlaying: boolean;
  isFullscreen: boolean;
  volume: number; // 0.0 to 1.0
  brightness: number; // 0.2 to 1.0
  isMuted: boolean;
  isBuffering: boolean;
  error: string | null;
}

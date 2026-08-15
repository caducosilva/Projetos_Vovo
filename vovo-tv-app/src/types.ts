import type { HealthStatus } from './utils/health';

export interface Channel {
  id: string;
  name: string;
  logo: string;
  group: string;
  country: string;
  url: string;
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

export type CategoryKey =
  | 'abertos'
  | 'radios-todas'
  | 'radios-sp'
  | 'radios-mg'
  | 'radios-ba'
  | 'radios-rj'
  | 'radios-sul'
  | 'radios-co'
  | 'radios-ne'
  | 'radios-norte'
  | 'brasil'
  | 'latam'
  | 'sp-mogi'
  | 'bahia'
  | 'noticias'
  | 'filmes'
  | 'series'
  | 'infantil'
  | 'esportes'
  | 'documentarios'
  | 'musica'
  | 'religioso'
  | 'favoritos'
  | 'todos'
  | 'outros';

export interface CategoryInfo {
  key: CategoryKey;
  label: string;
  icon: string;
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

import { registerPlugin } from '@capacitor/core';
import { isNative } from './tvBridge';

/** Uma TV (ou caixinha) que aceita receber o canal pela rede Wi-Fi. */
export interface DlnaDevice {
  id: string;
  name: string;
  model?: string;
}

interface DlnaBridgePlugin {
  discover(options: { timeoutMs?: number }): Promise<{ devices: DlnaDevice[] }>;
  listDevices(): Promise<{ devices: DlnaDevice[] }>;
  cast(options: { deviceId: string; url: string; title?: string }): Promise<{ ok: boolean; device: string }>;
  stop(options: { deviceId: string }): Promise<void>;
  play(options: { deviceId: string }): Promise<void>;
  pause(options: { deviceId: string }): Promise<void>;
  setVolume(options: { deviceId: string; value: number }): Promise<void>;
}

const DlnaBridge = registerPlugin<DlnaBridgePlugin>('DlnaBridge');

/** Erro que ja vem com texto pronto para a vovo ler. */
export class DlnaError extends Error {}

function friendly(error: unknown, fallback: string): DlnaError {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  return new DlnaError(raw.trim() || fallback);
}

export const dlna = {
  /** No navegador nao existe DLNA, entao a tela nem oferece o botao. */
  get available(): boolean {
    return isNative;
  },

  /** Procura TVs ligadas na mesma rede. Lista vazia significa nenhuma achada. */
  async discover(timeoutMs = 4000): Promise<DlnaDevice[]> {
    if (!isNative) return [];
    try {
      const { devices } = await DlnaBridge.discover({ timeoutMs });
      return devices ?? [];
    } catch (error) {
      throw friendly(error, 'Nao consegui procurar TVs na rede.');
    }
  },

  async cast(deviceId: string, url: string, title?: string): Promise<string> {
    try {
      const { device } = await DlnaBridge.cast({ deviceId, url, title });
      return device;
    } catch (error) {
      throw friendly(error, 'A TV nao aceitou este canal.');
    }
  },

  async stop(deviceId: string): Promise<void> {
    try {
      await DlnaBridge.stop({ deviceId });
    } catch (error) {
      throw friendly(error, 'Nao consegui parar a transmissao.');
    }
  },

  async setVolume(deviceId: string, value: number): Promise<void> {
    try {
      await DlnaBridge.setVolume({ deviceId, value: Math.round(value) });
    } catch (error) {
      throw friendly(error, 'Essa TV nao deixa mudar o volume por aqui.');
    }
  }
};

/**
 * Diz se vale a pena tentar espelhar este endereco.
 *
 * Boa parte das TVs com DLNA nao abre HLS (.m3u8), que e o formato da maioria
 * dos canais de IPTV. Avisar antes e melhor do que deixar a vovo olhando para
 * uma tela parada sem entender o que aconteceu.
 */
export function castCompatibility(url: string): 'boa' | 'duvidosa' {
  const clean = (url || '').toLowerCase().split('?')[0];
  if (clean.endsWith('.m3u8') || clean.endsWith('.m3u')) return 'duvidosa';
  return 'boa';
}

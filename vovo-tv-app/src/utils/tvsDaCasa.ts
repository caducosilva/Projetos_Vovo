import { registerPlugin } from '@capacitor/core';
import { isNative } from './tvBridge';
import { dlna, type DlnaDevice } from './dlna';

/**
 * "Mandar para a TV" com os dois idiomas que uma TV pode falar.
 *
 * O app so falava DLNA, e por isso nunca funcionou na sala: a Philips de la e
 * uma Android TV com Chromecast embutido, que nao expoe AVTransport nenhum. O
 * caminho certo para ela e o Google Cast (o mesmo que o painel do PC usa). O
 * DLNA fica para aparelho que so tem ele.
 *
 * A tela nao precisa saber a diferenca: pede a lista, escolhe uma TV, manda.
 */

export type TipoDeTv = 'chromecast' | 'dlna';

export interface TvNaRede {
  id: string;
  name: string;
  model?: string;
  kind: TipoDeTv;
}

interface CastBridgePlugin {
  available(): Promise<{ available: boolean }>;
  discover(options: { timeoutMs?: number }): Promise<{ devices: TvNaRede[] }>;
  cast(options: { deviceId: string; url: string; title?: string }): Promise<{ ok: boolean; device: string }>;
  stop(): Promise<void>;
  isPlaying(): Promise<{ playing: boolean }>;
}

const CastBridge = registerPlugin<CastBridgePlugin>('CastBridge');

/** No navegador nao existe nem Cast nem DLNA, entao o botao nem aparece. */
export const podeMandarParaTv = isNative;

function comoTv(aparelho: DlnaDevice): TvNaRede {
  return { id: aparelho.id, name: aparelho.name, model: aparelho.model, kind: 'dlna' };
}

/**
 * Procura TVs pelos dois caminhos ao mesmo tempo.
 *
 * Um caminho falhar nao pode derrubar o outro: sem Play Services o Cast quebra
 * e o DLNA continua valendo, e em rede que bloqueia multicast acontece o
 * contrario. Por isso o allSettled em vez de all.
 */
export async function procurarTvs(timeoutMs = 5000): Promise<TvNaRede[]> {
  if (!isNative) return [];

  const [porCast, porDlna] = await Promise.allSettled([
    CastBridge.discover({ timeoutMs }).then((r) => r.devices ?? []),
    dlna.discover(timeoutMs)
  ]);

  const achadas: TvNaRede[] = [];
  if (porCast.status === 'fulfilled') achadas.push(...porCast.value);
  if (porDlna.status === 'fulfilled') achadas.push(...porDlna.value.map(comoTv));

  // A mesma TV pode responder pelos dois lados; Chromecast na frente porque e
  // o que abre os canais de IPTV (a maioria e HLS, que quase nenhum DLNA abre).
  const vistas = new Set<string>();
  return achadas.filter((tv) => {
    const chave = (tv.name || '').trim().toLowerCase();
    if (!chave || vistas.has(chave)) return false;
    vistas.add(chave);
    return true;
  });
}

export async function mandarParaTv(tv: TvNaRede, url: string, titulo: string): Promise<void> {
  if (tv.kind === 'chromecast') {
    await CastBridge.cast({ deviceId: tv.id, url, title: titulo });
    return;
  }
  await dlna.cast(tv.id, url, titulo);
}

export async function pararNaTv(tv: TvNaRede): Promise<void> {
  if (tv.kind === 'chromecast') {
    await CastBridge.stop();
    return;
  }
  await dlna.stop(tv.id);
}

/**
 * Aviso de canal que provavelmente nao vai abrir.
 *
 * Vale so para DLNA: a maioria dos canais e HLS (.m3u8) e quase nenhuma TV
 * abre HLS por DLNA. O Chromecast abre, entao la o aviso so assustaria a vovo
 * a toa.
 */
export function avisarFormato(tv: TvNaRede, url: string): boolean {
  if (tv.kind === 'chromecast') return false;
  const limpa = (url || '').toLowerCase().split('?')[0];
  return limpa.endsWith('.m3u8') || limpa.endsWith('.m3u');
}

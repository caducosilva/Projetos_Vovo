import { CapacitorHttp } from '@capacitor/core';
import type { Channel } from '../types';
import { isNative } from './tvBridge';

/**
 * Sincronizacao remota da grade de canais.
 *
 * Sempre que um canal aberto mudar de link ou entrar um canal novo no GitHub,
 * o aplicativo da vovo busca esta lista ao abrir e atualiza os canais sozinho,
 * sem precisar reinstalar APK no celular dela.
 */
export const REMOTE_CHANNELS_URL =
  'https://raw.githubusercontent.com/caducosilva/Projetos_Vovo/main/tv-da-vovo-app/src/data/canais_abertos.json';

const STORAGE_KEY = 'clarice_tv_canais_remotos';
const TIMEOUT_MS = 6000;

export function validarCanaisRemotos(bruto: unknown): Channel[] | null {
  if (!Array.isArray(bruto) || bruto.length === 0) return null;
  const validos: Channel[] = [];
  for (const item of bruto) {
    if (!item || typeof item !== 'object') continue;
    const c = item as Record<string, unknown>;
    if (typeof c.name !== 'string' || !c.name.trim()) continue;
    if (typeof c.url !== 'string' || !c.url.startsWith('http')) continue;
    validos.push(item as Channel);
  }
  return validos.length > 0 ? validos : null;
}

export function carregarCanaisEmCache(): Channel[] | null {
  try {
    const salvo = localStorage.getItem(STORAGE_KEY);
    if (!salvo) return null;
    return validarCanaisRemotos(JSON.parse(salvo));
  } catch {
    return null;
  }
}

export async function buscarCanaisRemotos(signal?: AbortSignal): Promise<Channel[] | null> {
  const url = `${REMOTE_CHANNELS_URL}?t=${Date.now()}`;
  let payload: unknown;

  try {
    if (isNative) {
      const res = await CapacitorHttp.get({
        url,
        connectTimeout: TIMEOUT_MS,
        readTimeout: TIMEOUT_MS
      });
      if (res.status < 200 || res.status >= 300) return null;
      payload = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
    } else {
      const ctrl = new AbortController();
      const timer = window.setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      const onAbort = () => ctrl.abort();
      signal?.addEventListener('abort', onAbort, { once: true });
      try {
        const res = await fetch(url, { cache: 'no-store', signal: ctrl.signal });
        if (!res.ok) return null;
        payload = await res.json();
      } finally {
        window.clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      }
    }
  } catch {
    return null;
  }

  const canais = validarCanaisRemotos(payload);
  if (!canais) return null;

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(canais));
  } catch {
    /* armazenamento cheio: ainda retorna em memoria */
  }
  return canais;
}

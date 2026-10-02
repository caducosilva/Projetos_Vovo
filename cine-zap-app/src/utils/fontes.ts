import type { Channel } from '../types';
import type { HealthMap, HealthStatus } from './health';
import { signalScore, emptyEntry } from './health';

/**
 * Um canal tem varias fontes (URLs diferentes do MESMO canal). Quando a que
 * esta tocando para, o player cai para a proxima sem a vovo fazer nada.
 *
 * Canal antigo, gravado antes das fontes existirem, tem so a `url`.
 */
export function fontesDoCanal(canal: Channel): string[] {
  const brutas = canal.sources && canal.sources.length > 0 ? canal.sources : [canal.url];
  const vistas = new Set<string>();
  const saida: string[] = [];
  for (const bruta of brutas) {
    const url = (bruta || '').trim();
    if (!url || vistas.has(url)) continue;
    vistas.add(url);
    saida.push(url);
  }
  return saida.length > 0 ? saida : [canal.url];
}

/** Pior para melhor: e a ordem que decide qual fonte representa o canal. */
const ORDEM_SAUDE: Record<HealthStatus, number> = {
  confirmed: 0,
  ok: 1,
  unknown: 2,
  doubt: 3,
  dead: 4,
};

export interface SaudeDoCanal {
  status: HealthStatus;
  signal: number;
  latencyMs?: number;
  /** true so quando TODAS as fontes do canal estao mortas */
  todasMortas: boolean;
}

/**
 * Saude do canal = a da melhor fonte que ele tem. Um canal com cinco fontes so
 * some da grade quando as cinco morrem; antes disso ele continua na tela,
 * porque ainda tem por onde tocar.
 */
export function saudeDoCanal(canal: Channel, health: HealthMap): SaudeDoCanal {
  const fontes = fontesDoCanal(canal);
  let melhor: SaudeDoCanal = { status: 'unknown', signal: 0, todasMortas: false };
  let mortas = 0;
  let primeira = true;

  for (const url of fontes) {
    const entrada = health[url];
    const status: HealthStatus = entrada?.status ?? 'unknown';
    const signal = entrada ? (entrada.signal ?? signalScore(entrada)) : signalScore(emptyEntry());
    if (status === 'dead') mortas += 1;

    const atual: SaudeDoCanal = {
      status,
      signal,
      latencyMs: entrada?.latency_ms,
      todasMortas: false,
    };
    if (primeira) {
      melhor = atual;
      primeira = false;
      continue;
    }
    const ganhaPelaSaude = ORDEM_SAUDE[status] < ORDEM_SAUDE[melhor.status];
    const empateComSinalMelhor =
      ORDEM_SAUDE[status] === ORDEM_SAUDE[melhor.status] && signal > melhor.signal;
    if (ganhaPelaSaude || empateComSinalMelhor) melhor = atual;
  }

  melhor.todasMortas = fontes.length > 0 && mortas === fontes.length;
  return melhor;
}

/** Ordem alfabetica do jeito que o portugues espera (a = á = A). */
export function compararPorNome(a: Channel, b: Channel): number {
  return (a.name || '').localeCompare(b.name || '', 'pt-BR', {
    sensitivity: 'base',
    numeric: true,
  });
}

import type { Channel } from '../types';

/** Remove canais repetidos pela URL, mantendo o primeiro que apareceu. */
export function dedupe(list: Channel[]): Channel[] {
  const vistos = new Set<string>();
  const saida: Channel[] = [];
  for (const canal of list) {
    const chave = (canal.url || '').trim();
    if (!chave || vistos.has(chave)) continue;
    vistos.add(chave);
    saida.push(canal);
  }
  return saida;
}

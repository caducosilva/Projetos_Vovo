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

/**
 * Converte favoritos antigos, que eram salvos pelo id do canal.
 *
 * O id se repete na lista (o mesmo "RecordNews.br@SD" aparece em onze canais),
 * entao favoritar um marcava todos e a estrela piscava. Hoje a chave e a URL, e
 * esta funcao traduz o que ficou salvo antes da mudanca.
 */
export function migrarFavoritos(bruto: string[], canais: Channel[]): string[] {
  if (bruto.length === 0) return [];

  const urls = new Set(canais.map((c) => c.url));
  const primeiraUrlPorId = new Map<string, string>();
  for (const canal of canais) {
    if (canal.id && !primeiraUrlPorId.has(canal.id)) {
      primeiraUrlPorId.set(canal.id, canal.url);
    }
  }

  const migrados = new Set<string>();
  for (const valor of bruto) {
    if (urls.has(valor)) migrados.add(valor);
    else if (primeiraUrlPorId.has(valor)) migrados.add(primeiraUrlPorId.get(valor)!);
  }
  return [...migrados];
}

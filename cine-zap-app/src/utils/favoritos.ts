import type { Channel } from '../types';
import favoritosPadrao from '../data/favoritos_padrao.json';

/**
 * Canais favoritos.
 *
 * Guardado como uma LISTA, nao como um conjunto: a ordem em que a vovo marcou
 * e a ordem em que os favoritos aparecem, e favorito novo entra no fim, sem
 * embaralhar o que ja estava la.
 *
 * A chave e o `id` do canal, e nao a URL: URL de IPTV troca quando a lista e
 * remontada, e um favorito que some sozinho e pior do que nao ter favorito.
 * Canal velho, gravado sem id, cai na URL mesmo.
 */

const CHAVE = 'cinezap_favoritos';
/** Marca de qual semente ja foi aplicada neste aparelho. */
const CHAVE_SEMENTE = 'cinezap_favoritos_semente';
/** Suba isto ao trocar `favoritos_padrao.json` para a TV pegar a lista nova. */
const VERSAO_SEMENTE = '1';

export type CanalIdentificavel = Pick<Channel, 'id' | 'url'>;

/** Identidade do canal na lista de favoritos. */
export function chaveDoCanal(canal: CanalIdentificavel): string {
  return (canal.id || '').trim() || (canal.url || '').trim();
}

export function carregarFavoritos(): string[] {
  try {
    const bruto = localStorage.getItem(CHAVE);
    if (!bruto) return [];
    const dados = JSON.parse(bruto);
    if (!Array.isArray(dados)) return [];
    return dados.filter((x): x is string => typeof x === 'string' && x.length > 0);
  } catch {
    // registro corrompido nao pode impedir o app de abrir
    return [];
  }
}

export function salvarFavoritos(lista: string[]): void {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(lista));
  } catch {
    /* TV com armazenamento cheio continua tocando, so nao guarda */
  }
}

export function ehFavorito(lista: string[], canal: CanalIdentificavel | null): boolean {
  if (!canal) return false;
  const chave = chaveDoCanal(canal);
  return chave.length > 0 && lista.includes(chave);
}

/** Marca ou desmarca. Devolve uma lista nova, sem mexer na que entrou. */
export function alternarFavorito(lista: string[], canal: CanalIdentificavel): string[] {
  const chave = chaveDoCanal(canal);
  if (!chave) return lista;
  return lista.includes(chave) ? lista.filter((x) => x !== chave) : [...lista, chave];
}

/**
 * Os canais favoritos, na ordem em que foram marcados. Favorito que nao existe
 * mais na lista de canais some sozinho, sem deixar buraco.
 */
export function canaisFavoritos<T extends CanalIdentificavel>(canais: T[], lista: string[]): T[] {
  const porChave = new Map<string, T>();
  for (const canal of canais) {
    const chave = chaveDoCanal(canal);
    if (chave && !porChave.has(chave)) porChave.set(chave, canal);
  }
  const saida: T[] = [];
  for (const chave of lista) {
    const canal = porChave.get(chave);
    if (canal) saida.push(canal);
  }
  return saida;
}

/**
 * Junta a lista guardada no aparelho com a que veio dentro do app.
 *
 * A ordem de quem ja estava e preservada e os novos entram no fim: quem marcou
 * favorito direto na TV nao pode ver a propria lista embaralhada porque veio
 * uma semente nova junto com a atualizacao.
 */
export function mesclarFavoritos(atuais: string[], semente: string[]): string[] {
  const saida = [...atuais];
  for (const chave of semente) {
    if (chave && !saida.includes(chave)) saida.push(chave);
  }
  return saida;
}

/**
 * Favoritos na abertura do app, ja com a semente aplicada.
 *
 * A semente sao os canais marcados no PC durante os testes, gravados em
 * `favoritos_padrao.json`. Nao basta aplicar "so quando estiver vazio": a TV
 * ja tem favoritos marcados nela, e nesse caso a semente nunca entraria. Por
 * isso a marca de versao: cada semente nova entra uma vez, soma com o que ja
 * havia, e nao volta a entrar nas aberturas seguintes.
 */
export function favoritosDeAbertura(): string[] {
  const atuais = carregarFavoritos();

  let jaAplicada: string | null = null;
  try {
    jaAplicada = localStorage.getItem(CHAVE_SEMENTE);
  } catch {
    // sem armazenamento nao da para lembrar; melhor nao semear do que semear
    // de novo a cada abertura e ressuscitar favorito que a pessoa tirou
    return atuais;
  }
  if (jaAplicada === VERSAO_SEMENTE) return atuais;

  const mesclados = mesclarFavoritos(atuais, favoritosPadrao as string[]);
  salvarFavoritos(mesclados);
  try {
    localStorage.setItem(CHAVE_SEMENTE, VERSAO_SEMENTE);
  } catch {
    /* segue sem marcar; na proxima abertura tenta de novo */
  }
  return mesclados;
}

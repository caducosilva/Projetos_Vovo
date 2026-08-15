import type { Channel } from '../types';

/**
 * Sujeira que vem nas listas M3U e nao diz nada para a vovo: resolucao,
 * marcador de qualidade e sufixo de pais.
 */
const NOISE = /\s*[([]\s*(4k|uhd|fhd|hd|sd|hq|lq|\d{3,4}p|\d{3,4}i)\s*[)\]]\s*/gi;
const TRAILING_TAGS = /\s*[-|]\s*(4k|uhd|fhd|hd|sd|hq|\d{3,4}p)\s*$/gi;
const LEADING_EMOJI = /^[\p{Extended_Pictographic}️‍\s]+/u;

/**
 * Aviso tecnico em ingles que as listas publicas grudam no nome. Nao significa
 * nada para a vovo, e "[Geo-blocked]" no meio do titulo so atrapalha a leitura:
 * quando o canal nao toca, o teste de sinal ja o esconde da grade.
 */
const AVISOS_TECNICOS =
  /\s*[[(]\s*(geo[-\s]?blocked|not\s*24\/?7|offline|timeshift|backup|multi[-\s]?audio|nsfw)[^\])]*[\])]\s*/gi;

/** Nome limpo do canal, sem "(720p)", sem aviso tecnico e sem emoji na frente. */
export function cleanChannelName(raw: string): string {
  const cleaned = (raw || '')
    .replace(AVISOS_TECNICOS, ' ')
    .replace(NOISE, ' ')
    .replace(TRAILING_TAGS, '')
    .replace(LEADING_EMOJI, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return cleaned || (raw || '').trim() || 'Canal';
}

/** Uma ou duas letras para o quadradinho de quem nao tem logo. */
export function channelInitials(name: string): string {
  // Vem do nome cru: cleanChannelName devolve "Canal" para entrada vazia, e
  // iniciar o quadradinho com "CA" faria parecer a sigla de uma emissora real.
  if (!(name || '').trim()) return 'TV';

  const words = cleanChannelName(name)
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);

  if (words.length === 0) return 'TV';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/**
 * Cor fixa por canal.
 *
 * Sempre a mesma cor para o mesmo nome, para a vovo reconhecer o canal pela
 * cor mesmo sem saber ler o nome de longe. Tons escolhidos para manter o texto
 * branco legivel por cima.
 */
const TILE_COLORS = [
  '#b4530a', // ambar queimado
  '#1e5f8f', // azul
  '#8f1e4a', // vinho
  '#2f6b3c', // verde
  '#6b3fa0', // roxo
  '#a03f1e', // terracota
  '#1e6b6b', // petroleo
  '#7a5a12'  // mostarda
];

export function channelColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return TILE_COLORS[Math.abs(hash) % TILE_COLORS.length];
}

/**
 * Reconhece o aviso "imagem removida" que o imgur serve no lugar do logo.
 *
 * O imgur responde 200 com esse aviso quando a imagem foi apagada, entao o
 * onError da tag <img> nunca dispara e o cartao acaba mostrando um texto em
 * ingles para a vovo. A unica pista que sobra e o tamanho exato do aviso.
 *
 * De proposito casa so com a medida exata: um limite generoso derrubaria logo
 * pequeno de verdade, e ja derrubou o da Adesso TV durante o teste.
 */
export function ehImagemRemovida(largura: number, altura: number): boolean {
  return largura === 161 && altura === 81;
}

/** Radio ou TV. A regra estava repetida em tres telas, agora mora aqui. */
export function isRadioChannel(channel: Pick<Channel, 'isRadio' | 'group' | 'name'> | null): boolean {
  if (!channel) return false;
  if (channel.isRadio) return true;
  const group = (channel.group || '').toLowerCase();
  if (group.includes('rádio') || group.includes('radio')) return true;
  return (channel.name || '').startsWith('📻');
}

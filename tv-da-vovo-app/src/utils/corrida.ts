/**
 * Escolhe por qual fonte o canal comeca a tocar.
 *
 * 1. Se uma fonte deste canal ja tocou antes, ela vai primeiro (memoria).
 * 2. Senao, todas as fontes sao consultadas ao mesmo tempo e a primeira que
 *    devolver uma playlist HLS de verdade ganha. As que responderam erro vao
 *    para o fim da fila.
 *
 * A espera e curta (TEMPO_MAXIMO_MS): se ninguem responder a tempo, fica a
 * ordem original da lista, que ja vem do PC ordenada pela mais rapida.
 */

import { MARCA_JWT, comPassePluto, pegarPassePluto } from './programacao';

const CHAVE = 'tvdavovo_fonte_boa';
const TEMPO_MAXIMO_MS = 3500;

function lerMemoria(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(CHAVE) || '{}') || {};
  } catch {
    return {};
  }
}

export function lembrarFonteBoa(canal: string, url: string): void {
  if (!canal || !url) return;
  try {
    const memoria = lerMemoria();
    if (memoria[canal] === url) return;
    memoria[canal] = url;
    localStorage.setItem(CHAVE, JSON.stringify(memoria));
  } catch {
    /* sem espaco: so nao lembra */
  }
}

/** Remove a fonte lembrada quando ela falhar ao tocar, evitando prender em link morto. */
export function esquecerFonte(canal: string, url?: string): void {
  if (!canal) return;
  try {
    const memoria = lerMemoria();
    if (!(canal in memoria)) return;
    if (url && memoria[canal] !== url) return;
    delete memoria[canal];
    localStorage.setItem(CHAVE, JSON.stringify(memoria));
  } catch {
    /* ok */
  }
}

/** Na troca de versao do app, limpa caches antigos de fontes e saude de sinais mortos. */
export function limparCacheAntigoDeFontes(versao = '3'): void {
  const chaveVersao = 'tvdavovo_cache_ver';
  try {
    if (localStorage.getItem(chaveVersao) === versao) return;
    localStorage.removeItem(CHAVE);
    localStorage.removeItem('vovo_tv_health');
    localStorage.setItem(chaveVersao, versao);
  } catch {
    /* ok */
  }
}

async function respondeComPlaylist(url: string, sinal: AbortSignal): Promise<boolean> {
  const r = await fetch(comPassePluto(url), { signal: sinal, cache: 'no-store' });
  if (!r.ok) return false;
  const texto = (await r.text()).slice(0, 4000);
  return texto.includes('#EXTM3U') && (texto.includes('#EXTINF') || texto.includes('#EXT-X-STREAM-INF'));
}

export async function ordenarFontes(canal: string, fontes: string[], sinal?: AbortSignal): Promise<string[]> {
  // rota oficial do Pluto: garante o passe antes de qualquer tentativa
  if (fontes.some((u) => u.includes(MARCA_JWT))) {
    await pegarPassePluto().catch(() => '');
  }
  if (fontes.length <= 1) return fontes;

  const lembrada = lerMemoria()[canal];
  if (lembrada && fontes.includes(lembrada)) {
    return [lembrada, ...fontes.filter((u) => u !== lembrada)];
  }

  const controle = new AbortController();
  const abortar = () => controle.abort();
  sinal?.addEventListener('abort', abortar);

  const boas: string[] = [];
  const ruins = new Set<string>();

  await new Promise<void>((resolver) => {
    let pendentes = fontes.length;
    const relogio = window.setTimeout(resolver, TEMPO_MAXIMO_MS);
    const terminar = () => {
      window.clearTimeout(relogio);
      resolver();
    };
    for (const url of fontes) {
      respondeComPlaylist(url, controle.signal)
        .then((ok) => {
          if (ok) {
            boas.push(url);
            terminar(); // a primeira que respondeu ja basta para comecar
          } else {
            ruins.add(url);
          }
        })
        .catch(() => ruins.add(url))
        .finally(() => {
          pendentes -= 1;
          if (pendentes === 0) terminar();
        });
    }
  });

  controle.abort(); // nao precisa esperar as outras
  sinal?.removeEventListener('abort', abortar);

  const resto = fontes.filter((u) => !boas.includes(u) && !ruins.has(u));
  return [...boas, ...resto, ...fontes.filter((u) => ruins.has(u))];
}

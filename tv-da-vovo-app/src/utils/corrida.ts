/**
 * Escolhe e melhora continuamente por qual fonte o canal toca.
 *
 * 1. Mantem memoria da ultima fonte que tocou bem (`tvdavovo_fonte_boa`),
 *    com validade de 15 minutos e pontuacao de desempenho (`tvdavovo_desempenho`)
 *    para que servidores mais rapidos e estaveis subam naturalmente para o topo.
 * 2. Quando nao ha fonte fresca, a fonte lembrada falhou ou foi pedido
 *    reordenamento (`forcarCorrida`), todas as fontes sao consultadas em paralelo
 *    para colocar a mais rapida com playlist valida em primeiro lugar.
 */

import { MARCA_JWT, comPassePluto, pegarPassePluto } from './programacao';

const CHAVE = 'tvdavovo_fonte_boa';
const CHAVE_META = 'tvdavovo_fonte_meta';
const CHAVE_DESEMPENHO = 'tvdavovo_desempenho';
const CHAVE_VERSAO = 'tvdavovo_cache_ver';
const TEMPO_MAXIMO_MS = 3500;
const JANELA_MELHOR_CORRIDA_MS = 450;
const TTL_FONTE_BOA_MS = 15 * 60_000;

export interface DesempenhoFonte {
  ok: number;
  falhas: number;
  falhasSeguidas: number;
  latenciaMs?: number;
  atualizadoEm: number;
}

function lerJson<T>(chave: string, padrao: T): T {
  try {
    return (JSON.parse(localStorage.getItem(chave) || 'null') as T) ?? padrao;
  } catch {
    return padrao;
  }
}

function salvarJson(chave: string, valor: unknown): void {
  try {
    localStorage.setItem(chave, JSON.stringify(valor));
  } catch {
    /* sem espaco: segue sem cache */
  }
}

function lerMemoria(): Record<string, string> {
  return lerJson<Record<string, string>>(CHAVE, {});
}

export function lerDesempenhoFontes(): Record<string, DesempenhoFonte> {
  return lerJson<Record<string, DesempenhoFonte>>(CHAVE_DESEMPENHO, {});
}

/**
 * Registra sucesso, falha ou latencia real de uma URL (tanto pelo player
 * quanto pela verificacao silenciosa em segundo plano), permitindo que fontes
 * melhores subam automaticamente de prioridade.
 */
export function registrarDesempenhoFonte(url: string, ok: boolean, latenciaMs?: number): void {
  if (!url) return;
  const mapa = lerDesempenhoFontes();
  const atual = mapa[url] || { ok: 0, falhas: 0, falhasSeguidas: 0, atualizadoEm: 0 };

  if (ok) {
    atual.ok += 1;
    atual.falhasSeguidas = 0;
    if (typeof latenciaMs === 'number' && !Number.isNaN(latenciaMs)) {
      atual.latenciaMs =
        typeof atual.latenciaMs === 'number'
          ? Math.round(atual.latenciaMs * 0.5 + latenciaMs * 0.5)
          : Math.round(latenciaMs);
    }
  } else {
    atual.falhas += 1;
    atual.falhasSeguidas += 1;
  }
  atual.atualizadoEm = Date.now();
  mapa[url] = atual;
  salvarJson(CHAVE_DESEMPENHO, mapa);

  // Se uma fonte lembrada acumulou 2 falhas seguidas, esquece dela para nao travar
  if (!ok && atual.falhasSeguidas >= 2) {
    const memoria = lerMemoria();
    let mudou = false;
    for (const [canal, salva] of Object.entries(memoria)) {
      if (salva === url) {
        delete memoria[canal];
        mudou = true;
      }
    }
    if (mudou) salvarJson(CHAVE, memoria);
  }
}

export function pontuacaoFonte(url: string, mapa = lerDesempenhoFontes()): number {
  const d = mapa[url];
  if (!d) return 0;
  let score = (d.ok - d.falhas * 2) * 100 - d.falhasSeguidas * 500;
  if (typeof d.latenciaMs === 'number') {
    score -= Math.min(d.latenciaMs, 3000) / 10;
  }
  return score;
}

export function lembrarFonteBoa(canal: string, url: string, latenciaMs?: number): void {
  if (!canal || !url) return;
  const memoria = lerMemoria();
  if (memoria[canal] !== url) {
    memoria[canal] = url;
    salvarJson(CHAVE, memoria);
  }
  const meta = lerJson<Record<string, number>>(CHAVE_META, {});
  meta[canal] = Date.now();
  salvarJson(CHAVE_META, meta);
  registrarDesempenhoFonte(url, true, latenciaMs);
}

/** Remove a fonte lembrada quando ela falhar ao tocar, evitando prender em link morto. */
export function esquecerFonte(canal: string, url?: string): void {
  if (!canal) return;
  const memoria = lerMemoria();
  if (!(canal in memoria)) return;
  if (url && memoria[canal] !== url) return;
  delete memoria[canal];
  salvarJson(CHAVE, memoria);
}

/** Na troca de versao do app, limpa caches antigos de fontes e saude de sinais mortos. */
export function limparCacheAntigoDeFontes(versao = '4'): void {
  try {
    if (localStorage.getItem(CHAVE_VERSAO) === versao) return;
    localStorage.removeItem(CHAVE);
    localStorage.removeItem(CHAVE_META);
    localStorage.removeItem(CHAVE_DESEMPENHO);
    localStorage.removeItem('vovo_tv_health');
    localStorage.setItem(CHAVE_VERSAO, versao);
  } catch {
    /* ok */
  }
}

async function respondeComPlaylist(url: string, sinal: AbortSignal): Promise<{ ok: boolean; latenciaMs: number }> {
  const inicio = performance.now();
  const r = await fetch(comPassePluto(url), { signal: sinal, cache: 'no-store' });
  const latenciaMs = Math.round(performance.now() - inicio);
  if (!r.ok) return { ok: false, latenciaMs };
  const texto = (await r.text()).slice(0, 4000);
  const valida =
    texto.includes('#EXTM3U') && (texto.includes('#EXTINF') || texto.includes('#EXT-X-STREAM-INF'));
  return { ok: valida, latenciaMs };
}

function ordenarPorHistorico(urls: string[], mapa: Record<string, DesempenhoFonte>): string[] {
  return [...urls].sort((a, b) => pontuacaoFonte(b, mapa) - pontuacaoFonte(a, mapa));
}

export interface OpcoesCorrida {
  forcarCorrida?: boolean;
}

export async function ordenarFontes(
  canal: string,
  fontes: string[],
  sinal?: AbortSignal,
  opcoes?: OpcoesCorrida
): Promise<string[]> {
  // rota oficial do Pluto: garante o passe antes de qualquer tentativa
  if (fontes.some((u) => u.includes(MARCA_JWT))) {
    await pegarPassePluto().catch(() => '');
  }
  if (fontes.length <= 1) return fontes;

  const mapa = lerDesempenhoFontes();
  const lembrada = lerMemoria()[canal];
  const meta = lerJson<Record<string, number>>(CHAVE_META, {});
  const lembradaEm = meta[canal];
  const naoExpirou = !lembradaEm || Date.now() - lembradaEm < TTL_FONTE_BOA_MS;
  const infoLembrada = lembrada ? mapa[lembrada] : undefined;
  const saudavel = !infoLembrada || infoLembrada.falhasSeguidas === 0;

  if (!opcoes?.forcarCorrida && lembrada && fontes.includes(lembrada) && naoExpirou && saudavel) {
    const reservas = ordenarPorHistorico(
      fontes.filter((u) => u !== lembrada),
      mapa
    );
    return [lembrada, ...reservas];
  }

  const controle = new AbortController();
  const abortar = () => controle.abort();
  sinal?.addEventListener('abort', abortar);

  const boas: { url: string; latenciaMs: number }[] = [];
  const ruins = new Set<string>();

  await new Promise<void>((resolver) => {
    let pendentes = fontes.length;
    let encerrado = false;
    let janelaExtra: ReturnType<typeof setTimeout> | null = null;

    const terminar = () => {
      if (encerrado) return;
      encerrado = true;
      globalThis.clearTimeout(relogio);
      if (janelaExtra !== null) globalThis.clearTimeout(janelaExtra);
      resolver();
    };

    const relogio = globalThis.setTimeout(terminar, TEMPO_MAXIMO_MS);

    for (const url of fontes) {
      respondeComPlaylist(url, controle.signal)
        .then(({ ok, latenciaMs }) => {
          if (controle.signal.aborted) return;
          registrarDesempenhoFonte(url, ok, latenciaMs);
          if (ok) {
            boas.push({ url, latenciaMs });
            // Espera uma janela curta apos o primeiro acerto para deixar
            // servidores paralelos ainda mais estaveis/rapidos entrarem na fila
            if (janelaExtra === null && pendentes > 1) {
              janelaExtra = globalThis.setTimeout(terminar, JANELA_MELHOR_CORRIDA_MS);
            }
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

  controle.abort();
  sinal?.removeEventListener('abort', abortar);

  const mapaFinal = lerDesempenhoFontes();
  boas.sort((a, b) => {
    const diffScore = pontuacaoFonte(b.url, mapaFinal) - pontuacaoFonte(a.url, mapaFinal);
    if (Math.abs(diffScore) >= 300) return diffScore;
    return a.latenciaMs - b.latenciaMs;
  });

  const boasUrls = boas.map((b) => b.url);
  const resto = ordenarPorHistorico(
    fontes.filter((u) => !boasUrls.includes(u) && !ruins.has(u)),
    mapaFinal
  );
  const falhasOrdenadas = ordenarPorHistorico(
    fontes.filter((u) => ruins.has(u)),
    mapaFinal
  );

  return [...boasUrls, ...resto, ...falhasOrdenadas];
}

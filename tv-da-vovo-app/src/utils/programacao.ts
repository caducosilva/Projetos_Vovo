/**
 * O que esta passando agora em cada canal (horario de inicio e termino).
 *
 * Fontes suportadas no campo `epg` (com fallback separado por `|`):
 *   "meuguia:<COD>"   -> programacao do meuguia.tv (Globo, Record, SBT, Band, RedeTV, etc.)
 *   "epgshare:<ID>"   -> guia XMLTV BR do epgshare01 (CNN Brasil, Jovem Pan News, etc.)
 *   "epgpw:<id>"      -> legado epg.pw
 *   "pluto:<id>"      -> guia oficial do Pluto TV
 *
 * No Android nativo as requisicoes passam pelo CapacitorHttp para evitar bloqueio
 * de CORS da WebView. Sem guia disponivel, tudo falha em silencio.
 */
import { CapacitorHttp } from '@capacitor/core';
import { isNative } from './tvBridge';

export interface Programa {
  titulo: string;
  inicio: number;
  fim?: number;
}

export interface AgoraEDepois {
  agora?: Programa;
  depois?: Programa;
}

/** America/Sao_Paulo em base64 para o epg.pw. */
const FUSO_SP = 'QW1lcmljYS9TYW9fUGF1bG8=';
const URL_MEUGUIA = 'https://meuguia.tv/programacao/canal/';
const URL_EPGSHARE_BR = 'https://epgshare01.online/epgshare01/epg_ripper_BR1.xml.gz';

const VALIDADE_MS = 30 * 60 * 1000;
const VALIDADE_XML_MS = 2 * 60 * 60 * 1000;
const TEMPO_LIMITE_MS = 7000;

const cache = new Map<string, { quando: number; programas: Programa[] }>();
const emAndamento = new Map<string, Promise<Programa[]>>();

let cacheXmlBr: { quando: number; xml: string } | null = null;
let promessaXmlBr: Promise<string> | null = null;

const ENTIDADES_HTML: Record<string, string> = {
  amp: '&',
  quot: '"',
  apos: "'",
  lt: '<',
  gt: '>',
  nbsp: ' ',
  aacute: 'á',
  eacute: 'é',
  iacute: 'í',
  oacute: 'ó',
  uacute: 'ú',
  atilde: 'ã',
  otilde: 'õ',
  ccedil: 'ç',
  acirc: 'â',
  ecirc: 'ê',
  ocirc: 'ô',
  agrave: 'à'
};

function decodificarEntidadesHtml(texto: string): string {
  return texto
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    })
    .replace(/&#39;/g, "'")
    .replace(/&([a-z]+);/gi, (m, nome) => ENTIDADES_HTML[nome.toLowerCase()] ?? m);
}

function limparHtml(texto: string): string {
  return decodificarEntidadesHtml(texto.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

async function buscarTexto(url: string): Promise<string> {
  if (isNative) {
    const res = await CapacitorHttp.get({
      url,
      connectTimeout: TEMPO_LIMITE_MS,
      readTimeout: TEMPO_LIMITE_MS,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    if (res.status < 200 || res.status >= 300) throw new Error('http ' + res.status);
    return typeof res.data === 'string' ? res.data : String(res.data ?? '');
  }

  const controle = new AbortController();
  const relogio = window.setTimeout(() => controle.abort(), TEMPO_LIMITE_MS);
  try {
    const r = await fetch(url, { signal: controle.signal, cache: 'no-store' });
    if (!r.ok) throw new Error('http ' + r.status);
    return await r.text();
  } finally {
    window.clearTimeout(relogio);
  }
}

async function buscarJson(url: string, cabecalhos?: Record<string, string>): Promise<any> {
  if (isNative) {
    const res = await CapacitorHttp.get({
      url,
      connectTimeout: TEMPO_LIMITE_MS,
      readTimeout: TEMPO_LIMITE_MS,
      headers: cabecalhos
    });
    if (res.status < 200 || res.status >= 300) throw new Error('http ' + res.status);
    return typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
  }

  const controle = new AbortController();
  const relogio = window.setTimeout(() => controle.abort(), TEMPO_LIMITE_MS);
  try {
    const r = await fetch(url, { headers: cabecalhos, signal: controle.signal, cache: 'no-store' });
    if (!r.ok) throw new Error('http ' + r.status);
    return await r.json();
  } finally {
    window.clearTimeout(relogio);
  }
}

function base64ParaBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function descompactarGzipParaTexto(bytes: Uint8Array): Promise<string> {
  if (typeof DecompressionStream !== 'undefined') {
    const ds = new DecompressionStream('gzip');
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    const fluxo = new Blob([copy]).stream().pipeThrough(ds);
    return await new Response(fluxo).text();
  }
  throw new Error('DecompressionStream indisponivel');
}

async function obterXmlEpgShareBr(): Promise<string> {
  if (cacheXmlBr && Date.now() - cacheXmlBr.quando < VALIDADE_XML_MS) {
    return cacheXmlBr.xml;
  }
  if (promessaXmlBr) return promessaXmlBr;

  promessaXmlBr = (async () => {
    let bytes: Uint8Array;
    if (isNative) {
      const res = await CapacitorHttp.get({
        url: URL_EPGSHARE_BR,
        responseType: 'arraybuffer',
        connectTimeout: 10000,
        readTimeout: 12000
      });
      if (res.status < 200 || res.status >= 300 || !res.data) {
        throw new Error('http ' + res.status);
      }
      bytes =
        typeof res.data === 'string' ? base64ParaBytes(res.data) : new Uint8Array(res.data as ArrayBuffer);
    } else {
      const controle = new AbortController();
      const relogio = window.setTimeout(() => controle.abort(), 12000);
      try {
        const r = await fetch(URL_EPGSHARE_BR, { signal: controle.signal });
        if (!r.ok) throw new Error('http ' + r.status);
        bytes = new Uint8Array(await r.arrayBuffer());
      } finally {
        window.clearTimeout(relogio);
      }
    }
    const xml = await descompactarGzipParaTexto(bytes);
    cacheXmlBr = { quando: Date.now(), xml };
    return xml;
  })().finally(() => {
    promessaXmlBr = null;
  });

  return promessaXmlBr;
}

/**
 * Converte a pagina HTML de um canal do meuguia.tv em lista de programas com inicio e fim.
 * Horarios do site estao sempre em Brasilia (UTC-3).
 */
export function parsearMeuGuiaHtml(html: string, referenciaMs = Date.now()): Programa[] {
  const limpo = html.replace(/<!--[\s\S]*?-->/g, '');
  // Data atual em Brasilia (UTC-3)
  const brtAgora = new Date(referenciaMs - 3 * 3600 * 1000);
  let ano = brtAgora.getUTCFullYear();
  let mesAtual = brtAgora.getUTCMonth() + 1;
  let diaAtual = brtAgora.getUTCDate();

  const regex =
    /<li[^>]*class=['"][^'"]*subheader[^'"]*['"][^>]*>[^<]*?(\d{2})\/(\d{2})[^<]*<\/li>|<a[^>]*>[\s\S]*?<div[^>]*class=['"][^'"]*\btime\b[^'"]*['"][^>]*>\s*(\d{2}):(\d{2})\s*<\/div>[\s\S]*?<div[^>]*class=['"][^'"]*licontent[^'"]*['"][^>]*>\s*<h2[^>]*>([\s\S]*?)<\/h2>/gi;

  const lista: Programa[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(limpo)) !== null) {
    if (match[1] && match[2]) {
      const novoDia = Number(match[1]);
      const novoMes = Number(match[2]);
      if (novoMes < mesAtual && mesAtual - novoMes > 6) ano += 1;
      else if (novoMes > mesAtual && novoMes - mesAtual > 6) ano -= 1;
      diaAtual = novoDia;
      mesAtual = novoMes;
    } else if (match[3] && match[4]) {
      const hh = Number(match[3]);
      const mm = Number(match[4]);
      const titulo = limparHtml(match[5] || '');
      if (!titulo) continue;
      const inicio = Date.UTC(ano, mesAtual - 1, diaAtual, hh + 3, mm, 0, 0);
      lista.push({ titulo, inicio });
    }
  }

  for (let i = 0; i < lista.length - 1; i++) {
    lista[i].fim = lista[i + 1].inicio;
  }
  return lista;
}

/** Converte timestamp XMLTV ("20261115204500 -0300") para epoch ms. */
export function parsearDataXmlTv(valor: string): number {
  const m = /^\s*(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-]\d{2}):?(\d{2})?/.exec(valor);
  if (!m) return Number.NaN;
  const [, y, mo, d, h, mi, s, offH, offM] = m;
  const utcBase = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  const oh = Number(offH);
  const om = Number(offM || '0') * (oh < 0 ? -1 : 1);
  const offsetMs = (oh * 60 + om) * 60 * 1000;
  return utcBase - offsetMs;
}

/** Extrai a grade de um canal especifico dentro do XMLTV sem construir DOM gigante. */
export function parsearXmlTvParaCanal(xml: string, channelId: string): Programa[] {
  const escaped = channelId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(
    `<programme\\s+([^>]*?channel=["']${escaped}["'][^>]*)>([\\s\\S]*?)<\\/programme>`,
    'gi'
  );
  const lista: Programa[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(xml)) !== null) {
    const attrs = match[1];
    const body = match[2];
    const startMatch = /start=["']([^"']+)["']/i.exec(attrs);
    const stopMatch = /stop=["']([^"']+)["']/i.exec(attrs);
    const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(body);
    if (!startMatch || !titleMatch) continue;
    const inicio = parsearDataXmlTv(startMatch[1]);
    const fim = stopMatch ? parsearDataXmlTv(stopMatch[1]) : Number.NaN;
    const titulo = limparHtml(titleMatch[1]);
    if (!titulo || Number.isNaN(inicio)) continue;
    lista.push({
      titulo,
      inicio,
      fim: Number.isNaN(fim) ? undefined : fim
    });
  }
  lista.sort((a, b) => a.inicio - b.inicio);
  for (let i = 0; i < lista.length - 1; i++) {
    if (lista[i].fim === undefined) lista[i].fim = lista[i + 1].inicio;
  }
  return lista;
}

async function guiaMeuGuia(codigo: string): Promise<Programa[]> {
  const html = await buscarTexto(`${URL_MEUGUIA}${encodeURIComponent(codigo)}`);
  return parsearMeuGuiaHtml(html);
}

async function guiaEpgShare(channelId: string): Promise<Programa[]> {
  const xml = await obterXmlEpgShareBr();
  return parsearXmlTvParaCanal(xml, channelId);
}

async function guiaEpgPw(id: string): Promise<Programa[]> {
  const dados = await buscarJson(
    `https://epg.pw/api/epg.json?lang=pt&channel_id=${encodeURIComponent(id)}&timezone=${FUSO_SP}`
  );
  const lista: Programa[] = (dados?.epg_list ?? [])
    .map((p: any) => ({ titulo: String(p?.title ?? '').trim(), inicio: Date.parse(p?.start_date) }))
    .filter((p: Programa) => p.titulo && !Number.isNaN(p.inicio))
    .sort((a: Programa, b: Programa) => a.inicio - b.inicio);
  for (let i = 0; i < lista.length - 1; i++) lista[i].fim = lista[i + 1].inicio;
  return lista;
}

// --- Pluto -----------------------------------------------------------------

const BOOT_PLUTO =
  'https://boot.pluto.tv/v4/start?appName=web&appVersion=8.0.0&deviceVersion=151.0.0' +
  '&deviceModel=web&deviceMake=chrome&deviceType=web&clientModelNumber=1.0.0' +
  '&serverSideAds=false&clientID=';
const CHAVE_PASSE = 'tvdavovo_pluto_passe';
/** O passe vale 24h; renova antes para nunca usar um vencido. */
const VALIDADE_PASSE_MS = 20 * 60 * 60 * 1000;

let passePluto: Promise<string> | null = null;

/** Onde a URL da rota oficial do Pluto espera o passe da sessao. */
export const MARCA_JWT = '__PLUTO_JWT__';

/** Passe guardado e ainda valido, sem ir a rede ('' se nao houver). */
export function passePlutoGuardado(): string {
  try {
    const salvo = JSON.parse(localStorage.getItem(CHAVE_PASSE) || 'null');
    if (salvo?.token && salvo.validoAte > Date.now()) return String(salvo.token);
  } catch {
    /* sem passe */
  }
  return '';
}

/** Troca a marca pelo passe do momento. Sem passe, a URL falha e o player pula. */
export function comPassePluto(url: string): string {
  return url.includes(MARCA_JWT) ? url.split(MARCA_JWT).join(passePlutoGuardado()) : url;
}

function idDoAparelho(): string {
  try {
    let id = localStorage.getItem('tvdavovo_aparelho');
    if (!id) {
      id = crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);
      localStorage.setItem('tvdavovo_aparelho', id);
    }
    return id;
  } catch {
    return '00000000-0000-0000-0000-000000000000';
  }
}

export function pegarPassePluto(): Promise<string> {
  try {
    const salvo = JSON.parse(localStorage.getItem(CHAVE_PASSE) || 'null');
    if (salvo?.token && salvo.validoAte > Date.now()) return Promise.resolve(salvo.token);
  } catch {
    /* sem passe guardado */
  }
  if (!passePluto) {
    passePluto = buscarJson(BOOT_PLUTO + idDoAparelho())
      .then((d) => {
        const token = String(d?.sessionToken || '');
        if (!token) throw new Error('sem passe');
        try {
          localStorage.setItem(CHAVE_PASSE, JSON.stringify({ token, validoAte: Date.now() + VALIDADE_PASSE_MS }));
        } catch {
          /* armazenamento cheio */
        }
        return token;
      })
      .finally(() => {
        passePluto = null;
      });
  }
  return passePluto;
}

async function guiaPluto(id: string): Promise<Programa[]> {
  const token = await pegarPassePluto();
  const inicio = new Date();
  inicio.setMinutes(0, 0, 0);
  const dados = await buscarJson(
    'https://service-channels.clusters.pluto.tv/v2/guide/timelines' +
      `?start=${encodeURIComponent(inicio.toISOString())}&channelIds=${encodeURIComponent(id)}&duration=360`,
    { Authorization: 'Bearer ' + token }
  );
  const canal = (dados?.data ?? [])[0];
  return (canal?.timelines ?? [])
    .map((t: any) => ({
      titulo: String(t?.title ?? '').trim(),
      inicio: Date.parse(t?.start),
      fim: Date.parse(t?.stop)
    }))
    .filter((p: Programa) => p.titulo && !Number.isNaN(p.inicio))
    .sort((a: Programa, b: Programa) => a.inicio - b.inicio);
}

// ---------------------------------------------------------------------------

async function buscarUmaFonte(fonteEpg: string): Promise<Programa[]> {
  const idx = fonteEpg.indexOf(':');
  if (idx === -1) return [];
  const fonte = fonteEpg.slice(0, idx);
  const id = fonteEpg.slice(idx + 1);
  if (!id) return [];
  if (fonte === 'meuguia') return guiaMeuGuia(id);
  if (fonte === 'epgshare') return guiaEpgShare(id);
  if (fonte === 'epgpw') return guiaEpgPw(id);
  if (fonte === 'pluto') return guiaPluto(id);
  return [];
}

async function buscarGuia(epg: string): Promise<Programa[]> {
  const fontes = epg
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const fonte of fontes) {
    try {
      const programas = await buscarUmaFonte(fonte);
      const checado = agoraEDepois(programas);
      if (checado.agora || checado.depois) return programas;
    } catch {
      /* tenta a proxima fonte de guia */
    }
  }
  return [];
}

/** Separa o programa no ar e o seguinte, para um instante qualquer. */
export function agoraEDepois(programas: Programa[], agora = Date.now()): AgoraEDepois {
  let indice = -1;
  for (let i = 0; i < programas.length; i++) {
    if (programas[i].inicio <= agora) indice = i;
    else break;
  }
  if (indice === -1) return { depois: programas[0] };
  const atual = programas[indice];
  // guia velho: o ultimo programa que temos ja acabou faz tempo
  if (atual.fim !== undefined && atual.fim < agora) return {};
  return { agora: atual, depois: programas[indice + 1] };
}

/** Programa no ar e o proximo. Nunca rejeita: sem guia devolve {}. */
export async function programacaoDoCanal(epg: string | undefined): Promise<AgoraEDepois> {
  if (!epg) return {};
  const guardado = cache.get(epg);
  if (guardado && Date.now() - guardado.quando < VALIDADE_MS) {
    const r = agoraEDepois(guardado.programas);
    if (r.agora) return r;
  }
  try {
    let pedido = emAndamento.get(epg);
    if (!pedido) {
      pedido = buscarGuia(epg).finally(() => emAndamento.delete(epg));
      emAndamento.set(epg, pedido);
    }
    const programas = await pedido;
    cache.set(epg, { quando: Date.now(), programas });
    return agoraEDepois(programas);
  } catch {
    return {};
  }
}

export function horaCurta(ms: number): string {
  return new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

/** Percentual concluido do programa atual (0 a 100), ou null sem horario de fim. */
export function progressoDoPrograma(programa: Programa, agora = Date.now()): number | null {
  if (programa.fim === undefined || programa.fim <= programa.inicio) return null;
  const pct = ((agora - programa.inicio) / (programa.fim - programa.inicio)) * 100;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

/** Texto claro com inicio e termino ("Das 20:45 às 23:35" ou "Começou às 20:45"). */
export function horarioDoPrograma(programa: Programa): string {
  const inicio = horaCurta(programa.inicio);
  if (programa.fim !== undefined && programa.fim > programa.inicio) {
    return `Das ${inicio} às ${horaCurta(programa.fim)}`;
  }
  return `Começou às ${inicio}`;
}

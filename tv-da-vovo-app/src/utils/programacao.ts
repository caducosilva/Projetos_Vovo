/**
 * O que esta passando agora em cada canal.
 *
 * Cada canal da lista traz a chave `epg`, gravada pelo tools/montar_listas.py:
 *   "epgpw:<id>"  -> guia do epg.pw (canais abertos: Globo, Record, SBT...)
 *   "pluto:<id>"  -> guia oficial do Pluto TV (Cine Zap)
 *
 * Tudo aqui falha em silencio: sem guia, a faixa mostra so o nome do canal.
 * A vovo nunca ve erro por causa de programacao.
 */

export interface Programa {
  titulo: string;
  inicio: number;
  fim?: number;
}

export interface AgoraEDepois {
  agora?: Programa;
  depois?: Programa;
}

/** America/Sao_Paulo em base64, como o epg.pw quer receber o fuso. */
const FUSO_SP = 'QW1lcmljYS9TYW9fUGF1bG8=';
const VALIDADE_MS = 30 * 60 * 1000;
const TEMPO_LIMITE_MS = 6000;

const cache = new Map<string, { quando: number; programas: Programa[] }>();
const emAndamento = new Map<string, Promise<Programa[]>>();

async function buscarJson(url: string, cabecalhos?: Record<string, string>): Promise<any> {
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

async function guiaEpgPw(id: string): Promise<Programa[]> {
  const dados = await buscarJson(
    `https://epg.pw/api/epg.json?lang=pt&channel_id=${encodeURIComponent(id)}&timezone=${FUSO_SP}`
  );
  const lista: Programa[] = (dados?.epg_list ?? [])
    .map((p: any) => ({ titulo: String(p?.title ?? '').trim(), inicio: Date.parse(p?.start_date) }))
    .filter((p: Programa) => p.titulo && !Number.isNaN(p.inicio))
    .sort((a: Programa, b: Programa) => a.inicio - b.inicio);
  // o epg.pw so manda o inicio: o fim de um e o inicio do proximo
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
          /* TV com armazenamento cheio: so nao guarda */
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

function buscarGuia(epg: string): Promise<Programa[]> {
  const [fonte, id] = [epg.slice(0, epg.indexOf(':')), epg.slice(epg.indexOf(':') + 1)];
  if (!id) return Promise.resolve([]);
  if (fonte === 'epgpw') return guiaEpgPw(id);
  if (fonte === 'pluto') return guiaPluto(id);
  return Promise.resolve([]);
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

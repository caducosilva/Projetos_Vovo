/**
 * Sessao do Pluto TV.
 *
 * O Pluto desligou a rota antiga (`/v1/stitch/embed/...`), que era aberta e
 * ficou gravada na lista. Ela ainda responde 200, e por isso nenhum teste de
 * "o link esta no ar" percebe o problema: o que vem no lugar do canal e um
 * cartao dizendo "Pluto TV nao esta mais disponivel neste aparelho".
 *
 * A rota nova exige um passe de sessao. O passe e anonimo (nao precisa de
 * conta), vale 24 horas e sai do `boot.pluto.tv`. Como ele muda, a lista de
 * canais guarda a URL com a marca MARCA_JWT no lugar do passe, e quem troca a
 * marca pelo passe do momento e este arquivo, na hora de tocar.
 */

/** Onde a URL da lista espera receber o passe da sessao. */
export const MARCA_JWT = '__PLUTO_JWT__';

const BOOT =
  'https://boot.pluto.tv/v4/start?appName=web&appVersion=8.0.0&deviceVersion=151.0.0' +
  '&deviceModel=web&deviceMake=chrome&deviceType=web&clientModelNumber=1.0.0' +
  '&serverSideAds=false&clientID=';

const CHAVE = 'cinezap_pluto_sessao';
/** O passe vale 24h; renova antes disso para nunca tocar com passe vencido. */
const VALIDADE_MS = 20 * 60 * 60 * 1000;

interface Sessao {
  token: string;
  validoAte: number;
}

let emMemoria: Sessao | null = null;
let buscando: Promise<string> | null = null;

function agora(): number {
  return Date.now();
}

function lerGuardado(): Sessao | null {
  try {
    const bruto = localStorage.getItem(CHAVE);
    if (!bruto) return null;
    const dados = JSON.parse(bruto) as Sessao;
    if (!dados?.token || typeof dados.validoAte !== 'number') return null;
    return dados;
  } catch {
    return null;
  }
}

function guardar(sessao: Sessao): void {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(sessao));
  } catch {
    /* TV com armazenamento cheio ainda toca, so nao guarda o passe */
  }
}

/** Identificador do aparelho: o Pluto quer um, e o mesmo pode ser reusado. */
function idDoAparelho(): string {
  const chave = 'cinezap_pluto_aparelho';
  try {
    const existente = localStorage.getItem(chave);
    if (existente) return existente;
  } catch {
    /* segue com um id novo a cada abertura */
  }
  const novo =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
          const r = (Math.random() * 16) | 0;
          return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
        });
  try {
    localStorage.setItem(chave, novo);
  } catch {
    /* sem persistir, o Pluto so vai ver um aparelho novo na proxima vez */
  }
  return novo;
}

/** Joga fora o passe atual. Use quando o Pluto recusar a fonte. */
export function esquecerSessaoPluto(): void {
  emMemoria = null;
  buscando = null;
  try {
    localStorage.removeItem(CHAVE);
  } catch {
    /* nada a fazer */
  }
}

async function buscarToken(): Promise<string> {
  const resposta = await fetch(BOOT + idDoAparelho(), { credentials: 'omit' });
  if (!resposta.ok) throw new Error('boot do Pluto respondeu ' + resposta.status);
  const dados = (await resposta.json()) as { sessionToken?: string };
  if (!dados.sessionToken) throw new Error('boot do Pluto veio sem passe');
  const sessao: Sessao = { token: dados.sessionToken, validoAte: agora() + VALIDADE_MS };
  emMemoria = sessao;
  guardar(sessao);
  return sessao.token;
}

/** Passe de sessao valido, do cache quando der e da rede quando precisar. */
export function tokenPluto(): Promise<string> {
  const guardado = emMemoria ?? lerGuardado();
  if (guardado && guardado.validoAte > agora()) {
    emMemoria = guardado;
    return Promise.resolve(guardado.token);
  }
  // uma unica ida a rede mesmo que varias fontes peçam ao mesmo tempo
  if (!buscando) {
    buscando = buscarToken().finally(() => {
      buscando = null;
    });
  }
  return buscando;
}

/** true quando a URL da lista precisa do passe para tocar. */
export function precisaDeSessaoPluto(url: string): boolean {
  return url.includes(MARCA_JWT);
}

/**
 * Troca a marca pelo passe. URL que nao e do Pluto volta igual, sem ida a rede.
 */
export async function resolverFonte(url: string): Promise<string> {
  if (!precisaDeSessaoPluto(url)) return url;
  const token = await tokenPluto();
  return url.split(MARCA_JWT).join(encodeURIComponent(token));
}

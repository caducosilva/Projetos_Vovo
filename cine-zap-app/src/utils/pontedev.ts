import { isNative } from './tvBridge';

/**
 * Ponte para o proxy do servidor de desenvolvimento (veja `dev-proxy.ts`).
 *
 * Vale so quando o app roda no navegador do PC durante o `npm run dev`. No
 * APK, `isNative` e true e quem resolve o CORS e o ProxyDeStream em Java;
 * no build de producao o `import.meta.env.DEV` e false e esta funcao vira
 * um passa-direto, entao nada disto chega na TV.
 */

const PREFIXO = '/dev-stream/';

/** base64url sem depender de Buffer, que no navegador nao existe. */
function codificar(texto: string): string {
  const bytes = new TextEncoder().encode(texto);
  let bruto = '';
  for (const b of bytes) bruto += String.fromCharCode(b);
  return btoa(bruto).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** true quando esta rodando no navegador do PC, com o proxy de dev disponivel. */
export function usaPonteDeDesenvolvimento(): boolean {
  return import.meta.env.DEV && !isNative;
}

/**
 * Devolve a URL que o player deve carregar. Fora do desenvolvimento, ou se a
 * URL ja estiver passando pela ponte, volta igual.
 */
export function pelaPonteDeDesenvolvimento(url: string): string {
  if (!url || !usaPonteDeDesenvolvimento()) return url;
  if (url.startsWith(PREFIXO)) return url;
  if (!/^https?:\/\//i.test(url)) return url;
  return PREFIXO + codificar(url);
}

/**
 * Manda os favoritos do PC para o servidor de desenvolvimento gravar em
 * arquivo (`favoritos-do-pc.json`), que vira a semente do app da TV.
 *
 * So no `npm run dev`. Falha em silencio: se o servidor nao responder, nao ha
 * nada de util a dizer para quem esta assistindo TV.
 */
export function espelharFavoritosNoDev(favoritos: string[]): void {
  if (!usaPonteDeDesenvolvimento()) return;
  fetch('/dev-favoritos', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(favoritos)
  }).catch(() => undefined);
}

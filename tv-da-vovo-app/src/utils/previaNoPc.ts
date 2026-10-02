/**
 * So na previa do PC (npm run dev): manda todo pedido externo pelo
 * /__proxy do vite.config.ts, que faz o papel do ProxyDeStream da TV. Sem
 * isso o navegador barra quase todo stream por CORS. No APK isto nem e
 * carregado (ver main.tsx).
 */
const externo = (url: string) => /^https?:\/\//.test(url) && !url.startsWith(location.origin);
const pelaPonte = (url: string) => '/__proxy?u=' + encodeURIComponent(url);

export function ligarPreviaNoPc(): void {
  const fetchOriginal = window.fetch.bind(window);
  window.fetch = (entrada: RequestInfo | URL, opcoes?: RequestInit) => {
    const url = typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
    return fetchOriginal(externo(url) ? pelaPonte(url) : entrada, opcoes);
  };

  const abrirOriginal = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, metodo: string, url: string | URL, ...resto: unknown[]) {
    const texto = String(url);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (abrirOriginal as any).call(this, metodo, externo(texto) ? pelaPonte(texto) : texto, ...resto);
  } as typeof XMLHttpRequest.prototype.open;
}

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

/**
 * Proxy de streams para o servidor de desenvolvimento.
 *
 * Na TV isto ja existe em Java (ProxyDeStream, chamado pelo MainActivity):
 * servidor de IPTV nao manda cabecalho CORS, e o hls.js baixa playlist e
 * segmento por XHR, entao sem alguem no meio o navegador recusa tudo.
 *
 * O Pluto TV e o caso mais duro: ele responde
 * `Access-Control-Allow-Origin: http://pluto.tv`, um valor fixo que nunca vai
 * casar com localhost. Sao 175 dos 414 canais da lista, ou seja, sem isto
 * quase metade do app nao da para testar no PC, so na TV.
 *
 * Este arquivo e o mesmo servico, em JavaScript, valendo SO no `npm run dev`
 * (`apply: 'serve'`). Ele nao entra na pasta `dist`, entao nao existe no APK.
 *
 * Como funciona: `/dev-stream/<url em base64url>` busca a URL de verdade,
 * devolve com CORS liberado e, quando a resposta e uma playlist, reescreve
 * TODAS as URLs de dentro dela para passarem por aqui tambem. E preciso
 * reescrever porque a playlist do Pluto aponta os segmentos para outro
 * dominio (`siloh-ns1.plutotv.net`), que o navegador buscaria direto e
 * levaria o mesmo bloqueio.
 */

const PREFIXO = '/dev-stream/';

/** Cabecalhos que fazem sentido repassar para o servidor de origem. */
const REPASSAR_PEDIDO = ['range', 'accept'];

export function codificarAlvo(url: string): string {
  return Buffer.from(url, 'utf8').toString('base64url');
}

function decodificarAlvo(pedaco: string): string {
  return Buffer.from(pedaco, 'base64url').toString('utf8');
}

/**
 * Playlist se decide pelo CONTEUDO, nunca pelo content-type.
 *
 * O Pluto entrega a chave AES (`.key`, 16 bytes binarios) marcada como
 * `application/vnd.apple.mpegurl`. Acreditando no rotulo, o proxy tratava a
 * chave como texto, e os 16 bytes viravam 212 depois de passar por UTF-8.
 * Chave destruida quer dizer segmento que nao descriptografa: o canal carrega
 * a playlist, escolhe a faixa e nunca mostra imagem.
 *
 * Toda playlist HLS comeca com `#EXTM3U`. Esse e o unico teste confiavel.
 */
function ehPlaylist(bytes: Buffer): boolean {
  return bytes.subarray(0, 7).toString('latin1') === '#EXTM3U';
}

/** Uma URL de dentro da playlist, ja resolvida, apontada de volta para o proxy. */
function pelaPonte(bruta: string, base: string): string {
  try {
    return PREFIXO + codificarAlvo(new URL(bruta, base).toString());
  } catch {
    return bruta; // linha estranha: melhor deixar passar do que quebrar a playlist
  }
}

/** Reescreve os atributos URI="..." das linhas de tag (#EXT-X-KEY, MEDIA, MAP). */
function reescreverAtributoUri(linha: string, base: string): string {
  return linha.replace(/URI="([^"]*)"/g, (_todo, alvo: string) => `URI="${pelaPonte(alvo, base)}"`);
}

export function reescreverPlaylist(corpo: string, base: string): string {
  return corpo
    .split('\n')
    .map((linhaBruta) => {
      const linha = linhaBruta.replace(/\r$/, '');
      if (linha === '') return linha;
      if (linha.startsWith('#')) {
        return linha.includes('URI="') ? reescreverAtributoUri(linha, base) : linha;
      }
      return pelaPonte(linha, base);
    })
    .join('\n');
}

/**
 * Onde ficam guardados os favoritos marcados no PC.
 *
 * O app da TV nasce com estes canais ja guardados. Sem isto, marcar favorito
 * testando no PC nao servia de nada: o localStorage do navegador do PC nao
 * chega no APK, e a lista teria que ser remarcada na TV, no controle remoto,
 * canal por canal.
 */
export const ARQUIVO_FAVORITOS = 'favoritos-do-pc.json';

export function proxyDeStreamDev(): Plugin {
  return {
    name: 'cine-zap-proxy-de-stream-dev',
    apply: 'serve',
    configureServer(servidor) {
      // Espelho dos favoritos do PC em arquivo, para virarem semente do APK.
      servidor.middlewares.use((req, res, next) => {
        if (req.url !== '/dev-favoritos' || req.method !== 'POST') return next();
        let corpo = '';
        req.on('data', (pedaco) => {
          corpo += pedaco;
        });
        req.on('end', () => {
          try {
            const lista = JSON.parse(corpo);
            if (!Array.isArray(lista)) throw new Error('esperava uma lista');
            writeFileSync(
              resolve(process.cwd(), ARQUIVO_FAVORITOS),
              JSON.stringify(lista, null, 2) + '\n',
              'utf8'
            );
            res.statusCode = 204;
            res.end();
          } catch (erro) {
            res.statusCode = 400;
            res.end(String(erro));
          }
        });
      });

      servidor.middlewares.use((req, res, next) => {
        if (!req.url || !req.url.startsWith(PREFIXO)) return next();

        const alvo = decodificarAlvo(req.url.slice(PREFIXO.length));

        const cabecalhos: Record<string, string> = {
          // Alguns servidores de IPTV recusam cliente sem cara de navegador
          'user-agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
        };
        for (const nome of REPASSAR_PEDIDO) {
          const valor = req.headers[nome];
          if (typeof valor === 'string') cabecalhos[nome] = valor;
        }

        fetch(alvo, { headers: cabecalhos, redirect: 'follow' })
          .then(async (resposta) => {
            const tipo = resposta.headers.get('content-type');
            res.setHeader('access-control-allow-origin', '*');
            res.setHeader('cache-control', 'no-store');
            if (tipo) res.setHeader('content-type', tipo);

            const bytes = Buffer.from(await resposta.arrayBuffer());
            res.statusCode = resposta.status;

            // `resposta.url` e nao `alvo`: depois de um redirecionamento a base
            // das URLs relativas e o endereco final, nao o que pedimos.
            if (ehPlaylist(bytes)) {
              const reescrita = reescreverPlaylist(
                bytes.toString('utf8'),
                resposta.url || alvo
              );
              res.end(reescrita);
              return;
            }

            res.setHeader('content-length', String(bytes.length));
            res.end(bytes);
          })
          .catch((erro) => {
            // 502 com o motivo no corpo: e o que aparece no console do navegador
            res.statusCode = 502;
            res.setHeader('access-control-allow-origin', '*');
            res.end('proxy de desenvolvimento falhou: ' + String(erro));
          });
      });
    }
  };
}

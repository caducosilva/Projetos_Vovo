import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * So para a previa no navegador do PC (npm run dev). Faz o papel do
 * ProxyDeStream.java da TV: busca o stream por fora do navegador (sem CORS) e
 * reescreve a playlist com enderecos absolutos. Nao entra no APK.
 */
function proxyDaPrevia(): Plugin {
  const REPASSADOS = ['range', 'authorization', 'accept'];
  return {
    name: 'proxy-da-previa',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__proxy', async (req, res) => {
        const alvo = new URL(req.url || '', 'http://x').searchParams.get('u') || '';
        if (!/^https?:\/\//.test(alvo)) {
          res.statusCode = 400;
          res.end('u invalido');
          return;
        }
        try {
          const cabecalhos: Record<string, string> = {
            'user-agent': 'Mozilla/5.0 (Linux; Android 12; TV) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
          };
          for (const nome of REPASSADOS) {
            const valor = req.headers[nome];
            if (typeof valor === 'string') cabecalhos[nome] = valor;
          }
          const r = await fetch(alvo, { headers: cabecalhos, redirect: 'follow', signal: AbortSignal.timeout(10000) });
          const corpo = Buffer.from(await r.arrayBuffer());
          res.statusCode = r.status;
          res.setHeader('access-control-allow-origin', '*');
          const inicio = corpo.subarray(0, 7).toString('utf8');
          if (inicio === '#EXTM3U') {
            const base = r.url;
            const absoluto = (u: string) => new URL(u, base).toString();
            const texto = corpo
              .toString('utf8')
              .split(/\r?\n/)
              .map((linha) => {
                const l = linha.trim();
                if (!l) return linha;
                if (l.startsWith('#')) return linha.replace(/URI="([^"]+)"/g, (_m, u) => `URI="${absoluto(u)}"`);
                return absoluto(l);
              })
              .join('\n');
            res.setHeader('content-type', 'application/vnd.apple.mpegurl');
            res.end(texto);
            return;
          }
          const tipo = r.headers.get('content-type');
          if (tipo) res.setHeader('content-type', tipo);
          res.end(corpo);
        } catch (erro) {
          res.statusCode = 502;
          res.end(String(erro));
        }
      });
    }
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), proxyDaPrevia()],
});

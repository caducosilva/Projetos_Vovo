import type { Channel } from '../types';

const CHAVE_SERVIDOR = 'vovo_tv_servidor_cameras';

/** Prefixo do id dos canais de camera, para reconhece-los depois. */
export const PREFIXO_CAMERA = 'camera:';

interface CameraDoServidor {
  id: string;
  nome: string;
}

/**
 * Endereco do servidor de cameras de casa.
 *
 * Fica em localStorage, e nao no codigo, por dois motivos: o repositorio e
 * publico e nao deve carregar o mapa da rede da casa, e o notebook pega IP por
 * DHCP, entao o endereco muda de vez em quando.
 */
export function servidorCameras(): string {
  return (localStorage.getItem(CHAVE_SERVIDOR) || '').trim();
}

export function definirServidorCameras(endereco: string): void {
  const limpo = normalizar(endereco);
  if (limpo) localStorage.setItem(CHAVE_SERVIDOR, limpo);
  else localStorage.removeItem(CHAVE_SERVIDOR);
}

/** Aceita "192.168.0.25", "192.168.0.25:8790" ou a URL inteira. */
function normalizar(bruto: string): string {
  let endereco = (bruto || '').trim().replace(/\/+$/, '');
  if (!endereco) return '';
  if (!/^https?:\/\//i.test(endereco)) endereco = `http://${endereco}`;
  if (!/:\d+$/.test(endereco)) endereco = `${endereco}:8790`;
  return endereco;
}

export function ehCanalDeCamera(canal: Pick<Channel, 'id'>): boolean {
  return (canal.id || '').startsWith(PREFIXO_CAMERA);
}

/**
 * Monta os canais das cameras a partir da lista que o servidor publica.
 *
 * Devolve lista vazia quando o servidor nao responde, que e o caso normal
 * quando o notebook esta desligado. Nao e erro: os canais somem da grade e
 * voltam sozinhos quando o servidor subir.
 */
export async function buscarCanaisDeCamera(sinal?: AbortSignal): Promise<Channel[]> {
  const servidor = servidorCameras();
  if (!servidor) return [];

  let lista: CameraDoServidor[];
  try {
    const resposta = await fetch(`${servidor}/api/cameras`, {
      cache: 'no-store',
      signal: sinal
    });
    if (!resposta.ok) return [];
    lista = await resposta.json();
  } catch {
    return [];
  }

  if (!Array.isArray(lista)) return [];

  return lista
    .filter((cam) => cam && typeof cam.id === 'string' && typeof cam.nome === 'string')
    .map((cam) => ({
      id: `${PREFIXO_CAMERA}${cam.id}`,
      name: cam.nome,
      logo: '',
      group: 'Câmeras de Casa',
      country: 'br',
      url: `${servidor}/stream/${cam.id}/index.m3u8`,
      isCustom: true
    }));
}

/** Confere se o servidor esta no ar, para o botao de testar em Ajustes. */
export async function testarServidorCameras(endereco: string): Promise<number> {
  const servidor = normalizar(endereco);
  if (!servidor) throw new Error('Digite o endereço do computador.');

  let resposta: Response;
  try {
    resposta = await fetch(`${servidor}/api/cameras`, { cache: 'no-store' });
  } catch {
    throw new Error('Não achei o servidor. O computador está ligado e na mesma rede?');
  }

  if (!resposta.ok) throw new Error(`O servidor respondeu ${resposta.status}.`);

  const lista = await resposta.json();
  if (!Array.isArray(lista)) throw new Error('O servidor respondeu algo inesperado.');
  return lista.length;
}

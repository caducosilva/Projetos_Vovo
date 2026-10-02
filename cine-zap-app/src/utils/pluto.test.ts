import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { MARCA_JWT, precisaDeSessaoPluto, resolverFonte, esquecerSessaoPluto } from './pluto';

const URL_PLUTO =
  'https://ipv4.pluto.tv/api/tn/video/playout/v2/stitch/hls/channel/abc/master.m3u8' +
  '?includeExtendedEvents=true&jwt=' +
  MARCA_JWT;

/** O projeto testa em node, que nao tem localStorage. Este basta para o caso. */
function memoriaFalsa(): Storage {
  const dados = new Map<string, string>();
  return {
    getItem: (k: string) => dados.get(k) ?? null,
    setItem: (k: string, v: string) => void dados.set(k, v),
    removeItem: (k: string) => void dados.delete(k),
    clear: () => dados.clear(),
    key: (i: number) => Array.from(dados.keys())[i] ?? null,
    get length() {
      return dados.size;
    }
  } as Storage;
}

function fingirBoot(token: string) {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ sessionToken: token })
  })) as unknown as typeof fetch;
}

describe('sessao do Pluto', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', memoriaFalsa());
    esquecerSessaoPluto();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reconhece a URL que precisa de passe', () => {
    expect(precisaDeSessaoPluto(URL_PLUTO)).toBe(true);
    expect(precisaDeSessaoPluto('http://tv.exemplo.br/canal/playlist.m3u8')).toBe(false);
  });

  it('nao vai a rede por causa de canal que nao e do Pluto', async () => {
    const rede = fingirBoot('nao-devia-usar');
    vi.stubGlobal('fetch', rede);
    const url = 'http://tv.exemplo.br/canal/playlist.m3u8';
    await expect(resolverFonte(url)).resolves.toBe(url);
    expect(rede).not.toHaveBeenCalled();
  });

  it('troca a marca pelo passe da sessao', async () => {
    vi.stubGlobal('fetch', fingirBoot('passe-123'));
    const pronto = await resolverFonte(URL_PLUTO);
    expect(pronto).toContain('jwt=passe-123');
    expect(pronto).not.toContain(MARCA_JWT);
  });

  it('pede o passe uma vez so, mesmo com varias fontes ao mesmo tempo', async () => {
    const rede = fingirBoot('passe-unico');
    vi.stubGlobal('fetch', rede);
    const [a, b, c] = await Promise.all([
      resolverFonte(URL_PLUTO),
      resolverFonte(URL_PLUTO),
      resolverFonte(URL_PLUTO)
    ]);
    expect([a, b, c].every((u) => u.includes('passe-unico'))).toBe(true);
    expect(rede).toHaveBeenCalledTimes(1);
  });

  it('busca passe novo depois de esquecer o antigo', async () => {
    vi.stubGlobal('fetch', fingirBoot('passe-velho'));
    await resolverFonte(URL_PLUTO);
    esquecerSessaoPluto();
    vi.stubGlobal('fetch', fingirBoot('passe-novo'));
    await expect(resolverFonte(URL_PLUTO)).resolves.toContain('jwt=passe-novo');
  });

  it('propaga a falha quando o boot do Pluto nao responde', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })) as unknown as typeof fetch
    );
    await expect(resolverFonte(URL_PLUTO)).rejects.toThrow('503');
  });
});

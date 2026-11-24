import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ordenarFontes,
  lembrarFonteBoa,
  esquecerFonte,
  limparCacheAntigoDeFontes,
  registrarDesempenhoFonte,
  lerDesempenhoFontes,
} from './corrida';
import { ehPlaylistHlsValida, primeiraVarianteM3u8, STALE_MINUTES } from './health';
import canais from '../data/canais_abertos.json';

function criarStorage() {
  const dados = new Map<string, string>();
  return {
    getItem: (k: string) => dados.get(k) ?? null,
    setItem: (k: string, v: string) => dados.set(k, v),
    removeItem: (k: string) => dados.delete(k),
    clear: () => dados.clear(),
  };
}

describe('corrida e memoria de fontes', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', criarStorage());
  });

  it('coloca a fonte lembrada em primeiro na fila', async () => {
    lembrarFonteBoa('Globo', 'https://b.com/live.m3u8');
    const resultado = await ordenarFontes('Globo', [
      'https://a.com/live.m3u8',
      'https://b.com/live.m3u8',
    ]);

    expect(resultado).toEqual([
      'https://b.com/live.m3u8',
      'https://a.com/live.m3u8',
    ]);
  });

  it('esquece a fonte lembrada quando ela falha ao tocar', () => {
    lembrarFonteBoa('Globo', 'https://ruim.com/live.m3u8');
    esquecerFonte('Globo', 'https://outra.com/live.m3u8');
    expect(localStorage.getItem('tvdavovo_fonte_boa')).toContain('ruim.com');

    esquecerFonte('Globo', 'https://ruim.com/live.m3u8');
    expect(JSON.parse(localStorage.getItem('tvdavovo_fonte_boa') || '{}')).toEqual({});
  });

  it('limpa caches antigos uma unica vez na troca de versao', () => {
    localStorage.setItem('tvdavovo_fonte_boa', '{"Globo":"http://antigo"}');
    localStorage.setItem('vovo_tv_health', '{"http://antigo":{"status":"dead"}}');

    limparCacheAntigoDeFontes('2');
    expect(localStorage.getItem('tvdavovo_fonte_boa')).toBeNull();
    expect(localStorage.getItem('vovo_tv_health')).toBeNull();
    expect(localStorage.getItem('tvdavovo_cache_ver')).toBe('2');

    // Na segunda chamada com mesma versao nao apaga memorias novas
    localStorage.setItem('tvdavovo_fonte_boa', '{"Globo":"https://novo"}');
    limparCacheAntigoDeFontes('2');
    expect(localStorage.getItem('tvdavovo_fonte_boa')).toBe('{"Globo":"https://novo"}');

    // Nova versao de cache volta a limpar links antigos
    limparCacheAntigoDeFontes('3');
    expect(localStorage.getItem('tvdavovo_fonte_boa')).toBeNull();
    expect(localStorage.getItem('tvdavovo_cache_ver')).toBe('3');
  });

  it('auto-melhora ordem das reservas por historico e esquece fonte com falhas seguidas', async () => {
    lembrarFonteBoa('SBT', 'https://a.com/live.m3u8', 900);
    registrarDesempenhoFonte('https://c.com/live.m3u8', true, 120);
    registrarDesempenhoFonte('https://c.com/live.m3u8', true, 140);
    registrarDesempenhoFonte('https://b.com/live.m3u8', false);

    const ordemInicial = await ordenarFontes('SBT', [
      'https://a.com/live.m3u8',
      'https://b.com/live.m3u8',
      'https://c.com/live.m3u8',
    ]);
    // Lembrada segue em 1o, mas a reserva mais rapida/estavel (c) sobe na frente da ruim (b)
    expect(ordemInicial).toEqual([
      'https://a.com/live.m3u8',
      'https://c.com/live.m3u8',
      'https://b.com/live.m3u8',
    ]);

    // Duas falhas seguidas na lembrada derrubam ela da memoria automaticamente
    registrarDesempenhoFonte('https://a.com/live.m3u8', false);
    registrarDesempenhoFonte('https://a.com/live.m3u8', false);
    expect(JSON.parse(localStorage.getItem('tvdavovo_fonte_boa') || '{}')).toEqual({});
    expect(lerDesempenhoFontes()['https://a.com/live.m3u8'].falhasSeguidas).toBe(2);
  });

  it('forcarCorrida reordena fontes pela resposta valida mais rapida e mais estavel', async () => {
    lembrarFonteBoa('Band', 'https://lenta.com/live.m3u8', 1800);

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        const u = String(input);
        if (u.includes('lenta')) {
          return new Response('#EXTM3U\n#EXTINF:-1,\nseg.ts\n', { status: 200 });
        }
        if (u.includes('quebrada')) {
          return new Response('<html>erro</html>', { status: 200 });
        }
        return new Response('#EXTM3U\n#EXTINF:-1,\nseg.ts\n', { status: 200 });
      })
    );

    registrarDesempenhoFonte('https://boa.com/live.m3u8', true, 150);
    const reordenada = await ordenarFontes(
      'Band',
      ['https://lenta.com/live.m3u8', 'https://quebrada.com/live.m3u8', 'https://boa.com/live.m3u8'],
      undefined,
      { forcarCorrida: true }
    );

    expect(reordenada[0]).toBe('https://boa.com/live.m3u8');
    expect(reordenada[reordenada.length - 1]).toBe('https://quebrada.com/live.m3u8');
    vi.unstubAllGlobals();
  });

  it('valida playlist HLS de verdade e segue variante mestre', () => {
    expect(STALE_MINUTES).toBe(10);
    expect(ehPlaylistHlsValida('<html>erro</html>')).toBe(false);
    expect(ehPlaylistHlsValida('#EXTM3U\n')).toBe(false);
    expect(ehPlaylistHlsValida('#EXTM3U\n#EXTINF:6.0,\nseg0.ts\n')).toBe(true);

    const master = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1200000\n720p/index.m3u8\n';
    expect(primeiraVarianteM3u8(master, 'https://cdn.exemplo.com/live/master.m3u8')).toBe(
      'https://cdn.exemplo.com/live/720p/index.m3u8'
    );
  });
});

describe('catalogo canais_abertos.json (SP / Mogi + Noticias)', () => {
  it('inclui os principais canais abertos de SP e canais de noticias', () => {
    const nomes = canais.map((c) => c.name);
    for (const essencial of [
      'Globo',
      'Record',
      'SBT',
      'Band',
      'RedeTV!',
      'TV Cultura',
      'TV Gazeta',
      'TV Brasil',
      'Record News',
      'CNN Brasil',
      'BandNews',
      'Jovem Pan News',
    ]) {
      expect(nomes).toContain(essencial);
    }
  });

  it('tem URLs validas sem placeholders em todos os canais', () => {
    expect(canais.length).toBeGreaterThanOrEqual(25);
    for (const c of canais) {
      expect(c.url.startsWith('http')).toBe(true);
      const fontes = c.sources && c.sources.length > 0 ? c.sources : [c.url];
      for (const u of fontes) {
        expect(u.startsWith('http')).toBe(true);
        expect(u).not.toContain('__PLUTO_JWT__');
        expect(u).not.toContain('[DEVICE_ID]');
      }
    }
  });
});

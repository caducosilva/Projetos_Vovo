import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ordenarFontes,
  lembrarFonteBoa,
  esquecerFonte,
  limparCacheAntigoDeFontes,
} from './corrida';
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

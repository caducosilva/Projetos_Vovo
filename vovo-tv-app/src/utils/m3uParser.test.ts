import { describe, it, expect } from 'vitest';
import { parseM3UContent } from './m3uParser';

describe('parseM3UContent', () => {
  it('le nome, logo, grupo e URL de uma entrada completa', () => {
    const lista = [
      '#EXTM3U',
      '#EXTINF:-1 tvg-id="Globo.br" tvg-logo="http://logo/globo.png" group-title="Abertos",Globo SP',
      'http://stream/globo.m3u8'
    ].join('\n');

    const canais = parseM3UContent(lista);

    expect(canais).toHaveLength(1);
    expect(canais[0].name).toBe('Globo SP');
    expect(canais[0].logo).toBe('http://logo/globo.png');
    expect(canais[0].group).toBe('Abertos');
    expect(canais[0].url).toBe('http://stream/globo.m3u8');
    expect(canais[0].isCustom).toBe(true);
  });

  it('le varias entradas seguidas', () => {
    const lista = [
      '#EXTM3U',
      '#EXTINF:-1,Canal A',
      'http://a',
      '#EXTINF:-1,Canal B',
      'http://b'
    ].join('\n');

    expect(parseM3UContent(lista).map((c) => c.name)).toEqual(['Canal A', 'Canal B']);
  });

  it('aceita quebra de linha do Windows', () => {
    const lista = '#EXTM3U\r\n#EXTINF:-1,Canal A\r\nhttp://a\r\n';
    expect(parseM3UContent(lista)).toHaveLength(1);
  });

  it('ignora entrada sem URL logo abaixo', () => {
    const lista = ['#EXTINF:-1,Sem endereco', '#EXTINF:-1,Com endereco', 'http://b'].join('\n');
    const canais = parseM3UContent(lista);
    expect(canais).toHaveLength(1);
    expect(canais[0].name).toBe('Com endereco');
  });

  it('devolve lista vazia para conteudo que nao e M3U', () => {
    expect(parseM3UContent('isso aqui nao e uma lista')).toEqual([]);
    expect(parseM3UContent('')).toEqual([]);
  });

  it('marca o pais pelo sufixo do tvg-id', () => {
    const lista = '#EXTINF:-1 tvg-id="RTP.pt",RTP\nhttp://rtp';
    expect(parseM3UContent(lista)[0].country).toBe('pt');
  });
});

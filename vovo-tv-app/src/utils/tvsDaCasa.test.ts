import { describe, expect, it } from 'vitest';
import { avisarFormato, type TvNaRede } from './tvsDaCasa';

const chromecast: TvNaRede = { id: '1', name: 'TV da Sala', kind: 'chromecast' };
const dlna: TvNaRede = { id: '2', name: 'Xbox', kind: 'dlna' };

describe('avisarFormato', () => {
  it('nao assusta a vovo quando a TV e Chromecast', () => {
    // O Chromecast abre HLS numa boa: era o aviso aparecendo aqui que fazia a
    // tela dizer "pode nao funcionar" justo no caminho que funciona.
    expect(avisarFormato(chromecast, 'http://servidor/canal/index.m3u8')).toBe(false);
  });

  it('avisa quando so tem DLNA e o canal e HLS', () => {
    expect(avisarFormato(dlna, 'http://servidor/canal/index.m3u8')).toBe(true);
    expect(avisarFormato(dlna, 'http://servidor/canal/index.m3u8?token=123')).toBe(true);
  });

  it('nao avisa no DLNA quando o canal nao e HLS', () => {
    expect(avisarFormato(dlna, 'http://servidor/radio.mp3')).toBe(false);
  });
});

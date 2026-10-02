import { describe, it, expect } from 'vitest';
import { escolherNivel, rotuloDaQualidade } from './qualidade';
import type { NivelDeVideo } from './qualidade';

function nivel(parcial: Partial<NivelDeVideo>): NivelDeVideo {
  return { height: 0, width: 0, bitrate: 0, frameRate: 0, ...parcial };
}

describe('escolherNivel', () => {
  it('pega 720p na bucha quando o canal oferece', () => {
    const escolha = escolherNivel([
      nivel({ height: 360, bitrate: 800_000 }),
      nivel({ height: 480, bitrate: 1_400_000 }),
      nivel({ height: 720, bitrate: 2_800_000 }),
      nivel({ height: 1080, bitrate: 5_000_000 })
    ]);
    expect(escolha.indice).toBe(2);
    expect(escolha.altura).toBe(720);
    expect(escolha.estimada).toBe(false);
  });

  it('sem 720p, prefere 1080p a 480p (na TV fica melhor reduzido que esticado)', () => {
    const escolha = escolherNivel([
      nivel({ height: 360, bitrate: 800_000 }),
      nivel({ height: 480, bitrate: 1_400_000 }),
      nivel({ height: 1080, bitrate: 5_000_000 })
    ]);
    expect(escolha.altura).toBe(1080);
    expect(escolha.indice).toBe(2);
  });

  it('canal que so tem faixa baixa fica com a melhor que existe', () => {
    const escolha = escolherNivel([
      nivel({ height: 240, bitrate: 400_000 }),
      nivel({ height: 480, bitrate: 1_200_000 })
    ]);
    expect(escolha.altura).toBe(480);
    expect(escolha.indice).toBe(1);
  });

  it('escolhe pelo bitrate quando o manifesto nao declara resolucao (Pluto TV)', () => {
    // ladder real do Pluto: 640930 = 234p ... 3321280 = 1280x720
    const escolha = escolherNivel([
      nivel({ bitrate: 640_930 }),
      nivel({ bitrate: 1_042_180 }),
      nivel({ bitrate: 1_577_180 }),
      nivel({ bitrate: 2_294_080 }),
      nivel({ bitrate: 3_321_280 })
    ]);
    expect(escolha.indice).toBe(4);
    expect(escolha.estimada).toBe(true);
  });

  it('sem resolucao declarada, ignora faixa gorda demais para a TV', () => {
    const escolha = escolherNivel([
      nivel({ bitrate: 3_000_000 }),
      nivel({ bitrate: 12_000_000 })
    ]);
    expect(escolha.indice).toBe(0);
  });

  it('empate de altura: fica com a de fps que a TV aguenta', () => {
    const escolha = escolherNivel([
      nivel({ height: 720, bitrate: 6_000_000, frameRate: 60 }),
      nivel({ height: 720, bitrate: 2_800_000, frameRate: 30 })
    ]);
    expect(escolha.indice).toBe(1);
  });

  it('empate de altura e de fps: fica com o maior bitrate', () => {
    const escolha = escolherNivel([
      nivel({ height: 720, bitrate: 2_000_000, frameRate: 30 }),
      nivel({ height: 720, bitrate: 3_500_000, frameRate: 30 })
    ]);
    expect(escolha.indice).toBe(1);
  });

  it('canal de uma faixa so nao quebra', () => {
    const escolha = escolherNivel([nivel({ height: 1080, bitrate: 4_000_000 })]);
    expect(escolha.indice).toBe(0);
    expect(escolha.altura).toBe(1080);
  });

  it('lista vazia devolve -1 em vez de estourar', () => {
    expect(escolherNivel([]).indice).toBe(-1);
  });
});

describe('rotuloDaQualidade', () => {
  it('escreve a altura do jeito que se fala', () => {
    expect(rotuloDaQualidade(720)).toBe('720p');
    expect(rotuloDaQualidade(1080)).toBe('1080p');
    expect(rotuloDaQualidade(2160)).toBe('4K');
  });

  it('altura desconhecida nao vira etiqueta', () => {
    expect(rotuloDaQualidade(0)).toBe('');
  });
});

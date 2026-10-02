import { describe, it, expect } from 'vitest';
import {
  chaveDoCanal,
  ehFavorito,
  alternarFavorito,
  canaisFavoritos,
  mesclarFavoritos
} from './favoritos';
import type { Channel } from '../types';

function canal(parcial: Partial<Channel>): Channel {
  return {
    id: 'id',
    name: 'Canal',
    logo: '',
    group: '',
    country: 'br',
    url: 'http://x',
    ...parcial
  };
}

describe('chaveDoCanal', () => {
  it('usa o id, que sobrevive a troca de URL do provedor', () => {
    expect(chaveDoCanal(canal({ id: 'Globo.br', url: 'http://um' }))).toBe('Globo.br');
  });

  it('canal velho sem id cai na URL', () => {
    expect(chaveDoCanal(canal({ id: '', url: 'http://um' }))).toBe('http://um');
  });
});

describe('alternarFavorito', () => {
  it('marca no fim da lista, preservando a ordem de quem ja estava', () => {
    const lista = alternarFavorito(['A'], canal({ id: 'B' }));
    expect(lista).toEqual(['A', 'B']);
  });

  it('marcar de novo desmarca', () => {
    expect(alternarFavorito(['A', 'B'], canal({ id: 'A' }))).toEqual(['B']);
  });

  it('nao mexe na lista que recebeu', () => {
    const original = ['A'];
    alternarFavorito(original, canal({ id: 'B' }));
    expect(original).toEqual(['A']);
  });

  it('canal sem id e sem URL nao entra', () => {
    expect(alternarFavorito([], canal({ id: '', url: '' }))).toEqual([]);
  });
});

describe('ehFavorito', () => {
  it('responde pela chave do canal', () => {
    expect(ehFavorito(['Globo.br'], canal({ id: 'Globo.br' }))).toBe(true);
    expect(ehFavorito(['Globo.br'], canal({ id: 'SBT.br' }))).toBe(false);
  });

  it('sem canal aberto, nao e favorito', () => {
    expect(ehFavorito(['A'], null)).toBe(false);
  });
});

describe('canaisFavoritos', () => {
  it('devolve na ordem em que foram marcados, nao na ordem da grade', () => {
    const grade = [canal({ id: 'A' }), canal({ id: 'B' }), canal({ id: 'C' })];
    const saida = canaisFavoritos(grade, ['C', 'A']);
    expect(saida.map((c) => c.id)).toEqual(['C', 'A']);
  });

  it('favorito de canal que saiu da lista some sem deixar buraco', () => {
    const grade = [canal({ id: 'A' })];
    expect(canaisFavoritos(grade, ['sumiu', 'A'])).toHaveLength(1);
  });
});

describe('mesclarFavoritos', () => {
  it('soma a semente do app ao que a TV ja tinha guardado', () => {
    expect(mesclarFavoritos(['naTV'], ['doPC1', 'doPC2'])).toEqual(['naTV', 'doPC1', 'doPC2']);
  });

  it('nao duplica o que ja estava marcado nos dois lados', () => {
    expect(mesclarFavoritos(['igual', 'soNaTV'], ['igual', 'novo'])).toEqual([
      'igual',
      'soNaTV',
      'novo'
    ]);
  });

  it('preserva a ordem de quem marcou na TV', () => {
    // atualizar o app nao pode embaralhar a lista que a pessoa montou
    expect(mesclarFavoritos(['c', 'a', 'b'], ['a'])).toEqual(['c', 'a', 'b']);
  });

  it('sem semente, devolve o que ja havia', () => {
    expect(mesclarFavoritos(['a', 'b'], [])).toEqual(['a', 'b']);
  });

  it('nao mexe na lista que recebeu', () => {
    const original = ['a'];
    mesclarFavoritos(original, ['b']);
    expect(original).toEqual(['a']);
  });
});

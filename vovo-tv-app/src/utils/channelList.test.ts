import { describe, it, expect } from 'vitest';
import { dedupe, migrarFavoritos } from './channelList';
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

describe('dedupe', () => {
  it('mantem so a primeira ocorrencia de cada URL', () => {
    const saida = dedupe([
      canal({ name: 'A', url: 'http://um' }),
      canal({ name: 'B', url: 'http://um' }),
      canal({ name: 'C', url: 'http://dois' })
    ]);

    expect(saida).toHaveLength(2);
    expect(saida[0].name).toBe('A');
    expect(saida[1].name).toBe('C');
  });

  it('descarta canal sem URL, que nunca tocaria', () => {
    const saida = dedupe([canal({ url: '' }), canal({ url: '   ' }), canal({ url: 'http://ok' })]);
    expect(saida).toHaveLength(1);
  });

  it('trata URL com espaco em volta como a mesma', () => {
    const saida = dedupe([canal({ url: 'http://um' }), canal({ url: '  http://um  ' })]);
    expect(saida).toHaveLength(1);
  });
});

describe('migrarFavoritos', () => {
  const lista = [
    canal({ id: 'record', name: 'Record 1', url: 'http://record-1' }),
    canal({ id: 'record', name: 'Record 2', url: 'http://record-2' }),
    canal({ id: 'globo', name: 'Globo', url: 'http://globo' })
  ];

  it('mantem favorito que ja era URL', () => {
    expect(migrarFavoritos(['http://globo'], lista)).toEqual(['http://globo']);
  });

  it('converte favorito antigo salvo por id para a primeira URL daquele id', () => {
    expect(migrarFavoritos(['record'], lista)).toEqual(['http://record-1']);
  });

  it('nao marca os onze canais que dividem o mesmo id', () => {
    const saida = migrarFavoritos(['record'], lista);
    expect(saida).toHaveLength(1);
    expect(saida).not.toContain('http://record-2');
  });

  it('descarta favorito de canal que sumiu da lista', () => {
    expect(migrarFavoritos(['http://nao-existe'], lista)).toEqual([]);
  });

  it('nao repete quando o mesmo canal aparece por id e por URL', () => {
    expect(migrarFavoritos(['record', 'http://record-1'], lista)).toEqual(['http://record-1']);
  });

  it('devolve vazio para entrada vazia', () => {
    expect(migrarFavoritos([], lista)).toEqual([]);
  });
});

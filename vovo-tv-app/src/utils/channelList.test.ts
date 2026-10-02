import { describe, it, expect } from 'vitest';
import { dedupe } from './channelList';
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

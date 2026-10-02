import { describe, it, expect } from 'vitest';
import { agoraEDepois } from './programacao';

const p = (titulo: string, inicio: number, fim?: number) => ({ titulo, inicio, fim });

describe('agoraEDepois', () => {
  const guia = [p('Jornal', 100, 200), p('Novela', 200, 300), p('Filme', 300)];

  it('acha o programa no ar e o seguinte', () => {
    expect(agoraEDepois(guia, 250)).toEqual({ agora: guia[1], depois: guia[2] });
  });

  it('ultimo programa sem fim continua valendo', () => {
    expect(agoraEDepois(guia, 999)).toEqual({ agora: guia[2], depois: undefined });
  });

  it('antes do primeiro: so o proximo', () => {
    expect(agoraEDepois(guia, 50)).toEqual({ depois: guia[0] });
  });

  it('guia vencido nao mostra nada', () => {
    expect(agoraEDepois([p('Velho', 100, 200)], 500)).toEqual({});
  });
});

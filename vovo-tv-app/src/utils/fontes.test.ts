import { describe, it, expect } from 'vitest';
import { fontesDoCanal, saudeDoCanal, compararPorNome } from './fontes';
import type { Channel } from '../types';
import type { HealthMap } from './health';

function canal(extra: Partial<Channel> = {}): Channel {
  return {
    id: 'x',
    name: 'Canal',
    logo: '',
    group: 'Abertos',
    country: 'br',
    url: 'http://a/1.m3u8',
    ...extra,
  };
}

function entrada(status: 'ok' | 'dead' | 'confirmed' | 'doubt', signal: number): HealthMap[string] {
  return {
    status,
    signal,
    fail_count: 0,
    ok_count: 0,
    confirmed: status === 'confirmed',
    last_check: '',
    last_error: '',
    class: '',
  };
}

describe('fontesDoCanal', () => {
  it('usa a url quando o canal nao tem lista de fontes', () => {
    expect(fontesDoCanal(canal())).toEqual(['http://a/1.m3u8']);
  });

  it('devolve as fontes na ordem gravada, sem repetir url', () => {
    const c = canal({ sources: ['http://a/1.m3u8', 'http://b/2.m3u8', 'http://a/1.m3u8'] });
    expect(fontesDoCanal(c)).toEqual(['http://a/1.m3u8', 'http://b/2.m3u8']);
  });

  it('nunca devolve vazio, mesmo com sources so de lixo', () => {
    expect(fontesDoCanal(canal({ sources: ['', '  '] }))).toEqual(['http://a/1.m3u8']);
  });
});

describe('saudeDoCanal', () => {
  const c = canal({ sources: ['http://a/1.m3u8', 'http://b/2.m3u8', 'http://c/3.m3u8'] });

  it('vale a melhor fonte, nao a primeira', () => {
    const health: HealthMap = {
      'http://a/1.m3u8': entrada('dead', 0),
      'http://b/2.m3u8': entrada('ok', 70),
    };
    const saude = saudeDoCanal(c, health);
    expect(saude.status).toBe('ok');
    expect(saude.signal).toBe(70);
    expect(saude.todasMortas).toBe(false);
  });

  it('so marca o canal como morto quando TODAS as fontes morreram', () => {
    const health: HealthMap = {
      'http://a/1.m3u8': entrada('dead', 0),
      'http://b/2.m3u8': entrada('dead', 0),
      'http://c/3.m3u8': entrada('dead', 0),
    };
    const saude = saudeDoCanal(c, health);
    expect(saude.status).toBe('dead');
    expect(saude.todasMortas).toBe(true);
  });

  it('confirmado ganha de ok mesmo com sinal menor', () => {
    const health: HealthMap = {
      'http://a/1.m3u8': entrada('ok', 90),
      'http://b/2.m3u8': entrada('confirmed', 40),
    };
    expect(saudeDoCanal(c, health).status).toBe('confirmed');
  });
});

describe('compararPorNome', () => {
  it('ordena ignorando acento e caixa', () => {
    const nomes = ['Zebra', 'Área', 'ARARA', 'ábaco']
      .map((name) => canal({ name }))
      .sort(compararPorNome)
      .map((c) => c.name);
    expect(nomes).toEqual(['ábaco', 'ARARA', 'Área', 'Zebra']);
  });

  it('trata numero como numero', () => {
    const nomes = ['Canal 10', 'Canal 2']
      .map((name) => canal({ name }))
      .sort(compararPorNome)
      .map((c) => c.name);
    expect(nomes).toEqual(['Canal 2', 'Canal 10']);
  });
});

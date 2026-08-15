import { describe, it, expect } from 'vitest';
import {
  cleanChannelName,
  channelInitials,
  channelColor,
  isRadioChannel,
  ehImagemRemovida
} from './channelName';

describe('cleanChannelName', () => {
  it('tira o sufixo de resolucao entre parenteses', () => {
    expect(cleanChannelName('WooHoo (720p)')).toBe('WooHoo');
    expect(cleanChannelName('TV Cultura (1080p)')).toBe('TV Cultura');
    expect(cleanChannelName('Band [HD]')).toBe('Band');
  });

  it('tira a resolucao presa por hifen ou barra', () => {
    expect(cleanChannelName('Globo SP - FHD')).toBe('Globo SP');
    expect(cleanChannelName('Record | 720p')).toBe('Record');
  });

  it('tira emoji do comeco, que a vovo le como caractere quebrado', () => {
    expect(cleanChannelName('📻 Alpha FM')).toBe('Alpha FM');
    expect(cleanChannelName('⭐ Favorito')).toBe('Favorito');
  });

  it('tira aviso tecnico em ingles que a vovo nao entende', () => {
    expect(cleanChannelName('+SBT Novelas [Geo-blocked]')).toBe('+SBT Novelas');
    expect(cleanChannelName('Canal X [Not 24/7]')).toBe('Canal X');
    expect(cleanChannelName('Canal Y (Offline)')).toBe('Canal Y');
  });

  it('nao confunde aviso tecnico com parte do nome', () => {
    expect(cleanChannelName('Rádio Backup Sertanejo')).toBe('Rádio Backup Sertanejo');
  });

  it('nao devolve vazio quando o nome era so ruido', () => {
    expect(cleanChannelName('(720p)')).toBe('(720p)');
    expect(cleanChannelName('')).toBe('Canal');
  });

  it('preserva nome que ja estava limpo', () => {
    expect(cleanChannelName('SBT Interior')).toBe('SBT Interior');
  });

  it('nao come numero que faz parte do nome', () => {
    expect(cleanChannelName('98 FM Belo Horizonte')).toBe('98 FM Belo Horizonte');
    expect(cleanChannelName('89 Rock')).toBe('89 Rock');
  });
});

describe('channelInitials', () => {
  it('usa as iniciais das duas primeiras palavras', () => {
    expect(channelInitials('TV Cultura')).toBe('TC');
    expect(channelInitials('Jovem Pan News')).toBe('JP');
  });

  it('usa as duas primeiras letras quando so tem uma palavra', () => {
    expect(channelInitials('Globo')).toBe('GL');
  });

  it('cai no padrao quando nao sobra letra nenhuma', () => {
    expect(channelInitials('')).toBe('TV');
    expect(channelInitials('---')).toBe('TV');
  });

  it('ignora a resolucao ao montar a inicial', () => {
    expect(channelInitials('AgroMais (720p)')).toBe('AG');
  });
});

describe('channelColor', () => {
  it('devolve sempre a mesma cor para o mesmo canal', () => {
    expect(channelColor('http://a/x.m3u8')).toBe(channelColor('http://a/x.m3u8'));
  });

  it('devolve uma cor valida do conjunto', () => {
    expect(channelColor('qualquer coisa')).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('ehImagemRemovida', () => {
  it('reconhece o aviso do imgur pela medida exata', () => {
    expect(ehImagemRemovida(161, 81)).toBe(true);
  });

  it('nao derruba logo pequeno de verdade', () => {
    // A Adesso TV foi derrubada por um limite generoso durante o teste manual
    expect(ehImagemRemovida(160, 90)).toBe(false);
    expect(ehImagemRemovida(120, 60)).toBe(false);
    expect(ehImagemRemovida(161, 80)).toBe(false);
  });

  it('nao derruba logo grande', () => {
    expect(ehImagemRemovida(512, 512)).toBe(false);
  });
});

describe('isRadioChannel', () => {
  it('reconhece pela marcacao explicita', () => {
    expect(isRadioChannel({ isRadio: true, group: '', name: 'X' })).toBe(true);
  });

  it('reconhece pelo grupo, com e sem acento', () => {
    expect(isRadioChannel({ isRadio: false, group: 'Rádios SP', name: 'X' })).toBe(true);
    expect(isRadioChannel({ isRadio: false, group: 'Radios MG', name: 'X' })).toBe(true);
  });

  it('reconhece pelo emoji no nome', () => {
    expect(isRadioChannel({ isRadio: false, group: '', name: '📻 Itatiaia' })).toBe(true);
  });

  it('nao confunde canal de TV com radio', () => {
    expect(isRadioChannel({ isRadio: false, group: 'Abertos', name: 'Globo' })).toBe(false);
    expect(isRadioChannel(null)).toBe(false);
  });
});

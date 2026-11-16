import { describe, it, expect } from 'vitest';
import {
  agoraEDepois,
  horarioDoPrograma,
  parsearDataXmlTv,
  parsearMeuGuiaHtml,
  parsearXmlTvParaCanal,
  progressoDoPrograma
} from './programacao';

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

describe('parsearMeuGuiaHtml', () => {
  it('le subcabecalho de dia, horarios de inicio e fim e ignora comentarios ERB', () => {
    const html = `
      <ul>
        <li class="subheader devicepadding">domingo, 15/11</li>
        <!-- <a title="Ignorado"><div class='lileft time'>01:00</div><div class="licontent"><h2>ERB</h2></div></a> -->
        <li>
          <a title="Fantastico" class="devicepadding">
            <div class='lileft time'>20:45</div>
            <div class="licontent"><h2>Fant&aacute;stico</h2></div>
          </a>
        </li>
        <li>
          <a title="Ney" class="devicepadding">
            <div class='lileft time'>23:35</div>
            <div class="licontent"><h2>Por Dentro &amp; Especial</h2></div>
          </a>
        </li>
        <li class="subheader devicepadding">segunda-feira, 16/11</li>
        <li>
          <a title="Domingo Maior" class="devicepadding">
            <div class='lileft time'>00:40</div>
            <div class="licontent"><h2>Domingo Maior</h2></div>
          </a>
        </li>
      </ul>
    `;
    const refMs = Date.UTC(2026, 10, 16, 1, 0, 0); // 2026-11-15 22:00 BRT
    const programas = parsearMeuGuiaHtml(html, refMs);
    expect(programas).toHaveLength(3);
    expect(programas[0].titulo).toBe('Fantástico');
    expect(programas[0].inicio).toBe(Date.UTC(2026, 10, 15, 23, 45, 0)); // 20:45 BRT
    expect(programas[0].fim).toBe(Date.UTC(2026, 10, 16, 2, 35, 0)); // 23:35 BRT
    expect(programas[1].titulo).toBe('Por Dentro & Especial');
    expect(programas[1].fim).toBe(Date.UTC(2026, 10, 16, 3, 40, 0)); // 00:40 BRT do dia 16

    const atual = agoraEDepois(programas, refMs);
    expect(atual.agora?.inicio).toBe(programas[0].inicio);
    expect(atual.agora?.fim).toBe(programas[0].fim);
    expect(atual.depois?.titulo).toBe('Por Dentro & Especial');
  });
});

describe('parsearXmlTvParaCanal', () => {
  it('extrai inicio e termino exatos em UTC/BRT do canal', () => {
    const xml = `
      <tv>
        <programme start="20261115200000 -0300" stop="20261115220000 -0300" channel="CNN.br">
          <title>CNN Prime</title>
        </programme>
        <programme start="20261115220000 -0300" stop="20261115230000 -0300" channel="CNN.br">
          <title>WW &amp; Debate</title>
        </programme>
        <programme start="20261115220000 -0300" stop="20261115230000 -0300" channel="Outro">
          <title>Outro Canal</title>
        </programme>
      </tv>
    `;
    const lista = parsearXmlTvParaCanal(xml, 'CNN.br');
    expect(lista).toHaveLength(2);
    expect(lista[0].inicio).toBe(parsearDataXmlTv('20261115200000 -0300'));
    expect(lista[0].fim).toBe(parsearDataXmlTv('20261115220000 -0300'));
    expect(lista[1].titulo).toBe('WW & Debate');
  });
});

describe('progressoDoPrograma e horarioDoPrograma', () => {
  it('calcula porcentagem e formata faixa de horario', () => {
    const prog = p('Jornal', Date.UTC(2026, 10, 15, 23, 0, 0), Date.UTC(2026, 10, 16, 0, 0, 0));
    expect(progressoDoPrograma(prog, Date.UTC(2026, 10, 15, 23, 30, 0))).toBe(50);
    expect(progressoDoPrograma({ titulo: 'Livre', inicio: 100 })).toBeNull();
    expect(horarioDoPrograma(prog)).toMatch(/^Das \d{2}:\d{2} às \d{2}:\d{2}$/);
    expect(horarioDoPrograma({ titulo: 'Livre', inicio: Date.UTC(2026, 10, 15, 23, 0, 0) })).toMatch(
      /^Começou às \d{2}:\d{2}$/
    );
  });
});

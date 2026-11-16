import { beforeEach, describe, expect, it, vi } from 'vitest';
import { carregarCanaisEmCache, validarCanaisRemotos } from './canaisRemotos';

function criarStorage() {
  const dados = new Map<string, string>();
  return {
    getItem: (k: string) => dados.get(k) ?? null,
    setItem: (k: string, v: string) => dados.set(k, v),
    removeItem: (k: string) => dados.delete(k),
    clear: () => dados.clear()
  };
}

describe('canaisRemotos', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', criarStorage());
  });

  it('valida lista remota mantendo canais com nome e URL http', () => {
    const lista = validarCanaisRemotos([
      { id: 'Globo', name: 'Globo', url: 'https://exemplo/globo.m3u8' },
      { id: 'Quebrado', name: '', url: 'https://x' },
      { id: 'SemUrl', name: 'Record', url: 'ftp://invalido' }
    ]);
    expect(lista).toHaveLength(1);
    expect(lista?.[0].id).toBe('Globo');
  });

  it('devolve null quando JSON remoto esta vazio ou corrompido', () => {
    expect(validarCanaisRemotos([])).toBeNull();
    expect(validarCanaisRemotos({ ok: true })).toBeNull();
  });

  it('le cache valido de canais remotos e ignora lixo', () => {
    localStorage.setItem('clarice_tv_canais_remotos', '{invalido');
    expect(carregarCanaisEmCache()).toBeNull();

    localStorage.setItem(
      'clarice_tv_canais_remotos',
      JSON.stringify([{ id: 'SBT', name: 'SBT', url: 'https://exemplo/sbt.m3u8' }])
    );
    expect(carregarCanaisEmCache()).toHaveLength(1);
  });
});

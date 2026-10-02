import { useCallback, useEffect, useState } from 'react';
import Inicio, { type Destino } from './telas/Inicio';
import TvAberta from './telas/TvAberta';
import CineZap from './telas/CineZap';
import { UpdatePrompt } from './components/UpdatePrompt';
import { checkForUpdate, type AvailableUpdate } from './utils/updater';
import { tv } from './utils/tvBridge';

type Tela = 'inicio' | Destino;

/**
 * TV da Vovo: um app so com as duas TVs.
 *
 *   inicio  -> dois botoes grandes: TV Aberta ou Cine Zap
 *   abertos -> canais abertos (liga direto na Globo, Voltar mostra a grade)
 *   cine    -> canais de filme, serie e desenho, no estilo zapear
 *
 * Voltar dentro de qualquer uma das duas traz de volta para o inicio. Quem
 * desliga o app e o inicio, com Voltar duas vezes.
 */
export default function App() {
  const [tela, setTela] = useState<Tela>('inicio');
  const [atualizacao, setAtualizacao] = useState<AvailableUpdate | null>(null);

  const voltarInicio = useCallback(() => setTela('inicio'), []);

  // escala de TV (ver index.css, html.tv)
  useEffect(() => {
    tv.getDeviceType().then((r) => {
      if (r?.isTv) document.documentElement.classList.add('tv');
    });
  }, []);

  useEffect(() => {
    checkForUpdate().then((nova) => {
      if (nova) setAtualizacao(nova);
    });
  }, []);

  return (
    <>
      {tela === 'inicio' && <Inicio onEscolher={setTela} />}
      {tela === 'abertos' && <TvAberta onVoltarInicio={voltarInicio} />}
      {tela === 'cine' && <CineZap onVoltar={voltarInicio} />}
      <UpdatePrompt update={atualizacao} onDismiss={() => setAtualizacao(null)} />
    </>
  );
}

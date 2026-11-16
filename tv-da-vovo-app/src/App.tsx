import { useCallback, useEffect, useState } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import TvAberta from './telas/TvAberta';
import { UpdatePrompt } from './components/UpdatePrompt';
import { checkForUpdate, type AvailableUpdate } from './utils/updater';
import { tv } from './utils/tvBridge';

/**
 * CLARICE TV: acesso direto aos canais abertos de SP/Mogi das Cruzes e noticias.
 */
export default function App() {
  const [atualizacao, setAtualizacao] = useState<AvailableUpdate | null>(null);

  const sairDoApp = useCallback(() => {
    tv.exitApp();
  }, []);

  // Mantem a tela sempre ligada em qualquer tela do app enquanto estiver aberto
  useEffect(() => {
    void tv.keepAwake(true);
    tv.getDeviceType().then((r) => {
      if (r?.isTv) document.documentElement.classList.add('tv');
    });
  }, []);

  useEffect(() => {
    let ativo = true;
    const checar = () => {
      void tv.keepAwake(true);
      void checkForUpdate(true).then((nova) => {
        if (ativo && nova) setAtualizacao(nova);
      });
    };

    checar();

    let remover: (() => void) | null = null;
    CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive) checar();
    })
      .then((h) => {
        if (!ativo) h.remove();
        else remover = () => h.remove();
      })
      .catch(() => undefined);

    return () => {
      ativo = false;
      if (remover) remover();
    };
  }, []);

  return (
    <>
      <TvAberta onVoltarInicio={sairDoApp} />
      <UpdatePrompt update={atualizacao} onDismiss={() => setAtualizacao(null)} />
    </>
  );
}

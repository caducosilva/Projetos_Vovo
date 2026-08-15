import React, { useState } from 'react';
import { Download, ShieldCheck, AlertTriangle, Loader2 } from 'lucide-react';
import {
  canInstallApks,
  downloadAndInstall,
  openInstallPermission,
  skipVersion,
  type AvailableUpdate
} from '../utils/updater';
import { Sheet } from './Sheet';

interface UpdatePromptProps {
  update: AvailableUpdate | null;
  onDismiss: () => void;
}

type Fase =
  | { nome: 'perguntando' }
  | { nome: 'permissao' }
  | { nome: 'baixando'; percentual: number }
  | { nome: 'erro'; mensagem: string };

/**
 * Aviso de versao nova.
 *
 * Baixa e instala sem sair do app porque ele nao vive na Play Store, e o
 * caminho normal (abrir navegador, achar a pasta de downloads, tocar no
 * arquivo, liberar origem desconhecida) tem passos demais para a vovo.
 */
export const UpdatePrompt: React.FC<UpdatePromptProps> = ({ update, onDismiss }) => {
  const [fase, setFase] = useState<Fase>({ nome: 'perguntando' });

  if (!update) return null;

  const atualizar = async () => {
    if (!(await canInstallApks())) {
      setFase({ nome: 'permissao' });
      return;
    }

    setFase({ nome: 'baixando', percentual: 0 });
    try {
      await downloadAndInstall(update.apkUrl, (percentual) => {
        setFase({ nome: 'baixando', percentual });
      });
      // O instalador do Android assume daqui; o app fica parado atras dele.
    } catch (error) {
      setFase({
        nome: 'erro',
        mensagem: error instanceof Error ? error.message : 'Nao consegui baixar a atualizacao.'
      });
    }
  };

  const agoraNao = () => {
    skipVersion(update.versionCode);
    onDismiss();
  };

  const baixando = fase.nome === 'baixando';

  return (
    <Sheet
      isOpen
      title="Tem uma versão nova"
      subtitle={`Vovó TV ${update.versionName}`}
      onClose={baixando ? () => undefined : agoraNao}
      footer={
        fase.nome === 'perguntando' || fase.nome === 'erro' ? (
          <div className="flex flex-col gap-2.5 pb-2">
            <button
              onClick={atualizar}
              className="flex h-16 w-full items-center justify-center gap-2 rounded-2xl bg-sol-400 text-xl font-black text-noite-900 transition active:scale-95"
            >
              <Download className="h-7 w-7" strokeWidth={2.5} />
              Atualizar agora
            </button>
            <button
              onClick={agoraNao}
              className="flex h-toque w-full items-center justify-center rounded-2xl border-2 border-noite-500 bg-noite-700 text-lg font-black text-tinta-300 transition active:scale-95"
            >
              Agora não
            </button>
          </div>
        ) : undefined
      }
    >
      {fase.nome === 'perguntando' && (
        <div className="flex flex-col items-center gap-5 py-6 text-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-sol-400/15 text-sol-400">
            <ShieldCheck className="h-11 w-11" strokeWidth={2.5} />
          </div>
          <p className="max-w-md text-lg leading-relaxed font-bold text-tinta-100">{update.notes}</p>
          <p className="text-base text-tinta-300">O app baixa e instala sozinho. É seguro.</p>
        </div>
      )}

      {fase.nome === 'permissao' && (
        <div className="flex flex-col items-center gap-5 py-6 text-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-alerta-400/15 text-alerta-400">
            <AlertTriangle className="h-11 w-11" strokeWidth={2.5} />
          </div>
          <p className="max-w-md text-lg leading-snug font-bold text-tinta-100">
            O Android precisa da sua permissão para instalar a atualização.
          </p>
          <p className="max-w-md text-base leading-snug text-tinta-300">
            Toque no botão abaixo e ligue a chave que aparecer. Depois volte aqui e toque em
            Atualizar agora.
          </p>
          <button
            onClick={openInstallPermission}
            className="flex h-toque items-center gap-2 rounded-2xl bg-sol-400 px-6 text-xl font-black text-noite-900 transition active:scale-95"
          >
            Abrir a permissão
          </button>
          <button
            onClick={() => setFase({ nome: 'perguntando' })}
            className="text-lg font-black text-tinta-300 underline"
          >
            Já liberei, voltar
          </button>
        </div>
      )}

      {baixando && (
        <div className="flex flex-col items-center gap-5 py-10 text-center">
          <Loader2 className="h-14 w-14 animate-spin text-sol-400" strokeWidth={2.5} />
          <p className="text-2xl font-black text-tinta-100">Baixando... {fase.percentual}%</p>

          <div
            className="h-4 w-full max-w-sm overflow-hidden rounded-full bg-noite-700"
            role="progressbar"
            aria-valuenow={fase.percentual}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="h-full rounded-full bg-sol-400 transition-all duration-300"
              style={{ width: `${fase.percentual}%` }}
            />
          </div>

          <p className="text-base text-tinta-300">Não feche o app.</p>
        </div>
      )}

      {fase.nome === 'erro' && (
        <div className="flex flex-col items-center gap-5 py-6 text-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-morto-400/15 text-morto-400">
            <AlertTriangle className="h-11 w-11" strokeWidth={2.5} />
          </div>
          <p className="max-w-md text-lg leading-snug font-black text-tinta-100">{fase.mensagem}</p>
          <p className="text-base text-tinta-300">O app continua funcionando normalmente.</p>
        </div>
      )}
    </Sheet>
  );
};

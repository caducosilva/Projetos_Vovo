import React, { useCallback, useEffect, useState } from 'react';
import { Cast, Tv, RotateCcw, AlertTriangle, Square, Loader2 } from 'lucide-react';
import {
  procurarTvs,
  mandarParaTv,
  pararNaTv,
  avisarFormato,
  type TvNaRede
} from '../utils/tvsDaCasa';
import { cleanChannelName } from '../utils/channelName';
import { Sheet } from './Sheet';

interface CastSheetProps {
  isOpen: boolean;
  channelName: string;
  channelUrl: string;
  onClose: () => void;
  /** Chamado quando a TV aceitou o canal, para o celular parar de tocar junto. */
  onFoiParaTv?: () => void;
}

type Estado =
  | { fase: 'procurando' }
  | { fase: 'lista'; aparelhos: TvNaRede[] }
  | { fase: 'enviando'; nome: string }
  | { fase: 'tocando'; nome: string; tv: TvNaRede }
  | { fase: 'erro'; mensagem: string };

/**
 * Espelhar o canal numa TV da mesma rede Wi-Fi.
 *
 * Toda a conversa com a TV (Chromecast ou DLNA) acontece nos plugins nativos;
 * aqui so existe a tela. O texto evita "DLNA", "renderer" e "transmitir": para
 * a vovo isso e "mandar para a TV".
 */
export const CastSheet: React.FC<CastSheetProps> = ({
  isOpen,
  channelName,
  channelUrl,
  onClose,
  onFoiParaTv
}) => {
  const [estado, setEstado] = useState<Estado>({ fase: 'procurando' });
  const nomeCanal = cleanChannelName(channelName);

  const procurar = useCallback(async () => {
    setEstado({ fase: 'procurando' });
    try {
      const aparelhos = await procurarTvs(5000);
      setEstado({ fase: 'lista', aparelhos });
    } catch (error) {
      setEstado({
        fase: 'erro',
        mensagem: error instanceof Error ? error.message : 'Nao consegui procurar TVs.'
      });
    }
  }, []);

  // Comeca a procurar assim que abre: um passo a menos para a vovo dar
  useEffect(() => {
    if (isOpen) procurar();
  }, [isOpen, procurar]);

  const enviar = async (aparelho: TvNaRede) => {
    setEstado({ fase: 'enviando', nome: aparelho.name });
    try {
      await mandarParaTv(aparelho, channelUrl, nomeCanal);
      setEstado({ fase: 'tocando', nome: aparelho.name, tv: aparelho });
      onFoiParaTv?.();
    } catch (error) {
      setEstado({
        fase: 'erro',
        mensagem: error instanceof Error ? error.message : 'A TV nao aceitou o canal.'
      });
    }
  };

  const parar = async (tv: TvNaRede) => {
    try {
      await pararNaTv(tv);
    } catch {
      /* a TV pode ter sido desligada na mao; parar mesmo assim na tela */
    }
    procurar();
  };

  return (
    <Sheet isOpen={isOpen} title="Mandar para a TV" subtitle={nomeCanal} onClose={onClose}>
      {estado.fase === 'lista' &&
        estado.aparelhos.length > 0 &&
        estado.aparelhos.every((tv) => avisarFormato(tv, channelUrl)) && (
        <div className="mb-4 flex gap-3 rounded-2xl border-2 border-alerta-400/40 bg-alerta-400/10 p-4">
          <AlertTriangle className="h-7 w-7 shrink-0 text-alerta-400" strokeWidth={2.5} />
          <p className="text-base leading-snug font-bold text-tinta-100">
            Este canal usa um formato que algumas TVs não abrem. Se a tela ficar parada, assista
            pelo celular mesmo.
          </p>
        </div>
      )}

      {estado.fase === 'procurando' && (
        <div className="flex flex-col items-center gap-4 py-14 text-center">
          <Loader2 className="h-14 w-14 animate-spin text-sol-400" strokeWidth={2.5} />
          <p className="text-xl font-black text-tinta-100">Procurando TVs...</p>
          <p className="max-w-sm text-base text-tinta-300">
            A TV precisa estar ligada e no mesmo Wi-Fi do celular.
          </p>
        </div>
      )}

      {estado.fase === 'enviando' && (
        <div className="flex flex-col items-center gap-4 py-14 text-center">
          <Loader2 className="h-14 w-14 animate-spin text-sol-400" strokeWidth={2.5} />
          <p className="text-xl font-black text-tinta-100">Mandando para a {estado.nome}...</p>
        </div>
      )}

      {estado.fase === 'tocando' && (
        <div className="flex flex-col items-center gap-5 py-12 text-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-vivo-400/15 text-vivo-400">
            <Cast className="h-11 w-11" strokeWidth={2.5} />
          </div>
          <div>
            <p className="text-2xl font-black text-tinta-100">Tocando na {estado.nome}</p>
            <p className="mt-1 text-base text-tinta-300">Você já pode guardar o celular.</p>
          </div>
          <button
            onClick={() => parar(estado.tv)}
            className="flex h-toque items-center gap-2 rounded-2xl bg-morto-400 px-6 text-xl font-black text-noite-900 transition active:scale-95"
          >
            <Square className="h-6 w-6 fill-current" />
            Parar na TV
          </button>
        </div>
      )}

      {estado.fase === 'erro' && (
        <div className="flex flex-col items-center gap-5 py-12 text-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-morto-400/15 text-morto-400">
            <AlertTriangle className="h-11 w-11" strokeWidth={2.5} />
          </div>
          <p className="max-w-sm text-xl leading-snug font-black text-tinta-100">
            {estado.mensagem}
          </p>
          <button
            onClick={procurar}
            className="flex h-toque items-center gap-2 rounded-2xl bg-sol-400 px-6 text-xl font-black text-noite-900 transition active:scale-95"
          >
            <RotateCcw className="h-6 w-6" strokeWidth={3} />
            Procurar de novo
          </button>
        </div>
      )}

      {estado.fase === 'lista' && estado.aparelhos.length === 0 && (
        <div className="flex flex-col items-center gap-5 py-12 text-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-noite-700 text-tinta-500">
            <Tv className="h-11 w-11" strokeWidth={2.5} />
          </div>
          <div>
            <p className="text-2xl font-black text-tinta-100">Nenhuma TV encontrada</p>
            <p className="mx-auto mt-2 max-w-sm text-base leading-snug text-tinta-300">
              Ligue a TV, confira se ela está no mesmo Wi-Fi do celular e procure de novo.
            </p>
          </div>
          <button
            onClick={procurar}
            className="flex h-toque items-center gap-2 rounded-2xl bg-sol-400 px-6 text-xl font-black text-noite-900 transition active:scale-95"
          >
            <RotateCcw className="h-6 w-6" strokeWidth={3} />
            Procurar de novo
          </button>
        </div>
      )}

      {estado.fase === 'lista' && estado.aparelhos.length > 0 && (
        <>
          <ul className="flex flex-col gap-2.5">
            {estado.aparelhos.map((aparelho) => (
              <li key={aparelho.id}>
                <button
                  onClick={() => enviar(aparelho)}
                  className="flex min-h-[4.5rem] w-full items-center gap-3 rounded-2xl border-2 border-noite-600 bg-noite-700 px-4 py-3 text-left transition active:scale-[0.98] active:border-sol-400"
                >
                  <Tv className="h-9 w-9 shrink-0 text-sol-400" strokeWidth={2.5} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xl font-black text-tinta-100">
                      {aparelho.name}
                    </span>
                    {aparelho.model && (
                      <span className="block truncate text-base text-tinta-300">
                        {aparelho.model}
                      </span>
                    )}
                  </span>
                  <Cast className="h-7 w-7 shrink-0 text-tinta-300" strokeWidth={2.5} />
                </button>
              </li>
            ))}
          </ul>

          <button
            onClick={procurar}
            className="mt-4 flex h-toque w-full items-center justify-center gap-2 rounded-2xl border-2 border-noite-500 bg-noite-700 text-lg font-black text-tinta-300 transition active:scale-95"
          >
            <RotateCcw className="h-6 w-6" strokeWidth={2.5} />
            Procurar de novo
          </button>
        </>
      )}
    </Sheet>
  );
};

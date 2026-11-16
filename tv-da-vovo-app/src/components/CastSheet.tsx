import React, { useCallback, useEffect, useState } from 'react';
import {
  Cast,
  Tv,
  RotateCcw,
  AlertTriangle,
  Square,
  Loader2,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import {
  procurarTvs,
  mandarParaTv,
  pararNaTv,
  avisarFormato,
  ouvirPassos,
  passo,
  type PassoDoCast,
  type TvNaRede
} from '../utils/tvsDaCasa';
import { cleanChannelName } from '../utils/channelName';
import { Sheet } from './Sheet';

interface CastSheetProps {
  isOpen: boolean;
  channelName: string;
  channelUrl: string;
  connectedTv?: TvNaRede | null;
  onClose: () => void;
  /** Chamado antes de mandar, para o celular liberar o canal e a rede. */
  onVaiParaTv?: () => void;
  /** Chamado quando a TV recusou, para o canal voltar a tocar no celular. */
  onVoltaProCelular?: () => void;
  onTvConectada?: (tv: TvNaRede, sentUrl: string) => void;
  onTvDesconectada?: () => void;
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
/**
 * Diario do que aconteceu com a transmissao.
 *
 * A vovo nao precisa disto, entao ele fica fechado e em letra pequena; mas
 * quando o cast falha e alguem vai investigar, e a diferenca entre "nao
 * funcionou" e "parou na conexao com a TV as 10h20".
 */
const PainelDePassos: React.FC<{
  passos: PassoDoCast[];
  aberto: boolean;
  onAlternar: () => void;
}> = ({ passos, aberto, onAlternar }) => {
  if (passos.length === 0) return null;
  const ultimo = passos[passos.length - 1];

  return (
    <div className="mt-5 rounded-2xl border-2 border-noite-600 bg-noite-800/60">
      <button
        onClick={onAlternar}
        className="flex w-full items-center gap-2 px-4 py-3 text-left"
        aria-expanded={aberto}
      >
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold tracking-wide text-tinta-500 uppercase">
            O que está acontecendo
          </span>
          <span className="block truncate text-base font-bold text-tinta-300">
            {ultimo.mensagem}
          </span>
        </span>
        {aberto ? (
          <ChevronUp className="h-6 w-6 shrink-0 text-tinta-500" strokeWidth={2.5} />
        ) : (
          <ChevronDown className="h-6 w-6 shrink-0 text-tinta-500" strokeWidth={2.5} />
        )}
      </button>

      {aberto && (
        <ol className="flex flex-col gap-2 border-t-2 border-noite-600 px-4 py-3">
          {passos.map((p, i) => (
            <li key={`${p.hora}-${i}`} className="flex gap-2 text-sm leading-snug">
              <span className="shrink-0 font-mono text-tinta-500">{p.hora}</span>
              <span className="min-w-0 flex-1">
                <span
                  className={
                    p.fase === 'erro'
                      ? 'font-bold text-morto-400'
                      : p.fase === 'tocando' || p.fase === 'aceito'
                        ? 'font-bold text-vivo-400'
                        : 'font-bold text-tinta-300'
                  }
                >
                  {p.mensagem}
                </span>
                {p.detalhe && (
                  <span className="block break-all text-tinta-500">{p.detalhe}</span>
                )}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
};

export const CastSheet: React.FC<CastSheetProps> = ({
  isOpen,
  channelName,
  channelUrl,
  connectedTv = null,
  onClose,
  onVaiParaTv,
  onVoltaProCelular,
  onTvConectada,
  onTvDesconectada
}) => {
  const [estado, setEstado] = useState<Estado>({ fase: 'procurando' });
  const [passos, setPassos] = useState<PassoDoCast[]>([]);
  const [verDetalhes, setVerDetalhes] = useState(false);
  const nomeCanal = cleanChannelName(channelName);

  const anotar = useCallback((novo: PassoDoCast) => {
    setPassos((anteriores) => [...anteriores.slice(-19), novo]);
  }, []);

  // O plugin nativo conta cada etapa; a tela so escuta enquanto esta aberta
  useEffect(() => {
    if (!isOpen) return;
    let cancelar: (() => void) | undefined;
    let vivo = true;
    void ouvirPassos((p) => anotar(p)).then((remover) => {
      if (vivo) cancelar = remover;
      else remover();
    });
    return () => {
      vivo = false;
      cancelar?.();
    };
  }, [isOpen, anotar]);

  const procurar = useCallback(async () => {
    setEstado({ fase: 'procurando' });
    setPassos([]);
    try {
      const aparelhos = await procurarTvs(5000);
      anotar(
        passo(
          aparelhos.length > 0 ? 'lista' : 'nenhuma',
          aparelhos.length > 0
            ? `Lista pronta: ${aparelhos.length} aparelho(s)`
            : 'Nenhuma TV encontrada na rede',
          aparelhos.map((tv) => `${tv.name} (${tv.kind})`).join(', ') || undefined
        )
      );
      setEstado({ fase: 'lista', aparelhos });
    } catch (error) {
      const mensagem = error instanceof Error ? error.message : 'Nao consegui procurar TVs.';
      anotar(passo('erro', 'Falhou ao procurar', mensagem));
      setVerDetalhes(true);
      setEstado({ fase: 'erro', mensagem });
    }
  }, [anotar]);

  // Comeca a procurar ao abrir, ou mostra a TV ja espelhada se estiver conectada
  useEffect(() => {
    if (!isOpen) return;
    if (connectedTv) {
      setEstado({ fase: 'tocando', nome: connectedTv.name, tv: connectedTv });
      return;
    }
    procurar();
  }, [isOpen, connectedTv, procurar]);

  const enviar = async (aparelho: TvNaRede) => {
    setEstado({ fase: 'enviando', nome: aparelho.name });
    // O celular solta o canal ANTES de a TV pedir o dela. A conta do provedor
    // de IPTV costuma permitir duas conexoes, e enquanto o celular segurava
    // uma delas a TV ficava esperando a vida inteira por uma vaga.
    onVaiParaTv?.();
    anotar(passo('escolhida', `TV escolhida: ${aparelho.name}`, `tipo ${aparelho.kind}`));
    try {
      await mandarParaTv(aparelho, channelUrl, nomeCanal);
      setEstado({ fase: 'tocando', nome: aparelho.name, tv: aparelho });
      onTvConectada?.(aparelho, channelUrl);
    } catch (error) {
      onVoltaProCelular?.();
      const mensagem = error instanceof Error ? error.message : 'A TV nao aceitou o canal.';
      anotar(passo('erro', 'Parou aqui', mensagem));
      setVerDetalhes(true);
      setEstado({ fase: 'erro', mensagem });
    }
  };

  const parar = async (tv: TvNaRede) => {
    try {
      await pararNaTv(tv);
    } catch {
      /* a TV pode ter sido desligada na mao; parar mesmo assim na tela */
    }
    onTvDesconectada?.();
    onClose();
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
          {passos.length > 0 && (
            <p className="max-w-sm text-base text-tinta-300">
              {passos[passos.length - 1].mensagem}
            </p>
          )}
        </div>
      )}

      {estado.fase === 'tocando' && (
        <div className="flex flex-col items-center gap-4 py-10 text-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-vivo-400/15 text-vivo-400">
            <Cast className="h-11 w-11" strokeWidth={2.5} />
          </div>
          <div>
            <p className="text-2xl font-black text-tinta-100">Espelhado na {estado.nome}</p>
            <p className="mx-auto mt-1 max-w-sm text-base text-tinta-300">
              Se você trocar de canal no aplicativo, a TV muda para o mesmo canal na hora.
            </p>
          </div>
          <div className="flex w-full max-w-sm flex-col gap-2.5 pt-2">
            <button
              onClick={onClose}
              className="flex h-toque items-center justify-center gap-2 rounded-2xl bg-sol-400 px-6 text-lg font-black text-noite-900 transition active:scale-95"
            >
              Continuar no app (trocar de canal)
            </button>
            <button
              onClick={() => parar(estado.tv)}
              className="flex h-toque items-center justify-center gap-2 rounded-2xl bg-morto-400 px-6 text-xl font-black text-noite-900 transition active:scale-95"
            >
              <Square className="h-6 w-6 fill-current" />
              Desconectar da TV
            </button>
          </div>
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

      {estado.fase !== 'lista' && (
        <PainelDePassos
          passos={passos}
          aberto={verDetalhes}
          onAlternar={() => setVerDetalhes((v) => !v)}
        />
      )}
    </Sheet>
  );
};

import React from 'react';
import { Cast, Tv, X } from 'lucide-react';

interface HeaderProps {
  channelCount: number;
  tvConectadaNome?: string;
  canalNaTvNome?: string;
  onDesconectarTv?: () => void;
}

/** Cabecalho direto da CLARICE TV com barra opcional de TV espelhada. */
export const Header: React.FC<HeaderProps> = ({
  channelCount,
  tvConectadaNome,
  canalNaTvNome,
  onDesconectarTv
}) => {
  return (
    <header className="area-segura-topo area-segura-lados border-b border-noite-600 bg-noite-800 px-4 pb-3 sm:px-6">
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-sol-400 text-noite-900 shadow-md">
          <Tv className="h-6 w-6" strokeWidth={2.5} />
        </div>
        <h1 className="text-2xl font-black tracking-tight text-tinta-100">CLARICE TV</h1>
        <span className="hidden rounded-full bg-noite-900 px-2.5 py-0.5 text-sm font-bold text-sol-400 sm:inline">
          {channelCount} canais
        </span>

        {tvConectadaNome && (
          <div className="ml-auto flex items-center gap-2 rounded-2xl border-2 border-vivo-400/50 bg-vivo-400/10 px-3 py-1.5">
            <Cast className="h-5 w-5 shrink-0 text-vivo-400" strokeWidth={2.5} />
            <span className="max-w-[11rem] truncate text-sm font-black text-tinta-100 sm:max-w-xs">
              {canalNaTvNome ? `${tvConectadaNome}: ${canalNaTvNome}` : tvConectadaNome}
            </span>
            {onDesconectarTv && (
              <button
                type="button"
                onClick={onDesconectarTv}
                className="flex items-center gap-1 rounded-xl bg-morto-400 px-2.5 py-1 text-xs font-black text-noite-900 transition active:scale-95"
              >
                <X className="h-4 w-4" strokeWidth={3} />
                Desconectar
              </button>
            )}
          </div>
        )}
      </div>
    </header>
  );
};

import React from 'react';
import { Tv } from 'lucide-react';

interface HeaderProps {
  channelCount: number;
}

/**
 * Topo da grade: so a marca e a contagem.
 *
 * Nao tem botao nenhum de proposito. O de ajustes saiu porque a vovo clicava
 * nele sem querer e caia numa tela cheia de coisa que nao e para ela. Quem
 * precisa dos ajustes aperta o zero tres vezes seguidas (ver App.tsx).
 */
export const Header: React.FC<HeaderProps> = ({ channelCount }) => {
  return (
    <header className="area-segura-topo area-segura-lados border-b border-noite-600 bg-noite-800 px-6 py-3">
      <div className="mx-auto flex w-full max-w-7xl items-center gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-sol-400 text-noite-900 shadow-md">
          <Tv className="h-6 w-6" strokeWidth={2.5} />
        </div>
        <h1 className="text-2xl font-black tracking-tight text-tinta-100">Vovó TV</h1>
        <span className="hidden rounded-full bg-noite-900 px-2.5 py-0.5 text-sm font-bold text-sol-400 sm:inline">
          {channelCount} canais
        </span>
      </div>
    </header>
  );
};

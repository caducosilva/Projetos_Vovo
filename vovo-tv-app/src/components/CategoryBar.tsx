import React from 'react';
import { ChevronDown } from 'lucide-react';

interface CategoryBarProps {
  label: string;
  count: number;
  onOpenPicker: () => void;
}

/**
 * Mostra a categoria que esta na tela e abre o seletor.
 *
 * Antes eram vinte e tantos botoes numa fita que rolava de lado. Rolagem
 * horizontal e invisivel para quem nao sabe que ela existe: a vovo so via os
 * tres primeiros e achava que o app so tinha aquilo. Agora e um alvo grande
 * que abre a lista inteira de uma vez.
 */
export const CategoryBar: React.FC<CategoryBarProps> = ({ label, count, onOpenPicker }) => {
  return (
    <div className="area-segura-lados border-b border-noite-600 bg-noite-800 px-4 py-3">
      <div className="mx-auto w-full max-w-7xl">
        <button
          onClick={onOpenPicker}
          className="flex h-toque w-full items-center gap-3 rounded-2xl border-2 border-noite-500 bg-noite-700 px-4 transition active:scale-[0.98] active:border-sol-400"
          aria-label={`Categoria atual: ${label}. Tocar para trocar.`}
        >
          <span className="min-w-0 flex-1 truncate text-left text-xl font-black text-tinta-100">
            {label}
          </span>
          <span className="shrink-0 rounded-full bg-noite-900 px-3 py-1 text-base font-black text-tinta-300">
            {count}
          </span>
          <ChevronDown className="h-7 w-7 shrink-0 text-sol-400" strokeWidth={3} />
        </button>
      </div>
    </div>
  );
};

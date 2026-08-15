import React from 'react';
import { Search, X, Settings, Tv } from 'lucide-react';

interface HeaderProps {
  searchTerm: string;
  onSearchChange: (value: string) => void;
  onOpenSettings: () => void;
}

/**
 * Topo do app: marca, busca e ajustes. Nada mais.
 *
 * A contagem de canais, o seletor de pais e a barra de teste de sinal moravam
 * aqui e empurravam o primeiro canal para fora da tela. A vovo abria o app e
 * via painel, nao TV. Tudo isso saiu daqui.
 */
export const Header: React.FC<HeaderProps> = ({ searchTerm, onSearchChange, onOpenSettings }) => {
  return (
    <header className="area-segura-topo area-segura-lados border-b border-noite-600 bg-noite-800 px-4 pb-3">
      <div className="mx-auto w-full max-w-7xl">
        <div className="mb-3 flex items-center gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-sol-400 text-noite-900">
            <Tv className="h-7 w-7" strokeWidth={2.5} />
          </div>

          <h1 className="flex-1 text-3xl font-black tracking-tight text-tinta-100">Vovó TV</h1>

          <button
            onClick={onOpenSettings}
            className="flex h-toque w-toque items-center justify-center rounded-2xl border-2 border-noite-500 bg-noite-700 text-tinta-300 transition active:scale-95 active:bg-noite-600"
            aria-label="Abrir ajustes"
          >
            <Settings className="h-7 w-7" strokeWidth={2.5} />
          </button>
        </div>

        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-4 h-6 w-6 -translate-y-1/2 text-tinta-500"
            strokeWidth={2.5}
          />
          <input
            type="search"
            value={searchTerm}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Buscar canal"
            aria-label="Buscar canal pelo nome"
            className="h-toque w-full rounded-2xl border-2 border-noite-500 bg-noite-700 pr-16 pl-13 text-lg font-bold text-tinta-100 placeholder-tinta-500 transition outline-none focus:border-sol-400"
          />
          {searchTerm && (
            <button
              onClick={() => onSearchChange('')}
              className="absolute top-1/2 right-2 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-xl text-tinta-300 transition active:scale-90 active:bg-noite-600"
              aria-label="Limpar a busca"
            >
              <X className="h-6 w-6" strokeWidth={3} />
            </button>
          )}
        </div>
      </div>
    </header>
  );
};

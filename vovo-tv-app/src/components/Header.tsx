import React from 'react';
import { Search, PlusCircle, Tv, X } from 'lucide-react';

interface HeaderProps {
  searchTerm: string;
  onSearchChange: (value: string) => void;
  onOpenImport: () => void;
  totalChannels: number;
}

export const Header: React.FC<HeaderProps> = ({
  searchTerm,
  onSearchChange,
  onOpenImport,
  totalChannels
}) => {
  return (
    <header className="sticky top-0 z-40 bg-slate-900/95 backdrop-blur-md border-b border-slate-800 px-4 py-3 shadow-md">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-3">
        {/* Logo and App Title */}
        <div className="flex items-center justify-between w-full md:w-auto">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-tr from-amber-500 to-amber-300 rounded-2xl flex items-center justify-center shadow-lg shadow-amber-500/20 text-slate-950">
              <Tv className="w-7 h-7 stroke-[2.5]" />
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-black text-white tracking-tight flex items-center gap-2">
                Vovó TV <span className="text-xs bg-amber-400/20 text-amber-300 font-bold px-2 py-0.5 rounded-full border border-amber-400/30">Brasil</span>
              </h1>
              <p className="text-xs font-semibold text-slate-400">
                {totalChannels} canais prontos para assistir
              </p>
            </div>
          </div>

          {/* Import M3U Button (Mobile) */}
          <button
            onClick={onOpenImport}
            className="md:hidden flex items-center gap-2 bg-amber-400 hover:bg-amber-500 active:scale-95 text-slate-950 font-black px-4 py-2 rounded-xl text-sm transition shadow-md"
          >
            <PlusCircle className="w-5 h-5" />
            <span>Lista</span>
          </button>
        </div>

        {/* Search Bar & Desktop Import Button */}
        <div className="flex items-center gap-3 w-full md:w-auto flex-1 max-w-2xl justify-end">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-6 h-6 text-slate-400 pointer-events-none" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Buscar canal, cidade ou programa..."
              className="w-full bg-slate-800/90 text-white placeholder-slate-400 text-lg font-medium pl-12 pr-10 py-3 rounded-2xl border border-slate-700 focus:outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20 transition shadow-inner"
            />
            {searchTerm && (
              <button
                onClick={() => onSearchChange('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-white"
              >
                <X className="w-6 h-6" />
              </button>
            )}
          </div>

          <button
            onClick={onOpenImport}
            className="hidden md:flex items-center gap-2 bg-amber-400 hover:bg-amber-500 active:scale-95 text-slate-950 font-black px-5 py-3 rounded-2xl text-base transition shadow-md shadow-amber-400/10 shrink-0"
          >
            <PlusCircle className="w-6 h-6" />
            <span>Importar Lista M3U</span>
          </button>
        </div>
      </div>
    </header>
  );
};

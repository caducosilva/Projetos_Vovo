import React from 'react';
import { Search, Moon, Type, X } from 'lucide-react';

interface HeaderProps {
  searchTerm: string;
  onSearchChange: (value: string) => void;
  totalRadios: number;
  bigText: boolean;
  onToggleBigText: () => void;
  onOpenSleepTimer: () => void;
  sleepMinutesLeft: number | null;
}

export const Header: React.FC<HeaderProps> = ({
  searchTerm,
  onSearchChange,
  totalRadios,
  bigText,
  onToggleBigText,
  onOpenSleepTimer,
  sleepMinutesLeft,
}) => {
  return (
    <header className="bg-slate-900 border-b border-slate-800 sticky top-0 z-40 shadow-xl px-4 py-3">
      <div className="max-w-6xl mx-auto flex flex-col gap-3">
        {/* Top bar with branding and senior tools */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-amber-500 to-amber-300 flex items-center justify-center text-slate-950 font-black shadow-lg shadow-amber-500/20 text-2xl">
              📻
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className={`${bigText ? 'text-2xl' : 'text-xl'} font-black text-white tracking-tight`}>
                  Rádios da Vovó
                </h1>
                <span className="bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 text-[11px] font-extrabold px-2 py-0.5 rounded-full uppercase">
                  🇧🇷 Brasil
                </span>
              </div>
              <p className="text-xs text-slate-400 font-medium">
                {totalRadios} rádios de todo o Brasil sem comerciais
              </p>
            </div>
          </div>

          {/* Accessibility Buttons */}
          <div className="flex items-center gap-2">
            {/* Sleep timer button */}
            <button
              onClick={onOpenSleepTimer}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-black transition border ${
                sleepMinutesLeft !== null
                  ? 'bg-amber-400 text-slate-950 border-amber-300 shadow-md shadow-amber-400/20 animate-pulse'
                  : 'bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-750'
              }`}
              title="Timer Soneca para dormir ouvindo o rádio"
            >
              <Moon className="w-4 h-4" />
              <span>{sleepMinutesLeft !== null ? `${sleepMinutesLeft} min` : 'Soneca'}</span>
            </button>

            {/* Big text mode toggle */}
            <button
              onClick={onToggleBigText}
              className={`p-2.5 rounded-xl border text-xs font-black transition flex items-center gap-1 ${
                bigText
                  ? 'bg-sky-500 text-white border-sky-400 shadow-md shadow-sky-500/20'
                  : 'bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-750'
              }`}
              title="Aumentar tamanho das letras"
            >
              <Type className="w-4 h-4" />
              <span className="hidden sm:inline">Letras Grandes</span>
            </button>
          </div>
        </div>

        {/* Big Search Bar */}
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
            <Search className="w-5 h-5" />
          </div>
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Buscar por nome da rádio, cidade ou frequência (ex: 104.7, Aparecida, Mogi)..."
            className={`w-full bg-slate-950/80 border border-slate-700/80 text-white pl-11 pr-10 py-3 rounded-2xl placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent ${
              bigText ? 'text-lg' : 'text-base'
            } font-medium transition shadow-inner`}
          />
          {searchTerm && (
            <button
              onClick={() => onSearchChange('')}
              className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>
    </header>
  );
};

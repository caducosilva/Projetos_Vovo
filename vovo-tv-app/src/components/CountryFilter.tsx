import React from 'react';

interface CountryFilterProps {
  selectedCountry: string;
  onSelectCountry: (country: string) => void;
  availableCountries: { code: string; label: string; flag: string; count: number }[];
}

export const CountryFilter: React.FC<CountryFilterProps> = ({
  selectedCountry,
  onSelectCountry,
  availableCountries
}) => {
  if (availableCountries.length <= 1) return null;

  return (
    <div className="w-full overflow-x-auto py-1 px-4 scrollbar-none">
      <div className="flex items-center gap-2 min-w-max">
        <span className="text-xs font-black uppercase tracking-wider text-slate-400 mr-1">
          País:
        </span>
        {availableCountries.map((c) => {
          const isSelected = selectedCountry === c.code;

          return (
            <button
              key={c.code}
              onClick={() => onSelectCountry(c.code)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-bold text-sm transition-all active:scale-95 ${
                isSelected
                  ? 'bg-sky-500 text-white shadow-md shadow-sky-500/20'
                  : 'bg-slate-800/60 hover:bg-slate-700/60 text-slate-300 border border-slate-700/40'
              }`}
            >
              <span>{c.flag}</span>
              <span>{c.label}</span>
              <span className="text-xs opacity-75 font-semibold">({c.count})</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

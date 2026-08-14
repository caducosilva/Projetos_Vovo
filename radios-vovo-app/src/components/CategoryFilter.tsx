import React from 'react';
import { RADIO_CATEGORIES } from '../utils/categories';
import type { RadioCategoryKey } from '../types';

interface CategoryFilterProps {
  selectedCategory: RadioCategoryKey;
  onSelectCategory: (category: RadioCategoryKey) => void;
  categoryCounts: Record<string, number>;
  bigText: boolean;
}

export const CategoryFilter: React.FC<CategoryFilterProps> = ({
  selectedCategory,
  onSelectCategory,
  categoryCounts,
  bigText
}) => {
  return (
    <div className="w-full overflow-x-auto py-2.5 px-4 scrollbar-none border-b border-slate-800/80 bg-slate-900/60 backdrop-blur-md sticky top-[138px] z-30">
      <div className="flex items-center gap-2 max-w-6xl mx-auto min-w-max">
        {RADIO_CATEGORIES.map((cat) => {
          const isSelected = selectedCategory === cat.key;
          const count = categoryCounts[cat.key] || 0;

          return (
            <button
              key={cat.key}
              onClick={() => onSelectCategory(cat.key)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl font-black transition-all active:scale-95 whitespace-nowrap shadow-sm ${
                isSelected
                  ? 'bg-amber-400 text-slate-950 shadow-md shadow-amber-400/20'
                  : 'bg-slate-800/80 text-slate-300 hover:bg-slate-750 hover:text-white border border-slate-700/60'
              } ${bigText ? 'text-lg' : 'text-sm'}`}
            >
              <span>{cat.label}</span>
              <span
                className={`text-xs px-2 py-0.5 rounded-full font-bold ${
                  isSelected ? 'bg-slate-950/20 text-slate-950' : 'bg-slate-700/80 text-slate-300'
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

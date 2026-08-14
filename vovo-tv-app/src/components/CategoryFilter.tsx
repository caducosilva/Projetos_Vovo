import React from 'react';
import { CATEGORIES } from '../utils/categories';
import type { CategoryKey } from '../types';

interface CategoryFilterProps {
  selectedCategory: CategoryKey;
  onSelectCategory: (category: CategoryKey) => void;
  categoryCounts: Record<string, number>;
}

export const CategoryFilter: React.FC<CategoryFilterProps> = ({
  selectedCategory,
  onSelectCategory,
  categoryCounts
}) => {
  return (
    <div className="w-full overflow-x-auto py-2.5 scrollbar-none touch-pan-x overscroll-x-contain">
      <div className="flex items-center gap-2.5 px-4 min-w-max">
        {CATEGORIES.map((cat) => {
          const isSelected = selectedCategory === cat.key;
          const count = categoryCounts[cat.key] || 0;

          // Don't render empty categories unless it's todos or favoritos
          if (count === 0 && cat.key !== 'todos' && cat.key !== 'favoritos') {
            return null;
          }

          return (
            <button
              key={cat.key}
              onClick={() => onSelectCategory(cat.key)}
              className={`flex items-center gap-2 px-5 py-3 rounded-2xl font-black text-base md:text-lg transition-all active:scale-95 shadow-sm select-none ${
                isSelected
                  ? 'bg-amber-400 text-slate-950 shadow-amber-400/25 shadow-lg scale-105 border-2 border-amber-300'
                  : 'bg-slate-800/90 hover:bg-slate-700 text-slate-200 border border-slate-700/80'
              }`}
            >
              <span>{cat.label}</span>
              <span
                className={`text-xs px-2.5 py-0.5 rounded-full font-black ${
                  isSelected ? 'bg-slate-950/20 text-slate-950' : 'bg-slate-900 text-slate-400 border border-slate-700/50'
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

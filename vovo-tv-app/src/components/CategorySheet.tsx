import React from 'react';
import { Check } from 'lucide-react';
import { CATEGORIES } from '../utils/categories';
import type { CategoryKey } from '../types';
import { Sheet } from './Sheet';

interface CategorySheetProps {
  isOpen: boolean;
  selected: CategoryKey;
  counts: Record<string, number>;
  onSelect: (category: CategoryKey) => void;
  onClose: () => void;
}

/**
 * Seletor de categoria em tela cheia.
 *
 * Uma categoria por linha, na largura toda. Grade de dois em dois cabe mais na
 * tela, mas obriga a mirar, e mirar e exatamente o que da errado. Linha inteira
 * perdoa toque torto.
 */
export const CategorySheet: React.FC<CategorySheetProps> = ({
  isOpen,
  selected,
  counts,
  onSelect,
  onClose
}) => {
  const disponiveis = CATEGORIES.filter(
    (cat) => (counts[cat.key] || 0) > 0 || cat.key === 'favoritos' || cat.key === 'todos'
  );

  return (
    <Sheet isOpen={isOpen} title="Escolher categoria" onClose={onClose}>
      <ul className="flex flex-col gap-2.5">
        {disponiveis.map((cat) => {
          const ativa = cat.key === selected;
          const total = counts[cat.key] || 0;

          return (
            <li key={cat.key}>
              <button
                onClick={() => {
                  onSelect(cat.key);
                  onClose();
                }}
                className={`flex min-h-[4.5rem] w-full items-center gap-3 rounded-2xl border-2 px-4 py-3 text-left transition active:scale-[0.98] ${
                  ativa
                    ? 'border-sol-400 bg-sol-400 text-noite-900'
                    : 'border-noite-600 bg-noite-700 text-tinta-100'
                }`}
                aria-current={ativa ? 'true' : undefined}
              >
                <span className="min-w-0 flex-1 text-xl leading-snug font-black">{cat.label}</span>

                <span
                  className={`shrink-0 rounded-full px-3 py-1 text-base font-black ${
                    ativa ? 'bg-noite-900/20 text-noite-900' : 'bg-noite-900 text-tinta-300'
                  }`}
                >
                  {total}
                </span>

                {ativa && <Check className="h-7 w-7 shrink-0" strokeWidth={3} />}
              </button>
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
};

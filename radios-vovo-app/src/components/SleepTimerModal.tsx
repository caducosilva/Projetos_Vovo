import React from 'react';
import { Moon, X, Clock, Check } from 'lucide-react';

interface SleepTimerModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentMinutes: number | null;
  onSetTimer: (minutes: number | null) => void;
  bigText: boolean;
}

export const SleepTimerModal: React.FC<SleepTimerModalProps> = ({
  isOpen,
  onClose,
  currentMinutes,
  onSetTimer,
  bigText
}) => {
  if (!isOpen) return null;

  const options = [
    { label: '15 Minutos', value: 15 },
    { label: '30 Minutos (Meia hora)', value: 30 },
    { label: '45 Minutos', value: 45 },
    { label: '60 Minutos (1 Hora)', value: 60 },
    { label: '90 Minutos (1 Hora e meia)', value: 90 },
    { label: '120 Minutos (2 Horas)', value: 120 }
  ];

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-slate-900 border-2 border-amber-400/80 rounded-3xl max-w-md w-full p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-amber-400/20 text-amber-400 flex items-center justify-center border border-amber-400/40">
              <Moon className="w-6 h-6" />
            </div>
            <div>
              <h3 className={`${bigText ? 'text-2xl' : 'text-xl'} font-black text-white`}>
                Timer Soneca
              </h3>
              <p className="text-xs text-slate-400 font-medium">
                Desliga o rádio sozinho para você dormir em paz
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 bg-slate-800 text-slate-400 hover:text-white rounded-xl border border-slate-700"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Options List */}
        <div className="flex flex-col gap-2.5 my-4">
          {options.map((opt) => {
            const isSelected = currentMinutes === opt.value;
            return (
              <button
                key={opt.value}
                onClick={() => {
                  onSetTimer(opt.value);
                  onClose();
                }}
                className={`w-full py-3.5 px-4 rounded-2xl font-black text-left flex items-center justify-between transition active:scale-98 border ${
                  isSelected
                    ? 'bg-amber-400 text-slate-950 border-amber-300 shadow-md shadow-amber-400/20'
                    : 'bg-slate-800/80 text-white border-slate-700 hover:bg-slate-750'
                } ${bigText ? 'text-lg' : 'text-base'}`}
              >
                <div className="flex items-center gap-3">
                  <Clock className={`w-5 h-5 ${isSelected ? 'text-slate-950' : 'text-amber-400'}`} />
                  <span>{opt.label}</span>
                </div>
                {isSelected && <Check className="w-6 h-6" />}
              </button>
            );
          })}

          {/* Turn Off Timer Button */}
          {currentMinutes !== null && (
            <button
              onClick={() => {
                onSetTimer(null);
                onClose();
              }}
              className="w-full py-3 px-4 mt-2 rounded-2xl font-black bg-rose-500/20 text-rose-400 border border-rose-500/40 hover:bg-rose-500/30 transition text-center"
            >
              ❌ Desativar Timer Soneca
            </button>
          )}
        </div>

        {/* Bottom Close */}
        <button
          onClick={onClose}
          className="w-full py-3.5 rounded-2xl font-black bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700 transition active:scale-95"
        >
          Voltar para as Rádios
        </button>
      </div>
    </div>
  );
};

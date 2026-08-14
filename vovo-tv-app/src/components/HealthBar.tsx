import React from 'react';
import { Activity, EyeOff, Eye, Square } from 'lucide-react';

interface HealthBarProps {
  running: boolean;
  done: number;
  total: number;
  counts: { ok: number; doubt: number; dead: number; untested: number };
  hideDead: boolean;
  onToggleHideDead: () => void;
  onStart: () => void;
  onStop: () => void;
}

/** Barra de status do teste de sinal + controles. */
export const HealthBar: React.FC<HealthBarProps> = ({
  running,
  done,
  total,
  counts,
  hideDead,
  onToggleHideDead,
  onStart,
  onStop
}) => {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="px-4 pb-3 flex flex-wrap items-center gap-2">
      {running ? (
        <button
          onClick={onStop}
          className="flex items-center gap-2 bg-rose-500/20 text-rose-300 border border-rose-500/40 font-black px-4 py-2 rounded-xl text-sm active:scale-95 transition"
        >
          <Square className="w-4 h-4 fill-current" />
          Parar teste ({done}/{total})
        </button>
      ) : (
        <button
          onClick={onStart}
          className="flex items-center gap-2 bg-sky-500/20 text-sky-300 border border-sky-500/40 font-black px-4 py-2 rounded-xl text-sm active:scale-95 transition"
        >
          <Activity className="w-4 h-4" />
          Verificar sinal
        </button>
      )}

      <button
        onClick={onToggleHideDead}
        className={`flex items-center gap-2 font-black px-4 py-2 rounded-xl text-sm active:scale-95 transition border ${
          hideDead
            ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
            : 'bg-slate-800 text-slate-300 border-slate-700'
        }`}
      >
        {hideDead ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        {hideDead ? 'Escondendo sem sinal' : 'Mostrando todos'}
      </button>

      {/* Contadores */}
      <div className="flex items-center gap-3 text-xs font-bold ml-auto">
        <span className="text-emerald-400">● {counts.ok} bons</span>
        <span className="text-amber-400">● {counts.doubt} fracos</span>
        <span className="text-rose-400">● {counts.dead} sem sinal</span>
        <span className="text-slate-500">● {counts.untested} a testar</span>
      </div>

      {running && (
        <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-sky-400 transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
};

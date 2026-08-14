import React from 'react';
import { signalBars, statusLabel } from '../utils/health';
import type { HealthStatus } from '../utils/health';

interface SignalBarsProps {
  score: number;
  status: HealthStatus;
  latencyMs?: number;
  showText?: boolean;
  compact?: boolean;
}

const COLORS: Record<HealthStatus, string> = {
  confirmed: 'bg-emerald-400',
  ok: 'bg-emerald-400',
  doubt: 'bg-amber-400',
  dead: 'bg-rose-500',
  unknown: 'bg-slate-500'
};

const TEXT_COLORS: Record<HealthStatus, string> = {
  confirmed: 'text-emerald-400',
  ok: 'text-emerald-400',
  doubt: 'text-amber-400',
  dead: 'text-rose-400',
  unknown: 'text-slate-400'
};

/** Barrinhas de sinal estilo antena, iguais as do celular. */
export const SignalBars: React.FC<SignalBarsProps> = ({
  score,
  status,
  latencyMs,
  showText = true,
  compact = false
}) => {
  const bars = signalBars(score);
  const heights = compact ? ['h-1.5', 'h-2.5', 'h-3.5', 'h-4.5'] : ['h-2', 'h-3', 'h-4', 'h-5'];

  return (
    <span className="flex items-center gap-1.5" title={`${statusLabel(status)} (${score}/100)`}>
      <span className="flex items-end gap-0.5">
        {heights.map((h, i) => (
          <span
            key={i}
            className={`w-1.5 ${h} rounded-sm ${
              i < bars ? COLORS[status] : 'bg-slate-700'
            } transition-colors`}
          />
        ))}
      </span>
      {showText && (
        <span className={`text-[11px] font-extrabold uppercase tracking-wide ${TEXT_COLORS[status]}`}>
          {statusLabel(status)}
          {status !== 'dead' && status !== 'unknown' && typeof latencyMs === 'number' && (
            <span className="text-slate-500 normal-case font-bold"> · {latencyMs}ms</span>
          )}
        </span>
      )}
    </span>
  );
};

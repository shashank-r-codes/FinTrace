import { Cpu, FlaskConical, Scale } from 'lucide-react';
import { ScoreSource } from '../../types';

interface ScoreSourceBadgeProps {
  source: ScoreSource | string;
}

export function ScoreSourceBadge({ source }: ScoreSourceBadgeProps) {
  if (source === 'Trained ML prediction') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-[4px] border border-sky-500/35 bg-sky-950/50 px-2 py-0.5 text-[11px] font-medium text-sky-200 whitespace-nowrap">
        <Cpu className="h-3 w-3 text-sky-400 shrink-0" aria-hidden="true" />
        Trained ML prediction
      </span>
    );
  }

  if (source === 'Rule-based risk score') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-[4px] border border-amber-500/35 bg-amber-950/40 px-2 py-0.5 text-[11px] font-medium text-amber-200 whitespace-nowrap">
        <Scale className="h-3 w-3 text-amber-400 shrink-0" aria-hidden="true" />
        Rule-based risk score
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-[4px] border border-violet-500/35 bg-violet-950/40 px-2 py-0.5 text-[11px] font-medium text-violet-200 whitespace-nowrap">
      <FlaskConical className="h-3 w-3 text-violet-400 shrink-0" aria-hidden="true" />
      Synthetic demo result
    </span>
  );
}

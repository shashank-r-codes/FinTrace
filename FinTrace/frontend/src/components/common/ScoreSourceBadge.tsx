import { Cpu, FlaskConical, Scale } from 'lucide-react';
import { ScoreSource } from '../../types';

interface ScoreSourceBadgeProps {
  source: ScoreSource | string;
}

export function ScoreSourceBadge({ source }: ScoreSourceBadgeProps) {
  if (source === 'Trained ML prediction') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-[4px] border border-blue-300 bg-[#DCEEFF] px-2 py-0.5 text-[11px] font-medium text-[#1E40AF] dark:border-sky-500/35 dark:bg-sky-950/50 dark:text-sky-200 whitespace-nowrap">
        <Cpu className="h-3 w-3 text-[#2563EB] dark:text-sky-400 shrink-0" aria-hidden="true" />
        Trained ML prediction
      </span>
    );
  }

  if (source === 'Rule-based risk score') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-[4px] border border-amber-300 bg-[#FEF3C7] px-2 py-0.5 text-[11px] font-medium text-[#92400E] dark:border-amber-500/35 dark:bg-amber-950/40 dark:text-amber-200 whitespace-nowrap">
        <Scale className="h-3 w-3 text-[#B45309] dark:text-amber-400 shrink-0" aria-hidden="true" />
        Rule-based risk score
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-[4px] border border-violet-300 bg-[#E8E5FF] px-2 py-0.5 text-[11px] font-medium text-[#4C1D95] dark:border-violet-500/35 dark:bg-violet-950/40 dark:text-violet-200 whitespace-nowrap">
      <FlaskConical className="h-3 w-3 text-[#6D28D9] dark:text-violet-400 shrink-0" aria-hidden="true" />
      Synthetic demo result
    </span>
  );
}

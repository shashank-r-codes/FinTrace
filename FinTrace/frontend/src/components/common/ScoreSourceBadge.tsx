import { Cpu, FlaskConical, Scale } from 'lucide-react';
import { ScoreSource } from '../../types';

interface ScoreSourceBadgeProps {
  source: ScoreSource | string;
  className?: string;
}

export function ScoreSourceBadge({ source, className = '' }: ScoreSourceBadgeProps) {
  if (source === 'Trained ML prediction') {
    return (
      <span
        title="Predictive score calculated from historical fraud patterns"
        className={`inline-flex items-center gap-1.5 rounded-[6px] border border-border-subtle bg-subtle px-2 py-0.5 text-[11px] font-medium text-heading whitespace-nowrap ${className}`}
      >
        <Cpu className="h-3 w-3 text-muted shrink-0" aria-hidden="true" />
        <span>Trained ML</span>
      </span>
    );
  }

  if (source === 'Rule-based risk score') {
    return (
      <span
        title="Rule evaluation derived from burst frequency and pass-through velocity"
        className={`inline-flex items-center gap-1.5 rounded-[6px] border border-border-subtle bg-subtle px-2 py-0.5 text-[11px] font-medium text-heading whitespace-nowrap ${className}`}
      >
        <Scale className="h-3 w-3 text-muted shrink-0" aria-hidden="true" />
        <span>Rule-based</span>
      </span>
    );
  }

  return (
    <span
      title="Synthetic demonstration record for training and simulation"
      className={`inline-flex items-center gap-1.5 rounded-[6px] border border-border-subtle bg-subtle px-2 py-0.5 text-[11px] font-medium text-muted whitespace-nowrap ${className}`}
    >
      <FlaskConical className="h-3 w-3 text-muted shrink-0" aria-hidden="true" />
      <span>Synthetic demo</span>
    </span>
  );
}

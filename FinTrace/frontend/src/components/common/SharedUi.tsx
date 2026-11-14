import {
  CheckCircle2,
  ChevronDown,
  Loader2,
  X,
} from 'lucide-react';
import {
  ButtonHTMLAttributes,
  forwardRef,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  useEffect,
} from 'react';

/* =============================================================================
   BUTTON PRIMITIVE
   Nested 8px radius, strict contrast, single ease-out motion
   ============================================================================= */

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      children,
      variant = 'secondary',
      size = 'md',
      loading = false,
      icon,
      disabled,
      className = '',
      type = 'button',
      ...props
    },
    ref
  ) => {
    const sizeClasses = {
      sm: 'h-7 px-2.5 text-xs gap-1.5 rounded-[6px]',
      md: 'h-8 px-3 text-xs gap-1.5 rounded-[8px]',
      lg: 'h-9 px-4 text-sm gap-2 rounded-[8px]',
    }[size];

    const variantClasses = {
      primary:
        'bg-accent-strong text-white font-medium hover:bg-accent-strong-hover active:translate-y-[0.5px] shadow-xs',
      secondary:
        'border border-border-subtle bg-card text-heading font-medium hover:bg-subtle active:bg-highlight/60',
      danger:
        'border border-red-300 bg-red-50 text-red-700 font-medium hover:bg-red-100 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-900/60',
      ghost:
        'text-body font-medium hover:bg-subtle hover:text-heading active:bg-highlight/50',
    }[variant];

    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled || loading}
        className={`inline-flex items-center justify-center whitespace-nowrap cursor-pointer transition-colors duration-120 disabled:cursor-not-allowed disabled:opacity-50 select-none ${sizeClasses} ${variantClasses} ${className}`}
        {...props}
      >
        {loading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0 text-current" aria-hidden="true" />
        ) : (
          icon ? <span className="shrink-0">{icon}</span> : null
        )}
        <span>{children}</span>
      </button>
    );
  }
);
Button.displayName = 'Button';

/* =============================================================================
   CARD PRIMITIVE
   Standard 12px radius, 8% hairline border, quiet surface elevation
   ============================================================================= */

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  title?: string;
  subtitle?: string;
  action?: ReactNode;
  headerBorder?: boolean;
}

export function Card({
  title,
  subtitle,
  action,
  headerBorder = false,
  children,
  className = '',
  ...props
}: CardProps) {
  const hasHeader = title || subtitle || action;

  return (
    <div
      className={`rounded-[12px] border border-border-subtle bg-card shadow-xs transition-colors duration-150 ${className}`}
      {...props}
    >
      {hasHeader ? (
        <div
          className={`flex items-start justify-between gap-3 px-4 py-3 sm:px-5 ${
            headerBorder ? 'border-b border-border-subtle' : ''
          }`}
        >
          <div className="min-w-0">
            {title ? (
              <h3 className="text-sm font-semibold tracking-tight text-heading truncate">
                {title}
              </h3>
            ) : null}
            {subtitle ? (
              <p className="mt-0.5 text-xs text-muted">{subtitle}</p>
            ) : null}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
      ) : null}
      <div className="px-4 py-3 sm:px-5">{children}</div>
    </div>
  );
}

/* =============================================================================
   RISK BADGE
   Textual severity + numeric score [0-100], strictly non-decorative
   ============================================================================= */

export interface RiskBadgeProps {
  score: number;
  level?: string;
  showScore?: boolean;
  className?: string;
}

export function RiskBadge({
  score,
  level,
  showScore = true,
  className = '',
}: RiskBadgeProps) {
  const normalizedLevel =
    level ??
    (score >= 80 ? 'Critical' : score >= 60 ? 'High' : score >= 35 ? 'Medium' : 'Low');

  const config = {
    Critical: {
      bg: 'bg-red-50 dark:bg-red-950/40',
      text: 'text-red-700 dark:text-red-300',
      border: 'border-red-200 dark:border-red-900/60',
      dot: 'bg-red-600 dark:bg-red-400',
    },
    High: {
      bg: 'bg-amber-50 dark:bg-amber-950/40',
      text: 'text-amber-700 dark:text-amber-300',
      border: 'border-amber-200 dark:border-amber-900/60',
      dot: 'bg-amber-600 dark:bg-amber-400',
    },
    Medium: {
      bg: 'bg-amber-50/70 dark:bg-amber-950/30',
      text: 'text-amber-800 dark:text-amber-200',
      border: 'border-amber-200/80 dark:border-amber-900/40',
      dot: 'bg-amber-500 dark:bg-amber-400',
    },
    Low: {
      bg: 'bg-emerald-50 dark:bg-emerald-950/30',
      text: 'text-emerald-700 dark:text-emerald-300',
      border: 'border-emerald-200 dark:border-emerald-900/40',
      dot: 'bg-emerald-600 dark:bg-emerald-400',
    },
  }[normalizedLevel] ?? {
    bg: 'bg-subtle',
    text: 'text-body',
    border: 'border-border-subtle',
    dot: 'bg-muted',
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-[6px] border px-2 py-0.5 text-xs font-medium ${config.bg} ${config.text} ${config.border} ${className}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${config.dot}`} aria-hidden="true" />
      <span>{normalizedLevel}</span>
      {showScore ? (
        <span className="font-mono text-[11px] opacity-80 tabular-nums">
          [{Math.round(score)}]
        </span>
      ) : null}
    </span>
  );
}

/* =============================================================================
   INPUT & SELECT PRIMITIVES
   Standard 8px radius, quiet border, cobalt focus ring, zero glow
   ============================================================================= */

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
  icon?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, hint, icon, className = '', id, ...props }, ref) => {
    const inputId = id ?? (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);

    return (
      <div className="w-full space-y-1">
        {label ? (
          <label htmlFor={inputId} className="block text-xs font-medium text-body">
            {label}
          </label>
        ) : null}
        <div className="relative">
          {icon ? (
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">
              {icon}
            </span>
          ) : null}
          <input
            ref={ref}
            id={inputId}
            className={`w-full rounded-[8px] border bg-app px-3 py-1.5 text-xs text-heading placeholder:text-muted transition-colors duration-120 focus:border-accent-strong focus:outline-none disabled:bg-subtle disabled:cursor-not-allowed ${
              icon ? 'pl-8' : ''
            } ${
              error
                ? 'border-red-400 focus:border-red-500'
                : 'border-border-subtle hover:border-border-strong'
            } ${className}`}
            {...props}
          />
        </div>
        {error ? (
          <p className="text-[11px] font-medium text-red-600 dark:text-red-400">{error}</p>
        ) : hint ? (
          <p className="text-[11px] text-muted">{hint}</p>
        ) : null}
      </div>
    );
  }
);
Input.displayName = 'Input';

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  hint?: string;
  options?: Array<{ label: string; value: string }>;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, hint, options, children, className = '', id, ...props }, ref) => {
    const selectId = id ?? (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);

    return (
      <div className="w-full space-y-1">
        {label ? (
          <label htmlFor={selectId} className="block text-xs font-medium text-body">
            {label}
          </label>
        ) : null}
        <div className="relative">
          <select
            ref={ref}
            id={selectId}
            className={`w-full appearance-none rounded-[8px] border bg-app pl-3 pr-8 py-1.5 text-xs text-heading transition-colors duration-120 focus:border-accent-strong focus:outline-none disabled:bg-subtle disabled:cursor-not-allowed ${
              error
                ? 'border-red-400 focus:border-red-500'
                : 'border-border-subtle hover:border-border-strong'
            } ${className}`}
            {...props}
          >
            {options
              ? options.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))
              : children}
          </select>
          <ChevronDown
            className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted"
            aria-hidden="true"
          />
        </div>
        {error ? (
          <p className="text-[11px] font-medium text-red-600 dark:text-red-400">{error}</p>
        ) : hint ? (
          <p className="text-[11px] text-muted">{hint}</p>
        ) : null}
      </div>
    );
  }
);
Select.displayName = 'Select';

/* =============================================================================
   TABS PRIMITIVE
   Sentence case tabs, quiet underline indicator, zero neon pill glows
   ============================================================================= */

export interface TabItem {
  id: string;
  label: string;
  count?: number;
}

export interface TabsProps {
  tabs: TabItem[];
  activeTab: string;
  onChange: (id: string) => void;
  className?: string;
}

export function Tabs({ tabs, activeTab, onChange, className = '' }: TabsProps) {
  return (
    <div
      role="tablist"
      className={`flex items-center gap-1 border-b border-border-subtle overflow-x-auto ${className}`}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.id)}
            className={`flex items-center gap-2 border-b-2 px-3 py-2 text-xs font-medium whitespace-nowrap cursor-pointer transition-colors duration-120 ${
              isActive
                ? 'border-accent-strong text-heading'
                : 'border-transparent text-muted hover:text-heading hover:border-border-strong'
            }`}
          >
            <span>{tab.label}</span>
            {tab.count !== undefined ? (
              <span
                className={`rounded-[4px] px-1.5 py-0.2 font-mono text-[10px] tabular-nums ${
                  isActive
                    ? 'bg-subtle text-heading font-semibold'
                    : 'bg-subtle/60 text-muted'
                }`}
              >
                {tab.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/* =============================================================================
   MODAL PRIMITIVE
   16px radius, calm backdrop blur, structured header and action footer
   ============================================================================= */

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl';
}

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  maxWidth = 'md',
}: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const maxWidthClasses = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-2xl',
  }[maxWidth];

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-in fade-in duration-150"
    >
      <div
        className={`w-full rounded-[16px] border border-border-subtle bg-card shadow-float overflow-hidden ${maxWidthClasses}`}
      >
        <div className="flex items-start justify-between border-b border-border-subtle px-5 py-3.5">
          <div>
            <h2 className="text-sm font-semibold tracking-tight text-heading">{title}</h2>
            {subtitle ? <p className="mt-0.5 text-xs text-muted">{subtitle}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="rounded-[6px] p-1 text-muted hover:bg-subtle hover:text-heading cursor-pointer transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 max-h-[75vh] overflow-y-auto space-y-4">{children}</div>

        {footer ? (
          <div className="flex items-center justify-end gap-2 border-t border-border-subtle bg-subtle/50 px-5 py-3">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* =============================================================================
   STATUS STEPPER PRIMITIVE
   Linear progress through complaint or investigation stages
   ============================================================================= */

export interface StepItem {
  key: string;
  label: string;
  description?: string;
}

export interface StatusStepperProps {
  steps: StepItem[];
  currentStepKey: string;
  className?: string;
}

export function StatusStepper({ steps, currentStepKey, className = '' }: StatusStepperProps) {
  const currentIndex = steps.findIndex((s) => s.key === currentStepKey);

  return (
    <div className={`w-full py-2 ${className}`}>
      <ol className="flex items-center w-full">
        {steps.map((step, idx) => {
          const isCompleted = idx < currentIndex;
          const isCurrent = idx === currentIndex;

          return (
            <li
              key={step.key}
              className={`flex items-center ${
                idx < steps.length - 1 ? 'w-full' : ''
              }`}
            >
              <div className="flex flex-col items-center">
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-mono font-medium transition-colors ${
                    isCompleted
                      ? 'bg-emerald-600 text-white'
                      : isCurrent
                      ? 'border-2 border-accent-strong bg-card text-accent-strong'
                      : 'border border-border-subtle bg-subtle text-muted'
                  }`}
                >
                  {isCompleted ? <CheckCircle2 className="h-3.5 w-3.5" /> : idx + 1}
                </span>
                <span
                  className={`mt-1.5 text-[11px] whitespace-nowrap text-center ${
                    isCurrent
                      ? 'font-semibold text-heading'
                      : isCompleted
                      ? 'text-body font-medium'
                      : 'text-muted'
                  }`}
                >
                  {step.label}
                </span>
              </div>
              {idx < steps.length - 1 ? (
                <div
                  className={`h-[1px] w-full mx-2 transition-colors ${
                    idx < currentIndex ? 'bg-emerald-600' : 'bg-border-subtle'
                  }`}
                  aria-hidden="true"
                />
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

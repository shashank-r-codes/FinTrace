import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';

interface ThemeToggleProps {
  className?: string;
  compact?: boolean;
}

export function ThemeToggle({ className = '', compact = false }: ThemeToggleProps) {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      className={`inline-flex items-center gap-1.5 rounded-[8px] border border-border-subtle bg-card px-2.5 py-1 text-xs font-medium text-heading shadow-xs hover:bg-subtle cursor-pointer transition-colors duration-120 ${className}`}
    >
      {isDark ? (
        <Sun className="h-3.5 w-3.5 text-amber-500 shrink-0" aria-hidden="true" />
      ) : (
        <Moon className="h-3.5 w-3.5 text-muted shrink-0" aria-hidden="true" />
      )}
      {!compact ? <span>{isDark ? 'Light' : 'Dark'}</span> : null}
    </button>
  );
}

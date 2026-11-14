import { Component, ErrorInfo, ReactNode } from 'react';
import { AlertOctagon, RotateCcw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('FinTrace UI caught an unhandled exception:', error, errorInfo);
  }

  private handleReset = () => {
    try {
      localStorage.removeItem('fintrace_access_token');
      localStorage.removeItem('fintrace_refresh_token');
    } catch {
      // ignore
    }
    window.location.href = '/login';
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-app text-heading flex items-center justify-center p-6">
          <div className="w-full max-w-lg rounded-xl border border-red-300/40 bg-card p-6 shadow-xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-500/10 text-red-500">
                <AlertOctagon className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-base font-semibold text-heading">FinTrace Application Error</h1>
                <p className="text-xs text-muted">An unexpected UI error occurred while rendering this view.</p>
              </div>
            </div>

            <div className="rounded-lg bg-subtle p-3.5 font-mono text-xs text-red-600 dark:text-red-400 overflow-x-auto max-h-40">
              {this.state.error?.message || 'Unknown runtime error'}
            </div>

            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="rounded-lg border border-border-subtle bg-subtle px-3 py-1.5 text-xs font-medium text-heading hover:bg-highlight cursor-pointer"
              >
                Reload Page
              </button>
              <button
                type="button"
                onClick={this.handleReset}
                className="inline-flex items-center gap-1.5 rounded-lg bg-accent-strong px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-strong-hover cursor-pointer"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>Reset Session & Return to Login</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

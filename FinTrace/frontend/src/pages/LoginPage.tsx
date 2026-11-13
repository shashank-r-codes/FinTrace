import { Lock, Shield, UserCheck } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ApiError } from '../api/client';
import { useAuth } from '../context/AuthContext';

const DEMO_ACCOUNTS = [
  { label: 'Administrator', email: 'admin@fintrace.demo' },
  { label: 'Senior Investigator', email: 'kavya.rao@fintrace.demo' },
  { label: 'Investigator', email: 'rohan.menon@fintrace.demo' },
  { label: 'Bank Nodal Officer', email: 'nodal.synsbi@fintrace.demo' },
];

export function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState('kavya.rao@fintrace.demo');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (user) {
    return <Navigate to="/" replace />;
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email.trim(), password);
      navigate('/', { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Unable to reach FinTrace authentication service.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0B1120] text-slate-100 flex flex-col justify-center px-4 py-12">
      <div className="mx-auto w-full max-w-md space-y-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-[6px] border border-sky-500/40 bg-sky-950/60 text-sky-400">
            <Shield className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white">FinTrace Command Centre</h1>
            <p className="text-xs text-slate-400">
              SIH PS 26184 · Predictive Cybercrime & ATM Cash-Out Intelligence
            </p>
          </div>
        </div>

        <div className="rounded-[8px] border border-slate-800 bg-[#111827] p-6 space-y-5">
          <div>
            <h2 className="text-sm font-semibold text-white">Authorized Investigator Sign-In</h2>
            <p className="mt-1 text-xs text-slate-400">
              Authenticate with role-based credentials to access complaint trails, ML risk scoring, and ATM forecasts.
            </p>
          </div>

          {error ? (
            <div
              role="alert"
              className="rounded-[5px] border border-red-800/70 bg-red-950/40 px-3 py-2.5 text-xs text-red-200"
            >
              {error}
            </div>
          ) : null}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="login-email" className="block text-xs font-medium text-slate-300 mb-1.5">
                Official Email
              </label>
              <input
                id="login-email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-[5px] border border-slate-700 bg-[#0B1120] px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-sky-500 focus:outline-none"
                placeholder="investigator@fintrace.demo"
              />
            </div>

            <div>
              <label htmlFor="login-password" className="block text-xs font-medium text-slate-300 mb-1.5">
                Password
              </label>
              <input
                id="login-password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-[5px] border border-slate-700 bg-[#0B1120] px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-sky-500 focus:outline-none"
                placeholder="Enter your password"
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="flex w-full items-center justify-center gap-2 rounded-[5px] bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-60 cursor-pointer"
            >
              <Lock className="h-4 w-4" aria-hidden="true" />
              {submitting ? 'Verifying Credentials...' : 'Sign In to FinTrace'}
            </button>
          </form>

          <div className="border-t border-slate-800 pt-4 space-y-2.5">
            <div className="flex items-center justify-between text-[11px] text-slate-400">
              <span className="flex items-center gap-1.5 font-medium text-slate-300">
                <UserCheck className="h-3.5 w-3.5 text-sky-400" aria-hidden="true" />
                Seeded Demo Accounts
              </span>
              <span className="font-mono text-slate-400">Pass: FinTrace@Demo2026</span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {DEMO_ACCOUNTS.map((acct) => (
                <button
                  key={acct.email}
                  type="button"
                  onClick={() => {
                    setEmail(acct.email);
                    setPassword('FinTrace@Demo2026');
                  }}
                  className="rounded-[4px] border border-slate-800 bg-[#0B1120] px-2.5 py-1.5 text-left hover:border-sky-500/50 hover:bg-slate-900 cursor-pointer"
                >
                  <p className="text-[11px] font-semibold text-slate-200">{acct.label}</p>
                  <p className="font-mono text-[10px] text-slate-400 truncate">{acct.email}</p>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

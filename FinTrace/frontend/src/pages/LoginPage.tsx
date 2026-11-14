import { Lock, Shield, UserCheck, UserPlus, Users } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ApiError } from '../api/client';
import { ThemeToggle } from '../components/common/ThemeToggle';
import { useAuth } from '../context/AuthContext';

const OFFICER_DEMO_ACCOUNTS = [
  { label: 'Administrator', email: 'admin@fintrace.demo' },
  { label: 'Senior Investigator', email: 'kavya.rao@fintrace.demo' },
  { label: 'Investigator', email: 'rohan.menon@fintrace.demo' },
  { label: 'Bank Nodal Officer', email: 'nodal.synsbi@fintrace.demo' },
];

const CITIZEN_DEMO_ACCOUNTS = [
  { label: 'Citizen Demo 1 (Under review)', email: 'citizen1@fintrace.demo' },
  { label: 'Citizen Demo 2 (In progress)', email: 'citizen2@fintrace.demo' },
];

export function LoginPage() {
  const { user, login, registerCitizen } = useAuth();
  const navigate = useNavigate();

  const [portalTab, setPortalTab] = useState<'citizen' | 'officer'>('citizen');
  const [citizenMode, setCitizenMode] = useState<'login' | 'register'>('login');

  // Officer form state
  const [officerEmail, setOfficerEmail] = useState('kavya.rao@fintrace.demo');
  const [officerPassword, setOfficerPassword] = useState('');

  // Citizen login state
  const [citizenEmail, setCitizenEmail] = useState('citizen1@fintrace.demo');
  const [citizenPassword, setCitizenPassword] = useState('');

  // Citizen registration state
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPhone, setRegPhone] = useState('');
  const [regCity, setRegCity] = useState('Bengaluru');
  const [regPassword, setRegPassword] = useState('');
  const [regConfirmPassword, setRegConfirmPassword] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (user) {
    return <Navigate to={user.role === 'citizen' ? '/citizen' : '/'} replace />;
  }

  const handleOfficerLogin = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const signedIn = await login(officerEmail.trim(), officerPassword);
      navigate(signedIn.role === 'citizen' ? '/citizen' : '/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to reach the FinTrace authentication service.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCitizenLogin = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const signedIn = await login(citizenEmail.trim(), citizenPassword);
      navigate(signedIn.role === 'citizen' ? '/citizen' : '/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to reach the FinTrace authentication service.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCitizenRegister = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (regPassword !== regConfirmPassword) {
      setError('Password and confirmation password do not match.');
      return;
    }
    setSubmitting(true);
    try {
      await registerCitizen({
        fullName: regName.trim(),
        email: regEmail.trim(),
        phone: regPhone.trim(),
        city: regCity.trim() || 'Bengaluru',
        password: regPassword,
        confirmPassword: regConfirmPassword,
      });
      navigate('/citizen', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to complete citizen registration.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-app text-heading flex flex-col justify-center px-4 py-10 transition-colors duration-120">
      <div className="fixed top-4 right-4 z-20">
        <ThemeToggle />
      </div>

      <div className="mx-auto w-full max-w-md space-y-4">
        {/* Brand Header */}
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-[8px] border border-border-subtle bg-subtle text-accent-strong">
            <Shield className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-heading">FinTrace</h1>
            <p className="text-xs text-muted">
              Cybercrime reporting & forensic intelligence
            </p>
          </div>
        </div>

        {/* Evidentiary Login Card */}
        <div className="rounded-[16px] border border-border-subtle bg-card shadow-sm overflow-hidden transition-colors duration-120">
          {/* Portal Switcher Tabs */}
          <div className="grid grid-cols-2 border-b border-border-subtle bg-subtle/50" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={portalTab === 'citizen'}
              onClick={() => {
                setPortalTab('citizen');
                setError(null);
              }}
              className={`flex items-center justify-center gap-2 py-2.5 text-xs font-medium border-b-2 transition-colors cursor-pointer ${
                portalTab === 'citizen'
                  ? 'border-accent-strong bg-card text-heading font-semibold'
                  : 'border-transparent text-muted hover:text-heading'
              }`}
            >
              <Users className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Citizen portal</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={portalTab === 'officer'}
              onClick={() => {
                setPortalTab('officer');
                setError(null);
              }}
              className={`flex items-center justify-center gap-2 py-2.5 text-xs font-medium border-b-2 transition-colors cursor-pointer ${
                portalTab === 'officer'
                  ? 'border-accent-strong bg-card text-heading font-semibold'
                  : 'border-transparent text-muted hover:text-heading'
              }`}
            >
              <Shield className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Investigator access</span>
            </button>
          </div>

          <div className="p-5 sm:p-6 space-y-4">
            {error ? (
              <div
                role="alert"
                className="rounded-[8px] border border-red-200 bg-red-50/80 px-3 py-2 text-xs text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200"
              >
                {error}
              </div>
            ) : null}

            {portalTab === 'citizen' ? (
              <>
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h2 className="text-sm font-semibold text-heading">
                      {citizenMode === 'login' ? 'Sign in to citizen portal' : 'Create citizen account'}
                    </h2>
                    <p className="mt-0.5 text-xs text-muted leading-relaxed">
                      {citizenMode === 'login'
                        ? 'Report cyber fraud, submit transaction evidence, and track investigation progress.'
                        : 'Register to file complaints and receive verified case updates.'}
                    </p>
                  </div>
                </div>

                {/* Sub-Switch: Sign In / Create Account */}
                <div className="grid grid-cols-2 gap-1 rounded-[8px] border border-border-subtle bg-subtle p-1">
                  <button
                    type="button"
                    onClick={() => {
                      setCitizenMode('login');
                      setError(null);
                    }}
                    className={`rounded-[6px] py-1 text-xs font-medium transition-colors cursor-pointer ${
                      citizenMode === 'login'
                        ? 'bg-card text-heading shadow-xs font-semibold'
                        : 'text-muted hover:text-heading'
                    }`}
                  >
                    Sign in
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCitizenMode('register');
                      setError(null);
                    }}
                    className={`rounded-[6px] py-1 text-xs font-medium transition-colors cursor-pointer ${
                      citizenMode === 'register'
                        ? 'bg-card text-heading shadow-xs font-semibold'
                        : 'text-muted hover:text-heading'
                    }`}
                  >
                    Create account
                  </button>
                </div>

                {citizenMode === 'login' ? (
                  <>
                    <form onSubmit={handleCitizenLogin} className="space-y-3.5">
                      <div>
                        <label htmlFor="citizen-email" className="block text-xs font-medium text-body mb-1">
                          Email address
                        </label>
                        <input
                          id="citizen-email"
                          type="email"
                          required
                          autoComplete="email"
                          value={citizenEmail}
                          onChange={(e) => setCitizenEmail(e.target.value)}
                          className="w-full rounded-[8px] border border-border-subtle bg-app px-3 py-1.5 text-xs text-heading placeholder:text-muted transition-colors duration-120 focus:border-accent-strong focus:outline-none"
                          placeholder="citizen1@fintrace.demo"
                        />
                      </div>

                      <div>
                        <label htmlFor="citizen-password" className="block text-xs font-medium text-body mb-1">
                          Password
                        </label>
                        <input
                          id="citizen-password"
                          type="password"
                          required
                          autoComplete="current-password"
                          value={citizenPassword}
                          onChange={(e) => setCitizenPassword(e.target.value)}
                          className="w-full rounded-[8px] border border-border-subtle bg-app px-3 py-1.5 text-xs text-heading placeholder:text-muted transition-colors duration-120 focus:border-accent-strong focus:outline-none"
                          placeholder="Enter your password"
                        />
                      </div>

                      <button
                        type="submit"
                        disabled={submitting}
                        className="flex w-full items-center justify-center gap-2 rounded-[8px] bg-accent-strong px-4 py-2 text-xs font-semibold text-white hover:bg-accent-strong-hover disabled:opacity-60 cursor-pointer transition-colors duration-120"
                      >
                        <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>{submitting ? 'Signing in...' : 'Sign in as citizen'}</span>
                      </button>
                    </form>

                    {/* Quick Demo Accounts */}
                    <div className="border-t border-border-subtle pt-3 space-y-2">
                      <div className="flex items-center justify-between text-[11px] text-muted">
                        <span className="flex items-center gap-1.5 font-medium text-body">
                          <UserCheck className="h-3.5 w-3.5 text-accent-strong" aria-hidden="true" />
                          <span>Demo citizen accounts</span>
                        </span>
                        <span className="font-mono text-[10px]">Pass: FinTrace@Demo2026</span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                        {CITIZEN_DEMO_ACCOUNTS.map((acct) => (
                          <button
                            key={acct.email}
                            type="button"
                            onClick={() => {
                              setCitizenEmail(acct.email);
                              setCitizenPassword('FinTrace@Demo2026');
                            }}
                            className="rounded-[8px] border border-border-subtle bg-subtle/50 px-2.5 py-1.5 text-left hover:border-accent-strong/60 hover:bg-subtle cursor-pointer transition-colors"
                          >
                            <p className="text-[11px] font-medium text-heading">{acct.label}</p>
                            <p className="font-mono text-[10px] text-muted truncate">{acct.email}</p>
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                ) : (
                  <form onSubmit={handleCitizenRegister} className="space-y-3">
                    <div>
                      <label htmlFor="reg-fullname" className="block text-xs font-medium text-body mb-1">
                        Full name
                      </label>
                      <input
                        id="reg-fullname"
                        type="text"
                        required
                        minLength={2}
                        value={regName}
                        onChange={(e) => setRegName(e.target.value)}
                        className="w-full rounded-[8px] border border-border-subtle bg-app px-3 py-1.5 text-xs text-heading placeholder:text-muted focus:border-accent-strong focus:outline-none"
                        placeholder="e.g. Aarav Kulkarni"
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <div>
                        <label htmlFor="reg-email" className="block text-xs font-medium text-body mb-1">
                          Email address
                        </label>
                        <input
                          id="reg-email"
                          type="email"
                          required
                          value={regEmail}
                          onChange={(e) => setRegEmail(e.target.value)}
                          className="w-full rounded-[8px] border border-border-subtle bg-app px-3 py-1.5 text-xs text-heading placeholder:text-muted focus:border-accent-strong focus:outline-none"
                          placeholder="you@example.com"
                        />
                      </div>
                      <div>
                        <label htmlFor="reg-phone" className="block text-xs font-medium text-body mb-1">
                          Phone number
                        </label>
                        <input
                          id="reg-phone"
                          type="tel"
                          required
                          minLength={8}
                          value={regPhone}
                          onChange={(e) => setRegPhone(e.target.value)}
                          className="w-full rounded-[8px] border border-border-subtle bg-app px-3 py-1.5 text-xs text-heading placeholder:text-muted focus:border-accent-strong focus:outline-none"
                          placeholder="+91 9876543210"
                        />
                      </div>
                    </div>

                    <div>
                      <label htmlFor="reg-city" className="block text-xs font-medium text-body mb-1">
                        City
                      </label>
                      <input
                        id="reg-city"
                        type="text"
                        required
                        minLength={2}
                        value={regCity}
                        onChange={(e) => setRegCity(e.target.value)}
                        className="w-full rounded-[8px] border border-border-subtle bg-app px-3 py-1.5 text-xs text-heading focus:border-accent-strong focus:outline-none"
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <div>
                        <label htmlFor="reg-pass" className="block text-xs font-medium text-body mb-1">
                          Password
                        </label>
                        <input
                          id="reg-pass"
                          type="password"
                          required
                          minLength={8}
                          value={regPassword}
                          onChange={(e) => setRegPassword(e.target.value)}
                          className="w-full rounded-[8px] border border-border-subtle bg-app px-3 py-1.5 text-xs text-heading focus:border-accent-strong focus:outline-none"
                          placeholder="At least 8 chars"
                        />
                      </div>
                      <div>
                        <label htmlFor="reg-confirm" className="block text-xs font-medium text-body mb-1">
                          Confirm password
                        </label>
                        <input
                          id="reg-confirm"
                          type="password"
                          required
                          minLength={8}
                          value={regConfirmPassword}
                          onChange={(e) => setRegConfirmPassword(e.target.value)}
                          className="w-full rounded-[8px] border border-border-subtle bg-app px-3 py-1.5 text-xs text-heading focus:border-accent-strong focus:outline-none"
                          placeholder="Repeat password"
                        />
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={submitting}
                      className="flex w-full items-center justify-center gap-2 rounded-[8px] bg-accent-strong px-4 py-2 text-xs font-semibold text-white hover:bg-accent-strong-hover disabled:opacity-60 cursor-pointer transition-colors duration-120"
                    >
                      <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>{submitting ? 'Creating account...' : 'Create citizen account'}</span>
                    </button>
                  </form>
                )}
              </>
            ) : (
              <>
                <div>
                  <h2 className="text-sm font-semibold text-heading">Investigator sign-in</h2>
                  <p className="mt-0.5 text-xs text-muted leading-relaxed">
                    Authenticate with official role credentials to access the complaints ledger, prevention layer, and intelligence engines.
                  </p>
                </div>

                <form onSubmit={handleOfficerLogin} className="space-y-3.5">
                  <div>
                    <label htmlFor="login-email" className="block text-xs font-medium text-body mb-1">
                      Official email
                    </label>
                    <input
                      id="login-email"
                      type="email"
                      required
                      autoComplete="email"
                      value={officerEmail}
                      onChange={(e) => setOfficerEmail(e.target.value)}
                      className="w-full rounded-[8px] border border-border-subtle bg-app px-3 py-1.5 text-xs text-heading placeholder:text-muted transition-colors duration-120 focus:border-accent-strong focus:outline-none"
                      placeholder="investigator@fintrace.demo"
                    />
                  </div>

                  <div>
                    <label htmlFor="login-password" className="block text-xs font-medium text-body mb-1">
                      Password
                    </label>
                    <input
                      id="login-password"
                      type="password"
                      required
                      autoComplete="current-password"
                      value={officerPassword}
                      onChange={(e) => setOfficerPassword(e.target.value)}
                      className="w-full rounded-[8px] border border-border-subtle bg-app px-3 py-1.5 text-xs text-heading placeholder:text-muted transition-colors duration-120 focus:border-accent-strong focus:outline-none"
                      placeholder="Enter your password"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={submitting}
                    className="flex w-full items-center justify-center gap-2 rounded-[8px] bg-accent-strong px-4 py-2 text-xs font-semibold text-white hover:bg-accent-strong-hover disabled:opacity-60 cursor-pointer transition-colors duration-120"
                  >
                    <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>{submitting ? 'Verifying credentials...' : 'Sign in to FinTrace'}</span>
                  </button>
                </form>

                {/* Quick Seeded Officer Demo Accounts */}
                <div className="border-t border-border-subtle pt-3 space-y-2">
                  <div className="flex items-center justify-between text-[11px] text-muted">
                    <span className="flex items-center gap-1.5 font-medium text-body">
                      <UserCheck className="h-3.5 w-3.5 text-accent-strong" aria-hidden="true" />
                      <span>Officer demo accounts</span>
                    </span>
                    <span className="font-mono text-[10px]">Pass: FinTrace@Demo2026</span>
                  </div>

                  <div className="grid grid-cols-2 gap-1.5">
                    {OFFICER_DEMO_ACCOUNTS.map((acct) => (
                      <button
                        key={acct.email}
                        type="button"
                        onClick={() => {
                          setOfficerEmail(acct.email);
                          setOfficerPassword('FinTrace@Demo2026');
                        }}
                        className="rounded-[8px] border border-border-subtle bg-subtle/50 px-2.5 py-1.5 text-left hover:border-accent-strong/60 hover:bg-subtle cursor-pointer transition-colors"
                      >
                        <p className="text-[11px] font-medium text-heading truncate">{acct.label}</p>
                        <p className="font-mono text-[10px] text-muted truncate">{acct.email}</p>
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

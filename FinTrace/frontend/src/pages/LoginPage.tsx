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
  { label: 'Citizen Demo 1 (Under Review)', email: 'citizen1@fintrace.demo' },
  { label: 'Citizen Demo 2 (In Progress)', email: 'citizen2@fintrace.demo' },
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
      setError(err instanceof ApiError ? err.message : 'Unable to reach FinTrace authentication service.');
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
      setError(err instanceof ApiError ? err.message : 'Unable to reach FinTrace authentication service.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCitizenRegister = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (regPassword !== regConfirmPassword) {
      setError('Password and Confirm Password do not match.');
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
    <div className="min-h-screen bg-app bg-grad-sky text-heading flex flex-col justify-center px-4 py-10 transition-colors duration-200">
      <div className="fixed top-4 right-4 z-20">
        <ThemeToggle />
      </div>

      <div className="mx-auto w-full max-w-md space-y-5">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-[8px] border border-accent-strong/40 bg-card text-accent-strong shadow-sm">
            <Shield className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-heading">FinTrace</h1>
            <p className="text-xs text-muted">
              Cybercrime Reporting & Predictive Intelligence Portal
            </p>
          </div>
        </div>

        <div className="rounded-[10px] border border-border-subtle bg-card shadow-lg overflow-hidden transition-colors duration-200">
          {/* Portal Switcher Tabs */}
          <div className="grid grid-cols-2 border-b border-border-subtle bg-subtle/60" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={portalTab === 'citizen'}
              onClick={() => {
                setPortalTab('citizen');
                setError(null);
              }}
              className={`flex items-center justify-center gap-2 py-3 text-xs font-semibold border-b-2 transition-colors cursor-pointer ${
                portalTab === 'citizen'
                  ? 'border-accent-strong bg-card text-accent-strong dark:text-sky-300'
                  : 'border-transparent text-muted hover:text-heading'
              }`}
            >
              <Users className="h-3.5 w-3.5" aria-hidden="true" />
              Citizen
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={portalTab === 'officer'}
              onClick={() => {
                setPortalTab('officer');
                setError(null);
              }}
              className={`flex items-center justify-center gap-2 py-3 text-xs font-semibold border-b-2 transition-colors cursor-pointer ${
                portalTab === 'officer'
                  ? 'border-accent-strong bg-card text-accent-strong dark:text-sky-300'
                  : 'border-transparent text-muted hover:text-heading'
              }`}
            >
              <Shield className="h-3.5 w-3.5" aria-hidden="true" />
              Officer
            </button>
          </div>

          <div className="p-6 space-y-5">
            {error ? (
              <div
                role="alert"
                className="rounded-[6px] border border-red-300 bg-[#FEE2E2] px-3 py-2.5 text-xs text-[#991B1B] dark:border-red-800/70 dark:bg-red-950/40 dark:text-red-200"
              >
                {error}
              </div>
            ) : null}

            {portalTab === 'citizen' ? (
              <>
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h2 className="text-sm font-semibold text-heading">
                      {citizenMode === 'login' ? 'Citizen Portal Sign-In' : 'Create Citizen Account'}
                    </h2>
                    <p className="mt-0.5 text-xs text-muted">
                      {citizenMode === 'login'
                        ? 'File a cyber fraud complaint, upload evidence, and track official progress.'
                        : 'Register to submit cybercrime complaints and receive live status updates.'}
                    </p>
                  </div>
                </div>

                {/* Sign In / Create Account sub-switch */}
                <div className="grid grid-cols-2 gap-1.5 rounded-[6px] border border-border-subtle bg-subtle p-1">
                  <button
                    type="button"
                    onClick={() => {
                      setCitizenMode('login');
                      setError(null);
                    }}
                    className={`rounded-[4px] py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                      citizenMode === 'login'
                        ? 'bg-card text-heading shadow-xs'
                        : 'text-muted hover:text-heading'
                    }`}
                  >
                    Sign In
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCitizenMode('register');
                      setError(null);
                    }}
                    className={`rounded-[4px] py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                      citizenMode === 'register'
                        ? 'bg-card text-heading shadow-xs'
                        : 'text-muted hover:text-heading'
                    }`}
                  >
                    Create citizen account
                  </button>
                </div>

                {citizenMode === 'login' ? (
                  <>
                    <form onSubmit={handleCitizenLogin} className="space-y-4">
                      <div>
                        <label htmlFor="citizen-email" className="block text-xs font-medium text-body mb-1.5">
                          Email Address
                        </label>
                        <input
                          id="citizen-email"
                          type="email"
                          required
                          autoComplete="email"
                          value={citizenEmail}
                          onChange={(e) => setCitizenEmail(e.target.value)}
                          className="w-full rounded-[6px] border border-border-subtle bg-app px-3 py-2 text-sm text-heading placeholder:text-muted focus:border-accent-strong focus:outline-none"
                          placeholder="citizen1@fintrace.demo"
                        />
                      </div>

                      <div>
                        <label htmlFor="citizen-password" className="block text-xs font-medium text-body mb-1.5">
                          Password
                        </label>
                        <input
                          id="citizen-password"
                          type="password"
                          required
                          autoComplete="current-password"
                          value={citizenPassword}
                          onChange={(e) => setCitizenPassword(e.target.value)}
                          className="w-full rounded-[6px] border border-border-subtle bg-app px-3 py-2 text-sm text-heading placeholder:text-muted focus:border-accent-strong focus:outline-none"
                          placeholder="Enter your password"
                        />
                      </div>

                      <button
                        type="submit"
                        disabled={submitting}
                        className="flex w-full items-center justify-center gap-2 rounded-[6px] bg-accent-strong px-4 py-2.5 text-sm font-semibold text-white hover:bg-accent-strong-hover disabled:opacity-60 cursor-pointer transition-colors"
                      >
                        <Lock className="h-4 w-4" aria-hidden="true" />
                        {submitting ? 'Signing In...' : 'Sign In as Citizen'}
                      </button>
                    </form>

                    <div className="border-t border-border-subtle pt-4 space-y-2.5">
                      <div className="flex items-center justify-between text-[11px] text-muted">
                        <span className="flex items-center gap-1.5 font-medium text-body">
                          <UserCheck className="h-3.5 w-3.5 text-accent-strong" aria-hidden="true" />
                          Demo Citizen Accounts
                        </span>
                        <span className="font-mono">Pass: FinTrace@Demo2026</span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {CITIZEN_DEMO_ACCOUNTS.map((acct) => (
                          <button
                            key={acct.email}
                            type="button"
                            onClick={() => {
                              setCitizenEmail(acct.email);
                              setCitizenPassword('FinTrace@Demo2026');
                            }}
                            className="rounded-[5px] border border-border-subtle bg-subtle/70 px-2.5 py-1.5 text-left hover:border-accent-strong hover:bg-highlight/50 cursor-pointer transition-colors"
                          >
                            <p className="text-[11px] font-semibold text-heading">{acct.label}</p>
                            <p className="font-mono text-[10px] text-muted truncate">{acct.email}</p>
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                ) : (
                  <form onSubmit={handleCitizenRegister} className="space-y-3.5">
                    <div>
                      <label htmlFor="reg-fullname" className="block text-xs font-medium text-body mb-1">
                        Full Name
                      </label>
                      <input
                        id="reg-fullname"
                        type="text"
                        required
                        minLength={2}
                        value={regName}
                        onChange={(e) => setRegName(e.target.value)}
                        className="w-full rounded-[6px] border border-border-subtle bg-app px-3 py-2 text-sm text-heading placeholder:text-muted focus:border-accent-strong focus:outline-none"
                        placeholder="e.g. Aarav Kulkarni"
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label htmlFor="reg-email" className="block text-xs font-medium text-body mb-1">
                          Email
                        </label>
                        <input
                          id="reg-email"
                          type="email"
                          required
                          value={regEmail}
                          onChange={(e) => setRegEmail(e.target.value)}
                          className="w-full rounded-[6px] border border-border-subtle bg-app px-3 py-2 text-sm text-heading placeholder:text-muted focus:border-accent-strong focus:outline-none"
                          placeholder="you@example.com"
                        />
                      </div>
                      <div>
                        <label htmlFor="reg-phone" className="block text-xs font-medium text-body mb-1">
                          Phone Number
                        </label>
                        <input
                          id="reg-phone"
                          type="tel"
                          required
                          minLength={8}
                          value={regPhone}
                          onChange={(e) => setRegPhone(e.target.value)}
                          className="w-full rounded-[6px] border border-border-subtle bg-app px-3 py-2 text-sm text-heading placeholder:text-muted focus:border-accent-strong focus:outline-none"
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
                        className="w-full rounded-[6px] border border-border-subtle bg-app px-3 py-2 text-sm text-heading focus:border-accent-strong focus:outline-none"
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                          className="w-full rounded-[6px] border border-border-subtle bg-app px-3 py-2 text-sm text-heading focus:border-accent-strong focus:outline-none"
                          placeholder="Strong password"
                        />
                      </div>
                      <div>
                        <label htmlFor="reg-confirm" className="block text-xs font-medium text-body mb-1">
                          Confirm Password
                        </label>
                        <input
                          id="reg-confirm"
                          type="password"
                          required
                          minLength={8}
                          value={regConfirmPassword}
                          onChange={(e) => setRegConfirmPassword(e.target.value)}
                          className="w-full rounded-[6px] border border-border-subtle bg-app px-3 py-2 text-sm text-heading focus:border-accent-strong focus:outline-none"
                          placeholder="Repeat password"
                        />
                      </div>
                    </div>

                    <p className="text-[11px] text-muted">
                      Must be 8+ chars with uppercase, lowercase, number, and special character.
                    </p>

                    <button
                      type="submit"
                      disabled={submitting}
                      className="flex w-full items-center justify-center gap-2 rounded-[6px] bg-accent-strong px-4 py-2.5 text-sm font-semibold text-white hover:bg-accent-strong-hover disabled:opacity-60 cursor-pointer transition-colors"
                    >
                      <UserPlus className="h-4 w-4" aria-hidden="true" />
                      {submitting ? 'Creating Account...' : 'Create Citizen Account'}
                    </button>
                  </form>
                )}
              </>
            ) : (
              <>
                <div>
                  <h2 className="text-sm font-semibold text-heading">Authorized Investigator Sign-In</h2>
                  <p className="mt-1 text-xs text-muted">
                    Authenticate with official role-based credentials to access complaint trails, ML risk scoring, and ATM forecasts.
                  </p>
                </div>

                <form onSubmit={handleOfficerLogin} className="space-y-4">
                  <div>
                    <label htmlFor="login-email" className="block text-xs font-medium text-body mb-1.5">
                      Official Email
                    </label>
                    <input
                      id="login-email"
                      type="email"
                      required
                      autoComplete="email"
                      value={officerEmail}
                      onChange={(e) => setOfficerEmail(e.target.value)}
                      className="w-full rounded-[6px] border border-border-subtle bg-app px-3 py-2 text-sm text-heading placeholder:text-muted focus:border-accent-strong focus:outline-none"
                      placeholder="investigator@fintrace.demo"
                    />
                  </div>

                  <div>
                    <label htmlFor="login-password" className="block text-xs font-medium text-body mb-1.5">
                      Password
                    </label>
                    <input
                      id="login-password"
                      type="password"
                      required
                      autoComplete="current-password"
                      value={officerPassword}
                      onChange={(e) => setOfficerPassword(e.target.value)}
                      className="w-full rounded-[6px] border border-border-subtle bg-app px-3 py-2 text-sm text-heading placeholder:text-muted focus:border-accent-strong focus:outline-none"
                      placeholder="Enter your password"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={submitting}
                    className="flex w-full items-center justify-center gap-2 rounded-[6px] bg-accent-strong px-4 py-2.5 text-sm font-semibold text-white hover:bg-accent-strong-hover disabled:opacity-60 cursor-pointer transition-colors"
                  >
                    <Lock className="h-4 w-4" aria-hidden="true" />
                    {submitting ? 'Verifying Credentials...' : 'Sign In to FinTrace'}
                  </button>
                </form>

                <div className="border-t border-border-subtle pt-4 space-y-2.5">
                  <div className="flex items-center justify-between text-[11px] text-muted">
                    <span className="flex items-center gap-1.5 font-medium text-body">
                      <UserCheck className="h-3.5 w-3.5 text-accent-strong" aria-hidden="true" />
                      Seeded Officer Demo Accounts
                    </span>
                    <span className="font-mono">Pass: FinTrace@Demo2026</span>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    {OFFICER_DEMO_ACCOUNTS.map((acct) => (
                      <button
                        key={acct.email}
                        type="button"
                        onClick={() => {
                          setOfficerEmail(acct.email);
                          setOfficerPassword('FinTrace@Demo2026');
                        }}
                        className="rounded-[5px] border border-border-subtle bg-subtle/70 px-2.5 py-1.5 text-left hover:border-accent-strong hover:bg-highlight/50 cursor-pointer transition-colors"
                      >
                        <p className="text-[11px] font-semibold text-heading">{acct.label}</p>
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

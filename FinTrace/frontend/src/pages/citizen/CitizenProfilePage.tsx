import { Mail, Phone, PhoneCall, ShieldCheck, UserCircle2 } from 'lucide-react';
import { CitizenLayout } from '../../components/layout/CitizenLayout';
import { useAuth } from '../../context/AuthContext';

export function CitizenProfilePage() {
  const { user } = useAuth();

  return (
    <CitizenLayout title="Account profile & cyber safety" subtitle="Your registered citizen account and fraud protection reminders">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Complainant Account Card */}
        <section className="rounded-[12px] border border-border-subtle bg-card p-5 space-y-4">
          <div className="flex items-center gap-3 border-b border-border-subtle pb-4">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-highlight text-accent-strong">
              <UserCircle2 className="h-6 w-6" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-heading">{user?.fullName ?? 'Citizen'}</h2>
              <p className="text-xs text-muted">Verified Citizen Complainant Account</p>
            </div>
          </div>

          <dl className="space-y-3 text-xs">
            <div className="flex items-center justify-between py-2 border-b border-border-subtle">
              <dt className="flex items-center gap-2 text-muted">
                <Mail className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Email address</span>
              </dt>
              <dd className="font-mono font-medium text-heading">{user?.email ?? '—'}</dd>
            </div>
            <div className="flex items-center justify-between py-2 border-b border-border-subtle">
              <dt className="flex items-center gap-2 text-muted">
                <Phone className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Registered mobile</span>
              </dt>
              <dd className="font-mono font-medium text-heading">
                {user?.phoneMasked || '+91-98XXX-XX000'}
              </dd>
            </div>
            <div className="flex items-center justify-between py-2">
              <dt className="flex items-center gap-2 text-muted">
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Portal access level</span>
              </dt>
              <dd className="rounded-[6px] border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-900 dark:border-emerald-800/40 dark:bg-emerald-950/20 dark:text-emerald-200">
                Citizen (Complainant)
              </dd>
            </div>
          </dl>
        </section>

        {/* Cyber Safety Reminders */}
        <section className="rounded-[12px] border border-border-subtle bg-card p-5 space-y-4">
          <div className="flex items-center gap-2 border-b border-border-subtle pb-3">
            <ShieldCheck className="h-4 w-4 text-accent-strong" aria-hidden="true" />
            <h2 className="text-sm font-semibold text-heading">Cyber fraud safety reminders</h2>
          </div>

          <ul className="space-y-3 text-xs text-body leading-relaxed">
            <li className="flex items-start gap-2">
              <span className="font-semibold text-heading">•</span>
              <span>
                <strong className="text-heading">Act within the golden hour:</strong> Report unauthorized debits as quickly as possible. Rapid reporting allows banks to block subsequent inter-bank transfers before funds are withdrawn.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="font-semibold text-heading">•</span>
              <span>
                <strong className="text-heading">Preserve your evidence:</strong> Keep screenshots of debit SMS alerts, UPI transaction reference IDs, scam WhatsApp messages, and phone numbers.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="font-semibold text-heading">•</span>
              <span>
                <strong className="text-heading">Never share secret credentials:</strong> Bank officials, RBI representatives, and police officers will never call to request your UPI PIN, OTP, password, or remote screen sharing access.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="font-semibold text-heading">•</span>
              <span>
                <strong className="text-heading">Track your complaint:</strong> Check progress anytime on this portal using your unique FT reference number.
              </span>
            </li>
          </ul>

          <div className="pt-2 border-t border-border-subtle">
            <div className="rounded-[8px] border border-border-subtle bg-subtle p-3 flex items-center gap-2.5 text-xs text-muted">
              <PhoneCall className="h-4 w-4 text-accent-strong shrink-0" aria-hidden="true" />
              <span>National Cybercrime Helpline: <strong className="font-mono text-accent-strong">1930</strong> (Toll-free, 24/7)</span>
            </div>
          </div>
        </section>
      </div>
    </CitizenLayout>
  );
}

import { Mail, Phone, ShieldCheck, UserCircle2 } from 'lucide-react';
import { CitizenLayout } from '../../components/layout/CitizenLayout';
import { useAuth } from '../../context/AuthContext';

export function CitizenProfilePage() {
  const { user } = useAuth();

  return (
    <CitizenLayout title="Profile" subtitle="Your registered citizen account and safety guidance">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="rounded-[8px] border border-border-subtle bg-card p-5 space-y-4">
          <div className="flex items-center gap-3 border-b border-border-subtle pb-4">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-highlight text-accent-strong">
              <UserCircle2 className="h-6 w-6" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-heading">{user?.fullName}</h2>
              <p className="text-xs text-muted">Verified Citizen Complainant Account</p>
            </div>
          </div>

          <dl className="space-y-3 text-xs">
            <div className="flex items-center justify-between py-1.5 border-b border-border-subtle">
              <dt className="flex items-center gap-2 text-muted">
                <Mail className="h-3.5 w-3.5" aria-hidden="true" />
                Email Address
              </dt>
              <dd className="font-mono font-medium text-heading">{user?.email}</dd>
            </div>
            <div className="flex items-center justify-between py-1.5 border-b border-border-subtle">
              <dt className="flex items-center gap-2 text-muted">
                <Phone className="h-3.5 w-3.5" aria-hidden="true" />
                Registered Mobile
              </dt>
              <dd className="font-mono font-medium text-heading">
                {user?.phoneMasked || '+91-98XXX-XX000'}
              </dd>
            </div>
            <div className="flex items-center justify-between py-1.5">
              <dt className="flex items-center gap-2 text-muted">
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                Portal Access Role
              </dt>
              <dd className="rounded-[4px] border border-emerald-300 bg-[#D8F8EC] px-2 py-0.5 text-[11px] font-semibold text-[#065F46] dark:border-emerald-700/50 dark:bg-emerald-950/40 dark:text-emerald-200">
                Citizen (Complainant)
              </dd>
            </div>
          </dl>
        </section>

        <section className="rounded-[8px] border border-border-subtle bg-grad-mint p-5 space-y-3">
          <h2 className="text-sm font-bold text-heading">Cyber Fraud Safety Reminders</h2>
          <ul className="space-y-2 text-xs text-body list-disc pl-4">
            <li>Report unauthorized UPI, card, or net-banking debits immediately so banks can freeze onward transfers.</li>
            <li>Keep screenshots of SMS alerts, UTR/transaction IDs, and suspicious phone numbers or links.</li>
            <li>Never share OTPs, UPI PINs, or remote screen-sharing access with anyone claiming to be bank staff or police.</li>
            <li>Track all official case updates directly inside your My Complaints status page using your FT reference number.</li>
          </ul>
        </section>
      </div>
    </CitizenLayout>
  );
}

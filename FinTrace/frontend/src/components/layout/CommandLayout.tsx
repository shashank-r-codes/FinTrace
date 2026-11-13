import {
  Activity,
  ArrowLeftRight,
  BellRing,
  Bot,
  Briefcase,
  Cpu,
  FileBarChart2,
  FileText,
  FolderLock,
  Landmark,
  LayoutDashboard,
  LogOut,
  MapPin,
  Menu,
  Network,
  Shield,
  Users,
  X,
} from 'lucide-react';
import { ReactNode, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { UserRole } from '../../types';

interface NavItem {
  path: string;
  label: string;
  section: string;
  icon: typeof LayoutDashboard;
  roles: UserRole[];
}

const ALL_ROLES: UserRole[] = [
  'Administrator',
  'Senior Investigator',
  'Investigator',
  'Bank Nodal Officer',
];

const NAV_ITEMS: NavItem[] = [
  { path: '/', label: 'Command Dashboard', section: 'Core Operations', icon: LayoutDashboard, roles: ALL_ROLES },
  { path: '/complaints', label: 'Complaints Registry', section: 'Core Operations', icon: FileText, roles: ALL_ROLES },
  { path: '/transactions', label: 'Transaction Explorer', section: 'Core Operations', icon: ArrowLeftRight, roles: ALL_ROLES },
  { path: '/graph', label: 'Network & Hop Graph', section: 'Intelligence Engines', icon: Network, roles: ALL_ROLES },
  { path: '/fraud-ml', label: 'ML Fraud & Mule Risk', section: 'Intelligence Engines', icon: Cpu, roles: ALL_ROLES },
  { path: '/atm-predictions', label: 'ATM Cash-Out Engine', section: 'Intelligence Engines', icon: Landmark, roles: ALL_ROLES },
  { path: '/map', label: 'GIS Hotspot Map', section: 'Intelligence Engines', icon: MapPin, roles: ALL_ROLES },
  { path: '/alerts', label: 'Early Warning Alerts', section: 'Response & Casework', icon: BellRing, roles: ALL_ROLES },
  {
    path: '/investigations',
    label: 'Investigations',
    section: 'Response & Casework',
    icon: Briefcase,
    roles: ['Administrator', 'Senior Investigator', 'Investigator'],
  },
  {
    path: '/evidence',
    label: 'Evidence Vault',
    section: 'Response & Casework',
    icon: FolderLock,
    roles: ['Administrator', 'Senior Investigator', 'Investigator'],
  },
  {
    path: '/reports',
    label: 'Reports & Analytics',
    section: 'Governance & AI',
    icon: FileBarChart2,
    roles: ['Administrator', 'Senior Investigator', 'Investigator'],
  },
  {
    path: '/assistant',
    label: 'AI Case Assistant',
    section: 'Governance & AI',
    icon: Bot,
    roles: ['Administrator', 'Senior Investigator', 'Investigator'],
  },
  {
    path: '/settings',
    label: 'Users & Audit Logs',
    section: 'Governance & AI',
    icon: Users,
    roles: ['Administrator', 'Senior Investigator'],
  },
];

interface CommandLayoutProps {
  title: string;
  section?: string;
  actions?: ReactNode;
  children: ReactNode;
}

export function CommandLayout({ title, section = 'Command', actions, children }: CommandLayoutProps) {
  const { user, logout, hasRole } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const showSyntheticBanner = import.meta.env.VITE_SYNTHETIC_BANNER !== 'false';
  const visibleItems = NAV_ITEMS.filter((item) => hasRole(...item.roles));
  const sections = Array.from(new Set(visibleItems.map((i) => i.section)));

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const sidebarContent = (
    <div className="flex h-full flex-col bg-[#090E1A] border-r border-slate-800/90">
      <div className="flex items-center justify-between px-4 py-4 border-b border-slate-800/90">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-[6px] border border-sky-500/40 bg-sky-950/60 text-sky-400">
            <Shield className="h-4 w-4" aria-hidden="true" />
          </div>
          <div>
            <p className="text-sm font-bold tracking-tight text-slate-100">FinTrace</p>
            <p className="text-[11px] text-slate-400">SIH PS 26184 · Predictive Intel</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setMobileNavOpen(false)}
          className="lg:hidden rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100 cursor-pointer"
          aria-label="Close navigation"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5" aria-label="Primary navigation">
        {sections.map((secName) => (
          <div key={secName}>
            <p className="px-2.5 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              {secName}
            </p>
            <ul className="space-y-0.5">
              {visibleItems
                .filter((i) => i.section === secName)
                .map((item) => {
                  const Icon = item.icon;
                  const isActive =
                    item.path === '/'
                      ? location.pathname === '/'
                      : location.pathname.startsWith(item.path);
                  return (
                    <li key={item.path}>
                      <NavLink
                        to={item.path}
                        onClick={() => setMobileNavOpen(false)}
                        className={`flex items-center gap-2.5 rounded-[5px] px-2.5 py-2 text-[13px] font-medium transition-colors whitespace-nowrap ${
                          isActive
                            ? 'bg-sky-950/70 text-sky-200 border border-sky-500/30'
                            : 'text-slate-300 border border-transparent hover:bg-slate-800/60 hover:text-white'
                        }`}
                      >
                        <Icon
                          className={`h-4 w-4 shrink-0 ${isActive ? 'text-sky-400' : 'text-slate-400'}`}
                          aria-hidden="true"
                        />
                        <span className="truncate">{item.label}</span>
                      </NavLink>
                    </li>
                  );
                })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-slate-800/90 p-3 space-y-2.5">
        <div className="px-2">
          <p className="text-xs font-semibold text-slate-200 truncate">{user?.fullName}</p>
          <p className="text-[11px] text-slate-400 truncate">
            {user?.role} · {user?.email}
          </p>
        </div>
        <button
          type="button"
          onClick={handleLogout}
          className="flex w-full items-center justify-center gap-2 rounded-[5px] border border-slate-700/80 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800 hover:text-white cursor-pointer"
        >
          <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
          Sign Out
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-[#0B1120] text-slate-100">
      <aside className="hidden lg:block lg:w-64 lg:shrink-0 sticky top-0 h-screen">
        {sidebarContent}
      </aside>

      {mobileNavOpen ? (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div className="w-64 h-full">{sidebarContent}</div>
          <div
            className="flex-1 bg-black/60"
            onClick={() => setMobileNavOpen(false)}
            aria-hidden="true"
          />
        </div>
      ) : null}

      <div className="flex flex-1 flex-col min-w-0">
        {showSyntheticBanner ? (
          <div className="border-b border-amber-500/25 bg-amber-950/30 px-4 py-1.5 text-[11px] text-amber-200 flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <Activity className="h-3.5 w-3.5 text-amber-400 shrink-0" aria-hidden="true" />
              <span>
                Synthetic Demonstration Dataset · All accounts, transactions, and Bengaluru ATM records are synthetic for investigative simulation.
              </span>
            </span>
            <span className="hidden sm:inline font-mono text-[11px] text-amber-300/80">
              ENV: DEMO-BLR
            </span>
          </div>
        ) : null}

        <header className="sticky top-0 z-30 border-b border-slate-800/90 bg-[#0B1120]/95 backdrop-blur-sm px-4 sm:px-6 py-3">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={() => setMobileNavOpen(true)}
                className="lg:hidden rounded-[5px] border border-slate-700 p-1.5 text-slate-300 hover:bg-slate-800 cursor-pointer"
                aria-label="Open navigation menu"
              >
                <Menu className="h-4 w-4" />
              </button>
              <div className="min-w-0">
                <p className="text-xs text-slate-400 truncate">
                  <span>{section}</span>
                  <span className="mx-1.5 text-slate-600">/</span>
                  <span className="text-slate-200 font-medium">{title}</span>
                </p>
                <h1 className="text-base sm:text-lg font-semibold tracking-tight text-white truncate">
                  {title}
                </h1>
              </div>
            </div>

            {actions ? (
              <div className="flex items-center gap-2 shrink-0">{actions}</div>
            ) : null}
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 space-y-6">{children}</main>
      </div>
    </div>
  );
}

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
import { ThemeToggle } from '../common/ThemeToggle';

interface NavItem {
  path: string;
  label: string;
  section: string;
  icon: typeof LayoutDashboard;
  roles: UserRole[];
}

const ALL_OFFICER_ROLES: UserRole[] = [
  'Administrator',
  'Senior Investigator',
  'Investigator',
  'Bank Nodal Officer',
];

const NAV_ITEMS: NavItem[] = [
  { path: '/', label: 'Command Dashboard', section: 'Core Operations', icon: LayoutDashboard, roles: ALL_OFFICER_ROLES },
  { path: '/complaints', label: 'Complaints Registry', section: 'Core Operations', icon: FileText, roles: ALL_OFFICER_ROLES },
  { path: '/transactions', label: 'Transaction Explorer', section: 'Core Operations', icon: ArrowLeftRight, roles: ALL_OFFICER_ROLES },
  { path: '/graph', label: 'Network & Hop Graph', section: 'Intelligence Engines', icon: Network, roles: ALL_OFFICER_ROLES },
  { path: '/fraud-ml', label: 'ML Fraud & Mule Risk', section: 'Intelligence Engines', icon: Cpu, roles: ALL_OFFICER_ROLES },
  { path: '/atm-predictions', label: 'ATM Cash-Out Engine', section: 'Intelligence Engines', icon: Landmark, roles: ALL_OFFICER_ROLES },
  { path: '/map', label: 'GIS Hotspot Map', section: 'Intelligence Engines', icon: MapPin, roles: ALL_OFFICER_ROLES },
  { path: '/alerts', label: 'Early Warning Alerts', section: 'Response & Casework', icon: BellRing, roles: ALL_OFFICER_ROLES },
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
    <div className="flex h-full flex-col bg-sidebar border-r border-border-subtle transition-colors duration-200">
      <div className="flex items-center justify-between px-4 py-4 border-b border-border-subtle bg-grad-sky">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-[6px] border border-accent-strong/40 bg-card text-accent-strong shadow-xs">
            <Shield className="h-4 w-4" aria-hidden="true" />
          </div>
          <div>
            <p className="text-sm font-bold tracking-tight text-heading">FinTrace</p>
            <p className="text-[11px] text-muted">SIH PS 26184 · Predictive Intel</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setMobileNavOpen(false)}
          className="lg:hidden rounded p-1 text-muted hover:bg-highlight hover:text-heading cursor-pointer"
          aria-label="Close navigation"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5" aria-label="Primary navigation">
        {sections.map((secName) => (
          <div key={secName}>
            <p className="px-2.5 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
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
                        className={`flex items-center gap-2.5 rounded-[5px] px-2.5 py-2 text-[13px] font-medium transition-colors duration-150 whitespace-nowrap ${
                          isActive
                            ? 'bg-highlight text-heading border border-accent-strong/40 dark:bg-sky-950/70 dark:text-sky-100 dark:border-sky-500/35'
                            : 'text-body border border-transparent hover:bg-subtle hover:text-heading'
                        }`}
                      >
                        <Icon
                          className={`h-4 w-4 shrink-0 ${isActive ? 'text-accent-strong dark:text-sky-400' : 'text-muted'}`}
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

      <div className="border-t border-border-subtle p-3 space-y-2.5 bg-subtle/60">
        <div className="px-2">
          <p className="text-xs font-semibold text-heading truncate">{user?.fullName}</p>
          <p className="text-[11px] text-muted truncate">
            {user?.role} · {user?.email}
          </p>
        </div>
        <button
          type="button"
          onClick={handleLogout}
          className="flex w-full items-center justify-center gap-2 rounded-[5px] border border-border-subtle bg-card px-3 py-1.5 text-xs font-medium text-heading hover:bg-highlight cursor-pointer transition-colors duration-150"
        >
          <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
          Sign Out
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-app text-heading transition-colors duration-200">
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
          <div className="border-b border-amber-300 bg-[#FEF3C7] text-[#92400E] dark:border-amber-500/25 dark:bg-amber-950/30 dark:text-amber-200 px-4 py-1.5 text-[11px] flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <Activity className="h-3.5 w-3.5 text-[#B45309] dark:text-amber-400 shrink-0" aria-hidden="true" />
              <span>
                Synthetic Demonstration Dataset · All accounts, transactions, and Bengaluru ATM records are synthetic for investigative simulation.
              </span>
            </span>
            <span className="hidden sm:inline font-mono text-[11px] opacity-85">
              ENV: DEMO-BLR
            </span>
          </div>
        ) : null}

        <header className="sticky top-0 z-30 border-b border-border-subtle bg-card/95 backdrop-blur-sm px-4 sm:px-6 py-3 transition-colors duration-200">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={() => setMobileNavOpen(true)}
                className="lg:hidden rounded-[5px] border border-border-subtle p-1.5 text-heading hover:bg-highlight cursor-pointer"
                aria-label="Open navigation menu"
              >
                <Menu className="h-4 w-4" />
              </button>
              <div className="min-w-0">
                <p className="text-xs text-muted truncate">
                  <span>{section}</span>
                  <span className="mx-1.5 opacity-60">/</span>
                  <span className="text-heading font-medium">{title}</span>
                </p>
                <h1 className="text-base sm:text-lg font-semibold tracking-tight text-heading truncate">
                  {title}
                </h1>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {actions}
              <ThemeToggle />
            </div>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 space-y-6">{children}</main>
      </div>
    </div>
  );
}

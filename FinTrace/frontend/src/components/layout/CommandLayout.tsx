import {
  Activity,
  ArrowLeftRight,
  BellRing,
  Bot,
  Boxes,
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
  PlayCircle,
  Shield,
  ShieldAlert,
  Sliders,
  Users,
  X,
  Zap,
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
  { path: '/', label: 'Command dashboard', section: 'Core operations', icon: LayoutDashboard, roles: ALL_OFFICER_ROLES },
  { path: '/complaints', label: 'Complaints registry', section: 'Core operations', icon: FileText, roles: ALL_OFFICER_ROLES },
  { path: '/transactions', label: 'Transaction explorer', section: 'Core operations', icon: ArrowLeftRight, roles: ALL_OFFICER_ROLES },

  // --- Fraud Prevention Layer (Pre-Transaction) ---
  {
    path: '/accounts/intelligence',
    label: 'Account intelligence',
    section: 'Fraud prevention',
    icon: ShieldAlert,
    roles: ALL_OFFICER_ROLES,
  },
  {
    path: '/screening',
    label: 'Real-time screening',
    section: 'Fraud prevention',
    icon: Zap,
    roles: ALL_OFFICER_ROLES,
  },
  {
    path: '/interventions',
    label: 'Intervention centre',
    section: 'Fraud prevention',
    icon: Sliders,
    roles: ALL_OFFICER_ROLES,
  },
  {
    path: '/mule-clusters',
    label: 'Mule syndicates & rings',
    section: 'Fraud prevention',
    icon: Boxes,
    roles: ALL_OFFICER_ROLES,
  },
  {
    path: '/prevention-simulator',
    label: 'Prevention simulator',
    section: 'Fraud prevention',
    icon: PlayCircle,
    roles: ALL_OFFICER_ROLES,
  },

  // --- Intelligence Engines ---
  { path: '/graph', label: 'Network graph', section: 'Intelligence engines', icon: Network, roles: ALL_OFFICER_ROLES },
  { path: '/fraud-ml', label: 'ML fraud & mule risk', section: 'Intelligence engines', icon: Cpu, roles: ALL_OFFICER_ROLES },
  { path: '/atm-predictions', label: 'ATM cash-out engine', section: 'Intelligence engines', icon: Landmark, roles: ALL_OFFICER_ROLES },
  { path: '/map', label: 'GIS hotspot map', section: 'Intelligence engines', icon: MapPin, roles: ALL_OFFICER_ROLES },

  // --- Casework & Response ---
  { path: '/alerts', label: 'Early warning alerts', section: 'Response & casework', icon: BellRing, roles: ALL_OFFICER_ROLES },
  {
    path: '/investigations',
    label: 'Case investigations',
    section: 'Response & casework',
    icon: Briefcase,
    roles: ['Administrator', 'Senior Investigator', 'Investigator'],
  },
  {
    path: '/evidence',
    label: 'Evidence vault',
    section: 'Response & casework',
    icon: FolderLock,
    roles: ['Administrator', 'Senior Investigator', 'Investigator'],
  },

  // --- Governance & AI ---
  {
    path: '/reports',
    label: 'Reports & analytics',
    section: 'Governance & administration',
    icon: FileBarChart2,
    roles: ['Administrator', 'Senior Investigator', 'Investigator'],
  },
  {
    path: '/assistant',
    label: 'AI case assistant',
    section: 'Governance & administration',
    icon: Bot,
    roles: ['Administrator', 'Senior Investigator', 'Investigator'],
  },
  {
    path: '/settings',
    label: 'Users & audit logs',
    section: 'Governance & administration',
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
    <div className="flex h-full flex-col bg-sidebar border-r border-border-subtle transition-colors duration-120">
      {/* Brand Header */}
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-border-subtle bg-sidebar">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-[6px] border border-border-subtle bg-subtle text-accent-strong">
            <Shield className="h-4 w-4" aria-hidden="true" />
          </div>
          <div>
            <p className="text-xs font-semibold tracking-tight text-heading">FinTrace</p>
            <p className="text-[10px] text-muted font-mono">Forensic Intel Platform</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setMobileNavOpen(false)}
          className="lg:hidden rounded-[6px] p-1 text-muted hover:bg-subtle hover:text-heading cursor-pointer transition-colors"
          aria-label="Close navigation"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Navigation Groups */}
      <nav className="flex-1 overflow-y-auto px-2.5 py-3 space-y-4" aria-label="Primary navigation">
        {sections.map((secName) => (
          <div key={secName} className="space-y-1">
            <p className="px-2 text-[10px] font-medium uppercase tracking-wider text-muted/80">
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
                        className={`flex h-8 items-center gap-2 rounded-[6px] px-2 text-xs font-medium transition-colors duration-120 whitespace-nowrap ${
                          isActive
                            ? 'bg-subtle text-heading border border-border-subtle font-semibold shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]'
                            : 'text-body border border-transparent hover:bg-subtle/60 hover:text-heading'
                        }`}
                      >
                        <Icon
                          className={`h-3.5 w-3.5 shrink-0 ${
                            isActive ? 'text-accent-strong dark:text-sky-400' : 'text-muted'
                          }`}
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

      {/* User Status & Sign Out */}
      <div className="border-t border-border-subtle p-3 space-y-2 bg-sidebar">
        <div className="px-1">
          <p className="text-xs font-medium text-heading truncate">{user?.fullName}</p>
          <p className="text-[11px] text-muted truncate">
            {user?.role} · {user?.email}
          </p>
        </div>
        <button
          type="button"
          onClick={handleLogout}
          className="flex w-full items-center justify-center gap-1.5 rounded-[8px] border border-border-subtle bg-card px-3 py-1.5 text-xs font-medium text-heading hover:bg-subtle cursor-pointer transition-colors duration-120"
        >
          <LogOut className="h-3.5 w-3.5 text-muted" aria-hidden="true" />
          <span>Sign out</span>
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-app text-heading transition-colors duration-120">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:block lg:w-60 lg:shrink-0 sticky top-0 h-screen">
        {sidebarContent}
      </aside>

      {/* Mobile Drawer */}
      {mobileNavOpen ? (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div className="w-60 h-full">{sidebarContent}</div>
          <div
            className="flex-1 bg-black/50 backdrop-blur-xs"
            onClick={() => setMobileNavOpen(false)}
            aria-hidden="true"
          />
        </div>
      ) : null}

      <div className="flex flex-1 flex-col min-w-0">
        {/* Synthetic Dataset Notice */}
        {showSyntheticBanner ? (
          <div className="border-b border-border-subtle bg-subtle px-4 py-1.5 text-[11px] text-body flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <Activity className="h-3 w-3 text-muted shrink-0" aria-hidden="true" />
              <span>
                Synthetic demonstration dataset — All bank accounts, transfers, and Bengaluru ATM records are simulated for casework.
              </span>
            </span>
            <span className="hidden sm:inline font-mono text-[10px] text-muted">
              ENV: DEMO-BLR
            </span>
          </div>
        ) : null}

        {/* Top Header */}
        <header className="sticky top-0 z-30 border-b border-border-subtle bg-card/95 backdrop-blur-xs px-4 sm:px-6 py-2.5 transition-colors duration-120">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={() => setMobileNavOpen(true)}
                className="lg:hidden rounded-[8px] border border-border-subtle p-1.5 text-heading hover:bg-subtle cursor-pointer transition-colors"
                aria-label="Open navigation menu"
              >
                <Menu className="h-4 w-4" />
              </button>
              <div className="min-w-0">
                <p className="text-[11px] text-muted truncate">
                  <span>{section}</span>
                  <span className="mx-1.5 opacity-40">/</span>
                  <span className="text-heading font-medium">{title}</span>
                </p>
                <h1 className="text-base font-semibold tracking-tight text-heading truncate">
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

        {/* Viewport Content */}
        <main className="flex-1 p-4 sm:p-6 space-y-5 max-w-[1600px] w-full">{children}</main>
      </div>
    </div>
  );
}

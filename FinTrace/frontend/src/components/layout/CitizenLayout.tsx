import {
  Bell,
  FilePlus2,
  FileText,
  Home,
  LogOut,
  Menu,
  ShieldCheck,
  UserCircle2,
  X,
} from 'lucide-react';
import { ReactNode, useCallback, useEffect, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { apiRequest } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { ApiSuccessResponse, CitizenNotificationItem } from '../../types';
import { formatTimestamp } from '../../utils/formatters';
import { ThemeToggle } from '../common/ThemeToggle';

interface CitizenLayoutProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}

const CITIZEN_NAV = [
  { path: '/citizen', label: 'My dashboard', icon: Home, exact: true },
  { path: '/citizen/file', label: 'File a complaint', icon: FilePlus2, exact: false },
  { path: '/citizen/complaints', label: 'My complaints', icon: FileText, exact: false },
  { path: '/citizen/profile', label: 'Account profile', icon: UserCircle2, exact: false },
];

export function CitizenLayout({ title, subtitle, actions, children }: CitizenLayoutProps) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<CitizenNotificationItem[]>([]);

  const loadNotifications = useCallback(async () => {
    try {
      const res = await apiRequest<
        ApiSuccessResponse<{ unreadCount: number; notifications: CitizenNotificationItem[] }>
      >('/citizen/notifications');
      setUnreadCount(res.data.unreadCount);
      setNotifications(res.data.notifications);
    } catch {
      // Non-blocking notification fetch
    }
  }, []);

  useEffect(() => {
    void loadNotifications();
  }, [loadNotifications, location.pathname]);

  const handleMarkRead = async () => {
    if (unreadCount === 0) return;
    try {
      await apiRequest('/citizen/notifications/read', { method: 'POST' });
      setUnreadCount(0);
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    } catch {
      // Ignore error
    }
  };

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
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
          </div>
          <div>
            <p className="text-xs font-semibold tracking-tight text-heading">FinTrace Citizen</p>
            <p className="text-[10px] text-muted">Cyber Fraud Helpdesk</p>
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

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-2.5 py-3 space-y-1" aria-label="Citizen portal navigation">
        {CITIZEN_NAV.map((item) => {
          const Icon = item.icon;
          const isActive = item.exact
            ? location.pathname === item.path
            : location.pathname.startsWith(item.path);
          return (
            <NavLink
              key={item.path}
              to={item.path}
              onClick={() => setMobileNavOpen(false)}
              className={`flex h-9 items-center gap-2.5 rounded-[8px] px-3 text-xs font-medium transition-colors duration-120 ${
                isActive
                  ? 'bg-subtle text-heading border border-border-subtle font-semibold shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]'
                  : 'text-body border border-transparent hover:bg-subtle/60 hover:text-heading'
              }`}
            >
              <Icon
                className={`h-4 w-4 shrink-0 ${
                  isActive ? 'text-accent-strong dark:text-sky-400' : 'text-muted'
                }`}
                aria-hidden="true"
              />
              <span>{item.label}</span>
            </NavLink>
          );
        })}
      </nav>

      {/* User Status & Sign Out */}
      <div className="border-t border-border-subtle p-3 space-y-2 bg-sidebar">
        <div className="px-1">
          <p className="text-xs font-medium text-heading truncate">{user?.fullName}</p>
          <p className="text-[11px] text-muted truncate">{user?.email}</p>
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
        {/* Top Header */}
        <header className="sticky top-0 z-30 border-b border-border-subtle bg-card/95 backdrop-blur-xs px-4 sm:px-6 py-3 transition-colors duration-120">
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
                <h1 className="text-base font-semibold tracking-tight text-heading truncate">
                  {title}
                </h1>
                {subtitle ? (
                  <p className="text-xs text-muted truncate mt-0.5">{subtitle}</p>
                ) : null}
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0 relative">
              {actions}
              <button
                type="button"
                onClick={() => {
                  const next = !notifOpen;
                  setNotifOpen(next);
                  if (next) void handleMarkRead();
                }}
                aria-label="Notifications"
                className="relative inline-flex items-center justify-center rounded-[8px] border border-border-subtle bg-card p-2 text-heading hover:bg-subtle cursor-pointer transition-colors duration-120"
              >
                <Bell className="h-4 w-4 text-muted" aria-hidden="true" />
                {unreadCount > 0 ? (
                  <span className="absolute -top-1 -right-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-600 px-1 font-mono text-[10px] font-bold text-white tabular-nums">
                    {unreadCount}
                  </span>
                ) : null}
              </button>
              <ThemeToggle />

              {/* Notification Popover */}
              {notifOpen ? (
                <div className="absolute right-0 top-12 z-40 w-80 rounded-[12px] border border-border-subtle bg-card shadow-float overflow-hidden animate-in fade-in duration-120">
                  <div className="flex items-center justify-between border-b border-border-subtle bg-subtle px-4 py-2.5">
                    <span className="text-xs font-semibold text-heading">Case updates</span>
                    <button
                      type="button"
                      onClick={() => setNotifOpen(false)}
                      className="text-xs text-muted hover:text-heading cursor-pointer"
                    >
                      Close
                    </button>
                  </div>
                  <div className="max-h-72 overflow-y-auto divide-y divide-border-subtle">
                    {notifications.length === 0 ? (
                      <p className="p-4 text-xs text-muted text-center">No new case updates at this time.</p>
                    ) : (
                      notifications.map((n) => (
                        <button
                          key={n.id}
                          type="button"
                          onClick={() => {
                            setNotifOpen(false);
                            navigate(`/citizen/complaints/${n.complaint_id}`);
                          }}
                          className="w-full px-4 py-3 text-left hover:bg-subtle/80 transition-colors cursor-pointer space-y-1"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono text-[11px] font-semibold text-accent-strong">
                              {n.reference_no}
                            </span>
                            <span className="text-[10px] text-muted">{formatTimestamp(n.created_at)}</span>
                          </div>
                          <p className="text-xs font-medium text-heading leading-snug">{n.title}</p>
                          <p className="text-[11px] text-muted line-clamp-2 leading-relaxed">{n.message}</p>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        {/* Roomier Citizen Content */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 space-y-6 max-w-5xl w-full mx-auto">{children}</main>
      </div>
    </div>
  );
}

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
  { path: '/citizen', label: 'My Dashboard', icon: Home, exact: true },
  { path: '/citizen/file', label: 'File a Complaint', icon: FilePlus2, exact: false },
  { path: '/citizen/complaints', label: 'My Complaints', icon: FileText, exact: false },
  { path: '/citizen/profile', label: 'Profile', icon: UserCircle2, exact: false },
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
    <div className="flex h-full flex-col bg-sidebar border-r border-border-subtle transition-colors duration-200">
      <div className="flex items-center justify-between px-4 py-4 border-b border-border-subtle bg-grad-sky">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-[6px] border border-accent-strong/40 bg-card text-accent-strong shadow-xs">
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
          </div>
          <div>
            <p className="text-sm font-bold tracking-tight text-heading">FinTrace Citizen</p>
            <p className="text-[11px] text-muted">Cyber Fraud Helpdesk</p>
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

      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1" aria-label="Citizen Portal navigation">
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
              className={`flex items-center gap-2.5 rounded-[6px] px-3 py-2.5 text-[13px] font-medium transition-colors duration-150 ${
                isActive
                  ? 'bg-highlight text-heading border border-accent-strong/40 dark:bg-sky-950/70 dark:text-sky-100 dark:border-sky-500/35'
                  : 'text-body border border-transparent hover:bg-subtle hover:text-heading'
              }`}
            >
              <Icon
                className={`h-4 w-4 shrink-0 ${isActive ? 'text-accent-strong dark:text-sky-400' : 'text-muted'}`}
                aria-hidden="true"
              />
              <span>{item.label}</span>
            </NavLink>
          );
        })}
      </nav>

      <div className="border-t border-border-subtle p-3 space-y-2.5 bg-subtle/60">
        <div className="px-2">
          <p className="text-xs font-semibold text-heading truncate">{user?.fullName}</p>
          <p className="text-[11px] text-muted truncate">{user?.email}</p>
        </div>
        <button
          type="button"
          onClick={handleLogout}
          className="flex w-full items-center justify-center gap-2 rounded-[6px] border border-border-subtle bg-card px-3 py-1.5 text-xs font-medium text-heading hover:bg-highlight cursor-pointer transition-colors"
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
        <header className="sticky top-0 z-30 border-b border-border-subtle bg-card/95 backdrop-blur-sm px-4 sm:px-6 py-3 transition-colors duration-200">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={() => setMobileNavOpen(true)}
                className="lg:hidden rounded-[6px] border border-border-subtle p-1.5 text-heading hover:bg-highlight cursor-pointer"
                aria-label="Open navigation menu"
              >
                <Menu className="h-4 w-4" />
              </button>
              <div className="min-w-0">
                <h1 className="text-base sm:text-lg font-semibold tracking-tight text-heading truncate">
                  {title}
                </h1>
                {subtitle ? <p className="text-xs text-muted truncate">{subtitle}</p> : null}
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
                className="relative inline-flex items-center justify-center rounded-[6px] border border-border-subtle bg-card p-1.5 text-heading hover:bg-highlight cursor-pointer transition-colors"
              >
                <Bell className="h-4 w-4" aria-hidden="true" />
                {unreadCount > 0 ? (
                  <span className="absolute -top-1.5 -right-1.5 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[#DC2626] px-1 text-[10px] font-bold text-white">
                    {unreadCount}
                  </span>
                ) : null}
              </button>
              <ThemeToggle />

              {notifOpen ? (
                <div className="absolute right-0 top-11 z-40 w-80 rounded-[8px] border border-border-subtle bg-card shadow-xl overflow-hidden">
                  <div className="flex items-center justify-between border-b border-border-subtle bg-subtle px-3.5 py-2.5">
                    <span className="text-xs font-semibold text-heading">Case Updates</span>
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
                      <p className="p-4 text-xs text-muted text-center">No notifications yet.</p>
                    ) : (
                      notifications.map((n) => (
                        <button
                          key={n.id}
                          type="button"
                          onClick={() => {
                            setNotifOpen(false);
                            navigate(`/citizen/complaints/${n.complaint_id}`);
                          }}
                          className="w-full px-3.5 py-2.5 text-left hover:bg-subtle/80 transition-colors cursor-pointer"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono text-[11px] font-semibold text-accent-strong">
                              {n.reference_no}
                            </span>
                            <span className="text-[10px] text-muted">{formatTimestamp(n.created_at)}</span>
                          </div>
                          <p className="mt-0.5 text-xs font-medium text-heading">{n.title}</p>
                          <p className="mt-0.5 text-[11px] text-muted line-clamp-2">{n.message}</p>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 space-y-6">{children}</main>
      </div>
    </div>
  );
}

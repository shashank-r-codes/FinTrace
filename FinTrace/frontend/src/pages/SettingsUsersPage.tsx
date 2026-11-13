import { CheckCircle2, Plus, RefreshCw, ScrollText, Shield, Users } from 'lucide-react';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { apiRequest, ApiError } from '../api/client';
import { EmptyDataState, ErrorDataState, TableSkeleton } from '../components/common/DataState';
import { CommandLayout } from '../components/layout/CommandLayout';
import { useAuth } from '../context/AuthContext';
import {
  ApiSuccessResponse,
  AuditLogRow,
  RoleDefinitionRow,
  UserDirectoryRow,
  UserRole,
} from '../types';
import { formatTimestamp } from '../utils/formatters';

export function SettingsUsersPage() {
  const { hasRole } = useAuth();
  const isAdmin = hasRole('Administrator');

  const [activeTab, setActiveTab] = useState<'users' | 'audit'>('users');
  const [users, setUsers] = useState<UserDirectoryRow[]>([]);
  const [roles, setRoles] = useState<RoleDefinitionRow[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogRow[]>([]);
  const [auditActionFilter, setAuditActionFilter] = useState('');
  const [auditResourceFilter, setAuditResourceFilter] = useState('');

  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formEmail, setFormEmail] = useState('');
  const [formPassword, setFormPassword] = useState('');
  const [formFullName, setFormFullName] = useState('');
  const [formRole, setFormRole] = useState<UserRole>('Investigator');
  const [formBadge, setFormBadge] = useState('');
  const [formUnit, setFormUnit] = useState('Bengaluru Cyber Crime Cell');
  const [formJurisdiction, setFormJurisdiction] = useState('Bengaluru Urban');

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const auditParams = new URLSearchParams({ limit: '80' });
      if (auditActionFilter.trim()) auditParams.set('action', auditActionFilter.trim());
      if (auditResourceFilter.trim()) auditParams.set('resourceType', auditResourceFilter.trim());

      const [usersRes, rolesRes, auditRes] = await Promise.all([
        apiRequest<ApiSuccessResponse<UserDirectoryRow[]>>('/users'),
        apiRequest<ApiSuccessResponse<RoleDefinitionRow[]>>('/users/roles'),
        apiRequest<ApiSuccessResponse<AuditLogRow[]>>(`/audit-logs?${auditParams.toString()}`),
      ]);

      setUsers(usersRes.data);
      setRoles(rolesRes.data);
      setAuditLogs(auditRes.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to load governance records.');
    } finally {
      setLoading(false);
    }
  }, [auditActionFilter, auditResourceFilter]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleToggleActive = async (u: UserDirectoryRow) => {
    if (!isAdmin) return;
    setUpdatingId(u.id);
    setError(null);
    setNotice(null);
    try {
      await apiRequest(`/users/${u.id}`, {
        method: 'PATCH',
        body: { isActive: !u.is_active },
      });
      setNotice(`${u.full_name} is now ${u.is_active ? 'deactivated' : 'active'}.`);
      await loadData();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update user status.');
    } finally {
      setUpdatingId(null);
    }
  };

  const handleChangeRole = async (u: UserDirectoryRow, nextRole: UserRole) => {
    if (!isAdmin || u.role === nextRole) return;
    setUpdatingId(u.id);
    setError(null);
    setNotice(null);
    try {
      await apiRequest(`/users/${u.id}`, {
        method: 'PATCH',
        body: { roleName: nextRole },
      });
      setNotice(`Updated ${u.full_name} role to ${nextRole}.`);
      await loadData();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update user role.');
    } finally {
      setUpdatingId(null);
    }
  };

  const handleCreateUser = async (e: FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      const includeInvProfile =
        (formRole === 'Investigator' || formRole === 'Senior Investigator') &&
        formBadge.trim().length >= 3;

      await apiRequest('/users', {
        method: 'POST',
        body: {
          email: formEmail.trim(),
          password: formPassword,
          fullName: formFullName.trim(),
          roleName: formRole,
          ...(includeInvProfile
            ? {
                investigatorProfile: {
                  badgeNumber: formBadge.trim(),
                  unitName: formUnit.trim(),
                  jurisdiction: formJurisdiction.trim(),
                },
              }
            : {}),
        },
      });
      setShowCreateModal(false);
      setFormEmail('');
      setFormPassword('');
      setFormFullName('');
      setFormBadge('');
      setNotice(`Provisioned account for ${formEmail.trim()} (${formRole}).`);
      await loadData();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'User provisioning failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <CommandLayout
      title="Users, RBAC & Audit Logs"
      section="Governance & AI"
      actions={
        <>
          <button
            type="button"
            onClick={() => void loadData()}
            className="inline-flex items-center gap-1.5 rounded-[5px] border border-border-subtle bg-card px-3 py-1.5 text-xs font-medium text-heading hover:bg-highlight whitespace-nowrap shrink-0 cursor-pointer"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
            Refresh
          </button>
          {isAdmin ? (
            <button
              type="button"
              onClick={() => setShowCreateModal(true)}
              className="inline-flex items-center gap-1.5 rounded-[5px] bg-accent-strong px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-strong-hover whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              Provision Operator
            </button>
          ) : null}
        </>
      }
    >
      {error ? <ErrorDataState message={error} onRetry={() => void loadData()} /> : null}

      {notice ? (
        <div className="flex items-center gap-2 rounded-[6px] border border-emerald-300 bg-[#D8F8EC] px-4 py-2.5 text-xs text-[#065F46] dark:border-emerald-700/50 dark:bg-emerald-950/30 dark:text-emerald-200">
          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{notice}</span>
        </div>
      ) : null}

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-border-subtle pb-3">
        <button
          type="button"
          onClick={() => setActiveTab('users')}
          className={`inline-flex items-center gap-1.5 rounded-[5px] px-3 py-1.5 text-xs font-medium cursor-pointer ${
            activeTab === 'users'
              ? 'bg-accent-strong text-white'
              : 'border border-border-subtle bg-card text-heading hover:bg-highlight'
          }`}
        >
          <Users className="h-3.5 w-3.5" aria-hidden="true" />
          User Directory & RBAC ({users.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('audit')}
          className={`inline-flex items-center gap-1.5 rounded-[5px] px-3 py-1.5 text-xs font-medium cursor-pointer ${
            activeTab === 'audit'
              ? 'bg-accent-strong text-white'
              : 'border border-border-subtle bg-card text-heading hover:bg-highlight'
          }`}
        >
          <ScrollText className="h-3.5 w-3.5" aria-hidden="true" />
          Immutable Audit Trail ({auditLogs.length})
        </button>
      </div>

      {activeTab === 'users' ? (
        <div className="space-y-4">
          <section className="rounded-[6px] border border-border-subtle bg-card overflow-hidden">
            <div className="border-b border-border-subtle bg-subtle px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-accent-strong" aria-hidden="true" />
                <h2 className="text-sm font-semibold text-heading">User Directory & Role Controls</h2>
              </div>
              {!isAdmin ? (
                <span className="text-[11px] text-muted">
                  Read-only view (Administrator role required to mutate users)
                </span>
              ) : null}
            </div>

            {loading ? (
              <TableSkeleton rows={5} cols={5} />
            ) : users.length === 0 ? (
              <EmptyDataState title="No users found" description="No accounts provisioned." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-border-subtle bg-highlight text-[11px] font-semibold uppercase tracking-wider text-heading">
                    <tr>
                      <th className="px-4 py-2.5">Account Holder</th>
                      <th className="px-4 py-2.5">Role</th>
                      <th className="px-4 py-2.5">Unit / Institution</th>
                      <th className="px-4 py-2.5">Last Login</th>
                      <th className="px-4 py-2.5 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-subtle">
                    {users.map((u) => (
                      <tr key={u.id} className="hover:bg-subtle">
                        <td className="px-4 py-2.5">
                          <p className="font-semibold text-heading">{u.full_name}</p>
                          <p className="font-mono text-[11px] text-muted">{u.email}</p>
                        </td>
                        <td className="px-4 py-2.5">
                          {isAdmin ? (
                            <select
                              value={u.role}
                              disabled={updatingId === u.id}
                              onChange={(e) => void handleChangeRole(u, e.target.value as UserRole)}
                              className="rounded-[4px] border border-border-subtle bg-subtle px-2 py-1 text-xs text-heading"
                            >
                              <option value="Administrator">Administrator</option>
                              <option value="Senior Investigator">Senior Investigator</option>
                              <option value="Investigator">Investigator</option>
                              <option value="Bank Nodal Officer">Bank Nodal Officer</option>
                              <option value="citizen">citizen</option>
                            </select>
                          ) : (
                            <span className="font-mono font-medium text-accent-strong">{u.role}</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-body">
                          {u.badge_number
                            ? `${u.badge_number} · ${u.unit_name}`
                            : u.role === 'citizen'
                              ? 'Citizen Complainant Portal'
                              : u.institution_name ?? 'Cyber Command HQ'}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-[11px] text-muted tabular-nums">
                          {formatTimestamp(u.last_login_at)}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          {isAdmin ? (
                            <button
                              type="button"
                              disabled={updatingId === u.id}
                              onClick={() => void handleToggleActive(u)}
                              className={`rounded-[4px] border px-2.5 py-1 text-[11px] font-semibold cursor-pointer ${
                                u.is_active
                                  ? 'border-emerald-300 bg-[#D8F8EC] text-[#065F46] dark:border-emerald-700/50 dark:bg-emerald-950/30 dark:text-emerald-300'
                                  : 'border-red-300 bg-[#FEE2E2] text-[#991B1B] dark:border-red-700/50 dark:bg-red-950/30 dark:text-red-300'
                              }`}
                            >
                              {u.is_active ? 'Active' : 'Disabled'}
                            </button>
                          ) : (
                            <span
                              className={
                                u.is_active
                                  ? 'font-semibold text-[#065F46] dark:text-emerald-400'
                                  : 'font-semibold text-[#991B1B] dark:text-red-400'
                              }
                            >
                              {u.is_active ? 'Active' : 'Disabled'}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Role Permission Reference */}
          <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {roles.map((r) => (
              <div key={r.id} className="rounded-[6px] border border-border-subtle bg-card p-4 space-y-2">
                <p className="text-xs font-bold text-heading">{r.name}</p>
                <p className="text-xs text-muted">{r.description}</p>
                <p className="font-mono text-[10px] text-accent-strong">
                  Permissions: {Array.isArray(r.permissions) ? r.permissions.join(', ') : '—'}
                </p>
              </div>
            ))}
          </section>
        </div>
      ) : (
        <section className="space-y-4">
          <div className="rounded-[6px] border border-border-subtle bg-card p-3.5 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input
              type="text"
              value={auditActionFilter}
              onChange={(e) => setAuditActionFilter(e.target.value)}
              placeholder="Filter by action (e.g. LOGIN, REPORT_PDF, ML_TRAIN)..."
              className="rounded-[5px] border border-border-subtle bg-subtle px-3 py-1.5 text-xs font-mono text-heading"
            />
            <select
              value={auditResourceFilter}
              onChange={(e) => setAuditResourceFilter(e.target.value)}
              className="rounded-[5px] border border-border-subtle bg-subtle px-3 py-1.5 text-xs text-heading"
            >
              <option value="">All Resource Types</option>
              <option value="AUTH">AUTH</option>
              <option value="COMPLAINT">COMPLAINT</option>
              <option value="TRANSACTION">TRANSACTION</option>
              <option value="ACCOUNT">ACCOUNT</option>
              <option value="ML_MODEL">ML_MODEL</option>
              <option value="ATM_PREDICTION">ATM_PREDICTION</option>
              <option value="ALERT">ALERT</option>
              <option value="INVESTIGATION">INVESTIGATION</option>
              <option value="EVIDENCE">EVIDENCE</option>
              <option value="REPORT">REPORT</option>
              <option value="ASSISTANT">ASSISTANT</option>
              <option value="USER">USER</option>
            </select>
          </div>

          <div className="rounded-[6px] border border-border-subtle bg-card overflow-hidden">
            {loading ? (
              <TableSkeleton rows={8} cols={5} />
            ) : auditLogs.length === 0 ? (
              <EmptyDataState title="No audit events match filters" description="Adjust filters to view historical trail." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-border-subtle bg-highlight text-[11px] font-semibold uppercase tracking-wider text-heading">
                    <tr>
                      <th className="px-4 py-2.5">Timestamp</th>
                      <th className="px-4 py-2.5">Actor</th>
                      <th className="px-4 py-2.5">Action</th>
                      <th className="px-4 py-2.5">Resource</th>
                      <th className="px-4 py-2.5">Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-subtle">
                    {auditLogs.map((log) => (
                      <tr key={log.id} className="hover:bg-subtle">
                        <td className="px-4 py-2.5 font-mono text-[11px] text-muted tabular-nums whitespace-nowrap">
                          {formatTimestamp(log.created_at)}
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <p className="text-heading">{log.actor_name ?? log.actor_email ?? 'System'}</p>
                          <p className="text-[10px] text-muted">{log.actor_role ?? 'SYSTEM'}</p>
                        </td>
                        <td className="px-4 py-2.5 font-mono font-semibold text-accent-strong whitespace-nowrap">
                          {log.action}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-[11px] text-body whitespace-nowrap">
                          {log.resource_type}
                          {log.resource_id ? ` · ${log.resource_id.slice(0, 12)}` : ''}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-[10px] text-muted max-w-md truncate">
                          {JSON.stringify(log.details_json)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Create User Modal */}
      {showCreateModal && isAdmin ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-[6px] border border-border-subtle bg-card p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-border-subtle pb-3">
              <h2 className="text-sm font-semibold text-heading">Provision FinTrace Operator</h2>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="text-xs text-muted hover:text-heading cursor-pointer"
              >
                Close
              </button>
            </div>
            <form onSubmit={(e) => void handleCreateUser(e)} className="space-y-3 text-xs">
              <div>
                <label className="block text-muted mb-1">Full Name</label>
                <input
                  type="text"
                  required
                  value={formFullName}
                  onChange={(e) => setFormFullName(e.target.value)}
                  className="w-full rounded-[5px] border border-border-subtle bg-subtle px-2.5 py-1.5 text-heading"
                />
              </div>
              <div>
                <label className="block text-muted mb-1">Email</label>
                <input
                  type="email"
                  required
                  value={formEmail}
                  onChange={(e) => setFormEmail(e.target.value)}
                  className="w-full rounded-[5px] border border-border-subtle bg-subtle px-2.5 py-1.5 text-heading"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-muted mb-1">Initial Password</label>
                  <input
                    type="password"
                    required
                    minLength={8}
                    value={formPassword}
                    onChange={(e) => setFormPassword(e.target.value)}
                    className="w-full rounded-[5px] border border-border-subtle bg-subtle px-2.5 py-1.5 text-heading"
                  />
                </div>
                <div>
                  <label className="block text-muted mb-1">RBAC Role</label>
                  <select
                    value={formRole}
                    onChange={(e) => setFormRole(e.target.value as UserRole)}
                    className="w-full rounded-[5px] border border-border-subtle bg-subtle px-2.5 py-1.5 text-heading"
                  >
                    <option value="Investigator">Investigator</option>
                    <option value="Senior Investigator">Senior Investigator</option>
                    <option value="Bank Nodal Officer">Bank Nodal Officer</option>
                    <option value="Administrator">Administrator</option>
                  </select>
                </div>
              </div>
              {(formRole === 'Investigator' || formRole === 'Senior Investigator') ? (
                <div className="grid grid-cols-3 gap-2 pt-1">
                  <input
                    type="text"
                    value={formBadge}
                    onChange={(e) => setFormBadge(e.target.value)}
                    placeholder="Badge (CYB-...)"
                    className="rounded-[5px] border border-border-subtle bg-subtle px-2 py-1.5 font-mono text-heading"
                  />
                  <input
                    type="text"
                    value={formUnit}
                    onChange={(e) => setFormUnit(e.target.value)}
                    placeholder="Unit Name"
                    className="rounded-[5px] border border-border-subtle bg-subtle px-2 py-1.5 text-heading"
                  />
                  <input
                    type="text"
                    value={formJurisdiction}
                    onChange={(e) => setFormJurisdiction(e.target.value)}
                    placeholder="Jurisdiction"
                    className="rounded-[5px] border border-border-subtle bg-subtle px-2 py-1.5 text-heading"
                  />
                </div>
              ) : null}
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="rounded-[5px] border border-border-subtle px-3 py-1.5 text-body hover:bg-highlight cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-[5px] bg-accent-strong px-3.5 py-1.5 font-semibold text-white hover:bg-accent-strong-hover cursor-pointer"
                >
                  {submitting ? 'Creating...' : 'Create User'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </CommandLayout>
  );
}

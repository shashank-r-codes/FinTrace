import { Request } from 'express';
import { query } from '../config/db.js';
import { logger } from '../config/logger.js';

export interface AuditEntryInput {
  req?: Request;
  actorUserId?: string | null;
  actorRole?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  statusCode?: number;
  details?: Record<string, unknown>;
}

export async function recordAuditLog(entry: AuditEntryInput): Promise<void> {
  try {
    const actorUserId = entry.actorUserId ?? entry.req?.user?.userId ?? null;
    const actorRole = entry.actorRole ?? entry.req?.user?.role ?? null;
    const httpMethod = entry.req?.method ?? null;
    const endpoint = entry.req?.originalUrl ?? null;
    const ipAddress = entry.req?.ip ?? null;

    await query(
      `INSERT INTO audit_logs (
         actor_user_id, actor_role, action, resource_type, resource_id,
         http_method, endpoint, ip_address, status_code, details_json
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)`,
      [
        actorUserId,
        actorRole,
        entry.action,
        entry.resourceType,
        entry.resourceId ?? null,
        httpMethod,
        endpoint,
        ipAddress,
        entry.statusCode ?? 200,
        JSON.stringify(entry.details ?? {}),
      ]
    );
  } catch (err) {
    logger.error({ err, action: entry.action }, 'Failed to persist audit log entry');
  }
}

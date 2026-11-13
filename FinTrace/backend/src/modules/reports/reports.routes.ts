import { Router } from 'express';
import PDFDocument from 'pdfkit';
import { z } from 'zod';
import { query } from '../../config/db.js';
import { recordAuditLog } from '../../middleware/audit.js';
import { authenticate } from '../../middleware/auth.js';
import { AppError } from '../../middleware/errorHandler.js';
import { authorizeOfficer, authorizeRoles } from '../../middleware/rbac.js';
import { validate, ValidatedRequest } from '../../middleware/validate.js';

const router = Router();

const csvExportQuerySchema = z.object({
  dataset: z.enum(['complaints', 'transactions', 'predictions', 'alerts']).default('complaints'),
  complaintId: z.string().uuid().optional(),
});

const pdfParamsSchema = z.object({
  complaintId: z.string().uuid(),
});

function escapeCsvCell(val: unknown): string {
  if (val === null || val === undefined) return '';
  const str = typeof val === 'object' ? JSON.stringify(val) : String(val);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function toCsv(headers: string[], rows: Record<string, unknown>[]): string {
  const headerLine = headers.map(escapeCsvCell).join(',');
  const dataLines = rows.map((row) => headers.map((h) => escapeCsvCell(row[h])).join(','));
  return [headerLine, ...dataLines].join('\n');
}

router.use(authenticate, authorizeOfficer);

router.get(
  '/analytics',
  authorizeRoles('Administrator', 'Senior Investigator', 'Investigator', 'Bank Nodal Officer'),
  async (_req, res, next) => {
    try {
      const [statusRes, fraudTypeRes, channelRes, atmRiskRes, alertRes, summaryRes] =
        await Promise.all([
          query(
            `SELECT status, COUNT(*)::int AS count, COALESCE(SUM(reported_amount), 0)::numeric AS total_amount
             FROM complaints
             GROUP BY status
             ORDER BY count DESC`
          ),
          query(
            `SELECT fraud_type, COUNT(*)::int AS count, COALESCE(SUM(reported_amount), 0)::numeric AS total_amount
             FROM complaints
             GROUP BY fraud_type
             ORDER BY total_amount DESC`
          ),
          query(
            `SELECT channel, COUNT(*)::int AS txn_count, COALESCE(SUM(amount), 0)::numeric AS total_amount
             FROM transactions
             GROUP BY channel
             ORDER BY total_amount DESC`
          ),
          query(
            `SELECT risk_level, COUNT(*)::int AS count, ROUND(AVG(risk_score), 1)::numeric AS avg_score
             FROM atm_predictions
             GROUP BY risk_level
             ORDER BY CASE risk_level WHEN 'Critical' THEN 1 WHEN 'High' THEN 2 WHEN 'Medium' THEN 3 ELSE 4 END`
          ),
          query(
            `SELECT status, severity, COUNT(*)::int AS count
             FROM alerts
             GROUP BY status, severity`
          ),
          query(
            `SELECT
               (SELECT COUNT(*)::int FROM complaints) AS total_complaints,
               (SELECT COALESCE(SUM(reported_amount), 0)::numeric FROM complaints) AS total_reported_loss,
               (SELECT COUNT(*)::int FROM transactions) AS total_transactions,
               (SELECT COUNT(*)::int FROM suspicious_accounts WHERE status IN ('ACTIVE', 'FROZEN')) AS flagged_accounts,
               (SELECT COUNT(*)::int FROM bank_accounts WHERE is_frozen = TRUE) AS frozen_accounts,
               (SELECT COUNT(*)::int FROM atm_predictions) AS total_atm_forecasts,
               (SELECT COUNT(*)::int FROM evidence_records) AS total_evidence_records`
          ),
        ]);

      res.json({
        success: true,
        data: {
          summary: summaryRes.rows[0],
          byComplaintStatus: statusRes.rows,
          byFraudType: fraudTypeRes.rows,
          byChannel: channelRes.rows,
          byAtmRiskLevel: atmRiskRes.rows,
          byAlertStatus: alertRes.rows,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/export/csv',
  authorizeRoles('Administrator', 'Senior Investigator', 'Investigator'),
  validate({ query: csvExportQuerySchema }),
  async (req: ValidatedRequest<unknown, z.infer<typeof csvExportQuerySchema>>, res, next) => {
    try {
      const { dataset, complaintId } = req.validatedQuery!;
      let csvContent = '';
      const params: unknown[] = [];
      const cmpFilter = complaintId ? 'WHERE ' : '';

      if (dataset === 'complaints') {
        if (complaintId) params.push(complaintId);
        const result = await query(
          `SELECT c.complaint_number, c.fraud_type, c.reported_amount, c.currency,
                  c.status, c.priority, c.city, c.incident_timestamp, c.reported_at,
                  v.full_name AS victim_name, v.phone_masked AS victim_phone,
                  u.full_name AS investigator_name
           FROM complaints c
           JOIN victims v ON v.id = c.victim_id
           LEFT JOIN investigators i ON i.id = c.assigned_to
           LEFT JOIN users u ON u.id = i.user_id
           ${complaintId ? 'WHERE c.id = $1' : ''}
           ORDER BY c.reported_at DESC`,
          params
        );
        csvContent = toCsv(
          [
            'complaint_number',
            'fraud_type',
            'reported_amount',
            'currency',
            'status',
            'priority',
            'city',
            'victim_name',
            'victim_phone',
            'investigator_name',
            'incident_timestamp',
            'reported_at',
          ],
          result.rows
        );
      } else if (dataset === 'transactions') {
        if (complaintId) params.push(complaintId);
        const result = await query(
          `SELECT t.txn_id, c.complaint_number, fa.account_number AS from_account,
                  fa.holder_name AS from_holder, ta.account_number AS to_account,
                  ta.holder_name AS to_holder, t.amount, t.currency, t.channel,
                  t.hop_depth, t.is_flagged_fraud, t.timestamp, t.remarks
           FROM transactions t
           JOIN bank_accounts fa ON fa.id = t.from_account
           JOIN bank_accounts ta ON ta.id = t.to_account
           LEFT JOIN complaints c ON c.id = t.complaint_id
           ${complaintId ? 'WHERE t.complaint_id = $1' : ''}
           ORDER BY t.timestamp ASC`,
          params
        );
        csvContent = toCsv(
          [
            'txn_id',
            'complaint_number',
            'from_account',
            'from_holder',
            'to_account',
            'to_holder',
            'amount',
            'currency',
            'channel',
            'hop_depth',
            'is_flagged_fraud',
            'timestamp',
            'remarks',
          ],
          result.rows
        );
      } else if (dataset === 'predictions') {
        if (complaintId) params.push(complaintId);
        const result = await query(
          `SELECT c.complaint_number, ap.rank_order, ap.atm_id, a.bank, a.locality, a.city,
                  ap.risk_score, ap.risk_level, ap."window", ap.confidence,
                  ap.score_source, ap.model_version, ap.predicted_at
           FROM atm_predictions ap
           JOIN atms a ON a.id = ap.atm_id
           JOIN complaints c ON c.id = ap.complaint_id
           ${cmpFilter}${complaintId ? 'ap.complaint_id = $1' : ''}
           ORDER BY c.complaint_number DESC, ap.rank_order ASC`,
          params
        );
        csvContent = toCsv(
          [
            'complaint_number',
            'rank_order',
            'atm_id',
            'bank',
            'locality',
            'city',
            'risk_score',
            'risk_level',
            'window',
            'confidence',
            'score_source',
            'model_version',
            'predicted_at',
          ],
          result.rows
        );
      } else {
        if (complaintId) params.push(complaintId);
        const result = await query(
          `SELECT c.complaint_number, al.alert_type, al.severity, al.status,
                  al.title, al.atm_id, al.score_source, al.created_at
           FROM alerts al
           LEFT JOIN complaints c ON c.id = al.complaint_id
           ${complaintId ? 'WHERE al.complaint_id = $1' : ''}
           ORDER BY al.created_at DESC`,
          params
        );
        csvContent = toCsv(
          [
            'complaint_number',
            'alert_type',
            'severity',
            'status',
            'title',
            'atm_id',
            'score_source',
            'created_at',
          ],
          result.rows
        );
      }

      await recordAuditLog({
        req,
        action: 'REPORT_CSV_EXPORTED',
        resourceType: 'REPORT',
        resourceId: complaintId ?? dataset,
        statusCode: 200,
        details: { dataset, complaintId: complaintId ?? null },
      });

      const filename = `fintrace-${dataset}-${new Date().toISOString().slice(0, 10)}.csv`;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(csvContent);
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/export/pdf/:complaintId',
  authorizeRoles('Administrator', 'Senior Investigator', 'Investigator'),
  validate({ params: pdfParamsSchema }),
  async (
    req: ValidatedRequest<unknown, Record<string, unknown>, z.infer<typeof pdfParamsSchema>>,
    res,
    next
  ) => {
    try {
      const { complaintId } = req.validatedParams!;

      const cmpRes = await query(
        `SELECT c.*, v.full_name AS victim_name, v.phone_masked AS victim_phone,
                v.city AS victim_city, v.state AS victim_state,
                u.full_name AS investigator_name, i.badge_number AS investigator_badge
         FROM complaints c
         JOIN victims v ON v.id = c.victim_id
         LEFT JOIN investigators i ON i.id = c.assigned_to
         LEFT JOIN users u ON u.id = i.user_id
         WHERE c.id = $1
         LIMIT 1`,
        [complaintId]
      );

      if (!cmpRes.rows[0]) {
        throw new AppError('Complaint not found.', 404, 'COMPLAINT_NOT_FOUND');
      }

      const complaint = cmpRes.rows[0];
      const [invRes, txnsRes, suspRes, predsRes, alertsRes, evidenceRes] = await Promise.all([
        query('SELECT * FROM investigations WHERE complaint_id = $1 LIMIT 1', [complaintId]),
        query(
          `SELECT t.txn_id, t.amount, t.channel, t.timestamp, t.hop_depth,
                  fa.account_number AS from_account, ta.account_number AS to_account
           FROM transactions t
           JOIN bank_accounts fa ON fa.id = t.from_account
           JOIN bank_accounts ta ON ta.id = t.to_account
           WHERE t.complaint_id = $1
           ORDER BY t.timestamp ASC
           LIMIT 40`,
          [complaintId]
        ),
        query(
          `SELECT sa.classification, sa.mule_probability, sa.score_source, sa.status,
                  ba.account_number, ba.holder_name, ba.is_frozen
           FROM suspicious_accounts sa
           JOIN bank_accounts ba ON ba.id = sa.account_id
           WHERE sa.complaint_id = $1
           ORDER BY sa.mule_probability DESC NULLS LAST`,
          [complaintId]
        ),
        query(
          `SELECT ap.*, a.bank, a.address, a.locality, a.city
           FROM atm_predictions ap
           JOIN atms a ON a.id = ap.atm_id
           WHERE ap.complaint_id = $1
           ORDER BY ap.rank_order ASC
           LIMIT 10`,
          [complaintId]
        ),
        query(
          `SELECT severity, status, alert_type, title, score_source, created_at
           FROM alerts
           WHERE complaint_id = $1
           ORDER BY created_at DESC`,
          [complaintId]
        ),
        query(
          `SELECT evidence_type, title, sha256_hash, recorded_at
           FROM evidence_records
           WHERE complaint_id = $1
           ORDER BY recorded_at DESC`,
          [complaintId]
        ),
      ]);

      await recordAuditLog({
        req,
        action: 'REPORT_PDF_EXPORTED',
        resourceType: 'COMPLAINT',
        resourceId: complaintId,
        statusCode: 200,
        details: { complaint_number: complaint.complaint_number },
      });

      const doc = new PDFDocument({ margin: 46, size: 'A4' });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => {
        const pdfBuffer = Buffer.concat(chunks);
        const filename = `fintrace-dossier-${complaint.complaint_number}.pdf`;
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(pdfBuffer);
      });

      // Header
      doc.fontSize(17).fillColor('#0F172A').text('FINTRACE CYBERCRIME INTELLIGENCE DOSSIER');
      doc.fontSize(9).fillColor('#475569').text(
        `Complaint: ${complaint.complaint_number}  |  Generated: ${new Date().toISOString()}  |  Synthetic Demo Data: ${complaint.is_synthetic ? 'YES' : 'NO'}`
      );
      doc.moveDown(0.8);

      // 1. Complaint & Victim Summary
      doc.fontSize(12).fillColor('#0F172A').text('1. Complaint & Victim Summary');
      doc.fontSize(9.5).fillColor('#1E293B');
      doc.text(`Victim: ${complaint.victim_name} (${complaint.victim_phone}) — ${complaint.victim_city}, ${complaint.victim_state}`);
      doc.text(`Fraud Type: ${complaint.fraud_type}  |  Priority: ${complaint.priority}  |  Status: ${complaint.status}`);
      doc.text(`Reported Loss: INR ${Number(complaint.reported_amount).toLocaleString('en-IN')}`);
      doc.text(`Assigned Lead: ${complaint.investigator_name ?? 'Unassigned'} ${complaint.investigator_badge ? `(${complaint.investigator_badge})` : ''}`);
      doc.text(`Summary: ${complaint.summary}`);
      doc.moveDown(0.7);

      // 2. Investigation Findings
      const inv = invRes.rows[0];
      doc.fontSize(12).fillColor('#0F172A').text('2. Investigation Casework');
      doc.fontSize(9.5).fillColor('#1E293B');
      if (inv) {
        doc.text(`Case Number: ${inv.case_number}  |  Status: ${inv.status}`);
        doc.text(`Findings: ${inv.findings_summary ?? 'No findings recorded yet.'}`);
      } else {
        doc.text('No investigation record initialized yet.');
      }
      doc.moveDown(0.7);

      // 3. Flagged Mule & Suspicious Accounts
      doc.fontSize(12).fillColor('#0F172A').text('3. Flagged Accounts & Attribution');
      doc.fontSize(9).fillColor('#1E293B');
      if (suspRes.rows.length === 0) {
        doc.text('No suspicious accounts flagged for this complaint.');
      } else {
        for (const s of suspRes.rows) {
          const probPct = s.mule_probability !== null ? `${(Number(s.mule_probability) * 100).toFixed(1)}%` : 'N/A';
          doc.text(
            `• ${s.account_number} (${s.holder_name}) | ${s.classification} | Score: ${probPct} | Frozen: ${s.is_frozen ? 'YES' : 'NO'} | Source: ${s.score_source}`
          );
        }
      }
      doc.moveDown(0.7);

      // 4. Predictive ATM Cash-Out Forecasts
      doc.fontSize(12).fillColor('#0F172A').text('4. Predictive ATM Cash-Out Locations');
      doc.fontSize(9).fillColor('#1E293B');
      if (predsRes.rows.length === 0) {
        doc.text('No ATM forecasts generated for this complaint.');
      } else {
        doc.fillColor('#92400E').text(`Scope Notice: ${predsRes.rows[0].limitations_text}`);
        doc.fillColor('#1E293B');
        for (const p of predsRes.rows) {
          doc.text(
            `#${p.rank_order} ${p.atm_id} (${p.bank}, ${p.locality}) | Risk: ${Number(p.risk_score).toFixed(1)}/100 (${p.risk_level}) | Window: ${p.window} | Confidence: ${p.confidence} | Source: ${p.score_source}`
          );
        }
      }
      doc.moveDown(0.7);

      // 5. Transaction Trail
      doc.fontSize(12).fillColor('#0F172A').text(`5. Verified Transaction Trail (${txnsRes.rows.length} rows)`);
      doc.fontSize(8.5).fillColor('#1E293B');
      for (const t of txnsRes.rows) {
        doc.text(
          `${t.txn_id} | ${t.from_account} -> ${t.to_account} | INR ${Number(t.amount).toLocaleString('en-IN')} | ${t.channel} | Hop ${t.hop_depth ?? '-'} | ${new Date(t.timestamp).toISOString()}`
        );
      }
      doc.moveDown(0.7);

      // 6. Early Warning Alerts & Evidence
      doc.fontSize(12).fillColor('#0F172A').text('6. Alerts & Evidence Chain of Custody');
      doc.fontSize(8.5).fillColor('#1E293B');
      doc.text(`Alerts logged: ${alertsRes.rows.length} | Evidence artifacts: ${evidenceRes.rows.length}`);
      for (const ev of evidenceRes.rows) {
        doc.text(`• [${ev.evidence_type}] ${ev.title} | SHA-256: ${ev.sha256_hash ?? 'N/A'}`);
      }

      doc.end();
    } catch (err) {
      next(err);
    }
  }
);

export default router;

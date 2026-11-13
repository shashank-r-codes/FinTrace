import { GoogleGenAI } from '@google/genai';
import { Router } from 'express';
import { z } from 'zod';
import { query } from '../../config/db.js';
import { env } from '../../config/env.js';
import { recordAuditLog } from '../../middleware/audit.js';
import { authenticate } from '../../middleware/auth.js';
import { AppError } from '../../middleware/errorHandler.js';
import { authorizeRoles } from '../../middleware/rbac.js';
import { validate } from '../../middleware/validate.js';

const router = Router();

const queryAssistantSchema = z.object({
  question: z.string().min(3).max(2000),
  complaintId: z.string().uuid().optional(),
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        text: z.string().max(2000),
      })
    )
    .max(8)
    .default([]),
});

function isGeminiConfigured(): boolean {
  const key = env.GEMINI_API_KEY?.trim() || '';
  if (!key) return false;
  if (key.startsWith('CHANGE_ME') || key === 'MY_GEMINI_API_KEY') return false;
  return true;
}

function getGeminiClient(): GoogleGenAI {
  return new GoogleGenAI({
    apiKey: env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

router.use(authenticate);
router.use(authorizeRoles('Administrator', 'Senior Investigator', 'Investigator'));

router.get('/status', (_req, res) => {
  res.json({
    success: true,
    data: {
      configured: isGeminiConfigured(),
      model: env.GEMINI_MODEL,
    },
  });
});

router.post('/query', validate({ body: queryAssistantSchema }), async (req, res, next) => {
  try {
    if (!isGeminiConfigured()) {
      throw new AppError(
        'Gemini API key is not configured on the backend server (GEMINI_API_KEY). Set it in environment secrets to enable AI briefings.',
        503,
        'GEMINI_NOT_CONFIGURED'
      );
    }

    const body = req.body as z.infer<typeof queryAssistantSchema>;

    let groundingContext: Record<string, unknown>;
    let recordCounts: Record<string, number>;
    let groundedScope: string;

    if (body.complaintId) {
      const cmpRes = await query(
        `SELECT c.id, c.complaint_number, c.fraud_type, c.reported_amount, c.currency,
                c.status, c.priority, c.city, c.summary, c.incident_timestamp, c.is_synthetic,
                v.full_name AS victim_name, v.city AS victim_city,
                u.full_name AS investigator_name, i.badge_number AS investigator_badge
         FROM complaints c
         JOIN victims v ON v.id = c.victim_id
         LEFT JOIN investigators i ON i.id = c.assigned_to
         LEFT JOIN users u ON u.id = i.user_id
         WHERE c.id = $1
         LIMIT 1`,
        [body.complaintId]
      );

      if (!cmpRes.rows[0]) {
        throw new AppError('Referenced complaint not found.', 404, 'COMPLAINT_NOT_FOUND');
      }

      const [invRes, txnsRes, suspRes, fraudRes, atmRes, alertRes, evidRes] = await Promise.all([
        query(
          `SELECT case_number, status, findings_summary, recommended_actions, opened_at
           FROM investigations WHERE complaint_id = $1 LIMIT 1`,
          [body.complaintId]
        ),
        query(
          `SELECT t.txn_id, fa.account_number AS from_account, fa.holder_name AS from_holder,
                  ta.account_number AS to_account, ta.holder_name AS to_holder,
                  t.amount, t.channel, t.hop_depth, t.is_flagged_fraud, t.timestamp
           FROM transactions t
           JOIN bank_accounts fa ON fa.id = t.from_account
           JOIN bank_accounts ta ON ta.id = t.to_account
           WHERE t.complaint_id = $1
           ORDER BY t.timestamp ASC
           LIMIT 40`,
          [body.complaintId]
        ),
        query(
          `SELECT ba.account_number, ba.holder_name, ba.is_frozen, sa.classification,
                  sa.mule_probability, sa.score_source, sa.reason, sa.status
           FROM suspicious_accounts sa
           JOIN bank_accounts ba ON ba.id = sa.account_id
           WHERE sa.complaint_id = $1
           ORDER BY sa.mule_probability DESC NULLS LAST`,
          [body.complaintId]
        ),
        query(
          `SELECT ba.account_number, fdr.is_anomaly, fdr.mule_score, fdr.score_source,
                  fdr.velocity_1h, fdr.pass_through_ratio, fdr.avg_forward_sec
           FROM fraud_detection_results fdr
           JOIN bank_accounts ba ON ba.id = fdr.account_id
           WHERE fdr.complaint_id = $1
           ORDER BY fdr.mule_score DESC
           LIMIT 20`,
          [body.complaintId]
        ),
        query(
          `SELECT ap.rank_order, ap.atm_id, a.bank, a.locality, a.address,
                  ap.risk_score, ap.risk_level, ap."window", ap.confidence,
                  ap.score_source, ap.limitations_text, ap.explanation_json
           FROM atm_predictions ap
           JOIN atms a ON a.id = ap.atm_id
           WHERE ap.complaint_id = $1
           ORDER BY ap.rank_order ASC
           LIMIT 10`,
          [body.complaintId]
        ),
        query(
          `SELECT alert_type, severity, status, title, atm_id, score_source, created_at
           FROM alerts
           WHERE complaint_id = $1
           ORDER BY created_at DESC
           LIMIT 20`,
          [body.complaintId]
        ),
        query(
          `SELECT evidence_type, title, file_name, sha256_hash, recorded_at
           FROM evidence_records
           WHERE complaint_id = $1
           ORDER BY recorded_at DESC
           LIMIT 20`,
          [body.complaintId]
        ),
      ]);

      groundedScope = cmpRes.rows[0].complaint_number as string;
      recordCounts = {
        transactions: txnsRes.rows.length,
        suspiciousAccounts: suspRes.rows.length,
        atmPredictions: atmRes.rows.length,
        alerts: alertRes.rows.length,
        evidence: evidRes.rows.length,
      };
      groundingContext = {
        complaint: cmpRes.rows[0],
        investigation: invRes.rows[0] ?? null,
        transactions: txnsRes.rows,
        suspiciousAccounts: suspRes.rows,
        fraudDetectionResults: fraudRes.rows,
        atmPredictions: atmRes.rows,
        alerts: alertRes.rows,
        evidenceRecords: evidRes.rows,
      };
    } else {
      const [cmpRes, atmRes, alertRes, suspRes, metricsRes] = await Promise.all([
        query(
          `SELECT c.complaint_number, c.fraud_type, c.reported_amount, c.status, c.priority,
                  c.city, v.full_name AS victim_name
           FROM complaints c
           JOIN victims v ON v.id = c.victim_id
           ORDER BY c.reported_at DESC
           LIMIT 12`
        ),
        query(
          `SELECT c.complaint_number, ap.rank_order, ap.atm_id, a.bank, a.locality,
                  ap.risk_score, ap.risk_level, ap."window", ap.confidence, ap.score_source
           FROM atm_predictions ap
           JOIN atms a ON a.id = ap.atm_id
           JOIN complaints c ON c.id = ap.complaint_id
           ORDER BY ap.risk_score DESC
           LIMIT 12`
        ),
        query(
          `SELECT c.complaint_number, al.severity, al.status, al.alert_type, al.title, al.atm_id, al.score_source
           FROM alerts al
           LEFT JOIN complaints c ON c.id = al.complaint_id
           ORDER BY al.created_at DESC
           LIMIT 15`
        ),
        query(
          `SELECT ba.account_number, ba.holder_name, ba.is_frozen, sa.classification,
                  sa.mule_probability, sa.score_source
           FROM suspicious_accounts sa
           JOIN bank_accounts ba ON ba.id = sa.account_id
           ORDER BY sa.mule_probability DESC NULLS LAST
           LIMIT 15`
        ),
        query(
          `SELECT model_name, model_version, split_strategy, precision_score, recall_score, f1_score, roc_auc
           FROM model_metrics
           ORDER BY trained_at DESC
           LIMIT 1`
        ),
      ]);

      groundedScope = 'Global Operations Queue';
      recordCounts = {
        complaints: cmpRes.rows.length,
        atmPredictions: atmRes.rows.length,
        alerts: alertRes.rows.length,
        suspiciousAccounts: suspRes.rows.length,
      };
      groundingContext = {
        recentComplaints: cmpRes.rows,
        priorityAtmPredictions: atmRes.rows,
        recentAlerts: alertRes.rows,
        flaggedAccounts: suspRes.rows,
        latestModelMetrics: metricsRes.rows[0] ?? null,
      };
    }

    const systemInstruction = [
      'You are the FinTrace Cybercrime Investigative Intelligence Assistant (Smart India Hackathon PS 26184).',
      'STRICT GROUNDING RULES:',
      '1. Answer ONLY using facts present in the PostgreSQL JSON context provided below.',
      '2. Always cite exact identifiers when available: complaint_number, case_number, txn_id, account_number, atm_id.',
      '3. When citing risk scores, mule scores, or ATM predictions, always mention their score_source ("Trained ML prediction", "Rule-based risk score", or "Synthetic demo result") and clarify that ATM risk_score (0-100) is a weighted risk score, NOT a calibrated probability.',
      '4. NEVER fabricate account numbers, UTRs, ATM IDs, phone numbers, or ML metrics. If data is missing from the provided JSON context, explicitly state that it is not recorded in the database.',
      '5. Keep answers concise, structured with clear bullet points, and directly actionable for cybercrime investigators.',
    ].join('\n');

    const conversationHistory = body.history
      .map((h) => `${h.role === 'user' ? 'Investigator' : 'Assistant'}: ${h.text}`)
      .join('\n');

    const promptText = [
      `DATABASE CONTEXT (${groundedScope}):`,
      JSON.stringify(groundingContext),
      conversationHistory ? `\nPRIOR CONVERSATION:\n${conversationHistory}` : '',
      `\nINVESTIGATOR QUESTION:\n${body.question}`,
    ]
      .filter(Boolean)
      .join('\n');

    const ai = getGeminiClient();
    const response = await ai.models.generateContent({
      model: env.GEMINI_MODEL,
      contents: promptText,
      config: {
        systemInstruction,
      },
    });

    const answer = response.text?.trim();
    if (!answer) {
      throw new AppError(
        'Gemini returned an empty response for this investigative query.',
        502,
        'GEMINI_EMPTY_RESPONSE'
      );
    }

    await recordAuditLog({
      req,
      action: 'ASSISTANT_QUERY_EXECUTED',
      resourceType: 'ASSISTANT',
      resourceId: body.complaintId ?? 'GLOBAL',
      statusCode: 200,
      details: {
        model: env.GEMINI_MODEL,
        groundedScope,
        questionLength: body.question.length,
      },
    });

    res.json({
      success: true,
      data: {
        answer,
        model: env.GEMINI_MODEL,
        groundedScope,
        recordCounts,
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;

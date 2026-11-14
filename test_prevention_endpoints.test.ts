import express from 'express';
import request from 'supertest';
import { createApiRouter } from './server/routes.ts';
import { dbStore } from './server/store.ts';

/**
 * Prevention Layer Integration & Regression Test Suite
 * Tests the 3 broken Prevention pages' backend endpoints:
 * 1. GET /api/v1/accounts/intelligence (Account Intelligence & Risk Registry)
 * 2. GET /api/v1/interventions (Transaction Intervention Centre)
 * 3. GET /api/v1/graph/mule-clusters (Mule Syndicates & Ring Detection)
 *
 * Verifies:
 * - 200 OK with expected envelope and fields for authorized officer roles (Administrator, Nodal Officer)
 * - 403 FORBIDDEN for unauthorized 'citizen' role
 * - 401 UNAUTHORIZED when no token is provided
 * - Route order regression test: GET /accounts/intelligence is NEVER captured by /accounts/:id
 * - Parameterized route test: GET /accounts/:id returns 404 "Bank account not found." only for unknown IDs
 * - Cryptographic audit hash chain verification endpoint (/interventions/verify-chain)
 */

const app = express();
app.use(express.json());
app.use('/api/v1', createApiRouter());

let adminToken = '';
let nodalToken = '';
let citizenToken = '';
let testValidAccountId = '';

async function runTests() {
  console.log('=============================================================================');
  console.log('STARTING PREVENTION LAYER ENDPOINT & WIRING TEST SUITE');
  console.log('=============================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, desc: string, details?: unknown) {
    if (condition) {
      console.log(`  [PASS] ${desc}`);
      passed++;
    } else {
      console.error(`  [FAIL] ${desc}`, details ? details : '');
      failed++;
    }
  }

  // ---------------- 1. AUTHENTICATION SETUP ----------------
  console.log('1. Setting up Test Authentication Tokens...');

  const adminRes = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: 'admin@fintrace.demo', password: 'FinTrace@Demo2026' });

  assert(
    adminRes.status === 200 && Boolean(adminRes.body.data?.accessToken),
    'Login Administrator (admin@fintrace.demo)'
  );
  adminToken = adminRes.body.data?.accessToken;

  const nodalRes = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: 'nodal.synsbi@fintrace.demo', password: 'FinTrace@Demo2026' });

  assert(
    nodalRes.status === 200 && Boolean(nodalRes.body.data?.accessToken),
    'Login Bank Nodal Officer (nodal.synsbi@fintrace.demo)'
  );
  nodalToken = nodalRes.body.data?.accessToken;

  const citizenRes = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: 'citizen1@fintrace.demo', password: 'FinTrace@Demo2026' });

  assert(
    citizenRes.status === 200 && Boolean(citizenRes.body.data?.accessToken),
    'Login Citizen (citizen1@fintrace.demo)'
  );
  citizenToken = citizenRes.body.data?.accessToken;

  testValidAccountId = dbStore.accounts[0]?.id || '';
  assert(Boolean(testValidAccountId), `Found seeded bank account: ${testValidAccountId}`);

  // ---------------- 2. ACCOUNT INTELLIGENCE & RISK REGISTRY ----------------
  console.log('\n2. Testing Account Intelligence & Risk Registry (/api/v1/accounts/intelligence)...');

  // 2.1 Authorized 200 with expected shape
  const intelRes = await request(app)
    .get('/api/v1/accounts/intelligence?limit=10')
    .set('Authorization', `Bearer ${adminToken}`);

  assert(intelRes.status === 200, 'GET /accounts/intelligence returns 200 for Administrator');
  assert(intelRes.body.success === true, 'Response envelope has success: true');
  assert(Array.isArray(intelRes.body.data), 'Response data is an array of accounts');
  assert(intelRes.body.data.length > 0, `Returned ${intelRes.body.data?.length} account profiles`);

  const firstAcc = intelRes.body.data?.[0];
  assert(
    firstAcc &&
      typeof firstAcc.account_id === 'string' &&
      typeof firstAcc.account_number === 'string' &&
      typeof firstAcc.risk_score === 'number' &&
      typeof firstAcc.risk_classification === 'string' &&
      typeof firstAcc.account_status === 'string',
    'Account row contains expected fields (account_id, risk_score, risk_classification, account_status)'
  );

  assert(
    intelRes.body.summary &&
      typeof intelRes.body.summary.totalMonitoredAccounts === 'number' &&
      typeof intelRes.body.summary.highOrCriticalCount === 'number',
    'Summary contains totalMonitoredAccounts and highOrCriticalCount'
  );

  // 2.2 Filter tests
  const filteredRiskRes = await request(app)
    .get('/api/v1/accounts/intelligence?riskClassification=Critical')
    .set('Authorization', `Bearer ${adminToken}`);
  assert(
    filteredRiskRes.status === 200 &&
      filteredRiskRes.body.data.every((r: { risk_classification: string }) => r.risk_classification === 'Critical'),
    'Filter by riskClassification=Critical returns only Critical accounts'
  );

  // 2.3 REGRESSION TEST: GET /accounts/intelligence must NOT be captured by /accounts/:id
  assert(
    intelRes.status !== 404 && intelRes.body?.error?.message !== 'Bank account not found.',
    'REGRESSION CHECK: /accounts/intelligence is NOT shadowed by /accounts/:id ("Bank account not found.")'
  );

  // 2.4 Literal sub-routes
  const filtersRes = await request(app)
    .get('/api/v1/accounts/intelligence/filters')
    .set('Authorization', `Bearer ${adminToken}`);
  assert(
    filtersRes.status === 200 && Array.isArray(filtersRes.body.data?.banks),
    'GET /accounts/intelligence/filters returns 200 with banks array'
  );

  const summaryRes = await request(app)
    .get('/api/v1/accounts/intelligence/summary')
    .set('Authorization', `Bearer ${adminToken}`);
  assert(
    summaryRes.status === 200 && typeof summaryRes.body.data?.totalMonitoredAccounts === 'number',
    'GET /accounts/intelligence/summary returns 200 with summary metrics'
  );

  // 2.5 Parameterized route correctly handles genuine unknown account ID
  const unknownAccRes = await request(app)
    .get('/api/v1/accounts/nonexistent-uuid-99999')
    .set('Authorization', `Bearer ${adminToken}`);
  assert(
    unknownAccRes.status === 404 && unknownAccRes.body?.error?.message === 'Bank account not found.',
    'GET /accounts/nonexistent-id returns 404 "Bank account not found."'
  );

  // 2.6 Parameterized route returns valid account detail
  const validAccRes = await request(app)
    .get(`/api/v1/accounts/${testValidAccountId}`)
    .set('Authorization', `Bearer ${adminToken}`);
  assert(validAccRes.status === 200, `GET /accounts/${testValidAccountId} returns 200 for valid account`);

  // 2.7 RBAC: Citizen gets 403
  const citizenIntelRes = await request(app)
    .get('/api/v1/accounts/intelligence')
    .set('Authorization', `Bearer ${citizenToken}`);
  assert(citizenIntelRes.status === 403, 'GET /accounts/intelligence returns 403 FORBIDDEN for Citizen');

  // 2.8 Unauthenticated gets 401
  const unauthIntelRes = await request(app).get('/api/v1/accounts/intelligence');
  assert(unauthIntelRes.status === 401, 'GET /accounts/intelligence returns 401 UNAUTHORIZED without token');

  // ---------------- 3. TRANSACTION INTERVENTION CENTRE ----------------
  console.log('\n3. Testing Transaction Intervention Centre (/api/v1/interventions)...');

  // 3.1 Authorized 200 with expected shape
  const intervRes = await request(app)
    .get('/api/v1/interventions?limit=20')
    .set('Authorization', `Bearer ${adminToken}`);

  assert(intervRes.status === 200, 'GET /interventions returns 200 for Administrator');
  assert(intervRes.body.success === true, 'Response envelope has success: true');
  assert(Array.isArray(intervRes.body.data?.interventions), 'Response contains interventions array');
  assert(typeof intervRes.body.data?.total === 'number', 'Response contains total count at data.total');
  assert(intervRes.body.data?.interventions.length > 0, `Returned ${intervRes.body.data?.interventions.length} interventions`);

  const firstInterv = intervRes.body.data?.interventions?.[0];
  assert(
    firstInterv &&
      typeof firstInterv.id === 'string' &&
      typeof firstInterv.screening_id === 'string' &&
      typeof firstInterv.recommended_action === 'string' &&
      typeof firstInterv.review_status === 'string' &&
      typeof firstInterv.amount === 'number',
    'Intervention item contains expected fields (id, screening_id, recommended_action, review_status, amount)'
  );

  // 3.2 Filter by action
  const blockActionRes = await request(app)
    .get('/api/v1/interventions?action=REJECT_BLOCK')
    .set('Authorization', `Bearer ${adminToken}`);
  assert(
    blockActionRes.status === 200 &&
      blockActionRes.body.data?.interventions.every((i: { recommended_action: string }) => i.recommended_action === 'REJECT_BLOCK'),
    'Filter by action=REJECT_BLOCK returns only REJECT_BLOCK interventions'
  );

  // 3.3 Metrics endpoint
  const metricsRes = await request(app)
    .get('/api/v1/interventions/metrics')
    .set('Authorization', `Bearer ${adminToken}`);
  assert(
    metricsRes.status === 200 && typeof metricsRes.body.data?.total_interventions === 'number',
    'GET /interventions/metrics returns 200 with summary metrics'
  );

  // 3.4 Cryptographic SHA-256 Tamper-Evident Hash Chain Verification
  const verifyChainRes = await request(app)
    .get('/api/v1/interventions/verify-chain')
    .set('Authorization', `Bearer ${adminToken}`);
  assert(
    verifyChainRes.status === 200 &&
      verifyChainRes.body.data?.status === 'VALID' &&
      typeof verifyChainRes.body.data?.total_entries_verified === 'number',
    'GET /interventions/verify-chain reports VALID cryptographic hash chain'
  );

  // 3.5 Single Intervention Detail
  if (firstInterv) {
    const detailRes = await request(app)
      .get(`/api/v1/interventions/${firstInterv.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    assert(
      detailRes.status === 200 && detailRes.body.data?.id === firstInterv.id,
      `GET /interventions/${firstInterv.id} returns full intervention details`
    );
  }

  // 3.6 RBAC: Citizen gets 403
  const citizenIntervRes = await request(app)
    .get('/api/v1/interventions')
    .set('Authorization', `Bearer ${citizenToken}`);
  assert(citizenIntervRes.status === 403, 'GET /interventions returns 403 FORBIDDEN for Citizen');

  // 3.7 Unauthenticated gets 401
  const unauthIntervRes = await request(app).get('/api/v1/interventions');
  assert(unauthIntervRes.status === 401, 'GET /interventions returns 401 UNAUTHORIZED without token');

  // ---------------- 4. MULE SYNDICATES & RING DETECTION ----------------
  console.log('\n4. Testing Mule Syndicates & Ring Detection (/api/v1/graph/mule-clusters)...');

  // 4.1 Authorized 200 with expected shape
  const muleRes = await request(app)
    .get('/api/v1/graph/mule-clusters?minRiskScore=30')
    .set('Authorization', `Bearer ${adminToken}`);

  assert(muleRes.status === 200, 'GET /graph/mule-clusters returns 200 for Administrator');
  assert(muleRes.body.success === true, 'Response envelope has success: true');
  assert(Array.isArray(muleRes.body.data?.clusters), 'Response contains clusters array');
  assert(typeof muleRes.body.data?.total_clusters === 'number', 'Response contains total_clusters count');
  assert(typeof muleRes.body.data?.high_risk_clusters === 'number', 'Response contains high_risk_clusters count');
  assert(typeof muleRes.body.data?.total_exposure_amount === 'number', 'Response contains total_exposure_amount');
  assert(muleRes.body.data?.clusters.length > 0, `Returned ${muleRes.body.data?.clusters.length} mule clusters`);

  const firstCluster = muleRes.body.data?.clusters?.[0];
  assert(
    firstCluster &&
      typeof firstCluster.cluster_id === 'string' &&
      typeof firstCluster.cluster_type === 'string' &&
      typeof firstCluster.severity === 'string' &&
      Array.isArray(firstCluster.members),
    'Cluster object contains cluster_id, cluster_type, severity, and members array'
  );

  // 4.2 Query parameter casing flexibility (camelCase vs snake_case)
  const snakeQueryRes = await request(app)
    .get('/api/v1/graph/mule-clusters?min_risk_score=30&min_cluster_size=2')
    .set('Authorization', `Bearer ${adminToken}`);
  assert(snakeQueryRes.status === 200, 'GET /graph/mule-clusters accepts snake_case parameters');

  // 4.3 Search filtering on clusters
  if (firstCluster?.cluster_id) {
    const searchRes = await request(app)
      .get(`/api/v1/graph/mule-clusters?search=${firstCluster.cluster_id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    assert(
      searchRes.status === 200 &&
        searchRes.body.data?.clusters.some((c: { cluster_id: string }) => c.cluster_id === firstCluster.cluster_id),
      `Filter by search=${firstCluster.cluster_id} returns matching cluster`
    );
  }

  // 4.4 Account Graph Intelligence deep dive
  const firstMember = firstCluster?.members?.[0];
  if (firstMember?.account_id) {
    const intelGraphRes = await request(app)
      .get(`/api/v1/graph/account/${firstMember.account_id}/intelligence`)
      .set('Authorization', `Bearer ${adminToken}`);
    assert(
      intelGraphRes.status === 200 && intelGraphRes.body.data?.account_id === firstMember.account_id,
      `GET /graph/account/${firstMember.account_id}/intelligence returns graph metrics for cluster member`
    );
  }

  // 4.5 RBAC: Citizen gets 403
  const citizenMuleRes = await request(app)
    .get('/api/v1/graph/mule-clusters')
    .set('Authorization', `Bearer ${citizenToken}`);
  assert(citizenMuleRes.status === 403, 'GET /graph/mule-clusters returns 403 FORBIDDEN for Citizen');

  // 4.6 Unauthenticated gets 401
  const unauthMuleRes = await request(app).get('/api/v1/graph/mule-clusters');
  assert(unauthMuleRes.status === 401, 'GET /graph/mule-clusters returns 401 UNAUTHORIZED without token');

  // ---------------- 5. HEALTH ENDPOINT TELEMETRY ----------------
  console.log('\n5. Testing Health & Prevention Layer Telemetry (/api/v1/health)...');
  const healthRes = await request(app).get('/api/v1/health');
  assert(healthRes.status === 200, 'GET /health returns 200 OK');
  assert(healthRes.body.preventionLayer?.status === 'READY', 'Health endpoint reports preventionLayer.status === "READY"');
  assert(
    typeof healthRes.body.preventionLayer?.accountProfilesCount === 'number' &&
      healthRes.body.preventionLayer.accountProfilesCount > 0,
    `Health endpoint reports ${healthRes.body.preventionLayer?.accountProfilesCount} account profiles`
  );

  console.log('\n=============================================================================');
  console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('=============================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Test runner encountered unexpected error:', err);
  process.exit(1);
});

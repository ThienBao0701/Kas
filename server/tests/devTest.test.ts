import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from '../src/app';
import { seedBranches } from '../src/db/seed';
import { resetAll, testPrisma } from './helpers/db';
import { ADMIN_PASSWORD, RECEPTIONIST_PASSWORD, createAdmin, createReceptionist, loginAgent } from './helpers/auth';
import { setDevToolsOverride } from '../src/devtest/guard';
import { computeDevToolsEnabled } from '../src/config/env';
import { CLEAR_DEMO_PHRASE, TEST_RECEPTIONIST_PASSWORD, TEST_RECEPTIONIST_USERNAME } from '../src/devtest/constants';
import { BRANCH_COUNT } from '../src/db/branches';
import { PROOF_UPLOAD_DIR } from '../src/config/env';

let app: ReturnType<typeof createApp>;
let adminAgent: Awaited<ReturnType<typeof loginAgent>>['agent'];
let ownAgent: Awaited<ReturnType<typeof loginAgent>>['agent'];
let ownBranchId: number;
let otherBranchId: number;

beforeEach(async () => {
  await resetAll();
  await seedBranches(testPrisma);
  await testPrisma.demoDataBatch.deleteMany({});
  app = createApp();
  ownBranchId = (await testPrisma.branch.findUniqueOrThrow({ where: { code: 'TRUONG_DINH_05' } })).id;
  otherBranchId = (await testPrisma.branch.findUniqueOrThrow({ where: { code: 'LY_TU_TRONG_260' } })).id;
  await createAdmin({ mustChangePassword: false });
  adminAgent = (await loginAgent(app, 'admin', ADMIN_PASSWORD)).agent;
  await createReceptionist(ownBranchId, { username: 'letan_own', mustChangePassword: false });
  ownAgent = (await loginAgent(app, 'letan_own', RECEPTIONIST_PASSWORD)).agent;
});

afterEach(() => setDevToolsOverride(null));
afterAll(async () => testPrisma.$disconnect());

const gen = (over: Record<string, unknown> = {}) => ({ bookingsPerBranch: 6, issuesPerBranch: 3, includeProofs: true, includeOcr: true, includeComparisons: true, seed: 123, ...over });

/**
 * Demo generation writes ~400 rows (48 bookings × rooms/nights/proof/OCR/
 * comparison + 24 issues) one at a time to SQLite, and some cases generate twice.
 * That legitimately exceeds the suite's default 20s budget on a contended machine,
 * so the bulk cases get their own generous timeout — the work is inherently slow,
 * not stuck.
 */
const BULK_TIMEOUT = 120_000;

describe('dev-test — security guards', () => {
  it('gate logic: disabled flag or production is off', () => {
    expect(computeDevToolsEnabled(false, 'development')).toBe(false);
    expect(computeDevToolsEnabled(true, 'production')).toBe(false);
    expect(computeDevToolsEnabled(true, 'development')).toBe(true);
  });

  it('endpoints 404 when the tools are disabled', async () => {
    setDevToolsOverride(false);
    expect((await adminAgent.get('/api/dev-test/status')).status).toBe(404);
    expect((await adminAgent.post('/api/dev-test/demo/generate').send(gen())).status).toBe(404);
  });

  it('a receptionist cannot generate or clear demo data (admin-only)', async () => {
    expect((await ownAgent.post('/api/dev-test/demo/generate').send(gen())).status).toBe(403);
    expect((await ownAgent.delete('/api/dev-test/demo').send({ confirmPhrase: CLEAR_DEMO_PHRASE })).status).toBe(403);
  });

  it('an ordinary receptionist cannot switch branch', async () => {
    const res = await ownAgent.post('/api/dev-test/active-branch').send({ branchId: otherBranchId });
    expect(res.status).toBe(403);
  });
});

describe('dev-test — reception_test branch switching', () => {
  async function testAgent() {
    await adminAgent.post('/api/dev-test/ensure-test-account').send({});
    return (await loginAgent(app, TEST_RECEPTIONIST_USERNAME, TEST_RECEPTIONIST_PASSWORD)).agent;
  }

  it('only reception_test may switch, to an existing enabled branch', async () => {
    const agent = await testAgent();
    const ok = await agent.post('/api/dev-test/active-branch').send({ branchId: otherBranchId });
    expect(ok.status).toBe(200);
    expect(ok.body.activeTestBranchId).toBe(otherBranchId);

    const bad = await agent.post('/api/dev-test/active-branch').send({ branchId: 999999 });
    expect(bad.status).toBe(422);
  });

  it('the switched branch scopes what the test account sees (client branchId cannot bypass)', async () => {
    // Seed one real issue in each of two branches.
    const admin = await testPrisma.user.findFirstOrThrow({ where: { role: 'ADMIN' } });
    await testPrisma.hotelIssue.create({ data: { branchId: ownBranchId, category: 'DOOR', description: 'own', status: 'NEW', reportedByUserId: admin.id } });
    await testPrisma.hotelIssue.create({ data: { branchId: otherBranchId, category: 'DOOR', description: 'other', status: 'NEW', reportedByUserId: admin.id } });

    const agent = await testAgent();
    await agent.post('/api/dev-test/active-branch').send({ branchId: otherBranchId });
    // Even with a spoofed query branchId, the session's active test branch wins.
    const res = await agent.get(`/api/issues?branchId=${ownBranchId}`);
    expect(res.status).toBe(200);
    expect(res.body.issues).toHaveLength(1);
    expect(res.body.issues[0].description).toBe('other');
  });
});

describe('dev-test — demo generation', () => {
  it('generates deterministic demo data across all 8 branches', async () => {
    const res = await adminAgent.post('/api/dev-test/demo/generate').send(gen());
    expect(res.status).toBe(201);
    const s = res.body.summary;
    expect(s.branches).toBe(BRANCH_COUNT);
    expect(s.bookingsCreated).toBe(6 * BRANCH_COUNT);
    expect(s.issuesCreated).toBe(3 * BRANCH_COUNT);
    expect(s.perBranch).toHaveLength(BRANCH_COUNT);

    // All created bookings/issues are marked demo; none are real.
    expect(await testPrisma.booking.count({ where: { isDemo: false } })).toBe(0);
    expect(await testPrisma.booking.count({ where: { isDemo: true } })).toBe(6 * BRANCH_COUNT);
    // Statuses are spread (DRAFT..COMPLETED all present).
    for (const status of ['DRAFT', 'READY', 'NEW', 'COMPLETED'] as const) {
      expect(await testPrisma.booking.count({ where: { status, isDemo: true } })).toBeGreaterThan(0);
    }
    // A generated proof file physically exists.
    const proof = await testPrisma.bookingCreationProof.findFirst();
    expect(proof).not.toBeNull();
    expect(fs.existsSync(path.join(PROOF_UPLOAD_DIR, proof!.storedFileName))).toBe(true);
  }, BULK_TIMEOUT);

  it('is deterministic for the same seed', async () => {
    const a = (await adminAgent.post('/api/dev-test/demo/generate').send(gen({ seed: 42 }))).body.summary;
    await adminAgent.delete('/api/dev-test/demo').send({ confirmPhrase: CLEAR_DEMO_PHRASE });
    const b = (await adminAgent.post('/api/dev-test/demo/generate').send(gen({ seed: 42 }))).body.summary;
    expect({ ...a, batchId: null }).toEqual({ ...b, batchId: null });
  }, BULK_TIMEOUT);

  it('enforces safe count limits', async () => {
    const res = await adminAgent.post('/api/dev-test/demo/generate').send(gen({ bookingsPerBranch: 5000 }));
    expect(res.status).toBe(422);
  });

  it('does not invoke real OCR (fake analyses marked provider=demo)', async () => {
    await adminAgent.post('/api/dev-test/demo/generate').send(gen());
    const analyses = await testPrisma.bookingProofAnalysis.findMany({ take: 5 });
    expect(analyses.length).toBeGreaterThan(0);
    for (const a of analyses) expect(a.provider).toBe('demo');
  }, BULK_TIMEOUT);
});

describe('dev-test — clear demo', () => {
  it('requires the exact confirmation phrase', async () => {
    await adminAgent.post('/api/dev-test/demo/generate').send(gen());
    const wrong = await adminAgent.delete('/api/dev-test/demo').send({ confirmPhrase: 'xoa du lieu demo' });
    expect(wrong.status).toBe(422);
  }, BULK_TIMEOUT);

  it('removes all demo data + files but preserves real data', async () => {
    // A real booking + real issue that must survive.
    const admin = await testPrisma.user.findFirstOrThrow({ where: { role: 'ADMIN' } });
    const realBooking = await testPrisma.booking.create({ data: { bookingCode: 'REAL0001', customerName: 'Real', paymentStatus: 'PAY_AFTER', rawText: 'x', status: 'NEW', branchId: ownBranchId } });
    const realIssue = await testPrisma.hotelIssue.create({ data: { branchId: ownBranchId, category: 'DOOR', description: 'real', status: 'NEW', reportedByUserId: admin.id } });

    await adminAgent.post('/api/dev-test/demo/generate').send(gen());
    const demoProof = await testPrisma.bookingCreationProof.findFirstOrThrow({ where: { booking: { isDemo: true } } });
    const demoFile = path.join(PROOF_UPLOAD_DIR, demoProof.storedFileName);
    expect(fs.existsSync(demoFile)).toBe(true);

    const res = await adminAgent.delete('/api/dev-test/demo').send({ confirmPhrase: CLEAR_DEMO_PHRASE });
    expect(res.status).toBe(200);
    expect(res.body.summary.bookingsDeleted).toBeGreaterThan(0);

    // Demo gone (rows + file), real preserved.
    expect(await testPrisma.booking.count({ where: { isDemo: true } })).toBe(0);
    expect(await testPrisma.demoDataBatch.count()).toBe(0);
    expect(fs.existsSync(demoFile)).toBe(false);
    expect(await testPrisma.booking.findUnique({ where: { id: realBooking.id } })).not.toBeNull();
    expect(await testPrisma.hotelIssue.findUnique({ where: { id: realIssue.id } })).not.toBeNull();
    // Branches + users preserved.
    expect(await testPrisma.branch.count()).toBe(BRANCH_COUNT);
    expect(await testPrisma.user.count({ where: { role: 'ADMIN' } })).toBe(1);
  }, BULK_TIMEOUT);

  it('is safe to run twice', async () => {
    await adminAgent.post('/api/dev-test/demo/generate').send(gen());
    expect((await adminAgent.delete('/api/dev-test/demo').send({ confirmPhrase: CLEAR_DEMO_PHRASE })).status).toBe(200);
    const second = await adminAgent.delete('/api/dev-test/demo').send({ confirmPhrase: CLEAR_DEMO_PHRASE });
    expect(second.status).toBe(200);
    expect(second.body.summary.bookingsDeleted).toBe(0);
  }, BULK_TIMEOUT);
});

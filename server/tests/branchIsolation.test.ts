import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { seedBranches } from '../src/db/seed';
import { BRANCHES } from '../src/db/branches';
import { resetAll, testPrisma } from './helpers/db';
import {
  ADMIN_PASSWORD,
  RECEPTIONIST_PASSWORD,
  createAdmin,
  createReceptionist,
  loginAgent,
} from './helpers/auth';

let app: ReturnType<typeof createApp>;
let adminAgent: Awaited<ReturnType<typeof loginAgent>>['agent'];
let receptionistAgent: Awaited<ReturnType<typeof loginAgent>>['agent'];
let ownBranchId: number;
let otherBranchId: number;

beforeEach(async () => {
  await resetAll();
  await seedBranches(testPrisma);
  app = createApp();

  const own = await testPrisma.branch.findUniqueOrThrow({ where: { code: 'TRUONG_DINH_05' } });
  const other = await testPrisma.branch.findUniqueOrThrow({ where: { code: 'LY_TU_TRONG_260' } });
  ownBranchId = own.id;
  otherBranchId = other.id;

  await createAdmin({ mustChangePassword: false });
  adminAgent = (await loginAgent(app, 'admin', ADMIN_PASSWORD)).agent;

  await createReceptionist(ownBranchId, { username: 'letan', mustChangePassword: false });
  receptionistAgent = (await loginAgent(app, 'letan', RECEPTIONIST_PASSWORD)).agent;
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

describe('GET /api/branches', () => {
  it('returns all 8 active branches for an admin', async () => {
    const res = await adminAgent.get('/api/branches');
    expect(res.status).toBe(200);
    expect(res.body.branches).toHaveLength(BRANCHES.length);
    expect(res.body.branches).toHaveLength(8);
  });

  it('returns only the assigned branch for a receptionist', async () => {
    const res = await receptionistAgent.get('/api/branches');
    expect(res.status).toBe(200);
    expect(res.body.branches).toHaveLength(1);
    expect(res.body.branches[0].id).toBe(ownBranchId);
  });

  it('ignores a client-supplied branchId (server decides from the session)', async () => {
    const res = await receptionistAgent.get(`/api/branches?branchId=${otherBranchId}`);
    expect(res.status).toBe(200);
    expect(res.body.branches).toHaveLength(1);
    expect(res.body.branches[0].id).toBe(ownBranchId);
  });
});

describe('GET /api/branches/:id', () => {
  it('lets an admin read any active branch', async () => {
    const res = await adminAgent.get(`/api/branches/${otherBranchId}`);
    expect(res.status).toBe(200);
    expect(res.body.branch.id).toBe(otherBranchId);
  });

  it('lets a receptionist read their own branch', async () => {
    const res = await receptionistAgent.get(`/api/branches/${ownBranchId}`);
    expect(res.status).toBe(200);
    expect(res.body.branch.id).toBe(ownBranchId);
  });

  it("denies a receptionist access to another branch by id", async () => {
    const res = await receptionistAgent.get(`/api/branches/${otherBranchId}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('BRANCH_ACCESS_DENIED');
  });

  it('requires authentication', async () => {
    const res = await request(app).get(`/api/branches/${ownBranchId}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_REQUIRED');
  });
});

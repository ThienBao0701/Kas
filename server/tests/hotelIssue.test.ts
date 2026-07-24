import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { seedBranches } from '../src/db/seed';
import { resetAll, testPrisma } from './helpers/db';
import { ADMIN_PASSWORD, RECEPTIONIST_PASSWORD, createAdmin, createReceptionist, loginAgent } from './helpers/auth';
import { pngBuffer, notAnImageBuffer } from './helpers/images';

let app: ReturnType<typeof createApp>;
let adminAgent: Awaited<ReturnType<typeof loginAgent>>['agent'];
let ownAgent: Awaited<ReturnType<typeof loginAgent>>['agent'];
let otherAgent: Awaited<ReturnType<typeof loginAgent>>['agent'];
let ownBranchId: number;
let otherBranchId: number;
let adminId: number;
let ownReceptionistId: number;

beforeEach(async () => {
  await resetAll();
  await seedBranches(testPrisma);
  app = createApp();
  ownBranchId = (await testPrisma.branch.findUniqueOrThrow({ where: { code: 'TRUONG_DINH_05' } })).id;
  otherBranchId = (await testPrisma.branch.findUniqueOrThrow({ where: { code: 'LY_TU_TRONG_260' } })).id;

  adminId = (await createAdmin({ mustChangePassword: false })).id;
  adminAgent = (await loginAgent(app, 'admin', ADMIN_PASSWORD)).agent;
  ownReceptionistId = (await createReceptionist(ownBranchId, { username: 'letan_own', mustChangePassword: false })).id;
  ownAgent = (await loginAgent(app, 'letan_own', RECEPTIONIST_PASSWORD)).agent;
  await createReceptionist(otherBranchId, { username: 'letan_other', mustChangePassword: false });
  otherAgent = (await loginAgent(app, 'letan_other', RECEPTIONIST_PASSWORD)).agent;
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

function createBody(agent: typeof ownAgent, over: Record<string, string> = {}) {
  return agent
    .post('/api/issues')
    .field('category', over.category ?? 'AIR_CONDITIONER')
    .field('description', over.description ?? 'Máy lạnh không lạnh')
    .field('roomNumber', over.roomNumber ?? '301');
}

describe('POST /api/issues (create)', () => {
  it('lets a receptionist report an issue for their own branch', async () => {
    const res = await createBody(ownAgent);
    expect(res.status).toBe(201);
    expect(res.body.issue.status).toBe('NEW');
    expect(res.body.issue.category).toBe('AIR_CONDITIONER');
    expect(res.body.issue.roomNumber).toBe('301');
    expect(res.body.issue.branch.id).toBe(ownBranchId);
    expect(res.body.issue.reportedBy.id).toBe(ownReceptionistId);
    expect(res.body.issue.photoUrl).toBeNull();

    // Every active admin is notified (badge +1).
    const notes = await testPrisma.notification.findMany({ where: { userId: adminId } });
    expect(notes.some((n) => n.title === 'Có báo cáo sự cố mới')).toBe(true);
  });

  it('ignores a client-supplied branchId for a receptionist (isolation)', async () => {
    const res = await createBody(ownAgent).field('branchId', String(otherBranchId));
    expect(res.status).toBe(201);
    expect(res.body.issue.branch.id).toBe(ownBranchId);
  });

  it('accepts an optional photo and serves it branch-isolated', async () => {
    const res = await createBody(ownAgent).attach('image', pngBuffer(), { filename: 'p.png', contentType: 'image/png' });
    expect(res.status).toBe(201);
    const id = res.body.issue.id as string;
    expect(res.body.issue.photoUrl).toBe(`/api/issues/${id}/photo`);
    const own = await ownAgent.get(`/api/issues/${id}/photo`);
    expect(own.status).toBe(200);
    expect(own.headers['content-type']).toContain('image/png');

    const admin = await adminAgent.get(`/api/issues/${id}/photo`);
    expect(admin.status).toBe(200);

    const other = await otherAgent.get(`/api/issues/${id}/photo`);
    expect(other.status).toBe(403);
  });

  it('rejects a non-image photo', async () => {
    const res = await createBody(ownAgent).attach('image', notAnImageBuffer(), { filename: 'x.png', contentType: 'image/png' });
    expect(res.status).toBe(415);
  });

  it('requires a description', async () => {
    const res = await ownAgent.post('/api/issues').field('category', 'DOOR').field('description', '   ');
    expect(res.status).toBe(422);
  });
});

describe('GET /api/issues (branch isolation + admin all)', () => {
  beforeEach(async () => {
    await createBody(ownAgent, { description: 'Đơn của own' });
    await createBody(otherAgent, { description: 'Đơn của other' });
  });

  it('shows a receptionist only their own branch', async () => {
    const res = await ownAgent.get('/api/issues');
    expect(res.status).toBe(200);
    expect(res.body.issues).toHaveLength(1);
    expect(res.body.issues[0].branch.id).toBe(ownBranchId);
  });

  it('shows an admin all branches, newest first', async () => {
    const res = await adminAgent.get('/api/issues');
    expect(res.body.issues).toHaveLength(2);
    // Newest first: the last-created ("other") comes first.
    expect(res.body.issues[0].description).toBe('Đơn của other');
  });

  it('lets an admin filter by branch', async () => {
    const res = await adminAgent.get(`/api/issues?branchId=${otherBranchId}`);
    expect(res.body.issues).toHaveLength(1);
    expect(res.body.issues[0].branch.id).toBe(otherBranchId);
  });

  it("denies a receptionist another branch's issue detail", async () => {
    const other = await testPrisma.hotelIssue.findFirstOrThrow({ where: { branchId: otherBranchId } });
    const res = await ownAgent.get(`/api/issues/${other.id}`);
    expect(res.status).toBe(403);
  });
});

describe('status transitions (admin only)', () => {
  async function newIssue(): Promise<string> {
    const res = await createBody(ownAgent);
    return res.body.issue.id;
  }

  it('admin accepts (NEW → IN_PROGRESS) then resolves (→ RESOLVED)', async () => {
    const id = await newIssue();

    const accepted = await adminAgent.post(`/api/issues/${id}/accept`).send({});
    expect(accepted.status).toBe(200);
    expect(accepted.body.issue.status).toBe('IN_PROGRESS');
    expect(accepted.body.issue.acceptedBy.id).toBe(adminId);

    const resolved = await adminAgent.post(`/api/issues/${id}/resolve`).send({});
    expect(resolved.status).toBe(200);
    expect(resolved.body.issue.status).toBe('RESOLVED');
    expect(resolved.body.issue.resolvedBy.id).toBe(adminId);
    expect(resolved.body.issue.resolvedAt).not.toBeNull();

    // The reporter is notified on each status change.
    const notes = await testPrisma.notification.findMany({ where: { userId: ownReceptionistId } });
    expect(notes.some((n) => n.title === 'Sự cố đang được xử lý')).toBe(true);
    expect(notes.some((n) => n.title === 'Sự cố đã được xử lý')).toBe(true);
  });

  it('forbids a receptionist from changing status', async () => {
    const id = await newIssue();
    expect((await ownAgent.post(`/api/issues/${id}/accept`).send({})).status).toBe(403);
    expect((await ownAgent.post(`/api/issues/${id}/resolve`).send({})).status).toBe(403);
  });
});

describe('receptionist edit rules', () => {
  it('lets the reporter edit while NEW but not after the admin accepts', async () => {
    const id = (await createBody(ownAgent)).body.issue.id;

    const edited = await ownAgent.put(`/api/issues/${id}`).send({ description: 'Cập nhật mô tả' });
    expect(edited.status).toBe(200);
    expect(edited.body.issue.description).toBe('Cập nhật mô tả');

    await adminAgent.post(`/api/issues/${id}/accept`).send({});

    const afterAccept = await ownAgent.put(`/api/issues/${id}`).send({ description: 'Sửa sau khi tiếp nhận' });
    expect(afterAccept.status).toBe(409);
  });

  it("forbids editing another branch's issue", async () => {
    const other = (await createBody(otherAgent)).body.issue.id;
    const res = await ownAgent.put(`/api/issues/${other}`).send({ description: 'x' });
    expect(res.status).toBe(403);
  });
});

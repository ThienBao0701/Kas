import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { seedBranches } from '../src/db/seed';
import { resetAll, testPrisma } from './helpers/db';
import { ADMIN_PASSWORD, RECEPTIONIST_PASSWORD, createAdmin, createReceptionist, loginAgent } from './helpers/auth';

let app: ReturnType<typeof createApp>;
let adminAgent: Awaited<ReturnType<typeof loginAgent>>['agent'];
let ownAgent: Awaited<ReturnType<typeof loginAgent>>['agent'];
let receptionistId: number;
let adminId: number;

async function seedNotifications(userId: number, count: number, read = false): Promise<void> {
  await testPrisma.notification.createMany({
    data: Array.from({ length: count }, (_, i) => ({
      userId,
      title: `Thông báo ${i + 1}`,
      body: 'Nội dung',
      read,
    })),
  });
}

beforeEach(async () => {
  await resetAll();
  await seedBranches(testPrisma);
  app = createApp();
  const branchId = (await testPrisma.branch.findUniqueOrThrow({ where: { code: 'TRUONG_DINH_05' } })).id;

  adminId = (await createAdmin({ mustChangePassword: false })).id;
  adminAgent = (await loginAgent(app, 'admin', ADMIN_PASSWORD)).agent;
  receptionistId = (await createReceptionist(branchId, { username: 'letan_own', mustChangePassword: false })).id;
  ownAgent = (await loginAgent(app, 'letan_own', RECEPTIONIST_PASSWORD)).agent;
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

describe('Notifications API', () => {
  it('returns only the caller\'s own notifications with an unread count', async () => {
    await seedNotifications(receptionistId, 3);
    await seedNotifications(adminId, 2);

    const res = await ownAgent.get('/api/notifications');
    expect(res.status).toBe(200);
    expect(res.body.notifications).toHaveLength(3);
    expect(res.body.unreadCount).toBe(3);
    expect(res.body.pagination.total).toBe(3);
  });

  it('reports the unread count', async () => {
    await seedNotifications(receptionistId, 2);
    await seedNotifications(receptionistId, 1, true);
    const res = await ownAgent.get('/api/notifications/unread-count');
    expect(res.body.count).toBe(2);
  });

  it('marks a single notification read', async () => {
    await seedNotifications(receptionistId, 2);
    const one = (await ownAgent.get('/api/notifications')).body.notifications[0];
    const res = await ownAgent.post(`/api/notifications/${one.id}/read`);
    expect(res.status).toBe(200);
    expect((await ownAgent.get('/api/notifications/unread-count')).body.count).toBe(1);
  });

  it('marks all notifications read', async () => {
    await seedNotifications(receptionistId, 4);
    const res = await ownAgent.post('/api/notifications/read-all');
    expect(res.body.updated).toBe(4);
    expect((await ownAgent.get('/api/notifications/unread-count')).body.count).toBe(0);
  });

  it('cannot mark another user\'s notification read', async () => {
    await seedNotifications(adminId, 1);
    const adminNote = (await adminAgent.get('/api/notifications')).body.notifications[0];
    const res = await ownAgent.post(`/api/notifications/${adminNote.id}/read`);
    expect(res.status).toBe(404);
    // The admin's notification is untouched.
    const stored = await testPrisma.notification.findUniqueOrThrow({ where: { id: adminNote.id } });
    expect(stored.read).toBe(false);
  });

  it('requires authentication', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).get('/api/notifications');
    expect(res.status).toBe(401);
  });
});

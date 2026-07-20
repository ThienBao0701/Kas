import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../src/app';
import { ensureInitialAdmin } from '../src/auth/bootstrapAdmin';
import { verifyPassword } from '../src/auth/password';
import { seedBranches } from '../src/db/seed';
import { resetAll, testPrisma } from './helpers/db';
import {
  ADMIN_PASSWORD,
  NEW_PASSWORD,
  RECEPTIONIST_PASSWORD,
  createAdmin,
  createReceptionist,
  loginAgent,
  sessionIdFrom,
  sessionSetCookie,
} from './helpers/auth';

let app: Express;

beforeEach(async () => {
  await resetAll();
  await seedBranches(testPrisma);
  // A fresh app per test → a fresh login rate limiter, so counts never bleed
  // between tests.
  app = createApp();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

describe('initial admin bootstrap', () => {
  it('creates the admin from config: hashed password, mustChangePassword true', async () => {
    const result = await ensureInitialAdmin(
      testPrisma,
      { username: 'Admin', password: ADMIN_PASSWORD, fullName: 'Quản trị viên' },
      { production: false },
    );

    expect(result.created).toBe(true);

    const admin = await testPrisma.user.findUniqueOrThrow({ where: { username: 'admin' } });
    expect(admin.role).toBe('ADMIN');
    expect(admin.branchId).toBeNull();
    expect(admin.active).toBe(true);
    expect(admin.mustChangePassword).toBe(true);
    expect(admin.passwordHash).not.toBe(ADMIN_PASSWORD);
    expect(admin.passwordHash.startsWith('$2')).toBe(true);
    expect(await verifyPassword(ADMIN_PASSWORD, admin.passwordHash)).toBe(true);
  });

  it('is idempotent and never overwrites an existing admin password', async () => {
    const first = await ensureInitialAdmin(
      testPrisma,
      { username: 'admin', password: ADMIN_PASSWORD, fullName: 'Original' },
      { production: false },
    );
    const afterFirst = await testPrisma.user.findUniqueOrThrow({ where: { username: 'admin' } });

    const second = await ensureInitialAdmin(
      testPrisma,
      { username: 'admin', password: 'Different9', fullName: 'Changed' },
      { production: false },
    );
    const afterSecond = await testPrisma.user.findUniqueOrThrow({ where: { username: 'admin' } });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.reason).toBe('exists');
    expect(afterSecond.passwordHash).toBe(afterFirst.passwordHash);
    expect(afterSecond.fullName).toBe('Original');
    expect(await testPrisma.user.count({ where: { role: 'ADMIN' } })).toBe(1);
  });

  it('fails safely in production when credentials are missing (no account created)', async () => {
    await expect(
      ensureInitialAdmin(testPrisma, {}, { production: true }),
    ).rejects.toThrow(/production/i);
    expect(await testPrisma.user.count()).toBe(0);
  });

  it('does not invent a default account in development when unconfigured', async () => {
    const result = await ensureInitialAdmin(testPrisma, {}, { production: false });
    expect(result.created).toBe(false);
    expect(result.reason).toBe('missing-config');
    expect(await testPrisma.user.count()).toBe(0);
  });
});

describe('POST /api/auth/login', () => {
  beforeEach(async () => {
    await createAdmin({ mustChangePassword: false });
  });

  it('logs in with correct credentials and returns safe user data', async () => {
    const { res } = await loginAgent(app, 'admin', ADMIN_PASSWORD);
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ username: 'admin', role: 'ADMIN' });
    expect(res.body.mustChangePassword).toBe(false);
    expect(res.body.user.passwordHash).toBeUndefined();
  });

  it('rejects a wrong password with one generic message', async () => {
    const { res } = await loginAgent(app, 'admin', 'WrongPass9');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(res.body.error.message).toBe('Tên đăng nhập hoặc mật khẩu không đúng.');
  });

  it('rejects an unknown username with the identical generic message', async () => {
    const { res } = await loginAgent(app, 'nobody', ADMIN_PASSWORD);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(res.body.error.message).toBe('Tên đăng nhập hoặc mật khẩu không đúng.');
  });

  it('rejects a disabled account', async () => {
    const branch = await testPrisma.branch.findFirstOrThrow();
    await createReceptionist(branch.id, { username: 'disabled', active: false });
    const { res } = await loginAgent(app, 'disabled', RECEPTIONIST_PASSWORD);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_DISABLED');
  });

  it('creates an HttpOnly session cookie', async () => {
    const { res } = await loginAgent(app, 'admin', ADMIN_PASSWORD);
    const cookie = sessionSetCookie(res);
    expect(cookie).toBeDefined();
    expect(cookie?.toLowerCase()).toContain('httponly');
  });

  it('updates lastLoginAt', async () => {
    expect((await testPrisma.user.findUniqueOrThrow({ where: { username: 'admin' } })).lastLoginAt).toBeNull();
    await loginAgent(app, 'admin', ADMIN_PASSWORD);
    expect((await testPrisma.user.findUniqueOrThrow({ where: { username: 'admin' } })).lastLoginAt).not.toBeNull();
  });

  it('regenerates the session id on login (fixation protection)', async () => {
    const agent = request.agent(app);
    const first = await agent.post('/api/auth/login').send({ username: 'admin', password: ADMIN_PASSWORD });
    const second = await agent.post('/api/auth/login').send({ username: 'admin', password: ADMIN_PASSWORD });
    const id1 = sessionIdFrom(first);
    const id2 = sessionIdFrom(second);
    expect(id1).toBeDefined();
    expect(id2).toBeDefined();
    expect(id1).not.toBe(id2);
  });
});

describe('GET /api/auth/me', () => {
  it('requires authentication', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_REQUIRED');
  });

  it('returns only safe fields', async () => {
    await createAdmin({ mustChangePassword: false });
    const { agent } = await loginAgent(app, 'admin', ADMIN_PASSWORD);
    const res = await agent.get('/api/auth/me');

    expect(res.status).toBe(200);
    expect(Object.keys(res.body.user).sort()).toEqual([
      'active',
      'branch',
      'fullName',
      'id',
      'mustChangePassword',
      'role',
      'username',
    ]);
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
  });
});

describe('POST /api/auth/change-password', () => {
  it('requires authentication', async () => {
    const res = await request(app)
      .post('/api/auth/change-password')
      .send({ currentPassword: ADMIN_PASSWORD, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_REQUIRED');
  });

  it('rejects a wrong current password', async () => {
    await createAdmin({ mustChangePassword: true });
    const { agent } = await loginAgent(app, 'admin', ADMIN_PASSWORD);
    const res = await agent
      .post('/api/auth/change-password')
      .send({ currentPassword: 'WrongNow9', newPassword: NEW_PASSWORD });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('rejects a weak new password', async () => {
    await createAdmin({ mustChangePassword: true });
    const { agent } = await loginAgent(app, 'admin', ADMIN_PASSWORD);
    const res = await agent
      .post('/api/auth/change-password')
      .send({ currentPassword: ADMIN_PASSWORD, newPassword: 'short' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects reusing the current password', async () => {
    await createAdmin({ mustChangePassword: true });
    const { agent } = await loginAgent(app, 'admin', ADMIN_PASSWORD);
    const res = await agent
      .post('/api/auth/change-password')
      .send({ currentPassword: ADMIN_PASSWORD, newPassword: ADMIN_PASSWORD });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('changes the password, clears mustChangePassword, and swaps which password works', async () => {
    await createAdmin({ mustChangePassword: true });
    const { agent } = await loginAgent(app, 'admin', ADMIN_PASSWORD);

    const res = await agent
      .post('/api/auth/change-password')
      .send({ currentPassword: ADMIN_PASSWORD, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(200);

    const admin = await testPrisma.user.findUniqueOrThrow({ where: { username: 'admin' } });
    expect(admin.mustChangePassword).toBe(false);

    const oldLogin = await loginAgent(app, 'admin', ADMIN_PASSWORD);
    expect(oldLogin.res.status).toBe(401);

    const newLogin = await loginAgent(app, 'admin', NEW_PASSWORD);
    expect(newLogin.res.status).toBe(200);
  });
});

describe('forced password change', () => {
  it('permits me/change-password/logout but blocks other protected endpoints', async () => {
    await createAdmin({ mustChangePassword: true });
    const { agent, res: loginRes } = await loginAgent(app, 'admin', ADMIN_PASSWORD);
    expect(loginRes.body.mustChangePassword).toBe(true);

    expect((await agent.get('/api/auth/me')).status).toBe(200);

    const branches = await agent.get('/api/branches');
    expect(branches.status).toBe(403);
    expect(branches.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');

    const users = await agent.get('/api/admin/users');
    expect(users.status).toBe(403);
    expect(users.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');

    const change = await agent
      .post('/api/auth/change-password')
      .send({ currentPassword: ADMIN_PASSWORD, newPassword: NEW_PASSWORD });
    expect(change.status).toBe(200);

    // Once the password is changed, the previously blocked endpoint opens up.
    expect((await agent.get('/api/branches')).status).toBe(200);
    expect((await agent.post('/api/auth/logout')).status).toBe(200);
  });
});

describe('security', () => {
  it('never exposes a password hash in any auth response', async () => {
    await createAdmin({ mustChangePassword: false });
    const { agent, res } = await loginAgent(app, 'admin', ADMIN_PASSWORD);
    const me = await agent.get('/api/auth/me');

    for (const response of [res, me]) {
      const serialized = JSON.stringify(response.body);
      expect(serialized).not.toContain('passwordHash');
      expect(serialized).not.toContain('$2b$');
    }
  });

  it('rate limits login attempts, in isolation from other apps', async () => {
    await createAdmin({ mustChangePassword: false });

    // Dedicated app so this test's limiter cannot affect any other test.
    const limitedApp = createApp();
    for (let attempt = 0; attempt < 10; attempt++) {
      const r = await request(limitedApp)
        .post('/api/auth/login')
        .send({ username: 'admin', password: 'WrongPass9' });
      expect(r.status).toBe(401);
    }

    const blocked = await request(limitedApp)
      .post('/api/auth/login')
      .send({ username: 'admin', password: ADMIN_PASSWORD });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');

    // A separate app instance is completely unaffected by the tripped limiter.
    const freshApp = createApp();
    const ok = await request(freshApp)
      .post('/api/auth/login')
      .send({ username: 'admin', password: ADMIN_PASSWORD });
    expect(ok.status).toBe(200);
  });
});

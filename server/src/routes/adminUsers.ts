import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';
import { ApiError } from '../lib/errors';
import { normalizeUsername } from '../auth/username';
import { hashPassword, passwordSchema } from '../auth/password';
import { serializeManagedUser } from '../auth/serialize';
import { sessionStore } from '../auth/session';
import { requireAuth, requireAdmin, requirePasswordChanged } from '../middleware/auth';

const createUserSchema = z.object({
  username: z.string().trim().min(1, 'Tên đăng nhập là bắt buộc.').max(50),
  fullName: z.string().trim().min(1, 'Họ tên là bắt buộc.').max(100),
  temporaryPassword: passwordSchema,
  branchId: z.number().int().positive(),
  active: z.boolean().optional(),
});

const updateUserSchema = z
  .object({
    fullName: z.string().trim().min(1).max(100).optional(),
    branchId: z.number().int().positive().optional(),
    active: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Cần ít nhất một trường để cập nhật.',
  });

const resetPasswordSchema = z.object({ temporaryPassword: passwordSchema });

const listQuerySchema = z.object({
  branchId: z.coerce.number().int().positive().optional(),
  active: z.enum(['true', 'false']).optional(),
  search: z.string().trim().min(1).max(100).optional(),
});

function parseUserId(raw: string | undefined): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw ApiError.notFound('Không tìm thấy tài khoản.');
  }
  return id;
}

/** Loads a managed account and guarantees it is a receptionist. */
async function loadReceptionist(id: number) {
  const user = await prisma.user.findUnique({ where: { id }, include: { branch: true } });
  if (!user) {
    throw ApiError.notFound('Không tìm thấy tài khoản.');
  }
  // These endpoints manage receptionists only; admin accounts are off-limits so
  // the administrator can never lock itself out or demote itself here.
  if (user.role !== 'RECEPTIONIST') {
    throw ApiError.forbidden('Chỉ có thể quản lý tài khoản lễ tân.');
  }
  return user;
}

async function assertBranchUsable(branchId: number): Promise<void> {
  const branch = await prisma.branch.findUnique({ where: { id: branchId } });
  if (!branch || !branch.active) {
    throw ApiError.validation('Chi nhánh không hợp lệ hoặc đã ngừng hoạt động.');
  }
}

export function createAdminUsersRouter(): Router {
  const router = Router();

  // Every account-management endpoint requires an authenticated admin who has
  // already satisfied any forced password change.
  router.use('/admin', requireAuth, requirePasswordChanged, requireAdmin);

  // GET /api/admin/users — receptionist accounts, with optional filters.
  router.get('/admin/users', (req, res, next) => {
    (async () => {
      const query = listQuerySchema.parse(req.query);

      const where: Prisma.UserWhereInput = { role: 'RECEPTIONIST' };
      if (query.branchId !== undefined) where.branchId = query.branchId;
      if (query.active !== undefined) where.active = query.active === 'true';
      if (query.search) {
        where.OR = [
          { username: { contains: query.search } },
          { fullName: { contains: query.search } },
        ];
      }

      const users = await prisma.user.findMany({
        where,
        include: { branch: true },
        orderBy: { id: 'asc' },
      });
      res.json({ users: users.map(serializeManagedUser) });
    })().catch(next);
  });

  // POST /api/admin/users — create a receptionist.
  router.post('/admin/users', (req, res, next) => {
    (async () => {
      const body = createUserSchema.parse(req.body);
      const username = normalizeUsername(body.username);

      await assertBranchUsable(body.branchId);

      const existing = await prisma.user.findUnique({ where: { username } });
      if (existing) {
        throw ApiError.conflict('Tên đăng nhập đã tồn tại.');
      }

      const created = await prisma.user.create({
        data: {
          username,
          passwordHash: await hashPassword(body.temporaryPassword),
          fullName: body.fullName,
          role: 'RECEPTIONIST',
          branchId: body.branchId,
          active: body.active ?? true,
          mustChangePassword: true,
        },
        include: { branch: true },
      });

      res.status(201).json({ user: serializeManagedUser(created) });
    })().catch(next);
  });

  // PUT /api/admin/users/:id — update fullName / branchId / active only.
  router.put('/admin/users/:id', (req, res, next) => {
    (async () => {
      const id = parseUserId(req.params.id);
      await loadReceptionist(id);
      const body = updateUserSchema.parse(req.body);

      if (body.branchId !== undefined) {
        await assertBranchUsable(body.branchId);
      }

      const data: Prisma.UserUpdateInput = {};
      if (body.fullName !== undefined) data.fullName = body.fullName;
      if (body.active !== undefined) data.active = body.active;
      if (body.branchId !== undefined) data.branch = { connect: { id: body.branchId } };

      const updated = await prisma.user.update({
        where: { id },
        data,
        include: { branch: true },
      });

      // If this update just disabled the account, drop its live sessions too.
      if (body.active === false) {
        await sessionStore.destroyByUserId(id);
      }

      res.json({ user: serializeManagedUser(updated) });
    })().catch(next);
  });

  // POST /api/admin/users/:id/reset-password — issue a new temporary password.
  router.post('/admin/users/:id/reset-password', (req, res, next) => {
    (async () => {
      const id = parseUserId(req.params.id);
      await loadReceptionist(id);
      const { temporaryPassword } = resetPasswordSchema.parse(req.body);

      await prisma.user.update({
        where: { id },
        data: {
          passwordHash: await hashPassword(temporaryPassword),
          mustChangePassword: true,
        },
      });

      // Force re-authentication with the new temporary password.
      await sessionStore.destroyByUserId(id);

      res.json({ success: true });
    })().catch(next);
  });

  // POST /api/admin/users/:id/enable
  router.post('/admin/users/:id/enable', (req, res, next) => {
    (async () => {
      const id = parseUserId(req.params.id);
      await loadReceptionist(id);
      const updated = await prisma.user.update({
        where: { id },
        data: { active: true },
        include: { branch: true },
      });
      res.json({ user: serializeManagedUser(updated) });
    })().catch(next);
  });

  // POST /api/admin/users/:id/disable
  router.post('/admin/users/:id/disable', (req, res, next) => {
    (async () => {
      const id = parseUserId(req.params.id);
      await loadReceptionist(id);
      const updated = await prisma.user.update({
        where: { id },
        data: { active: false },
        include: { branch: true },
      });
      // Existing sessions must stop granting access immediately.
      await sessionStore.destroyByUserId(id);
      res.json({ user: serializeManagedUser(updated) });
    })().catch(next);
  });

  return router;
}

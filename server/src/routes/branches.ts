import { Router } from 'express';
import { prisma } from '../db/prisma';
import { ApiError } from '../lib/errors';
import { serializeBranch } from '../auth/serialize';
import { requireAuth, requirePasswordChanged, requireBranchAccess } from '../middleware/auth';

export function createBranchesRouter(): Router {
  const router = Router();

  // GET /api/branches
  // ADMIN: all active branches. RECEPTIONIST: only the assigned branch.
  router.get('/branches', requireAuth, requirePasswordChanged, (req, res, next) => {
    (async () => {
      const user = req.currentUser;
      if (!user) throw ApiError.authRequired();

      if (user.role === 'ADMIN') {
        const branches = await prisma.branch.findMany({
          where: { active: true },
          orderBy: { id: 'asc' },
        });
        res.json({ branches: branches.map((b) => serializeBranch(b)) });
        return;
      }

      // Receptionist: the server decides the branch from the session identity,
      // never from anything the client sends.
      const branches =
        user.branchId != null
          ? await prisma.branch.findMany({ where: { id: user.branchId, active: true } })
          : [];
      res.json({ branches: branches.map((b) => serializeBranch(b)) });
    })().catch(next);
  });

  // GET /api/branches/:id
  // ADMIN: any active branch. RECEPTIONIST: only their own (enforced by
  // requireBranchAccess before the handler ever runs).
  router.get(
    '/branches/:id',
    requireAuth,
    requirePasswordChanged,
    requireBranchAccess(),
    (req, res, next) => {
      (async () => {
        const id = Number(req.params.id);
        if (!Number.isInteger(id)) {
          throw ApiError.notFound('Không tìm thấy chi nhánh.');
        }
        const branch = await prisma.branch.findFirst({ where: { id, active: true } });
        if (!branch) {
          throw ApiError.notFound('Không tìm thấy chi nhánh.');
        }
        res.json({ branch: serializeBranch(branch) });
      })().catch(next);
    },
  );

  return router;
}

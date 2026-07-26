/**
 * Admin-only hotel & branch management (Milestone C.3.7).
 *
 * Every route here is gated by requireAuth + requirePasswordChanged +
 * requireAdmin, so a receptionist receives 403 on all of them — including the
 * read endpoints, which expose routing configuration.
 */
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireAdmin, requirePasswordChanged } from '../middleware/auth';
import { ApiError } from '../lib/errors';
import {
  activateBranch,
  addAlias,
  createBranch,
  createAliasSchema,
  createBranchSchema,
  deactivateBranch,
  getBranch,
  listBranchHistory,
  listBranches,
  receptionistsOfBranch,
  removeAlias,
  suggestBranchCode,
  updateAlias,
  updateAliasSchema,
  updateBranch,
  updateBranchSchema,
} from '../branch/branchService';

const suggestQuery = z.object({ address: z.string().trim().min(1).max(200) });

function branchIdOf(raw: string | undefined): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw ApiError.notFound('Không tìm thấy chi nhánh.');
  return id;
}

function aliasIdOf(raw: string | undefined): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw ApiError.notFound('Không tìm thấy tên khách sạn.');
  return id;
}

export function createAdminBranchesRouter(): Router {
  const router = Router();
  router.use('/admin/branches', requireAuth, requirePasswordChanged, requireAdmin);

  // GET /api/admin/branches — every branch (active and inactive) with aliases.
  router.get('/admin/branches', (_req, res, next) => {
    (async () => {
      res.json({ branches: await listBranches() });
    })().catch(next);
  });

  // GET /api/admin/branches/suggest-code?address=… — a proposed stable code.
  // Declared before "/:id" so the literal path is not read as an id.
  router.get('/admin/branches/suggest-code', (req, res, next) => {
    (async () => {
      const { address } = suggestQuery.parse(req.query);
      res.json({ code: suggestBranchCode(address) });
    })().catch(next);
  });

  // GET /api/admin/branches/:id
  router.get('/admin/branches/:id', (req, res, next) => {
    (async () => {
      res.json({ branch: await getBranch(branchIdOf(req.params.id)) });
    })().catch(next);
  });

  // GET /api/admin/branches/:id/history — the branch audit trail.
  router.get('/admin/branches/:id/history', (req, res, next) => {
    (async () => {
      const id = branchIdOf(req.params.id);
      await getBranch(id); // 404s for an unknown branch before exposing history
      res.json({ history: await listBranchHistory(id) });
    })().catch(next);
  });

  // GET /api/admin/branches/:id/receptionists — accounts bound to the branch,
  // so the UI can warn before a deactivation instead of reassigning silently.
  router.get('/admin/branches/:id/receptionists', (req, res, next) => {
    (async () => {
      const id = branchIdOf(req.params.id);
      await getBranch(id);
      res.json({ receptionists: await receptionistsOfBranch(id) });
    })().catch(next);
  });

  // POST /api/admin/branches — create a branch (+ optional platform names).
  router.post('/admin/branches', (req, res, next) => {
    (async () => {
      const input = createBranchSchema.parse(req.body ?? {});
      const branch = await createBranch(input, req.currentUser?.id ?? null);
      res.status(201).json({ branch });
    })().catch(next);
  });

  // PATCH /api/admin/branches/:id — edit number/name/address/breakfast/contact.
  // The stable code is never accepted here: it is immutable after creation.
  router.patch('/admin/branches/:id', (req, res, next) => {
    (async () => {
      const id = branchIdOf(req.params.id);
      const body = (req.body ?? {}) as Record<string, unknown>;
      if ('code' in body) {
        throw ApiError.validation('Mã chi nhánh không thể thay đổi sau khi tạo.');
      }
      const input = updateBranchSchema.parse(body);
      const branch = await updateBranch(id, input, req.currentUser?.id ?? null);
      res.json({ branch });
    })().catch(next);
  });

  // POST /api/admin/branches/:id/aliases — add a platform hotel name.
  router.post('/admin/branches/:id/aliases', (req, res, next) => {
    (async () => {
      const id = branchIdOf(req.params.id);
      const input = createAliasSchema.parse(req.body ?? {});
      const branch = await addAlias(id, input, req.currentUser?.id ?? null);
      res.status(201).json({ branch });
    })().catch(next);
  });

  // PATCH /api/admin/branches/:id/aliases/:aliasId — rename / enable / disable.
  router.patch('/admin/branches/:id/aliases/:aliasId', (req, res, next) => {
    (async () => {
      const id = branchIdOf(req.params.id);
      const aliasId = aliasIdOf(req.params.aliasId);
      const input = updateAliasSchema.parse(req.body ?? {});
      const branch = await updateAlias(id, aliasId, input, req.currentUser?.id ?? null);
      res.json({ branch });
    })().catch(next);
  });

  // DELETE /api/admin/branches/:id/aliases/:aliasId — remove entirely.
  router.delete('/admin/branches/:id/aliases/:aliasId', (req, res, next) => {
    (async () => {
      const id = branchIdOf(req.params.id);
      const aliasId = aliasIdOf(req.params.aliasId);
      const branch = await removeAlias(id, aliasId, req.currentUser?.id ?? null);
      res.json({ branch });
    })().catch(next);
  });

  // POST /api/admin/branches/:id/deactivate — stop new routing, keep all data.
  router.post('/admin/branches/:id/deactivate', (req, res, next) => {
    (async () => {
      const id = branchIdOf(req.params.id);
      const result = await deactivateBranch(id, req.currentUser?.id ?? null);
      res.json(result);
    })().catch(next);
  });

  // POST /api/admin/branches/:id/activate
  router.post('/admin/branches/:id/activate', (req, res, next) => {
    (async () => {
      const id = branchIdOf(req.params.id);
      const branch = await activateBranch(id, req.currentUser?.id ?? null);
      res.json({ branch });
    })().catch(next);
  });

  return router;
}

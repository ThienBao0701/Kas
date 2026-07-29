/**
 * Admin-only branch room-class mapping API (Phase C.3.8).
 *
 * Mounted under the branch that owns the mapping, so every path carries the
 * branch and every handler resolves it from the URL — a draft id alone can
 * never be used to reach another branch's configuration (the service re-checks
 * branch ownership too).
 *
 * Authorization is enforced HERE, on the server: hiding the UI is not a control.
 */
import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin, requireAuth, requirePasswordChanged } from '../middleware/auth';
import { ApiError } from '../lib/errors';
import {
  activateDraft,
  activateDraftSchema,
  addAlias,
  addRoomClass,
  cancelDraft,
  createDraft,
  createDraftSchema,
  getActiveVersion,
  getDraftVersion,
  listVersions,
  removeAlias,
  roomClassInputSchema,
  roomClassPatchSchema,
  updateRoomClass,
  validateDraft,
} from '../room/roomMappingService';

const aliasSchema = z.object({ alias: z.string().trim().min(1).max(120) });

function branchIdOf(raw: string | undefined): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw ApiError.notFound('Không tìm thấy chi nhánh.');
  return id;
}

function idOf(raw: string | undefined, message: string): string {
  if (!raw || raw.trim().length === 0) throw ApiError.notFound(message);
  return raw;
}

export function createAdminRoomMappingRouter(): Router {
  const router = Router();
  // Every room-mapping route is Admin-only, including the reads: the mapping is
  // routing configuration, not operational data a receptionist needs.
  router.use('/admin/branches/:branchId/room-mapping', requireAuth, requirePasswordChanged, requireAdmin);

  const base = '/admin/branches/:branchId/room-mapping';

  // GET … — the ACTIVE mapping (what new bookings resolve against).
  router.get(base, (req, res, next) => {
    (async () => {
      const branchId = branchIdOf(req.params.branchId);
      res.json({
        active: await getActiveVersion(branchId),
        draft: await getDraftVersion(branchId),
      });
    })().catch(next);
  });

  // GET …/versions — full history, newest first.
  router.get(`${base}/versions`, (req, res, next) => {
    (async () => {
      res.json({ versions: await listVersions(branchIdOf(req.params.branchId)) });
    })().catch(next);
  });

  // GET …/draft — the open draft, or null.
  router.get(`${base}/draft`, (req, res, next) => {
    (async () => {
      res.json({ draft: await getDraftVersion(branchIdOf(req.params.branchId)) });
    })().catch(next);
  });

  // POST …/drafts — start (or return) a draft copy of the active mapping.
  router.post(`${base}/drafts`, (req, res, next) => {
    (async () => {
      const branchId = branchIdOf(req.params.branchId);
      const { changeReason } = createDraftSchema.parse(req.body ?? {});
      const draft = await createDraft(branchId, changeReason, req.currentUser?.id ?? null);
      res.status(201).json({ draft });
    })().catch(next);
  });

  // POST …/drafts/:draftId/room-classes — add a room class to the draft.
  router.post(`${base}/drafts/:draftId/room-classes`, (req, res, next) => {
    (async () => {
      const branchId = branchIdOf(req.params.branchId);
      const draftId = idOf(req.params.draftId, 'Không tìm thấy bản nháp.');
      const input = roomClassInputSchema.parse(req.body ?? {});
      res.status(201).json({ draft: await addRoomClass(branchId, draftId, input, req.currentUser?.id ?? null) });
    })().catch(next);
  });

  // PATCH …/drafts/:draftId/room-classes/:roomClassId — rename / re-code /
  // deactivate / reorder, inside the draft only.
  router.patch(`${base}/drafts/:draftId/room-classes/:roomClassId`, (req, res, next) => {
    (async () => {
      const branchId = branchIdOf(req.params.branchId);
      const draftId = idOf(req.params.draftId, 'Không tìm thấy bản nháp.');
      const roomClassId = idOf(req.params.roomClassId, 'Không tìm thấy hạng phòng.');
      const patch = roomClassPatchSchema.parse(req.body ?? {});
      res.json({ draft: await updateRoomClass(branchId, draftId, roomClassId, patch, req.currentUser?.id ?? null) });
    })().catch(next);
  });

  // POST …/drafts/:draftId/room-classes/:roomClassId/aliases
  router.post(`${base}/drafts/:draftId/room-classes/:roomClassId/aliases`, (req, res, next) => {
    (async () => {
      const branchId = branchIdOf(req.params.branchId);
      const draftId = idOf(req.params.draftId, 'Không tìm thấy bản nháp.');
      const roomClassId = idOf(req.params.roomClassId, 'Không tìm thấy hạng phòng.');
      const { alias } = aliasSchema.parse(req.body ?? {});
      res.status(201).json({
        draft: await addAlias(branchId, draftId, roomClassId, alias, req.currentUser?.id ?? null),
      });
    })().catch(next);
  });

  // DELETE …/drafts/:draftId/aliases/:aliasId
  router.delete(`${base}/drafts/:draftId/aliases/:aliasId`, (req, res, next) => {
    (async () => {
      const branchId = branchIdOf(req.params.branchId);
      const draftId = idOf(req.params.draftId, 'Không tìm thấy bản nháp.');
      const aliasId = idOf(req.params.aliasId, 'Không tìm thấy tên gọi khác.');
      res.json({ draft: await removeAlias(branchId, draftId, aliasId, req.currentUser?.id ?? null) });
    })().catch(next);
  });

  // POST …/drafts/:draftId/validate — never mutates anything.
  router.post(`${base}/drafts/:draftId/validate`, (req, res, next) => {
    (async () => {
      const branchId = branchIdOf(req.params.branchId);
      const draftId = idOf(req.params.draftId, 'Không tìm thấy bản nháp.');
      res.json(await validateDraft(branchId, draftId, req.currentUser?.id ?? null));
    })().catch(next);
  });

  // POST …/drafts/:draftId/activate — atomic swap, with a stale-review check.
  router.post(`${base}/drafts/:draftId/activate`, (req, res, next) => {
    (async () => {
      const branchId = branchIdOf(req.params.branchId);
      const draftId = idOf(req.params.draftId, 'Không tìm thấy bản nháp.');
      const input = activateDraftSchema.parse(req.body ?? {});
      const summary = await activateDraft(
        branchId,
        draftId,
        input.expectedActiveVersionId,
        input.changeReason,
        req.currentUser?.id ?? null,
      );
      res.json(summary);
    })().catch(next);
  });

  // DELETE …/drafts/:draftId — discard an unused draft. The ACTIVE mapping and
  // every existing booking are untouched.
  router.delete(`${base}/drafts/:draftId`, (req, res, next) => {
    (async () => {
      const branchId = branchIdOf(req.params.branchId);
      const draftId = idOf(req.params.draftId, 'Không tìm thấy bản nháp.');
      await cancelDraft(branchId, draftId, req.currentUser?.id ?? null);
      res.json({ success: true });
    })().catch(next);
  });

  return router;
}

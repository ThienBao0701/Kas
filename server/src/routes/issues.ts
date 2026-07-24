import { Router } from 'express';
import { z } from 'zod';
import { getClock } from '../lib/clock';
import { requireAuth, requireAdmin, requirePasswordChanged } from '../middleware/auth';
import { proofUpload } from '../middleware/upload';
import { readIssuePhoto } from '../issue/issueStorage';
import {
  authorizeIssuePhoto,
  createIssue,
  getIssue,
  listIssues,
  serializeIssue,
  setIssueStatus,
  updateIssue,
} from '../issue/issueService';
import { computeIssueSummary } from '../issue/issueSummary';
import type { UserWithBranch } from '../auth/serialize';

const CATEGORY = z.enum([
  'DOOR',
  'AIR_CONDITIONER',
  'TOILET',
  'TV',
  'WIFI',
  'ELECTRICITY',
  'WATER',
  'FURNITURE',
  'HOUSEKEEPING',
  'GUEST_REQUEST',
  'OTHER',
]);

const createSchema = z.object({
  branchId: z.coerce.number().int().positive().optional(),
  roomNumber: z.string().trim().max(50).optional(),
  category: CATEGORY,
  description: z.string().trim().min(1, 'Vui lòng nhập mô tả sự cố.').max(2000),
});

const updateSchema = z
  .object({
    roomNumber: z.string().trim().max(50).nullable().optional(),
    category: CATEGORY.optional(),
    description: z.string().trim().min(1).max(2000).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Cần ít nhất một trường để cập nhật.' });

const listSchema = z.object({
  branchId: z.coerce.number().int().positive().optional(),
  status: z.enum(['NEW', 'IN_PROGRESS', 'RESOLVED']).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(50),
});

function actor(user: UserWithBranch) {
  return { id: user.id, role: user.role, branchId: user.branchId, fullName: user.fullName };
}

/** Receptionist → Admin hotel issue reporting. */
export function createIssuesRouter(): Router {
  const router = Router();

  // POST /api/issues — create a report (receptionist own branch, admin any branch).
  router.post('/issues', requireAuth, requirePasswordChanged, proofUpload(), (req, res, next) => {
    (async () => {
      const user = req.currentUser!;
      const input = createSchema.parse(req.body ?? {});
      const photo = req.file ? { buffer: req.file.buffer, size: req.file.size } : undefined;
      const issue = await createIssue(
        { branchId: input.branchId, roomNumber: input.roomNumber, category: input.category, description: input.description, photo },
        actor(user),
      );
      res.status(201).json({ issue: serializeIssue(issue) });
    })().catch(next);
  });

  // GET /api/issues — list (newest first; receptionist limited to own branch).
  router.get('/issues', requireAuth, requirePasswordChanged, (req, res, next) => {
    (async () => {
      const user = req.currentUser!;
      const q = listSchema.parse(req.query);
      const { issues, total } = await listIssues(actor(user), {
        branchId: q.branchId,
        status: q.status,
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      });
      res.json({
        issues: issues.map(serializeIssue),
        pagination: { page: q.page, pageSize: q.pageSize, total, totalPages: Math.max(1, Math.ceil(total / q.pageSize)) },
      });
    })().catch(next);
  });

  // GET /api/issues/summary — unresolved counters within the caller's branch
  // scope (Admin: all branches; receptionist: own branch only). Declared before
  // "/issues/:id" so "summary" is never captured as an id.
  router.get('/issues/summary', requireAuth, requirePasswordChanged, (req, res, next) => {
    (async () => {
      const user = req.currentUser!;
      const summary = await computeIssueSummary(actor(user));
      res.json({ summary });
    })().catch(next);
  });

  // GET /api/issues/:id — detail (branch-isolated).
  router.get('/issues/:id', requireAuth, requirePasswordChanged, (req, res, next) => {
    (async () => {
      const user = req.currentUser!;
      const issue = await getIssue(req.params.id!, actor(user));
      res.json({ issue: serializeIssue(issue) });
    })().catch(next);
  });

  // GET /api/issues/:id/photo — authenticated, branch-isolated photo bytes.
  router.get('/issues/:id/photo', requireAuth, requirePasswordChanged, (req, res, next) => {
    (async () => {
      const user = req.currentUser!;
      const { storedFileName, mimeType } = await authorizeIssuePhoto(req.params.id!, actor(user));
      const bytes = await readIssuePhoto(storedFileName);
      res.setHeader('Content-Type', mimeType);
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('Content-Disposition', 'inline');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.send(bytes);
    })().catch(next);
  });

  // PUT /api/issues/:id — reporter edits while still NEW (own branch).
  router.put('/issues/:id', requireAuth, requirePasswordChanged, (req, res, next) => {
    (async () => {
      const user = req.currentUser!;
      const input = updateSchema.parse(req.body ?? {});
      const issue = await updateIssue(req.params.id!, input, actor(user));
      res.json({ issue: serializeIssue(issue) });
    })().catch(next);
  });

  // POST /api/issues/:id/accept — Admin marks IN_PROGRESS.
  router.post('/issues/:id/accept', requireAuth, requirePasswordChanged, requireAdmin, (req, res, next) => {
    (async () => {
      const user = req.currentUser!;
      const issue = await setIssueStatus(req.params.id!, 'IN_PROGRESS', actor(user), getClock());
      res.json({ issue: serializeIssue(issue) });
    })().catch(next);
  });

  // POST /api/issues/:id/resolve — Admin marks RESOLVED.
  router.post('/issues/:id/resolve', requireAuth, requirePasswordChanged, requireAdmin, (req, res, next) => {
    (async () => {
      const user = req.currentUser!;
      const issue = await setIssueStatus(req.params.id!, 'RESOLVED', actor(user), getClock());
      res.json({ issue: serializeIssue(issue) });
    })().catch(next);
  });

  return router;
}

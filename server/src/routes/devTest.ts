/**
 * Developer test tools (DEVELOPMENT ONLY). The whole router 404s unless the tools
 * are enabled (explicit flag + non-production), so the surface is invisible and
 * unreachable in production. Demo generation/clear are Admin-only; branch
 * switching is limited to the dedicated `reception_test` account.
 */
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db/prisma';
import { requireAuth, requireAdmin, requirePasswordChanged } from '../middleware/auth';
import { ApiError } from '../lib/errors';
import { serializeUser } from '../auth/serialize';
import { requireDevTools, isTestReceptionist } from '../devtest/guard';
import { ensureTestReceptionist } from '../devtest/testAccount';
import { generateDemoData, clearDemoData } from '../devtest/demoFactory';
import { CLEAR_DEMO_PHRASE, MAX_BOOKINGS_PER_BRANCH, MAX_ISSUES_PER_BRANCH, TEST_RECEPTIONIST_USERNAME } from '../devtest/constants';

const generateSchema = z.object({
  bookingsPerBranch: z.coerce.number().int().min(0).max(MAX_BOOKINGS_PER_BRANCH).default(10),
  issuesPerBranch: z.coerce.number().int().min(0).max(MAX_ISSUES_PER_BRANCH).default(3),
  includeProofs: z.boolean().default(true),
  includeOcr: z.boolean().default(true),
  includeComparisons: z.boolean().default(true),
  seed: z.coerce.number().int().default(12345),
});

const activeBranchSchema = z.object({ branchId: z.coerce.number().int().positive() });
const clearSchema = z.object({ confirmPhrase: z.string() });

export function createDevTestRouter(): Router {
  const router = Router();
  // Every dev-test endpoint is invisible (404) unless the tools are enabled.
  router.use('/dev-test', requireDevTools);

  // GET /api/dev-test/status — lets the client decide what dev UI to show.
  router.get('/dev-test/status', requireAuth, (req, res) => {
    const user = req.currentUser!;
    res.json({
      enabled: true,
      testUsername: TEST_RECEPTIONIST_USERNAME,
      isTestReceptionist: isTestReceptionist(user),
      activeTestBranchId: req.session.activeTestBranchId ?? null,
    });
  });

  // POST /api/dev-test/ensure-test-account — Admin creates/reuses reception_test.
  router.post('/dev-test/ensure-test-account', requireAuth, requirePasswordChanged, requireAdmin, (_req, res, next) => {
    (async () => {
      const user = await ensureTestReceptionist();
      res.status(201).json({ user: serializeUser(user) });
    })().catch(next);
  });

  // POST /api/dev-test/active-branch — ONLY the test receptionist may switch its
  // effective branch. Persisted only in the session; the DB branch is untouched.
  router.post('/dev-test/active-branch', requireAuth, requirePasswordChanged, (req, res, next) => {
    (async () => {
      const user = req.currentUser!;
      if (!isTestReceptionist(user)) throw ApiError.forbidden('Chỉ tài khoản lễ tân test mới được chuyển chi nhánh.');
      const { branchId } = activeBranchSchema.parse(req.body ?? {});
      const branch = await prisma.branch.findFirst({ where: { id: branchId, active: true } });
      if (!branch) throw ApiError.validation('Chi nhánh không hợp lệ.');
      req.session.activeTestBranchId = branch.id;
      // Persist before responding so the next request sees the switch immediately.
      req.session.save((err) => (err ? next(err) : res.json({ activeTestBranchId: branch.id, branch: { id: branch.id, code: branch.code, address: branch.address, hotelName: branch.hotelName } })));
    })().catch(next);
  });

  // POST /api/dev-test/demo/generate — Admin generates demo data for 8 branches.
  router.post('/dev-test/demo/generate', requireAuth, requirePasswordChanged, requireAdmin, (req, res, next) => {
    (async () => {
      const params = generateSchema.parse(req.body ?? {});
      const summary = await generateDemoData(params, req.currentUser!.id);
      res.status(201).json({ summary });
    })().catch(next);
  });

  // DELETE /api/dev-test/demo — Admin clears ALL demo data (typed confirmation).
  router.delete('/dev-test/demo', requireAuth, requirePasswordChanged, requireAdmin, (req, res, next) => {
    (async () => {
      const { confirmPhrase } = clearSchema.parse(req.body ?? {});
      if (confirmPhrase !== CLEAR_DEMO_PHRASE) {
        throw ApiError.validation(`Cần nhập chính xác "${CLEAR_DEMO_PHRASE}" để xác nhận.`);
      }
      const summary = await clearDemoData();
      res.json({ summary });
    })().catch(next);
  });

  return router;
}

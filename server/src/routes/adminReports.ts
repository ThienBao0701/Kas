import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';
import { getClock } from '../lib/clock';
import { requireAuth, requireAdmin, requirePasswordChanged } from '../middleware/auth';
import {
  buildRecreationReport,
  hcmRange,
  serializeRecreationRow,
} from '../booking/recreationReport';
import { buildRecreationReportPdf, recreationReportFileName } from '../report/recreationPdf';
import { buildIncidentReportPdf, incidentReportFileName } from '../report/incidentPdf';
import { contentDisposition } from '../report/format';
import { serializeIssue } from '../issue/issueService';

const isoDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày phải theo định dạng YYYY-MM-DD.');

/**
 * Both reports take the SAME range shape as the dashboard and History, so an
 * operator never has to learn a second way of asking for a period. `from <= to`
 * is refused rather than silently swapped: an inverted range matches nothing,
 * and a report that is blank for that reason is indistinguishable from a period
 * in which nothing happened.
 */
const rangeQuery = z
  .object({
    from: isoDay,
    to: isoDay,
    branchId: z.coerce.number().int().positive().optional(),
  })
  .refine((q) => q.from <= q.to, {
    message: 'Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.',
    path: ['from'],
  });

const recreationQuery = rangeQuery.and(
  z.object({
    shiftType: z.enum(['A', 'B', 'C', 'A4', 'C4']).optional(),
    receptionistUserId: z.coerce.number().int().positive().optional(),
    source: z.enum(['BOOKING_COM', 'AGODA', 'CTRIP']).optional(),
  }),
);

const ISSUE_REPORT_INCLUDE = {
  branch: true,
  reportedBy: true,
  acceptedBy: true,
  completedBy: true,
} satisfies Prisma.HotelIssueInclude;

async function scopeLabel(branchId: number | undefined): Promise<string> {
  if (branchId === undefined) return 'Tất cả chi nhánh';
  const branch = await prisma.branch.findUnique({ where: { id: branchId } });
  return branch ? `${branch.code} — ${branch.address}` : `Chi nhánh #${branchId}`;
}

/**
 * Admin reporting: the "Cần tạo lại" accountability report and the hotel
 * incident report, each as JSON for the screen and PDF for the file.
 *
 * MONITORING ONLY. Nothing in this router mutates anything — an Admin reads and
 * exports, and never performs a technical transition. That rule is enforced by
 * there being no write endpoint here at all, not merely by hiding a button.
 */
export function createAdminReportsRouter(): Router {
  const router = Router();

  router.use('/admin/reports', requireAuth, requirePasswordChanged, requireAdmin);

  // GET /api/admin/reports/recreations — JSON for the screen.
  router.get('/admin/reports/recreations', (req, res, next) => {
    (async () => {
      const q = recreationQuery.parse(req.query);
      const report = await buildRecreationReport(q);
      res.json({
        range: report.range,
        rows: report.rows.map(serializeRecreationRow),
        totals: {
          total: report.totals.total,
          byBranch: Object.fromEntries(report.totals.byBranch),
          byShift: Object.fromEntries(report.totals.byShift),
          byReceptionist: Object.fromEntries(report.totals.byReceptionist),
        },
      });
    })().catch(next);
  });

  // GET /api/admin/reports/recreations.pdf — the same data, as a file.
  router.get('/admin/reports/recreations.pdf', (req, res, next) => {
    (async () => {
      const q = recreationQuery.parse(req.query);
      const report = await buildRecreationReport(q);
      const pdf = await buildRecreationReportPdf(
        report,
        await scopeLabel(q.branchId),
        getClock().now(),
      );
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', contentDisposition(recreationReportFileName(q.from, q.to)));
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.send(pdf);
    })().catch(next);
  });

  // GET /api/admin/reports/incidents — JSON for the screen.
  router.get('/admin/reports/incidents', (req, res, next) => {
    (async () => {
      const q = rangeQuery.parse(req.query);
      const issues = await loadIssues(q);
      res.json({ range: { from: q.from, to: q.to }, issues: issues.map(serializeIssue) });
    })().catch(next);
  });

  // GET /api/admin/reports/incidents.pdf — the same data, as a file.
  router.get('/admin/reports/incidents.pdf', (req, res, next) => {
    (async () => {
      const q = rangeQuery.parse(req.query);
      const issues = await loadIssues(q);
      const pdf = await buildIncidentReportPdf({
        from: q.from,
        to: q.to,
        scope: await scopeLabel(q.branchId),
        issues,
        generatedAt: getClock().now(),
      });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', contentDisposition(incidentReportFileName(q.from, q.to)));
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.send(pdf);
    })().catch(next);
  });

  return router;
}

/**
 * Filtered in the database over the reported-at instant, so a month across eight
 * properties is one indexed query rather than every incident ever loaded into
 * the process and filtered in JavaScript.
 */
async function loadIssues(q: { from: string; to: string; branchId?: number }) {
  const { start, end } = hcmRange(q.from, q.to);
  const where: Prisma.HotelIssueWhereInput = { createdAt: { gte: start, lt: end } };
  if (q.branchId !== undefined) where.branchId = q.branchId;
  return prisma.hotelIssue.findMany({
    where,
    include: ISSUE_REPORT_INCLUDE,
    orderBy: [{ branchId: 'asc' }, { createdAt: 'asc' }],
  });
}

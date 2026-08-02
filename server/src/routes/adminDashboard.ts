import { Router } from 'express';
import { prisma } from '../db/prisma';
import { requireAuth, requireAdmin, requirePasswordChanged } from '../middleware/auth';
import { getClock, hcmDateOnly } from '../lib/clock';
import { z } from 'zod';
import { computeStatistics } from '../booking/statistics';

const HCM_OFFSET_MS = 7 * 60 * 60 * 1000;

/**
 * The Asia/Ho_Chi_Minh "today" window expressed in UTC, plus the UTC-midnight
 * Date that a check-in stored for today equals.
 */
function hcmDayRange(now: Date): { start: Date; end: Date; checkInToday: Date } {
  const today = hcmDateOnly(now);
  const start = new Date(Date.parse(`${today}T00:00:00.000Z`) - HCM_OFFSET_MS);
  return {
    start,
    end: new Date(start.getTime() + 24 * 60 * 60 * 1000),
    checkInToday: new Date(`${today}T00:00:00.000Z`),
  };
}

function countByBranch(groups: { branchId: number | null; _count: { _all: number } }[]): Map<number, number> {
  const map = new Map<number, number>();
  for (const g of groups) if (g.branchId != null) map.set(g.branchId, g._count._all);
  return map;
}

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Defaults to today when a range is not given. */
const statisticsQuery = z.object({
  from: isoDay.optional(),
  to: isoDay.optional(),
  branchId: z.coerce.number().int().positive().optional(),
});

/**
 * The admin dashboard endpoints, so it never downloads all of history to count
 * things on the client. Everything is computed in the database, in the
 * property's timezone.
 */
export function createAdminDashboardRouter(): Router {
  const router = Router();
  router.use('/admin/dashboard', requireAuth, requirePasswordChanged, requireAdmin);

  router.get('/admin/dashboard/summary', (_req, res, next) => {
    (async () => {
      const { start, end, checkInToday } = hcmDayRange(getClock().now());
      // "Confirmed today" counts PROOF APPROVALS, which is what it has always
      // meant to an operator: the branch entered the reservation and an Admin
      // verified it. It is deliberately NOT `status: COMPLETED` — since the two
      // lifecycles were separated, COMPLETED means the guest's stay has ended,
      // which is a different event that happens days later. Reading the status
      // here would have shown zero all day and then a spike at check-out.
      const confirmedToday = {
        verificationStatus: 'APPROVED' as const,
        reviewedAt: { gte: start, lt: end },
      };
      // Still waiting on the BRANCH to create the reservation. An approved
      // booking is no longer waiting for that — it is waiting to be received,
      // which is reception's operational queue, not this counter.
      const awaitingCreation = {
        status: 'NEW' as const,
        verificationStatus: { not: 'APPROVED' as const },
      };
      const lastMinute = { status: 'NEW' as const, checkInDate: checkInToday };

      const [
        branches,
        waitingGroups,
        confirmedGroups,
        lastMinuteGroups,
        waitingTotal,
        confirmedTotal,
        sentTotal,
        lastMinuteTotal,
      ] = await Promise.all([
        prisma.branch.findMany({ where: { active: true }, orderBy: { id: 'asc' } }),
        prisma.booking.groupBy({ by: ['branchId'], where: awaitingCreation, _count: { _all: true }, orderBy: { branchId: 'asc' } }),
        prisma.booking.groupBy({ by: ['branchId'], where: confirmedToday, _count: { _all: true }, orderBy: { branchId: 'asc' } }),
        prisma.booking.groupBy({ by: ['branchId'], where: lastMinute, _count: { _all: true }, orderBy: { branchId: 'asc' } }),
        prisma.booking.count({ where: awaitingCreation }),
        prisma.booking.count({ where: confirmedToday }),
        prisma.booking.count({ where: { sentAt: { gte: start, lt: end } } }),
        prisma.booking.count({ where: lastMinute }),
      ]);

      const waiting = countByBranch(waitingGroups);
      const confirmed = countByBranch(confirmedGroups);
      const lastMin = countByBranch(lastMinuteGroups);

      res.json({
        totals: {
          waiting: waitingTotal,
          confirmedToday: confirmedTotal,
          lastMinute: lastMinuteTotal,
          sentToday: sentTotal,
        },
        branches: branches.map((b) => ({
          branch: { id: b.id, code: b.code, hotelName: b.hotelName, address: b.address },
          waiting: waiting.get(b.id) ?? 0,
          confirmedToday: confirmed.get(b.id) ?? 0,
          lastMinute: lastMin.get(b.id) ?? 0,
        })),
      });
    })().catch(next);
  });

  /**
   * GET /api/admin/dashboard/statistics — revenue and operational rates.
   *
   * A separate endpoint from the summary above, which answers "what needs
   * attention right now". This answers "how did a period go", so it takes a
   * range and is not recomputed on every dashboard poll.
   */
  router.get('/admin/dashboard/statistics', (req, res, next) => {
    (async () => {
      const today = hcmDateOnly(getClock().now());
      const query = statisticsQuery.parse(req.query);
      res.json(
        await computeStatistics({
          from: query.from ?? today,
          to: query.to ?? today,
          branchId: query.branchId,
        }),
      );
    })().catch(next);
  });

  return router;
}

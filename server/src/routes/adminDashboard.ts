import { Router } from 'express';
import { prisma } from '../db/prisma';
import { requireAuth, requireAdmin, requirePasswordChanged } from '../middleware/auth';
import { getClock, hcmDateOnly } from '../lib/clock';

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

/**
 * One admin-only summary endpoint so the dashboard never downloads all of
 * history to count things on the client. Everything is computed in the database
 * in a single transaction, in the property's timezone.
 */
export function createAdminDashboardRouter(): Router {
  const router = Router();
  router.use('/admin/dashboard', requireAuth, requirePasswordChanged, requireAdmin);

  router.get('/admin/dashboard/summary', (_req, res, next) => {
    (async () => {
      const { start, end, checkInToday } = hcmDayRange(getClock().now());
      const completedToday = { status: 'COMPLETED' as const, completedAt: { gte: start, lt: end } };
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
        prisma.booking.groupBy({ by: ['branchId'], where: { status: 'NEW' }, _count: { _all: true }, orderBy: { branchId: 'asc' } }),
        prisma.booking.groupBy({ by: ['branchId'], where: completedToday, _count: { _all: true }, orderBy: { branchId: 'asc' } }),
        prisma.booking.groupBy({ by: ['branchId'], where: lastMinute, _count: { _all: true }, orderBy: { branchId: 'asc' } }),
        prisma.booking.count({ where: { status: 'NEW' } }),
        prisma.booking.count({ where: completedToday }),
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

  return router;
}

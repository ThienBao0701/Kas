import { Router } from 'express';
import { prisma } from '../db/prisma';
import { requireAuth, requireAdmin, requirePasswordChanged } from '../middleware/auth';
import { getClock, hcmDateOnly } from '../lib/clock';
import { z } from 'zod';
import { computeStatistics } from '../booking/statistics';
import { NOT_DELETED } from '../booking/deleteBooking';

const HCM_OFFSET_MS = 7 * 60 * 60 * 1000;

/**
 * One Asia/Ho_Chi_Minh calendar day expressed in UTC, plus the UTC-midnight
 * Date that a check-in stored for that day equals.
 *
 * Takes the day as a string rather than reading the clock, so the same function
 * serves "today" and any date the Admin picks. The property's timezone is what
 * decides where a day starts — an operator asking for the 11th means the 11th
 * in Ho Chi Minh City, not in UTC.
 */
function hcmDayRange(day: string): { start: Date; end: Date; checkInDay: Date } {
  const start = new Date(Date.parse(`${day}T00:00:00.000Z`) - HCM_OFFSET_MS);
  return {
    start,
    end: new Date(start.getTime() + 24 * 60 * 60 * 1000),
    checkInDay: new Date(`${day}T00:00:00.000Z`),
  };
}

function countByBranch(groups: { branchId: number | null; _count: { _all: number } }[]): Map<number, number> {
  const map = new Map<number, number>();
  for (const g of groups) if (g.branchId != null) map.set(g.branchId, g._count._all);
  return map;
}

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** The summary is a ONE-DAY view. Omit `date` and it is today, as it always was. */
const summaryQuery = z.object({ date: isoDay.optional() });

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

  router.get('/admin/dashboard/summary', (req, res, next) => {
    (async () => {
      /*
        EVERY NUMBER BELOW IS SCOPED TO ONE DAY, and which day is the Admin's
        choice. The filtering happens here in the database: the dashboard has
        never downloaded history to count it, and a date picker that re-filtered
        an already-loaded "today" payload could only ever show today.

        Omitting `date` keeps the endpoint's original behaviour exactly.
      */
      const query = summaryQuery.parse(req.query ?? {});
      const day = query.date ?? hcmDateOnly(getClock().now());
      const { start, end, checkInDay } = hcmDayRange(day);
      // "Confirmed" counts PROOF APPROVALS, which is what it has always
      // meant to an operator: the branch entered the reservation and an Admin
      // verified it. It is deliberately NOT `status: COMPLETED` — since the two
      // lifecycles were separated, COMPLETED means the guest's stay has ended,
      // which is a different event that happens days later. Reading the status
      // here would have shown zero all day and then a spike at check-out.
      const confirmedOnDay = {
        ...NOT_DELETED,
        verificationStatus: 'APPROVED' as const,
        reviewedAt: { gte: start, lt: end },
      };
      // Still waiting on the BRANCH to create the reservation. An approved
      // booking is no longer waiting for that — it is waiting to be received,
      // which is reception's operational queue, not this counter.
      /*
        The backlog AS IT STOOD AT THE END OF THE SELECTED DAY: dispatched on or
        before that day and still not created.

        `sentAt < end` is what makes this a one-day view rather than a running
        total. For today it changes nothing — everything already dispatched was
        dispatched on or before today — so the number an operator watches all day
        is untouched. For a past date it stops counting orders that had not been
        sent yet, which would otherwise leak the future into a historical view.

        Note this reads TODAY's verificationStatus. Reconstructing what was still
        outstanding at midnight on a past date would mean replaying the audit log,
        which is a different and much heavier feature than a date picker.
      */
      const awaitingCreation = {
        ...NOT_DELETED,
        status: 'NEW' as const,
        verificationStatus: { not: 'APPROVED' as const },
        sentAt: { lt: end },
      };
      const lastMinute = { ...NOT_DELETED, status: 'NEW' as const, checkInDate: checkInDay };

      const [
        branches,
        waitingGroups,
        confirmedGroups,
        lastMinuteGroups,
        waitingTotal,
        confirmedTotal,
        sentTotal,
        lastMinuteTotal,
        issuesReported,
        issuesStillOpen,
      ] = await Promise.all([
        prisma.branch.findMany({ where: { active: true }, orderBy: { id: 'asc' } }),
        prisma.booking.groupBy({ by: ['branchId'], where: awaitingCreation, _count: { _all: true }, orderBy: { branchId: 'asc' } }),
        prisma.booking.groupBy({ by: ['branchId'], where: confirmedOnDay, _count: { _all: true }, orderBy: { branchId: 'asc' } }),
        prisma.booking.groupBy({ by: ['branchId'], where: lastMinute, _count: { _all: true }, orderBy: { branchId: 'asc' } }),
        prisma.booking.count({ where: awaitingCreation }),
        prisma.booking.count({ where: confirmedOnDay }),
        prisma.booking.count({ where: { ...NOT_DELETED, sentAt: { gte: start, lt: end } } }),
        prisma.booking.count({ where: lastMinute }),
        /*
          Issues REPORTED on the selected day, and how many of those are still
          open — a genuinely one-day figure, unlike a running backlog total.

          Counted here rather than by extending `computeIssueSummary`, which the
          sidebar badge and the Issues page both call and which must keep meaning
          "open right now". One shared function serving two different questions is
          how a badge starts disagreeing with the page it links to.
        */
        prisma.hotelIssue.count({ where: { createdAt: { gte: start, lt: end } } }),
        prisma.hotelIssue.count({
          where: { createdAt: { gte: start, lt: end }, status: { in: ['NEW', 'IN_PROGRESS'] } },
        }),
      ]);

      const waiting = countByBranch(waitingGroups);
      const confirmed = countByBranch(confirmedGroups);
      const lastMin = countByBranch(lastMinuteGroups);

      res.json({
        // The day these numbers describe, resolved server-side. The client shows
        // it back, so an operator can never be looking at one date and reading
        // another one's figures.
        date: day,
        totals: {
          waiting: waitingTotal,
          confirmedToday: confirmedTotal,
          lastMinute: lastMinuteTotal,
          sentToday: sentTotal,
        },
        issues: { reported: issuesReported, stillOpen: issuesStillOpen },
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

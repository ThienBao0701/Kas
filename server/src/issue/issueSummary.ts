/**
 * Unresolved hotel-issue counters, computed live from HotelIssue status. There is
 * no persisted counter table and no duplicate totals — the numbers are always a
 * query over the current data.
 *
 * "Unresolved" = NEW + IN_PROGRESS. COMPLETED issues stay in history but are
 * never counted here.
 *
 * Branch rules mirror the rest of the app: an Admin and Bộ phận kỹ thuật each see
 * every branch (including branches with zero unresolved issues); a receptionist
 * sees ONLY their own branch, and can never widen the scope.
 */
import type { Prisma, UserRole } from '@prisma/client';
import { prisma } from '../db/prisma';
import { seesAllBranches } from '../middleware/auth';

// The full role enum, not a two-member union: a new role must not silently fail
// to compile here. Which roles are ALLOWED is decided by the checks below and
// by branch scoping, never by narrowing this type.
type Actor = { id: number; role: UserRole; branchId: number | null; fullName: string };

export interface BranchIssueSummary {
  branchId: number;
  code: string;
  address: string;
  hotelName: string;
  newCount: number;
  inProgressCount: number;
  totalUnresolved: number;
}

export interface IssueSummary {
  totalUnresolved: number;
  newCount: number;
  inProgressCount: number;
  byBranch: BranchIssueSummary[];
}

/** Computes the unresolved-issue summary within the actor's branch scope. */
export async function computeIssueSummary(actor: Actor): Promise<IssueSummary> {
  const isGlobal = seesAllBranches(actor.role);
  // -1 never matches a real branch, so an unassigned receptionist sees nothing.
  const scopedBranchId = actor.branchId ?? -1;

  const branches = await prisma.branch.findMany({
    where: isGlobal ? { active: true } : { id: scopedBranchId },
    orderBy: { id: 'asc' },
  });

  const where: Prisma.HotelIssueWhereInput = { status: { in: ['NEW', 'IN_PROGRESS'] } };
  if (!isGlobal) where.branchId = scopedBranchId;

  const groups = await prisma.hotelIssue.groupBy({
    by: ['branchId', 'status'],
    where,
    _count: { _all: true },
  });

  const newByBranch = new Map<number, number>();
  const inProgressByBranch = new Map<number, number>();
  for (const g of groups) {
    const target = g.status === 'NEW' ? newByBranch : inProgressByBranch;
    target.set(g.branchId, (target.get(g.branchId) ?? 0) + g._count._all);
  }

  const byBranch: BranchIssueSummary[] = branches.map((b) => {
    const newCount = newByBranch.get(b.id) ?? 0;
    const inProgressCount = inProgressByBranch.get(b.id) ?? 0;
    return {
      branchId: b.id,
      code: b.code,
      address: b.address,
      hotelName: b.hotelName,
      newCount,
      inProgressCount,
      totalUnresolved: newCount + inProgressCount,
    };
  });

  const newCount = byBranch.reduce((s, b) => s + b.newCount, 0);
  const inProgressCount = byBranch.reduce((s, b) => s + b.inProgressCount, 0);
  return { totalUnresolved: newCount + inProgressCount, newCount, inProgressCount, byBranch };
}

export interface TechnicalCounts {
  /** "Sự cố khách sạn" — reported, nobody has picked it up. */
  newCount: number;
  /** "Đang sửa" — accepted, a named technician is on it. */
  inProgressCount: number;
  /** "Đã hoàn thành" — finished. */
  completedCount: number;
}

/**
 * The three workflow-queue totals behind the Technical tabs.
 *
 * COUNTED IN THE DATABASE, NEVER IN THE BROWSER. The list each tab shows is
 * paginated, so deriving "Đang sửa (12)" from a loaded page would show the size
 * of the page rather than the size of the queue — and would disagree with itself
 * as soon as somebody scrolled.
 *
 * Deliberately separate from `computeIssueSummary`, which answers a different
 * question (open work per branch, for the sidebar badge). One function serving
 * two questions is how a badge starts disagreeing with the page it links to.
 */
export async function computeTechnicalCounts(
  actor: Actor,
  branchId?: number,
): Promise<TechnicalCounts> {
  const where: Prisma.HotelIssueWhereInput = {};
  if (!seesAllBranches(actor.role)) {
    where.branchId = actor.branchId ?? -1; // -1 never matches → unassigned sees nothing
  } else if (branchId !== undefined) {
    where.branchId = branchId;
  }

  const groups = await prisma.hotelIssue.groupBy({
    by: ['status'],
    where,
    _count: { _all: true },
  });

  const of = (status: string): number =>
    groups.find((g) => g.status === status)?._count._all ?? 0;

  return {
    newCount: of('NEW'),
    inProgressCount: of('IN_PROGRESS'),
    completedCount: of('COMPLETED'),
  };
}

export interface IncidentRangeSummary {
  /** Incidents REPORTED inside the period, whatever state they are in now. */
  total: number;
  newCount: number;
  inProgressCount: number;
  completedCount: number;
  /**
   * How many "Không sửa được" ATTEMPTS ended inside the period.
   *
   * AN EVENT COUNT. One incident that three technicians failed on contributes
   * three, because three separate visits happened and three separate reasons
   * were recorded. That is what makes it useful — it measures work spent, not
   * incidents remaining.
   */
  cannotRepairAttempts: number;
  /**
   * How many incidents are RIGHT NOW waiting to be picked up again after a
   * failed attempt.
   *
   * A STATE COUNT, and deliberately a different number from the one above. The
   * same incident is counted at most once here however many times it has come
   * back, and it stops being counted the moment somebody accepts it again. The
   * two are reported side by side rather than merged precisely so that neither
   * can be mistaken for the other: "Không sửa được 5 lần" and "Cần xử lý lại 2
   * sự cố" are both true at once and answer different questions.
   *
   * Scoped to the period like the rest — by when the incident was REPORTED, so
   * it cannot disagree with the total it sits under.
   */
  needsReworkIssues: number;
  /**
   * Everything not finished, at any age, ignoring the period entirely.
   *
   * Reported alongside the period so an Admin reviewing this week can still see
   * that something from a fortnight ago is open — which a period-scoped report
   * structurally cannot tell them.
   */
  outstandingTotal: number;
}

export interface IncidentRangeFilter {
  /** Half-open [start, end) over the reported-at instant. */
  start: Date;
  end: Date;
  branchId?: number;
}

/**
 * The Admin's date-range incident summary.
 *
 * COUNTED IN THE DATABASE, one indexed query per number, over
 * `@@index([branchId, createdAt])`. The alternative — fetching the period's
 * incidents and counting them in JavaScript — is capped by the list's page size,
 * so a month across eight properties would report the size of a page.
 *
 * Deliberately NOT folded into `computeTechnicalCounts`, which feeds the
 * Technical tabs: that answers "how big is each queue right now" and has no
 * period at all. One function serving both is how a tab badge starts disagreeing
 * with the report beside it.
 */
export async function computeIncidentRangeSummary(
  filter: IncidentRangeFilter,
): Promise<IncidentRangeSummary> {
  const branch = filter.branchId !== undefined ? { branchId: filter.branchId } : {};
  const reportedInRange: Prisma.HotelIssueWhereInput = {
    ...branch,
    createdAt: { gte: filter.start, lt: filter.end },
  };

  /*
    An INTERACTIVE transaction, so every number is one consistent snapshot: a
    summary whose total was counted before an incident was completed and whose
    per-status counts were taken after would not add up, and a report that does
    not add up is worse than a slightly stale one.
  */
  const { groups, cannotRepairAttempts, needsReworkIssues, outstandingTotal } =
    await prisma.$transaction(async (tx) => ({
      groups: await tx.hotelIssue.groupBy({
        by: ['status'],
        where: reportedInRange,
        _count: { _all: true },
      }),
      // The ATTEMPTS that failed in the period, by when they failed — an attempt
      // is an event, so it belongs to the period it happened in, not to the
      // period its incident was reported in.
      cannotRepairAttempts: await tx.technicalRepairAttempt.count({
        where: {
          outcome: 'CANNOT_REPAIR',
          outcomeAt: { gte: filter.start, lt: filter.end },
          ...(filter.branchId !== undefined ? { issue: { branchId: filter.branchId } } : {}),
        },
      }),
      // DISTINCT incidents, because this counts rows of HotelIssue and not of
      // TechnicalRepairAttempt — `some` is an existence test, so three failed
      // attempts on one incident still match exactly one row.
      needsReworkIssues: await tx.hotelIssue.count({
        where: {
          ...reportedInRange,
          status: 'NEW',
          attempts: { some: { outcome: 'CANNOT_REPAIR' } },
        },
      }),
      outstandingTotal: await tx.hotelIssue.count({
        where: { ...branch, status: { in: ['NEW', 'IN_PROGRESS'] } },
      }),
    }));

  const of = (status: string): number =>
    groups.find((g) => g.status === status)?._count._all ?? 0;

  const newCount = of('NEW');
  const inProgressCount = of('IN_PROGRESS');
  const completedCount = of('COMPLETED');

  return {
    total: newCount + inProgressCount + completedCount,
    newCount,
    inProgressCount,
    completedCount,
    cannotRepairAttempts,
    needsReworkIssues,
    outstandingTotal,
  };
}

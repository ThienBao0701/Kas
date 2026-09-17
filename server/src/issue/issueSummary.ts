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

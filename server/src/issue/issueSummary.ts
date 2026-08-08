/**
 * Unresolved hotel-issue counters, computed live from HotelIssue status. There is
 * no persisted counter table and no duplicate totals — the numbers are always a
 * query over the current data.
 *
 * "Unresolved" = NEW + IN_PROGRESS. RESOLVED issues stay in history but are never
 * counted here.
 *
 * Branch rules mirror the rest of the app: an Admin sees every branch (including
 * branches with zero unresolved issues); a receptionist sees ONLY their own
 * branch, and can never widen the scope.
 */
import type { Prisma, UserRole } from '@prisma/client';
import { prisma } from '../db/prisma';

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
  const isAdmin = actor.role === 'ADMIN';
  // -1 never matches a real branch, so an unassigned receptionist sees nothing.
  const scopedBranchId = actor.branchId ?? -1;

  const branches = await prisma.branch.findMany({
    where: isAdmin ? { active: true } : { id: scopedBranchId },
    orderBy: { id: 'asc' },
  });

  const where: Prisma.HotelIssueWhereInput = { status: { in: ['NEW', 'IN_PROGRESS'] } };
  if (!isAdmin) where.branchId = scopedBranchId;

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

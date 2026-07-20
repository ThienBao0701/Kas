import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { UserRole } from '@prisma/client';
import { prisma } from '../db/prisma';
import { ApiError } from '../lib/errors';
import type { UserWithBranch } from '../auth/serialize';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** The freshly loaded authenticated user, set by requireAuth. */
      currentUser?: UserWithBranch;
    }
  }
}

/**
 * Loads the session's user straight from the database on every protected
 * request. Nothing authoritative is trusted from the session itself, so a
 * disabled account, a changed branch, or a forced password reset all take
 * effect immediately even while an old session cookie is still presented.
 */
async function loadSessionUser(req: Request): Promise<UserWithBranch | null> {
  const userId = req.session?.userId;
  if (typeof userId !== 'number') return null;
  return prisma.user.findUnique({ where: { id: userId }, include: { branch: true } });
}

export const requireAuth: RequestHandler = (req: Request, _res: Response, next: NextFunction) => {
  loadSessionUser(req)
    .then((user) => {
      if (!user) {
        next(ApiError.authRequired());
        return;
      }
      if (!user.active) {
        // A session that outlived the account being disabled must stop working.
        next(ApiError.accountDisabled());
        return;
      }
      req.currentUser = user;
      next();
    })
    .catch((err: unknown) => next(err));
};

/** Requires that requireAuth has already run and set req.currentUser. */
function currentUserOrThrow(req: Request): UserWithBranch {
  if (!req.currentUser) {
    // Defensive: a route wired without requireAuth in front of this.
    throw ApiError.authRequired();
  }
  return req.currentUser;
}

export function requireRole(...roles: UserRole[]): RequestHandler {
  return (req, _res, next) => {
    try {
      const user = currentUserOrThrow(req);
      if (!roles.includes(user.role)) {
        next(ApiError.forbidden());
        return;
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

export const requireAdmin: RequestHandler = requireRole('ADMIN');

/**
 * Blocks protected application endpoints while a user still owes a password
 * change. The whitelisted endpoints (me, change-password, logout) simply do
 * not mount this, so they remain reachable.
 */
export const requirePasswordChanged: RequestHandler = (req, _res, next) => {
  try {
    const user = currentUserOrThrow(req);
    if (user.mustChangePassword) {
      next(ApiError.passwordChangeRequired());
      return;
    }
    next();
  } catch (err) {
    next(err);
  }
};

/**
 * Authorizes access to a specific branch. The branch id is never trusted from
 * the client on its own — for a receptionist it must equal their own assigned
 * branch. Admins may reach any branch.
 */
export function assertBranchAccess(
  user: UserWithBranch,
  branchId: number | null | undefined,
): void {
  if (user.role === 'ADMIN') return;
  if (branchId == null || Number.isNaN(branchId)) {
    throw ApiError.branchAccessDenied();
  }
  if (user.branchId !== branchId) {
    throw ApiError.branchAccessDenied();
  }
}

type BranchIdExtractor = (req: Request) => number | null | undefined;

const defaultBranchIdExtractor: BranchIdExtractor = (req) => {
  const raw = req.params.id;
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  return Number.isNaN(parsed) ? undefined : parsed;
};

export function requireBranchAccess(
  extract: BranchIdExtractor = defaultBranchIdExtractor,
): RequestHandler {
  return (req, _res, next) => {
    try {
      const user = currentUserOrThrow(req);
      assertBranchAccess(user, extract(req));
      next();
    } catch (err) {
      next(err);
    }
  };
}

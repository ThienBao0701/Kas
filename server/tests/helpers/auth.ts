import request from 'supertest';
import type { Express } from 'express';
import type { UserRole } from '@prisma/client';
import { testPrisma } from './db';
import { hashPassword } from '../../src/auth/password';
import { normalizeUsername } from '../../src/auth/username';

// Passwords that satisfy the policy (>= 8 chars, a letter and a number).
export const ADMIN_PASSWORD = 'Admin12345';
export const RECEPTIONIST_PASSWORD = 'Reception1';
export const NEW_PASSWORD = 'NewPass2026';
export const TEMP_PASSWORD = 'Temp1234';

interface CreateUserParams {
  username: string;
  password: string;
  fullName: string;
  role: UserRole;
  branchId?: number | null;
  active?: boolean;
  mustChangePassword?: boolean;
}

export async function createUser(params: CreateUserParams) {
  return testPrisma.user.create({
    data: {
      username: normalizeUsername(params.username),
      passwordHash: await hashPassword(params.password),
      fullName: params.fullName,
      role: params.role,
      branchId: params.branchId ?? null,
      active: params.active ?? true,
      mustChangePassword: params.mustChangePassword ?? false,
    },
    include: { branch: true },
  });
}

export function createAdmin(overrides: Partial<CreateUserParams> = {}) {
  return createUser({
    username: 'admin',
    password: ADMIN_PASSWORD,
    fullName: 'Quản trị viên',
    role: 'ADMIN',
    branchId: null,
    ...overrides,
  });
}

export function createReceptionist(branchId: number, overrides: Partial<CreateUserParams> = {}) {
  return createUser({
    username: 'letan1',
    password: RECEPTIONIST_PASSWORD,
    fullName: 'Lễ tân Một',
    role: 'RECEPTIONIST',
    branchId,
    ...overrides,
  });
}

/**
 * Logs in and returns a supertest agent that carries the session cookie for
 * subsequent requests, alongside the raw login response.
 */
export async function loginAgent(app: Express, username: string, password: string) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ username, password });
  return { agent, res };
}

/** Extracts the raw Set-Cookie entry for the session cookie, if present. */
export function sessionSetCookie(res: request.Response): string | undefined {
  const raw = res.headers['set-cookie'];
  if (!raw) return undefined;
  const cookies = Array.isArray(raw) ? raw : [raw];
  return cookies.find((c) => c.startsWith('hbd.sid='));
}

/** Extracts just the session id value from a Set-Cookie entry. */
export function sessionIdFrom(res: request.Response): string | undefined {
  const cookie = sessionSetCookie(res);
  if (!cookie) return undefined;
  const match = /^hbd\.sid=([^;]+)/.exec(cookie);
  return match?.[1];
}

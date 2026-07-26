/**
 * Admin branch & platform-name management (Milestone C.3.7).
 *
 * Everything an operator used to need a code change for — adding a branch,
 * renumbering it, renaming it, changing its address, adding/renaming/disabling a
 * Booking.com or Agoda hotel name — happens here, against the database.
 *
 * Invariants this module protects:
 *  - The stable branch code is the identity. It is immutable after creation, and
 *    parser routing plus authorization key off it (never off the branch number).
 *  - A branch number is a human label: unique among ACTIVE branches, editable,
 *    and never used as an authorization key.
 *  - One active platform name resolves to exactly one branch. A collision is
 *    rejected rather than silently preferred.
 *  - Agoda names are always EXACT-matched.
 *  - Branches are deactivated, never hard-deleted, so historical bookings,
 *    proofs, issues and notifications keep their branch.
 *  - Every change is written to the immutable BranchChangeLog with the actor.
 */
import type { BranchAliasSource, Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { prisma as defaultPrisma } from '../db/prisma';
import { ApiError } from '../lib/errors';
import { normalizeText, removeDiacritics } from '../booking/text';

const BRANCH_CODE_PATTERN = /^[A-Z0-9_]+$/;

export const ALIAS_SOURCES = ['BOOKING_COM', 'AGODA', 'MANUAL', 'OTHER'] as const;

const aliasInputSchema = z.object({
  source: z.enum(ALIAS_SOURCES),
  alias: z.string().trim().min(1, 'Tên khách sạn không được để trống.').max(200),
  matchMode: z.enum(['EXACT', 'SIMILARITY']).optional(),
  active: z.boolean().optional(),
  priority: z.number().int().min(0).max(1000).optional(),
});

const optionalContact = z.string().trim().max(200).nullish();

export const createBranchSchema = z.object({
  branchNumber: z
    .number({ invalid_type_error: 'Số chi nhánh phải là số nguyên dương.' })
    .int('Số chi nhánh phải là số nguyên dương.')
    .positive('Số chi nhánh phải là số nguyên dương.'),
  hotelName: z.string().trim().min(1, 'Tên nội bộ là bắt buộc.').max(120),
  address: z.string().trim().min(1, 'Địa chỉ là bắt buộc.').max(200),
  code: z.string().trim().min(3, 'Mã chi nhánh quá ngắn.').max(60),
  breakfastIncluded: z.boolean().optional(),
  active: z.boolean().optional(),
  phone: optionalContact,
  email: optionalContact,
  contactName: optionalContact,
  note: z.string().trim().max(1000).nullish(),
  aliases: z.array(aliasInputSchema).max(50).optional(),
});

export const updateBranchSchema = z
  .object({
    branchNumber: z.number().int().positive('Số chi nhánh phải là số nguyên dương.').optional(),
    hotelName: z.string().trim().min(1, 'Tên nội bộ là bắt buộc.').max(120).optional(),
    address: z.string().trim().min(1, 'Địa chỉ là bắt buộc.').max(200).optional(),
    breakfastIncluded: z.boolean().optional(),
    active: z.boolean().optional(),
    phone: optionalContact,
    email: optionalContact,
    contactName: optionalContact,
    note: z.string().trim().max(1000).nullish(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Cần ít nhất một trường để cập nhật.' });

export const createAliasSchema = aliasInputSchema;

export const updateAliasSchema = z
  .object({
    alias: z.string().trim().min(1, 'Tên khách sạn không được để trống.').max(200).optional(),
    matchMode: z.enum(['EXACT', 'SIMILARITY']).optional(),
    active: z.boolean().optional(),
    priority: z.number().int().min(0).max(1000).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Cần ít nhất một trường để cập nhật.' });

export type CreateBranchInput = z.infer<typeof createBranchSchema>;
export type UpdateBranchInput = z.infer<typeof updateBranchSchema>;
export type CreateAliasInput = z.infer<typeof createAliasSchema>;
export type UpdateAliasInput = z.infer<typeof updateAliasSchema>;

/* ------------------------------------------------------------------ */
/* Stable code suggestion                                              */
/* ------------------------------------------------------------------ */

/**
 * Suggests a stable branch code from a street address, in the convention the
 * existing branches already use: street words first, house number last.
 *
 *   "40-42 Bùi Thị Xuân"          -> BUI_THI_XUAN_40
 *   "170-172-174 Nguyễn Thái Bình" -> NGUYEN_THAI_BINH_170
 *   "47A Nguyễn Trãi"              -> NGUYEN_TRAI_47A
 *
 * A suggestion only: the Admin may correct it before the branch is created, and
 * it can never be changed afterwards.
 */
export function suggestBranchCode(address: string): string {
  const tokens = removeDiacritics(address)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  if (tokens.length === 0) return '';

  // Vietnamese addresses lead with the house number, which may be a range
  // ("40-42", "170-172-174"). The whole leading numeric run is the number; only
  // its first part goes into the code, matching the existing convention.
  let lead = 0;
  while (lead < tokens.length && /^\d/.test(tokens[lead]!)) lead += 1;

  let houseNumber: string | null;
  let words: string[];
  if (lead > 0) {
    houseNumber = tokens[0]!;
    words = tokens.slice(lead);
  } else {
    // No leading number: fall back to the first numeric token anywhere.
    const idx = tokens.findIndex((t) => /^\d/.test(t));
    houseNumber = idx >= 0 ? tokens[idx]! : null;
    words = tokens.filter((_, i) => i !== idx);
  }

  const code = [...words, ...(houseNumber ? [houseNumber] : [])].join('_');
  return code.slice(0, 60);
}

/* ------------------------------------------------------------------ */
/* Serialization                                                       */
/* ------------------------------------------------------------------ */

export interface AdminBranchAlias {
  id: number;
  source: BranchAliasSource;
  alias: string;
  normalizedAlias: string;
  matchMode: 'EXACT' | 'SIMILARITY';
  active: boolean;
  priority: number;
}

export interface AdminBranch {
  id: number;
  branchNumber: number;
  code: string;
  hotelName: string;
  address: string;
  breakfastIncluded: boolean;
  active: boolean;
  phone: string | null;
  email: string | null;
  contactName: string | null;
  note: string | null;
  aliases: AdminBranchAlias[];
  /** Receptionist accounts assigned to this branch (all / still enabled). */
  receptionistCount: number;
  activeReceptionistCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const BRANCH_INCLUDE = {
  aliases: { orderBy: [{ source: 'asc' }, { priority: 'desc' }, { id: 'asc' }] },
  _count: { select: { users: true } },
} satisfies Prisma.BranchInclude;

type BranchRow = Prisma.BranchGetPayload<{ include: typeof BRANCH_INCLUDE }>;

function serialize(row: BranchRow, activeReceptionistCount: number): AdminBranch {
  return {
    id: row.id,
    branchNumber: row.branchNumber,
    code: row.code,
    hotelName: row.hotelName,
    address: row.address,
    breakfastIncluded: row.breakfastIncluded,
    active: row.active,
    phone: row.phone,
    email: row.email,
    contactName: row.contactName,
    note: row.note,
    aliases: row.aliases.map((a) => ({
      id: a.id,
      source: a.source,
      alias: a.alias,
      normalizedAlias: a.normalizedAlias,
      matchMode: a.matchMode,
      active: a.active,
      priority: a.priority,
    })),
    receptionistCount: row._count.users,
    activeReceptionistCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function loadSerialized(client: PrismaClient, id: number): Promise<AdminBranch> {
  const row = await client.branch.findUnique({ where: { id }, include: BRANCH_INCLUDE });
  if (!row) throw ApiError.notFound('Không tìm thấy chi nhánh.');
  const activeReceptionistCount = await client.user.count({
    where: { branchId: id, role: 'RECEPTIONIST', active: true },
  });
  return serialize(row, activeReceptionistCount);
}

/* ------------------------------------------------------------------ */
/* Audit                                                               */
/* ------------------------------------------------------------------ */

type ChangeAction = Prisma.BranchChangeLogCreateInput['action'];

async function logChange(
  client: PrismaClient,
  branchId: number,
  action: ChangeAction,
  actorId: number | null,
  field?: string,
  oldValue?: string | null,
  newValue?: string | null,
): Promise<void> {
  await client.branchChangeLog.create({
    data: {
      branchId,
      action,
      field: field ?? null,
      oldValue: oldValue ?? null,
      newValue: newValue ?? null,
      changedByUserId: actorId,
    },
  });
}

export interface BranchHistoryEntry {
  id: string;
  action: ChangeAction;
  field: string | null;
  oldValue: string | null;
  newValue: string | null;
  changedBy: { id: number; fullName: string } | null;
  changedAt: Date;
}

export async function listBranchHistory(
  branchId: number,
  client: PrismaClient = defaultPrisma,
): Promise<BranchHistoryEntry[]> {
  const rows = await client.branchChangeLog.findMany({
    where: { branchId },
    orderBy: { changedAt: 'desc' },
    take: 200,
    include: { changedBy: { select: { id: true, fullName: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    field: r.field,
    oldValue: r.oldValue,
    newValue: r.newValue,
    changedBy: r.changedBy ? { id: r.changedBy.id, fullName: r.changedBy.fullName } : null,
    changedAt: r.changedAt,
  }));
}

/* ------------------------------------------------------------------ */
/* Validation helpers                                                  */
/* ------------------------------------------------------------------ */

async function assertBranchNumberFree(
  client: PrismaClient,
  branchNumber: number,
  exceptBranchId: number | null,
): Promise<void> {
  const clash = await client.branch.findFirst({
    where: {
      branchNumber,
      active: true,
      ...(exceptBranchId ? { id: { not: exceptBranchId } } : {}),
    },
  });
  if (clash) {
    throw ApiError.conflict(`Số chi nhánh ${branchNumber} đã được dùng cho ${clash.address}.`);
  }
}

function assertCodeFormat(code: string): void {
  if (!BRANCH_CODE_PATTERN.test(code)) {
    throw ApiError.validation('Mã chi nhánh chỉ được gồm chữ IN HOA, số và dấu gạch dưới.');
  }
}

/**
 * Agoda is exact-match only, by design: every "KAS …" property name shares the
 * same tokens, so a similarity match could dispatch a booking to the wrong hotel.
 */
function effectiveMatchMode(
  source: BranchAliasSource,
  requested: 'EXACT' | 'SIMILARITY' | undefined,
): 'EXACT' | 'SIMILARITY' {
  if (source === 'AGODA') return 'EXACT';
  return requested ?? 'EXACT';
}

/**
 * An active platform name must resolve to exactly one branch. Checked across all
 * branches (not just this one), so a name can never be claimed twice.
 */
async function assertAliasFree(
  client: PrismaClient,
  source: BranchAliasSource,
  normalizedAlias: string,
  branchId: number,
  exceptAliasId: number | null,
): Promise<void> {
  const clashes = await client.branchSourceAlias.findMany({
    where: {
      source,
      normalizedAlias,
      ...(exceptAliasId ? { id: { not: exceptAliasId } } : {}),
    },
    include: { branch: { select: { address: true, code: true } } },
  });

  const sameBranch = clashes.find((c) => c.branchId === branchId);
  if (sameBranch) {
    throw ApiError.conflict('Tên khách sạn này đã tồn tại cho chi nhánh.');
  }
  const otherActive = clashes.find((c) => c.active);
  if (otherActive) {
    throw ApiError.conflict(
      `Tên khách sạn này đã được dùng cho chi nhánh ${otherActive.branch.address}.`,
    );
  }
}

function normalizedOrThrow(alias: string): string {
  const normalized = normalizeText(alias);
  if (normalized.length === 0) {
    throw ApiError.validation('Tên khách sạn không hợp lệ.');
  }
  return normalized;
}

/* ------------------------------------------------------------------ */
/* Queries                                                             */
/* ------------------------------------------------------------------ */

export async function listBranches(client: PrismaClient = defaultPrisma): Promise<AdminBranch[]> {
  const rows = await client.branch.findMany({
    orderBy: [{ active: 'desc' }, { branchNumber: 'asc' }, { id: 'asc' }],
    include: BRANCH_INCLUDE,
  });
  const activeCounts = await client.user.groupBy({
    by: ['branchId'],
    where: { role: 'RECEPTIONIST', active: true, branchId: { not: null } },
    _count: { _all: true },
  });
  const byBranch = new Map(activeCounts.map((c) => [c.branchId, c._count._all]));
  return rows.map((row) => serialize(row, byBranch.get(row.id) ?? 0));
}

export async function getBranch(
  id: number,
  client: PrismaClient = defaultPrisma,
): Promise<AdminBranch> {
  return loadSerialized(client, id);
}

/* ------------------------------------------------------------------ */
/* Mutations                                                           */
/* ------------------------------------------------------------------ */

export async function createBranch(
  input: CreateBranchInput,
  actorId: number | null,
  client: PrismaClient = defaultPrisma,
): Promise<AdminBranch> {
  const code = input.code.trim().toUpperCase();
  assertCodeFormat(code);

  if (await client.branch.findUnique({ where: { code } })) {
    throw ApiError.conflict(`Mã chi nhánh ${code} đã tồn tại.`);
  }
  await assertBranchNumberFree(client, input.branchNumber, null);

  // Validate every alias BEFORE creating anything, so a rejected name never
  // leaves a half-configured branch behind.
  const aliases = (input.aliases ?? []).map((a) => ({
    source: a.source,
    alias: a.alias,
    normalizedAlias: normalizedOrThrow(a.alias),
    matchMode: effectiveMatchMode(a.source, a.matchMode),
    active: a.active ?? true,
    priority: a.priority ?? 0,
  }));
  const seen = new Set<string>();
  for (const a of aliases) {
    const key = `${a.source}:${a.normalizedAlias}`;
    if (seen.has(key)) throw ApiError.conflict(`Tên khách sạn "${a.alias}" bị trùng trong biểu mẫu.`);
    seen.add(key);
    await assertAliasFree(client, a.source, a.normalizedAlias, -1, null);
  }

  const branch = await client.branch.create({
    data: {
      code,
      branchNumber: input.branchNumber,
      hotelName: input.hotelName,
      address: input.address,
      breakfastIncluded: input.breakfastIncluded ?? false,
      active: input.active ?? true,
      phone: input.phone ?? null,
      email: input.email ?? null,
      contactName: input.contactName ?? null,
      note: input.note ?? null,
      aliases: { create: aliases },
    },
  });

  await logChange(client, branch.id, 'BRANCH_CREATED', actorId, 'code', null, code);
  for (const a of aliases) {
    await logChange(client, branch.id, 'ALIAS_ADDED', actorId, a.source, null, a.alias);
  }

  return loadSerialized(client, branch.id);
}

export async function updateBranch(
  id: number,
  input: UpdateBranchInput,
  actorId: number | null,
  client: PrismaClient = defaultPrisma,
): Promise<AdminBranch> {
  const existing = await client.branch.findUnique({ where: { id } });
  if (!existing) throw ApiError.notFound('Không tìm thấy chi nhánh.');

  if (input.branchNumber !== undefined && input.branchNumber !== existing.branchNumber) {
    await assertBranchNumberFree(client, input.branchNumber, id);
  }

  const data: Prisma.BranchUpdateInput = {};
  if (input.branchNumber !== undefined) data.branchNumber = input.branchNumber;
  if (input.hotelName !== undefined) data.hotelName = input.hotelName;
  if (input.address !== undefined) data.address = input.address;
  if (input.breakfastIncluded !== undefined) data.breakfastIncluded = input.breakfastIncluded;
  if (input.active !== undefined) data.active = input.active;
  if (input.phone !== undefined) data.phone = input.phone ?? null;
  if (input.email !== undefined) data.email = input.email ?? null;
  if (input.contactName !== undefined) data.contactName = input.contactName ?? null;
  if (input.note !== undefined) data.note = input.note ?? null;

  await client.branch.update({ where: { id }, data });

  // The branch id never changes, so every historical booking, proof, issue and
  // notification stays attached to exactly the same branch.
  if (input.branchNumber !== undefined && input.branchNumber !== existing.branchNumber) {
    await logChange(client, id, 'BRANCH_NUMBER_CHANGED', actorId, 'branchNumber', String(existing.branchNumber), String(input.branchNumber));
  }
  if (input.hotelName !== undefined && input.hotelName !== existing.hotelName) {
    await logChange(client, id, 'BRANCH_NAME_CHANGED', actorId, 'hotelName', existing.hotelName, input.hotelName);
  }
  if (input.address !== undefined && input.address !== existing.address) {
    await logChange(client, id, 'BRANCH_ADDRESS_CHANGED', actorId, 'address', existing.address, input.address);
  }
  if (input.breakfastIncluded !== undefined && input.breakfastIncluded !== existing.breakfastIncluded) {
    await logChange(client, id, 'BRANCH_BREAKFAST_CHANGED', actorId, 'breakfastIncluded', String(existing.breakfastIncluded), String(input.breakfastIncluded));
  }
  for (const field of ['phone', 'email', 'contactName', 'note'] as const) {
    const next = input[field];
    if (next !== undefined && (next ?? null) !== existing[field]) {
      await logChange(client, id, 'BRANCH_CONTACT_CHANGED', actorId, field, existing[field], next ?? null);
    }
  }
  if (input.active !== undefined && input.active !== existing.active) {
    await logChange(client, id, input.active ? 'BRANCH_ACTIVATED' : 'BRANCH_DEACTIVATED', actorId, 'active', String(existing.active), String(input.active));
  }

  return loadSerialized(client, id);
}

/** Receptionist accounts the Admin must handle before/after a deactivation. */
export interface AffectedReceptionist {
  id: number;
  username: string;
  fullName: string;
  active: boolean;
}

export async function receptionistsOfBranch(
  branchId: number,
  client: PrismaClient = defaultPrisma,
): Promise<AffectedReceptionist[]> {
  const users = await client.user.findMany({
    where: { branchId, role: 'RECEPTIONIST' },
    orderBy: { id: 'asc' },
    select: { id: true, username: true, fullName: true, active: true },
  });
  return users;
}

export interface DeactivationResult {
  branch: AdminBranch;
  /** Accounts still bound to the branch — never reassigned or disabled silently. */
  affectedReceptionists: AffectedReceptionist[];
}

/**
 * Deactivates a branch. Nothing is deleted: bookings, proofs, issues,
 * notifications, users and history stay readable to the Admin. The branch stops
 * receiving automatic parser routing and new dispatch, and stops being offered
 * for new receptionist accounts. Assigned accounts are reported back so the
 * Admin can decide (disable them, move them, or re-activate the branch).
 */
export async function deactivateBranch(
  id: number,
  actorId: number | null,
  client: PrismaClient = defaultPrisma,
): Promise<DeactivationResult> {
  const existing = await client.branch.findUnique({ where: { id } });
  if (!existing) throw ApiError.notFound('Không tìm thấy chi nhánh.');

  if (existing.active) {
    await client.branch.update({ where: { id }, data: { active: false } });
    await logChange(client, id, 'BRANCH_DEACTIVATED', actorId, 'active', 'true', 'false');
  }

  return {
    branch: await loadSerialized(client, id),
    affectedReceptionists: await receptionistsOfBranch(id, client),
  };
}

export async function activateBranch(
  id: number,
  actorId: number | null,
  client: PrismaClient = defaultPrisma,
): Promise<AdminBranch> {
  const existing = await client.branch.findUnique({ where: { id } });
  if (!existing) throw ApiError.notFound('Không tìm thấy chi nhánh.');

  if (!existing.active) {
    // Re-activating must not resurrect a duplicate branch number.
    await assertBranchNumberFree(client, existing.branchNumber, id);
    await client.branch.update({ where: { id }, data: { active: true } });
    await logChange(client, id, 'BRANCH_ACTIVATED', actorId, 'active', 'false', 'true');
  }

  return loadSerialized(client, id);
}

/* ------------------------------------------------------------------ */
/* Aliases                                                             */
/* ------------------------------------------------------------------ */

export async function addAlias(
  branchId: number,
  input: CreateAliasInput,
  actorId: number | null,
  client: PrismaClient = defaultPrisma,
): Promise<AdminBranch> {
  const branch = await client.branch.findUnique({ where: { id: branchId } });
  if (!branch) throw ApiError.notFound('Không tìm thấy chi nhánh.');

  const normalizedAlias = normalizedOrThrow(input.alias);
  const matchMode = effectiveMatchMode(input.source, input.matchMode);
  await assertAliasFree(client, input.source, normalizedAlias, branchId, null);

  await client.branchSourceAlias.create({
    data: {
      branchId,
      source: input.source,
      alias: input.alias,
      normalizedAlias,
      matchMode,
      active: input.active ?? true,
      priority: input.priority ?? 0,
    },
  });
  await logChange(client, branchId, 'ALIAS_ADDED', actorId, input.source, null, input.alias);

  return loadSerialized(client, branchId);
}

export async function updateAlias(
  branchId: number,
  aliasId: number,
  input: UpdateAliasInput,
  actorId: number | null,
  client: PrismaClient = defaultPrisma,
): Promise<AdminBranch> {
  const existing = await client.branchSourceAlias.findUnique({ where: { id: aliasId } });
  if (!existing || existing.branchId !== branchId) {
    throw ApiError.notFound('Không tìm thấy tên khách sạn.');
  }

  const data: Prisma.BranchSourceAliasUpdateInput = {};

  if (input.alias !== undefined && input.alias !== existing.alias) {
    const normalizedAlias = normalizedOrThrow(input.alias);
    if (normalizedAlias !== existing.normalizedAlias) {
      await assertAliasFree(client, existing.source, normalizedAlias, branchId, aliasId);
    }
    data.alias = input.alias;
    data.normalizedAlias = normalizedAlias;
  }
  if (input.matchMode !== undefined) {
    data.matchMode = effectiveMatchMode(existing.source, input.matchMode);
  }
  if (input.active !== undefined) {
    // Re-enabling must not create a second active owner of the same name.
    if (input.active && !existing.active) {
      await assertAliasFree(client, existing.source, existing.normalizedAlias, branchId, aliasId);
    }
    data.active = input.active;
  }
  if (input.priority !== undefined) data.priority = input.priority;

  await client.branchSourceAlias.update({ where: { id: aliasId }, data });

  if (input.alias !== undefined && input.alias !== existing.alias) {
    await logChange(client, branchId, 'ALIAS_RENAMED', actorId, existing.source, existing.alias, input.alias);
  }
  if (input.active !== undefined && input.active !== existing.active) {
    await logChange(
      client,
      branchId,
      input.active ? 'ALIAS_ENABLED' : 'ALIAS_DISABLED',
      actorId,
      existing.source,
      existing.alias,
      existing.alias,
    );
  }

  return loadSerialized(client, branchId);
}

/**
 * Removes an alias row entirely. Only safe for a name that was never used:
 * disabling is the normal action, because a removed name stops resolving old
 * pasted text. The stored `hotelName` of past bookings is untouched either way.
 */
export async function removeAlias(
  branchId: number,
  aliasId: number,
  actorId: number | null,
  client: PrismaClient = defaultPrisma,
): Promise<AdminBranch> {
  const existing = await client.branchSourceAlias.findUnique({ where: { id: aliasId } });
  if (!existing || existing.branchId !== branchId) {
    throw ApiError.notFound('Không tìm thấy tên khách sạn.');
  }
  await client.branchSourceAlias.delete({ where: { id: aliasId } });
  await logChange(client, branchId, 'ALIAS_REMOVED', actorId, existing.source, existing.alias, null);
  return loadSerialized(client, branchId);
}

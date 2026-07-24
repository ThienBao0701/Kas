import type { IssueCategory, IssueStatus, Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';
import { ApiError } from '../lib/errors';
import { getClock, type Clock } from '../lib/clock';
import {
  generateIssuePhotoName,
  saveIssuePhoto,
  sniffImageMime,
} from './issueStorage';

type Actor = { id: number; role: 'ADMIN' | 'RECEPTIONIST'; branchId: number | null; fullName: string };

export interface UploadedPhoto {
  buffer: Buffer;
  size: number;
}

/** Vietnamese labels for the issue categories, used in notifications. */
export const ISSUE_CATEGORY_LABELS: Record<IssueCategory, string> = {
  DOOR: 'Cửa',
  AIR_CONDITIONER: 'Máy lạnh',
  TOILET: 'Nhà vệ sinh',
  TV: 'TV',
  WIFI: 'Wifi',
  ELECTRICITY: 'Điện',
  WATER: 'Nước',
  FURNITURE: 'Nội thất',
  HOUSEKEEPING: 'Buồng phòng',
  GUEST_REQUEST: 'Yêu cầu của khách',
  OTHER: 'Khác',
};

const ISSUE_INCLUDE = {
  branch: true,
  reportedBy: true,
  acceptedBy: true,
  resolvedBy: true,
} satisfies Prisma.HotelIssueInclude;

export type IssueDetail = Prisma.HotelIssueGetPayload<{ include: typeof ISSUE_INCLUDE }>;

function actorView(user: { id: number; fullName: string } | null) {
  return user ? { id: user.id, fullName: user.fullName } : null;
}

/** The authenticated image endpoint for an issue photo — never a filesystem path. */
export function issuePhotoUrl(id: string): string {
  return `/api/issues/${id}/photo`;
}

/** Public, branch-isolation-safe serialization of an issue. */
export function serializeIssue(issue: IssueDetail) {
  return {
    id: issue.id,
    branchId: issue.branchId,
    branch: issue.branch
      ? { id: issue.branch.id, code: issue.branch.code, hotelName: issue.branch.hotelName, address: issue.branch.address }
      : null,
    roomNumber: issue.roomNumber,
    category: issue.category,
    description: issue.description,
    photoUrl: issue.photoStoredName ? issuePhotoUrl(issue.id) : null,
    status: issue.status,
    reportedBy: actorView(issue.reportedBy),
    acceptedBy: actorView(issue.acceptedBy),
    resolvedBy: actorView(issue.resolvedBy),
    createdAt: issue.createdAt.toISOString(),
    updatedAt: issue.updatedAt.toISOString(),
    resolvedAt: issue.resolvedAt ? issue.resolvedAt.toISOString() : null,
  };
}

async function loadIssue(id: string): Promise<IssueDetail> {
  const issue = await prisma.hotelIssue.findUnique({ where: { id }, include: ISSUE_INCLUDE });
  if (!issue) throw ApiError.notFound('Không tìm thấy báo cáo sự cố.');
  return issue;
}

function assertBranchAccess(issue: IssueDetail, actor: Actor): void {
  if (actor.role === 'RECEPTIONIST' && issue.branchId !== actor.branchId) {
    throw ApiError.branchAccessDenied();
  }
}

export interface CreateIssueInput {
  branchId?: number;
  roomNumber?: string | null;
  category: IssueCategory;
  description: string;
  photo?: UploadedPhoto;
}

/**
 * Creates a new issue report. The reporter is the current user; a receptionist's
 * branch is always taken from their session (a client-supplied branchId is
 * ignored, so a report can never be filed against another branch). Every active
 * Admin is notified.
 */
export async function createIssue(input: CreateIssueInput, actor: Actor): Promise<IssueDetail> {
  const branchId = actor.role === 'RECEPTIONIST' ? actor.branchId : input.branchId ?? null;
  if (branchId == null) {
    throw ApiError.validation('Thiếu chi nhánh cho báo cáo sự cố.');
  }
  const branch = await prisma.branch.findUnique({ where: { id: branchId } });
  if (!branch) throw ApiError.validation('Chi nhánh không hợp lệ.');

  const description = input.description.trim();
  if (description.length === 0) throw ApiError.validation('Vui lòng nhập mô tả sự cố.');

  // Optional single photo: the declared MIME is never trusted — sniff the bytes.
  const mime = input.photo ? sniffImageMime(input.photo.buffer) : null;
  if (input.photo && !mime) throw ApiError.unsupportedMedia();

  const issue = await prisma.hotelIssue.create({
    data: {
      branchId,
      roomNumber: input.roomNumber?.trim() ? input.roomNumber.trim() : null,
      category: input.category,
      description,
      status: 'NEW',
      reportedByUserId: actor.id,
    },
    include: ISSUE_INCLUDE,
  });

  if (input.photo && mime) {
    // Now that the id exists, generate the definitive file name and persist it.
    const finalName = generateIssuePhotoName(issue.id, mime);
    await saveIssuePhoto(input.photo.buffer, finalName);
    await prisma.hotelIssue.update({
      where: { id: issue.id },
      data: { photoStoredName: finalName, photoMimeType: mime },
    });
  }

  await notifyAdminsNewIssue(branch.address, input.category);
  return loadIssue(issue.id);
}

async function notifyAdminsNewIssue(branchAddress: string, category: IssueCategory): Promise<void> {
  const admins = await prisma.user.findMany({ where: { role: 'ADMIN', active: true }, select: { id: true } });
  if (admins.length === 0) return;
  await prisma.notification.createMany({
    data: admins.map((a) => ({
      userId: a.id,
      title: 'Có báo cáo sự cố mới',
      body: `${ISSUE_CATEGORY_LABELS[category]} — ${branchAddress}`,
    })),
  });
}

export interface UpdateIssueInput {
  roomNumber?: string | null;
  category?: IssueCategory;
  description?: string;
}

/**
 * Edits a report. Only the reporting side (own branch) may edit, and only while
 * the issue is still NEW — once an Admin accepts it, edits are refused.
 */
export async function updateIssue(id: string, input: UpdateIssueInput, actor: Actor): Promise<IssueDetail> {
  const issue = await loadIssue(id);
  assertBranchAccess(issue, actor);
  if (issue.status !== 'NEW') {
    throw ApiError.conflict('Không thể sửa báo cáo sau khi Admin đã tiếp nhận.', { status: issue.status });
  }
  const data: Prisma.HotelIssueUpdateInput = {};
  if (input.roomNumber !== undefined) data.roomNumber = input.roomNumber?.trim() ? input.roomNumber.trim() : null;
  if (input.category !== undefined) data.category = input.category;
  if (input.description !== undefined) {
    const d = input.description.trim();
    if (d.length === 0) throw ApiError.validation('Vui lòng nhập mô tả sự cố.');
    data.description = d;
  }
  await prisma.hotelIssue.update({ where: { id }, data });
  return loadIssue(id);
}

/**
 * Admin transition NEW → IN_PROGRESS (accept) or IN_PROGRESS/NEW → RESOLVED
 * (resolve). Records who accepted/resolved and when, and notifies the reporter.
 */
export async function setIssueStatus(
  id: string,
  next: 'IN_PROGRESS' | 'RESOLVED',
  admin: Actor,
  clock: Clock = getClock(),
): Promise<IssueDetail> {
  const issue = await loadIssue(id);
  if (issue.status === next) return issue;

  const data: Prisma.HotelIssueUpdateInput =
    next === 'IN_PROGRESS'
      ? { status: 'IN_PROGRESS', acceptedBy: { connect: { id: admin.id } } }
      : { status: 'RESOLVED', resolvedBy: { connect: { id: admin.id } }, resolvedAt: clock.now() };
  await prisma.hotelIssue.update({ where: { id }, data });

  await notifyReporterStatus(issue.reportedByUserId, id, next, issue.category);
  return loadIssue(id);
}

async function notifyReporterStatus(
  reporterId: number,
  _issueId: string,
  status: IssueStatus,
  category: IssueCategory,
): Promise<void> {
  const user = await prisma.user.findFirst({ where: { id: reporterId, active: true }, select: { id: true } });
  if (!user) return;
  const title = status === 'IN_PROGRESS' ? 'Sự cố đang được xử lý' : 'Sự cố đã được xử lý';
  await prisma.notification.create({
    data: { userId: reporterId, title, body: ISSUE_CATEGORY_LABELS[category] },
  });
}

export interface ListIssuesFilter {
  branchId?: number;
  status?: IssueStatus;
  skip: number;
  take: number;
}

/** Lists issues newest-first, branch-isolated for receptionists. */
export async function listIssues(actor: Actor, filter: ListIssuesFilter): Promise<{ issues: IssueDetail[]; total: number }> {
  const where: Prisma.HotelIssueWhereInput = {};
  if (actor.role === 'RECEPTIONIST') {
    where.branchId = actor.branchId ?? -1; // -1 never matches → an unassigned receptionist sees nothing
  } else if (filter.branchId !== undefined) {
    where.branchId = filter.branchId;
  }
  if (filter.status) where.status = filter.status;

  const [total, issues] = await prisma.$transaction([
    prisma.hotelIssue.count({ where }),
    prisma.hotelIssue.findMany({ where, include: ISSUE_INCLUDE, orderBy: { createdAt: 'desc' }, skip: filter.skip, take: filter.take }),
  ]);
  return { issues, total };
}

export async function getIssue(id: string, actor: Actor): Promise<IssueDetail> {
  const issue = await loadIssue(id);
  assertBranchAccess(issue, actor);
  return issue;
}

/** Authorises an issue-photo request and returns what the file endpoint needs. */
export async function authorizeIssuePhoto(id: string, actor: Actor): Promise<{ storedFileName: string; mimeType: string }> {
  const issue = await prisma.hotelIssue.findUnique({
    where: { id },
    select: { photoStoredName: true, photoMimeType: true, branchId: true },
  });
  if (!issue || !issue.photoStoredName) throw ApiError.notFound('Không tìm thấy ảnh.');
  if (actor.role === 'RECEPTIONIST' && issue.branchId !== actor.branchId) throw ApiError.branchAccessDenied();
  return { storedFileName: issue.photoStoredName, mimeType: issue.photoMimeType ?? 'image/jpeg' };
}

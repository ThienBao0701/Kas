import type {
  IssueAreaCategory,
  IssueCategory,
  IssueStatus,
  Prisma,
  UserRole,
} from '@prisma/client';
import { prisma } from '../db/prisma';
import { ApiError } from '../lib/errors';
import { getClock, type Clock } from '../lib/clock';
import {
  generateIssuePhotoName,
  saveIssuePhoto,
  sniffImageMime,
} from './issueStorage';
import { AREA_FIELDS, describeLocation, normaliseArea, type AreaInput } from './issueArea';

// The full role enum — see issueSummary.ts. Access is decided at runtime.
type Actor = { id: number; role: UserRole; branchId: number | null; fullName: string };

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
  completedBy: true,
} satisfies Prisma.HotelIssueInclude;

export type IssueDetail = Prisma.HotelIssueGetPayload<{ include: typeof ISSUE_INCLUDE }>;

function actorView(user: { id: number; fullName: string } | null) {
  return user ? { id: user.id, fullName: user.fullName } : null;
}

/** The authenticated image endpoint for an issue photo — never a filesystem path. */
export function issuePhotoUrl(id: string): string {
  return `/api/issues/${id}/photo`;
}

/**
 * Public, branch-isolation-safe serialization of an issue.
 *
 * Each "who" is emitted twice on purpose: the live account (`reportedBy`) and
 * the name recorded at the time (`reportedByName`). The name falls back to the
 * account's current one only when there is no snapshot — i.e. on rows created
 * before snapshots existed — so a renamed account never silently rewrites the
 * history of a job somebody else did.
 */
export function serializeIssue(issue: IssueDetail) {
  return {
    id: issue.id,
    branchId: issue.branchId,
    branch: issue.branch
      ? { id: issue.branch.id, code: issue.branch.code, hotelName: issue.branch.hotelName, address: issue.branch.address }
      : null,
    areaCategory: issue.areaCategory,
    roomNumber: issue.roomNumber,
    floorNumber: issue.floorNumber,
    areaSubtype: issue.areaSubtype,
    locationDetail: issue.locationDetail,
    /** The place as one line, so every screen says it the same way. */
    locationLabel: describeLocation(issue),
    category: issue.category,
    description: issue.description,
    photoUrl: issue.photoStoredName ? issuePhotoUrl(issue.id) : null,
    status: issue.status,
    reportedBy: actorView(issue.reportedBy),
    reportedByName: issue.reportedByNameSnapshot ?? issue.reportedBy?.fullName ?? null,
    acceptedBy: actorView(issue.acceptedBy),
    acceptedByName: issue.acceptedByNameSnapshot ?? issue.acceptedBy?.fullName ?? null,
    acceptedAt: issue.acceptedAt ? issue.acceptedAt.toISOString() : null,
    technicianName: issue.technicianName,
    technicianPhone: issue.technicianPhone,
    completedBy: actorView(issue.completedBy),
    completedByName: issue.completedByNameSnapshot ?? issue.completedBy?.fullName ?? null,
    completedAt: issue.completedAt ? issue.completedAt.toISOString() : null,
    createdAt: issue.createdAt.toISOString(),
    updatedAt: issue.updatedAt.toISOString(),
  };
}

async function loadIssue(id: string): Promise<IssueDetail> {
  const issue = await prisma.hotelIssue.findUnique({ where: { id }, include: ISSUE_INCLUDE });
  if (!issue) throw ApiError.notFound('Không tìm thấy báo cáo sự cố.');
  return issue;
}

/**
 * Branch isolation, unchanged for Reception and deliberately absent for the
 * other two roles: ADMIN watches every branch and TECHNICAL works every branch,
 * because one maintenance team serves all eight properties.
 */
function assertBranchAccess(issue: IssueDetail, actor: Actor): void {
  if (actor.role === 'RECEPTIONIST' && issue.branchId !== actor.branchId) {
    throw ApiError.branchAccessDenied();
  }
}

/** The ONLY role that may move an incident through the workflow. */
export function assertTechnicalActor(actor: Actor): void {
  if (actor.role !== 'TECHNICAL') {
    throw ApiError.forbidden('Chỉ bộ phận kỹ thuật mới xử lý được sự cố.');
  }
}

export interface CreateIssueInput extends AreaInput {
  branchId?: number;
  category?: IssueCategory | null;
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

  // Always mandatory, and trimmed FIRST so "   " is rejected like "".
  const description = input.description.trim();
  if (description.length === 0) throw ApiError.validation('Vui lòng nhập mô tả sự cố.');

  // The area decides which location columns are required, and drops the rest.
  const area = normaliseArea(input);

  // Optional single photo: the declared MIME is never trusted — sniff the bytes.
  const mime = input.photo ? sniffImageMime(input.photo.buffer) : null;
  if (input.photo && !mime) throw ApiError.unsupportedMedia();

  const issue = await prisma.hotelIssue.create({
    data: {
      branchId,
      ...area,
      // Only some areas ask for a fault type; the rest store none rather than a
      // default nobody chose.
      category: AREA_FIELDS[area.areaCategory].category ? input.category ?? null : null,
      description,
      status: 'NEW',
      reportedByUserId: actor.id,
      reportedByNameSnapshot: actor.fullName,
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

  const created = await loadIssue(issue.id);
  await notifyNewIssue(branch.address, created);
  return created;
}

/**
 * A new incident notifies both the people who need to know: every active Admin
 * (who monitors) and every active TECHNICAL user (who will do the work). Before
 * the technical department existed only Admins were told, because only an Admin
 * could act on it.
 */
async function notifyNewIssue(branchAddress: string, issue: IssueDetail): Promise<void> {
  const recipients = await prisma.user.findMany({
    where: { role: { in: ['ADMIN', 'TECHNICAL'] }, active: true },
    select: { id: true },
  });
  if (recipients.length === 0) return;
  // The category can now be absent (a hallway report has none), so the location
  // is what identifies the incident — it is always present.
  const what = issue.category ? ISSUE_CATEGORY_LABELS[issue.category] : describeLocation(issue);
  await prisma.notification.createMany({
    data: recipients.map((a) => ({
      userId: a.id,
      title: 'Có báo cáo sự cố mới',
      body: `${what} — ${branchAddress}`,
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

export interface AcceptIssueInput {
  technicianName: string;
  technicianPhone: string;
}

/**
 * NEW → IN_PROGRESS. Technical accepts the job and names who is doing it.
 *
 * WHY THE WHERE-CLAUSE CARRIES THE EXPECTED STATUS
 *
 * `updateMany ... where: { id, status: 'NEW' }` is a conditional write: the
 * database decides, atomically, whether the transition was legal. Two technicians
 * pressing "Tiếp nhận" on the same incident at the same moment therefore produce
 * one winner and one clear 409, instead of the second silently overwriting the
 * first's technician name. Reading the row and then updating it — which is what
 * the old `setIssueStatus` did — leaves exactly that race open.
 */
export async function acceptIssue(
  id: string,
  input: AcceptIssueInput,
  actor: Actor,
  clock: Clock = getClock(),
): Promise<IssueDetail> {
  assertTechnicalActor(actor);

  const technicianName = input.technicianName.trim();
  const technicianPhone = input.technicianPhone.trim();
  if (!technicianName) throw ApiError.validation('Vui lòng nhập họ và tên người sửa.');
  if (!technicianPhone) throw ApiError.validation('Vui lòng nhập số điện thoại người sửa.');

  const issue = await loadIssue(id);
  const now = clock.now();

  const { count } = await prisma.hotelIssue.updateMany({
    where: { id, status: 'NEW' },
    data: {
      status: 'IN_PROGRESS',
      acceptedByUserId: actor.id,
      acceptedByNameSnapshot: actor.fullName,
      acceptedAt: now,
      technicianName,
      technicianPhone,
    },
  });
  if (count === 0) {
    throw ApiError.conflict('Sự cố này không còn ở trạng thái chờ tiếp nhận.', { status: issue.status });
  }

  const updated = await loadIssue(id);
  await notifyReporterStatus(updated, 'IN_PROGRESS');
  return updated;
}

/**
 * IN_PROGRESS → COMPLETED. Reachable ONLY from IN_PROGRESS, which is what
 * guarantees a completed incident always names the technician who did the work.
 */
export async function completeIssue(
  id: string,
  actor: Actor,
  clock: Clock = getClock(),
): Promise<IssueDetail> {
  assertTechnicalActor(actor);

  const issue = await loadIssue(id);
  const { count } = await prisma.hotelIssue.updateMany({
    where: { id, status: 'IN_PROGRESS' },
    data: {
      status: 'COMPLETED',
      completedByUserId: actor.id,
      completedByNameSnapshot: actor.fullName,
      completedAt: clock.now(),
    },
  });
  if (count === 0) {
    throw ApiError.conflict(
      issue.status === 'COMPLETED'
        ? 'Sự cố này đã hoàn thành trước đó.'
        : 'Cần tiếp nhận sự cố trước khi hoàn thành.',
      { status: issue.status },
    );
  }

  const updated = await loadIssue(id);
  await notifyReporterStatus(updated, 'COMPLETED');
  return updated;
}

async function notifyReporterStatus(issue: IssueDetail, status: IssueStatus): Promise<void> {
  const user = await prisma.user.findFirst({
    where: { id: issue.reportedByUserId, active: true },
    select: { id: true },
  });
  if (!user) return;
  const title = status === 'IN_PROGRESS' ? 'Sự cố đang được xử lý' : 'Sự cố đã hoàn thành';
  await prisma.notification.create({
    data: { userId: issue.reportedByUserId, title, body: describeLocation(issue) },
  });
}

export interface ListIssuesFilter {
  branchId?: number;
  status?: IssueStatus;
  areaCategory?: IssueAreaCategory;
  skip: number;
  take: number;
}

/**
 * Lists issues newest-first.
 *
 * VISIBILITY, BY ROLE:
 *   RECEPTIONIST  their own branch only, and a client-sent branchId is IGNORED
 *                 rather than refused — the scope is not theirs to choose.
 *   TECHNICAL     all eight branches, optionally narrowed by `branchId`.
 *   ADMIN         all eight branches, optionally narrowed by `branchId`.
 */
export async function listIssues(actor: Actor, filter: ListIssuesFilter): Promise<{ issues: IssueDetail[]; total: number }> {
  const where: Prisma.HotelIssueWhereInput = {};
  if (actor.role === 'RECEPTIONIST') {
    where.branchId = actor.branchId ?? -1; // -1 never matches → an unassigned receptionist sees nothing
  } else if (filter.branchId !== undefined) {
    where.branchId = filter.branchId;
  }
  if (filter.status) where.status = filter.status;
  if (filter.areaCategory) where.areaCategory = filter.areaCategory;

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

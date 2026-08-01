/**
 * Builds an Admin review for pasted Agoda or CTrip text.
 *
 * The server is the authority here, deliberately. The browser may propose a
 * branch, a PMS code, a price or a payment mode, but every one of those is
 * re-derived or re-validated against the database before it reaches a note or
 * a dispatch decision — a client-submitted PMS code the selected branch does
 * not have is refused, not trusted.
 *
 * The review is STATELESS: it is a pure function of (raw text, overrides) plus
 * the current branch configuration. Nothing is written, so an Admin can edit
 * freely without leaving half-finished rows behind.
 */
import type { OtaPlatform, PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from '../db/prisma';
import { ApiError } from '../lib/errors';
import { loadBranchConfigs } from './branchConfig';
import { parseAgodaBooking } from './agoda';
import { parseCtripBooking } from './ctrip';
import { loadOtaRoomMappings } from '../room/otaRoomMappingResolver';
import {
  buildOtaReview,
  type OtaReview,
  type OtaReviewBranch,
  type OtaReviewOverrides,
  type OtaReviewRoomLine,
} from './otaReview';
import type { OtaNoteSource } from './otaPmsNote';

/** A branch the Admin may pick, for the manual selector. */
export interface OtaBranchOption {
  id: number;
  code: string;
  branchNumber: number;
  address: string;
  hotelName: string;
}

export interface OtaReviewResponse {
  review: OtaReview;
  /** Every active branch, so the Admin can always correct the match. */
  branchOptions: OtaBranchOption[];
  /**
   * Internal codes valid for the CURRENTLY selected branch. The manual
   * selector offers only these, and the server refuses anything else.
   */
  validPmsCodes: string[];
  /** The branch's configured OTA room names, to help the Admin recognise one. */
  knownOtaRoomNames: { otaRoomName: string; pmsCode: string }[];
}

/** The PMS codes a branch's ACTIVE room-class catalogue defines. */
async function validPmsCodesFor(
  client: PrismaClient,
  branchId: number,
): Promise<string[]> {
  const activeVersion = await client.branchRoomMappingVersion.findFirst({
    where: { branchId, status: 'ACTIVE' },
    select: { id: true },
  });
  if (!activeVersion) return [];
  const classes = await client.branchRoomClass.findMany({
    where: { versionId: activeVersion.id, active: true },
    select: { pmsCode: true },
    orderBy: { sortOrder: 'asc' },
  });
  return classes.map((c) => c.pmsCode);
}

/** Loads everything the review needs about one branch on one platform. */
export async function loadOtaReviewBranch(
  branchId: number,
  platform: OtaPlatform,
  client: PrismaClient = defaultPrisma,
): Promise<OtaReviewBranch | null> {
  const branch = await client.branch.findFirst({
    where: { id: branchId, active: true },
    select: { id: true, code: true, address: true },
  });
  if (!branch) return null;

  return {
    id: branch.id,
    code: branch.code,
    address: branch.address,
    mappings: await loadOtaRoomMappings(branch.id, platform, client),
    validPmsCodes: await validPmsCodesFor(client, branch.id),
  };
}

export interface OtaReviewRequest {
  source: OtaNoteSource;
  rawText: string;
  overrides?: OtaReviewOverrides;
}

/**
 * Parses the pasted text, resolves the branch, and assembles the review.
 *
 * Room lines come from the parser as OTA ROOM NAMES, never as PMS codes: the
 * code is resolved here against the selected branch's mappings, so the
 * branch-agnostic legacy table can no longer decide what a note says.
 */
export async function buildOtaReviewFromText(
  request: OtaReviewRequest,
  client: PrismaClient = defaultPrisma,
): Promise<OtaReviewResponse> {
  const platform: OtaPlatform = request.source === 'AGODA' ? 'AGODA' : 'CTRIP';
  const branchConfigs = await loadBranchConfigs(client);

  const parsedBooking =
    request.source === 'AGODA'
      ? parseAgodaBooking(request.rawText, branchConfigs)
      : parseCtripBooking(request.rawText, branchConfigs);

  // The parser assigns a branch ONLY on an exact platform-identity match.
  const resolvedBranchId = parsedBooking.branchConfident
    ? (parsedBooking.suggestedBranch?.id ?? null)
    : null;

  // The Admin's choice wins; otherwise the exact match, otherwise nothing.
  const effectiveBranchId =
    request.overrides?.branchId !== undefined
      ? request.overrides.branchId
      : resolvedBranchId;

  const branch =
    effectiveBranchId != null
      ? await loadOtaReviewBranch(effectiveBranchId, platform, client)
      : null;
  if (effectiveBranchId != null && !branch) {
    throw ApiError.validation('Chi nhánh không hợp lệ hoặc đã ngừng hoạt động.');
  }

  const parsed =
    request.source === 'AGODA'
      ? agodaParsedFields(parsedBooking, resolvedBranchId)
      : ctripParsedFields(parsedBooking, resolvedBranchId);

  const review = buildOtaReview({
    source: request.source,
    platform,
    parsed,
    branch,
    overrides: request.overrides,
  });

  const branchOptions = await client.branch.findMany({
    where: { active: true },
    orderBy: [{ branchNumber: 'asc' }, { id: 'asc' }],
    select: { id: true, code: true, branchNumber: true, address: true, hotelName: true },
  });

  return {
    review,
    branchOptions,
    validPmsCodes: branch?.validPmsCodes.slice() ?? [],
    knownOtaRoomNames:
      branch?.mappings.map((m) => ({ otaRoomName: m.otaRoomName, pmsCode: m.pmsCode })) ?? [],
  };
}

/**
 * Agoda's fields, expressed as the review's platform-neutral shape.
 *
 * Exported so tests can drive the REAL mapping without a database, rather than
 * re-implementing it and proving only that the copy agrees with itself.
 */
export function agodaParsedFields(
  parsed: ReturnType<typeof parseAgodaBooking>,
  resolvedBranchId: number | null,
) {
  const a = parsed.agoda;
  // One line per room type the email states. The OTA NAME is carried, never a
  // code: the branch decides the code.
  const rooms: { quantity: number; otaRoomName: string | null; otaRoomTypeId: string | null }[] =
    a?.roomTypeOriginal
      ? [
          {
            quantity: a.roomQuantity && a.roomQuantity > 0 ? a.roomQuantity : 1,
            // The NORMALISED name: Agoda's trailing "(2)" is a style marker, and
            // the branch's mappings are keyed by the name without it. The raw
            // form stays on the parsed booking for audit.
            otaRoomName: a.roomTypeNormalized ?? a.roomTypeOriginal,
            otaRoomTypeId: null,
          },
        ]
      : [];

  return {
    bookingCode: a?.bookingId ?? parsed.bookingCode,
    guestName: a?.customerFullName ?? parsed.guestName,
    checkIn: a?.checkIn ?? parsed.checkIn,
    checkOut: a?.checkOut ?? parsed.checkOut,
    rooms,
    // Agoda's own per-night rows, only when it actually stated them.
    nightlyRates: (a?.nightlyRates ?? []).map((n) => ({
      stayDate: n.stayDate,
      amount: n.amount,
      perRoomAmount: n.perRoomAmount ?? null,
    })),
    // Net rate is what the branch receives; the guest's price is separate. It is
    // the whole-booking figure and is never divided by rooms or nights.
    branchPrice: a?.netRate ?? null,
    guestBookedPrice: a?.referenceSellRate ?? null,
    breakfastIncluded: false,
    resolvedBranchId,
  };
}

/** CTrip's fields, in the same shape. Exported for the same reason. */
export function ctripParsedFields(
  parsed: ReturnType<typeof parseCtripBooking>,
  resolvedBranchId: number | null,
) {
  const c = parsed.ctrip;
  const rooms: { quantity: number; otaRoomName: string | null; otaRoomTypeId: string | null }[] =
    c?.roomType
      ? [
          {
            quantity: c.roomQuantity && c.roomQuantity > 0 ? c.roomQuantity : 1,
            otaRoomName: c.roomType,
            // CTrip has supplied no room-type identifier.
            otaRoomTypeId: null,
          },
        ]
      : [];

  return {
    bookingCode: c?.reservationCode ?? parsed.bookingCode,
    guestName: c?.guestName ?? parsed.guestName,
    checkIn: c?.checkIn ?? parsed.checkIn,
    checkOut: c?.checkOut ?? parsed.checkOut,
    rooms,
    // CTrip states no per-night breakdown; nothing is derived to fill the gap.
    nightlyRates: [],
    // Your payout is the branch price; Original room rate is the guest price
    // and is never replaced by Final room rate.
    branchPrice: c?.branchPrice ?? null,
    guestBookedPrice: c?.guestBookedPrice ?? null,
    // Configured business rule, not read from the page: no breakfast on CTrip.
    breakfastIncluded: false,
    resolvedBranchId,
  };
}

export type { OtaReviewRoomLine };

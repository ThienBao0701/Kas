import { api } from './client';
import type { Branch } from '../auth/types';

/**
 * The dispatch states plus the five operational states added in Phase 5. The
 * two halves are one enum on the server and must stay one here — a status the
 * client does not know about renders as a raw enum name to the receptionist.
 */
export type BookingStatus =
  | 'DRAFT'
  | 'READY'
  | 'NEW'
  | 'COMPLETED'
  | 'ARCHIVED'
  | 'RECEIVED'
  | 'CHECKED_IN'
  | 'CHECKED_OUT'
  | 'CANCELLED'
  | 'NO_SHOW';
export type PaymentStatus = 'PAY_BEFORE' | 'PAY_AFTER';
export type BookingSource = 'BOOKING_COM' | 'AGODA' | 'CTRIP';
export type BusinessType = 'DIRECT' | 'PARTNER' | 'UNKNOWN';
export type VerificationStatus = 'NOT_SUBMITTED' | 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED';
export type ProofStatus = 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED';
export type ProofReviewReason =
  | 'WRONG_CUSTOMER_NAME'
  | 'WRONG_BOOKING_CODE'
  | 'WRONG_DATES'
  | 'WRONG_ROOM_COUNT'
  | 'WRONG_ROOM_TYPE'
  | 'WRONG_PRICE'
  | 'MISSING_ROOM'
  | 'UNCLEAR_IMAGE'
  | 'OTHER';

/** Vietnamese labels for the rejection reasons (order = display order). */
export const REVIEW_REASONS: { code: ProofReviewReason; label: string }[] = [
  { code: 'WRONG_CUSTOMER_NAME', label: 'Sai tên khách' },
  { code: 'WRONG_BOOKING_CODE', label: 'Sai mã Booking' },
  { code: 'WRONG_DATES', label: 'Sai ngày check-in/check-out' },
  { code: 'WRONG_ROOM_COUNT', label: 'Sai số lượng phòng' },
  { code: 'WRONG_ROOM_TYPE', label: 'Sai hạng phòng' },
  { code: 'WRONG_PRICE', label: 'Sai giá' },
  { code: 'MISSING_ROOM', label: 'Thiếu phòng' },
  { code: 'UNCLEAR_IMAGE', label: 'Ảnh không rõ' },
  { code: 'OTHER', label: 'Khác' },
];

export const REVIEW_REASON_LABEL: Record<ProofReviewReason, string> = Object.fromEntries(
  REVIEW_REASONS.map((r) => [r.code, r.label]),
) as Record<ProofReviewReason, string>;

export const SOURCE_LABEL: Record<BookingSource, string> = {
  BOOKING_COM: 'Booking.com',
  AGODA: 'Agoda',
  CTRIP: 'CTrip',
};

export interface ProofView {
  id: string;
  attemptNumber: number;
  status: ProofStatus;
  originalFileName: string;
  mimeType: string;
  fileSize: number;
  submissionNote: string | null;
  submittedBy: Actor | null;
  submittedAt: string;
  reviewedBy: Actor | null;
  reviewedAt: string | null;
  reviewReasonCode: ProofReviewReason | null;
  reviewNote: string | null;
  imageUrl: string;
}

export interface Actor {
  id: number;
  fullName: string;
}

export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface NightPrice {
  id: string;
  stayDate: string | null;
  amount: number | null;
  currency: string;
  manuallyCorrected: boolean;
  isEstimated: boolean;
}

export type RoomClassResolutionStatus = 'RESOLVED' | 'MANUAL' | 'UNRESOLVED' | 'LEGACY';

export interface RoomView {
  id: string;
  roomIndex: number;
  roomType: string | null;
  roomSubtotal: number | null;
  taxAmount: number | null;
  feeAmount: number | null;
  /**
   * Immutable branch room-class snapshot taken when the booking was created
   * (C.3.8). Optional because bookings created before that phase have none.
   * `roomClassPmsCode` is what the note prints — it is never recomputed, so
   * activating a new room-class mapping cannot change an existing booking.
   */
  roomClassId?: string | null;
  roomClassVersionId?: string | null;
  roomClassDisplayName?: string | null;
  roomClassPmsCode?: string | null;
  roomClassSourceText?: string | null;
  roomClassStatus?: RoomClassResolutionStatus | null;
  nights: NightPrice[];
}

export interface WarningView {
  code: string;
  message: string;
  severity: 'INFO' | 'WARNING' | 'ERROR';
}

export interface StatusHistoryEntry {
  id: string;
  oldStatus: BookingStatus | null;
  newStatus: BookingStatus;
  changedBy: Actor | null;
  changedAt: string;
  note: string | null;
}

/** What the OTA said about the booking, and which build read it. */
export interface OtaMetadata {
  sourcePlatform: BookingSource;
  sourcePropertyId: string | null;
  otaBookingStatus: string | null;
  ratePlanName: string | null;
  cancellationPolicy: string | null;
  countryOfResidence: string | null;
  websiteLanguage: string | null;
  paymentType: string | null;
  benefitsIncluded: string | null;
  parserVersion: string | null;
  reviewVersion: string | null;
  rawTextSha256: string | null;
}

/** What actually happened during the stay, beside what was expected. */
export interface OperationalRecord {
  receivedAt: string | null;
  receivedBy: Actor | null;
  actualCheckInAt: string | null;
  checkedInBy: Actor | null;
  actualCheckOutAt: string | null;
  checkedOutBy: Actor | null;
  cancelledAt: string | null;
  cancelledBy: Actor | null;
  cancellationReason: string | null;
}

/**
 * One applied field change. Append-only on the server.
 *
 * There is no `reason`: the database does not store one, and inventing a
 * plausible sentence for an audit record would be worse than its absence.
 */
export interface CorrectionEntry {
  id: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  appliedBy: Actor | null;
  appliedAt: string;
}

/** A derived, ordered event — assembled from records that already exist. */
export interface TimelineEvent {
  at: string;
  type: string;
  description: string;
  actor: Actor | null;
}

/**
 * Request provenance. ADMIN ONLY — the server omits this key entirely for a
 * receptionist, so its absence is the permission boundary, not a UI choice.
 */
export interface RequestAuditView {
  parserCommit: string | null;
  reviewBuildId: string | null;
  requests: {
    id: string;
    correlationId: string | null;
    route: string | null;
    ipAddress: string | null;
    userAgent: string | null;
    sessionId: string | null;
    occurredAt: string;
  }[];
}

/** The full operational booking (admin form also includes rawText). */
export interface BookingDetail {
  id: string;
  status: BookingStatus;
  sourcePlatform: BookingSource;
  verificationStatus: VerificationStatus;
  businessType: BusinessType;
  businessTypeConfidence?: number | null;
  businessTypeManuallyConfirmed: boolean;
  businessTypeDetectionSource?: string | null;
  hotelName: string | null;
  branch: Branch | null;
  branchId: number | null;
  customerName: string | null;
  phone: string | null;
  bookingCode: string | null;
  checkInDate: string | null;
  checkOutDate: string | null;
  checkInTime: string | null;
  checkOutTime: string | null;
  totalAmount: number | null;
  currency: string;
  paymentStatus: PaymentStatus;
  specialRequest: string | null;
  rawText?: string;
  parserVersion: string | null;
  isLastMinute: boolean;
  rooms: RoomView[];
  warnings: WarningView[];
  statusHistory: StatusHistoryEntry[];
  proofs: ProofView[];
  createdBy: Actor | null;
  sentBy: Actor | null;
  completedBy: Actor | null;
  reviewedBy: Actor | null;
  createdAt: string;
  updatedAt: string;
  sentAt: string | null;
  completedAt: string | null;
  completionNote: string | null;
  reviewedAt: string | null;
  /** Who created the PMS reservation, typed by the Admin. Null for Booking.com. */
  adminPmsNote: string | null;
  /** The payment mode the Admin accepted at dispatch. */
  reviewedPaymentMode: string | null;
  ota: OtaMetadata;
  operational: OperationalRecord;
  corrections: CorrectionEntry[];
  timeline: TimelineEvent[];
  /** Absent for receptionists — the server strips it. */
  requestAudit?: RequestAuditView;
}

export interface NewListItem {
  id: string;
  bookingCode: string | null;
  customerName: string | null;
  phone: string | null;
  branch: Branch | null;
  sourcePlatform: BookingSource;
  businessType: BusinessType;
  verificationStatus: VerificationStatus;
  checkInDate: string | null;
  checkOutDate: string | null;
  numberOfRooms: number;
  roomSummary: string;
  totalAmount: number | null;
  currency: string;
  paymentStatus: PaymentStatus;
  isLastMinute: boolean;
  sentAt: string | null;
  sentBy: Actor | null;
  status: BookingStatus;
  missingNightlyPriceCount: number;
  warningCount: number;
  latestAttemptNumber: number;
  latestRejectionReason: ProofReviewReason | null;
  submittedAt: string | null;
  reviewedAt: string | null;
}

export interface CompletedListItem {
  id: string;
  customerName: string | null;
  bookingCode: string | null;
  branch: Branch | null;
  sourcePlatform: BookingSource;
  businessType: BusinessType;
  verificationStatus: VerificationStatus;
  checkInDate: string | null;
  roomSummary: string;
  totalAmount: number | null;
  currency: string;
  isLastMinute: boolean;
  completedAt: string | null;
  completedBy: Actor | null;
  completionNote: string | null;
  reviewedBy: Actor | null;
  reviewedAt: string | null;
}

export interface HistoryListItem {
  id: string;
  bookingCode: string | null;
  customerName: string | null;
  phone: string | null;
  branch: Branch | null;
  sourcePlatform: BookingSource;
  businessType: BusinessType;
  status: BookingStatus;
  verificationStatus: VerificationStatus;
  paymentStatus: PaymentStatus;
  checkInDate: string | null;
  checkOutDate: string | null;
  roomSummary: string;
  totalAmount: number | null;
  currency: string;
  isLastMinute: boolean;
  sentAt: string | null;
  sentBy: Actor | null;
  completedAt: string | null;
  completedBy: Actor | null;
  reviewedBy: Actor | null;
  reviewedAt: string | null;
  createdAt: string;
  adminPmsNote: string | null;
  reviewedPaymentMode: string | null;
}

export interface ListResponse<T> {
  bookings: T[];
  pagination: Pagination;
}

export interface ParserQuality {
  score: number;
  level: 'HIGH' | 'MEDIUM' | 'LOW';
  requiresAdminReview: boolean;
  missingCriticalFields: string[];
  warningCount: number;
}

/**
 * Structured Agoda **hotel-partner** details, present only when the pasted text
 * was an Agoda partner (YCS) booking email. `pmsNote` is the exact two-line note
 * the receptionist copies.
 */
export interface AgodaPartnerExtras {
  bookingId: string | null;
  /** The OTA's public property name — a branch-lookup value, kept for review. */
  sourceHotelName: string | null;
  /** The resolved branch's exact stored address (the operational "Khách sạn"). */
  branchAddress: string | null;
  branchCode: string | null;
  branchId: number | null;
  /** Primary customer (First + Last), for the Admin preview. */
  customerFullName: string | null;
  checkIn: string | null;
  checkOut: string | null;
  nights: number | null;
  roomTypeOriginal: string | null;
  roomCode: string | null;
  roomTypeKnown: boolean;
  roomQuantity: number | null;
  occupancy: string | null;
  extraBeds: number | null;
  netRate: number | null;
  referenceSellRate: number | null;
  payment: string | null;
  ratePlan: string | null;
  cancellationPolicy: string | null;
  countryOfResidence: string | null;
  /** Agoda's own per-night rows (diagnostics only). */
  nightlyRates: { stayDate: string; amount: number | null }[];
  /** Total hotel receivable = the Agoda Net rate. */
  totalDebtAmount: number | null;
  /** Net rate split evenly per stay night; sums exactly to totalDebtAmount. */
  nightlyDebt: { stayDate: string; amount: number | null }[];
  pmsNote: string | null;
  pmsNoteError: string | null;
}

export interface ExtractResponse {
  booking: { id: string; status: BookingStatus };
  suggestedBranch: Branch | null;
  branchConfidence: number;
  branchConfident: boolean;
  requiresManualConfirmation: boolean;
  parserQuality: ParserQuality;
  businessType: BusinessType;
  businessTypeConfidence: number;
  businessTypeRequiresAdminConfirmation: boolean;
  businessTypeMatchedRules: string[];
  warnings: WarningView[];
  /** Null unless the source was an Agoda hotel-partner email. */
  agoda: AgodaPartnerExtras | null;
}

/** Vietnamese label + tone for a business type. */
export const BUSINESS_TYPE_LABEL: Record<BusinessType, string> = {
  DIRECT: 'Đơn thường',
  PARTNER: 'Đơn đối tác',
  UNKNOWN: 'Chưa xác định',
};

// --- Editing payloads ------------------------------------------------------
export interface RoomEdit {
  roomIndex: number;
  roomType: string | null;
  roomSubtotal: number | null;
  taxAmount?: number | null;
  feeAmount?: number | null;
  nights: { stayDate: string; amount: number | null; manuallyCorrected?: boolean }[];
}

export interface BookingEdit {
  hotelName?: string | null;
  branchId?: number | null;
  customerName?: string;
  phone?: string | null;
  bookingCode?: string;
  checkInDate?: string | null;
  checkOutDate?: string | null;
  totalAmount?: number | null;
  paymentStatus?: PaymentStatus;
  specialRequest?: string | null;
  rooms?: RoomEdit[];
}

function query(params: Record<string, string | number | boolean | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

export const bookingsApi = {
  extract: (rawText: string, source: BookingSource = 'BOOKING_COM') =>
    api.post<ExtractResponse>('/bookings/extract', { rawText, source }),

  adminDetail: (id: string) => api.get<{ booking: BookingDetail }>(`/admin/bookings/${id}`),
  update: (id: string, edit: BookingEdit) => api.put<{ booking: BookingDetail }>(`/admin/bookings/${id}`, edit),
  confirmBusinessType: (id: string, businessType: 'DIRECT' | 'PARTNER') =>
    api.post<{ booking: BookingDetail }>(`/admin/bookings/${id}/business-type`, { businessType }),
  markReady: (id: string, note?: string) => api.post<{ booking: BookingDetail }>(`/admin/bookings/${id}/ready`, { note }),
  send: (id: string, branchId: number, acknowledgedWarningCodes: string[]) =>
    api.post<{ booking: BookingDetail }>(`/admin/bookings/${id}/send`, { branchId, acknowledgedWarningCodes }),

  detail: (id: string) => api.get<{ booking: BookingDetail }>(`/bookings/${id}`),

  // --- Proof verification -------------------------------------------------
  submitProof: (id: string, file: File, note?: string) => {
    const form = new FormData();
    form.append('image', file);
    if (note && note.trim().length > 0) form.append('note', note.trim());
    return api.postForm<{ booking: BookingDetail }>(`/bookings/${id}/proofs`, form);
  },
  approveProof: (id: string, proofId: string) =>
    api.post<{ booking: BookingDetail }>(`/bookings/${id}/proofs/${proofId}/approve`, {}),
  rejectProof: (id: string, proofId: string, reasonCode: ProofReviewReason, reviewNote?: string) =>
    api.post<{ booking: BookingDetail }>(`/bookings/${id}/proofs/${proofId}/reject`, { reasonCode, reviewNote }),

  listNew: (params: { branchId?: number; page?: number; pageSize?: number } = {}) =>
    api.get<ListResponse<NewListItem>>(`/bookings/new${query(params)}`),
  listPendingReview: (params: { branchId?: number; page?: number; pageSize?: number } = {}) =>
    api.get<ListResponse<NewListItem>>(`/bookings/pending-review${query(params)}`),
  listRejected: (params: { branchId?: number; page?: number; pageSize?: number } = {}) =>
    api.get<ListResponse<NewListItem>>(`/bookings/rejected${query(params)}`),
  listCompleted: (params: { branchId?: number; page?: number; pageSize?: number } = {}) =>
    api.get<ListResponse<CompletedListItem>>(`/bookings/completed${query(params)}`),
  history: (params: Record<string, string | number | boolean | undefined>) =>
    api.get<ListResponse<HistoryListItem>>(`/bookings/history${query(params)}`),

  /**
   * One operational transition. The server owns which transitions are legal —
   * the client hides buttons it believes are unavailable, but a stale tab that
   * posts anyway gets a 409 rather than a wrong write.
   */
  lifecycle: (id: string, action: LifecycleAction, reason?: string) =>
    api.post<LifecycleResult>(`/bookings/${id}/${LIFECYCLE_PATH[action]}`, reason ? { reason } : {}),
};

export type LifecycleAction = 'RECEIVE' | 'CHECK_IN' | 'CHECK_OUT' | 'COMPLETE' | 'CANCEL' | 'NO_SHOW';

export interface LifecycleResult {
  bookingId: string;
  oldStatus: BookingStatus;
  newStatus: BookingStatus;
}

const LIFECYCLE_PATH: Record<LifecycleAction, string> = {
  RECEIVE: 'receive',
  CHECK_IN: 'check-in',
  CHECK_OUT: 'check-out',
  COMPLETE: 'complete',
  CANCEL: 'cancel',
  NO_SHOW: 'no-show',
};

/**
 * Which action each status offers, mirroring the server's ALLOWED_FROM.
 *
 * Duplicated deliberately and kept minimal: the client needs it to decide what
 * to DRAW, and it is not a permission check. The server re-validates every
 * transition, so a wrong entry here can only hide or offer a button — never
 * permit an illegal write.
 */
export const LIFECYCLE_NEXT: Partial<Record<BookingStatus, LifecycleAction[]>> = {
  NEW: ['RECEIVE', 'CANCEL'],
  RECEIVED: ['CHECK_IN', 'NO_SHOW', 'CANCEL'],
  CHECKED_IN: ['CHECK_OUT'],
  CHECKED_OUT: ['COMPLETE'],
};

export const LIFECYCLE_LABEL: Record<LifecycleAction, string> = {
  RECEIVE: 'Nhận đơn',
  CHECK_IN: 'Khách nhận phòng',
  CHECK_OUT: 'Khách trả phòng',
  COMPLETE: 'Hoàn tất',
  CANCEL: 'Huỷ đơn',
  NO_SHOW: 'Khách không đến',
};

/** The two that cost the hotel money, and so ask before they act. */
export const LIFECYCLE_DESTRUCTIVE: LifecycleAction[] = ['CANCEL', 'NO_SHOW'];

export const branchesApi = {
  list: () => api.get<{ branches: Branch[] }>('/branches'),
};

export interface DashboardSummary {
  totals: { waiting: number; confirmedToday: number; lastMinute: number; sentToday: number };
  branches: { branch: Branch; waiting: number; confirmedToday: number; lastMinute: number }[];
}

/** A metric the server refuses to compute, with the reason it gives. */
export interface Unavailable {
  value: null;
  reason: string;
}

export interface StatBreakdown {
  key: string;
  label: string;
  bookings: number;
  revenue: number;
  share: number;
}

/**
 * The 7b statistics. `adr`, `occupancy` and `revPar` are always
 * `{ value: null, reason }` until a room inventory exists — the server will not
 * invent a denominator, and the client must not invent one either.
 */
export interface BookingStatistics {
  range: { from: string; to: string };
  bookingCount: number;
  revenue: number;
  stayNights: number;
  averageRevenuePerStayNight: number | null;
  averageStayNights: number | null;
  adr: Unavailable;
  occupancy: Unavailable;
  revPar: Unavailable;
  cancelledCount: number;
  noShowCount: number;
  cancellationRate: number | null;
  noShowRate: number | null;
  byOta: StatBreakdown[];
  byBranch: StatBreakdown[];
}

export const dashboardApi = {
  summary: () => api.get<DashboardSummary>('/admin/dashboard/summary'),
  statistics: (params: { from?: string; to?: string; branchId?: number } = {}) =>
    api.get<BookingStatistics>(`/admin/dashboard/statistics${query(params)}`),
};

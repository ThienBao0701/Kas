import { api } from './client';
import type { Branch } from '../auth/types';

export type BookingStatus = 'DRAFT' | 'READY' | 'NEW' | 'COMPLETED' | 'ARCHIVED';
export type PaymentStatus = 'PAY_BEFORE' | 'PAY_AFTER';
export type BookingSource = 'BOOKING_COM' | 'AGODA';
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

export interface RoomView {
  id: string;
  roomIndex: number;
  roomType: string | null;
  roomSubtotal: number | null;
  taxAmount: number | null;
  feeAmount: number | null;
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
};

export const branchesApi = {
  list: () => api.get<{ branches: Branch[] }>('/branches'),
};

export interface DashboardSummary {
  totals: { waiting: number; confirmedToday: number; lastMinute: number; sentToday: number };
  branches: { branch: Branch; waiting: number; confirmedToday: number; lastMinute: number }[];
}

export const dashboardApi = {
  summary: () => api.get<DashboardSummary>('/admin/dashboard/summary'),
};

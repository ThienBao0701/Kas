import { api } from './client';
import type { Branch } from '../auth/types';

export type BookingStatus = 'DRAFT' | 'READY' | 'NEW' | 'COMPLETED' | 'ARCHIVED';
export type PaymentStatus = 'PAY_BEFORE' | 'PAY_AFTER';

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
  createdBy: Actor | null;
  sentBy: Actor | null;
  completedBy: Actor | null;
  createdAt: string;
  updatedAt: string;
  sentAt: string | null;
  completedAt: string | null;
  completionNote: string | null;
}

export interface NewListItem {
  id: string;
  bookingCode: string | null;
  customerName: string | null;
  phone: string | null;
  branch: Branch | null;
  checkInDate: string | null;
  checkOutDate: string | null;
  numberOfRooms: number;
  totalAmount: number | null;
  currency: string;
  paymentStatus: PaymentStatus;
  isLastMinute: boolean;
  sentAt: string | null;
  sentBy: Actor | null;
  status: BookingStatus;
  missingNightlyPriceCount: number;
  warningCount: number;
}

export interface CompletedListItem {
  id: string;
  customerName: string | null;
  bookingCode: string | null;
  branch: Branch | null;
  checkInDate: string | null;
  totalAmount: number | null;
  currency: string;
  isLastMinute: boolean;
  completedAt: string | null;
  completedBy: Actor | null;
  completionNote: string | null;
}

export interface HistoryListItem {
  id: string;
  bookingCode: string | null;
  customerName: string | null;
  phone: string | null;
  branch: Branch | null;
  status: BookingStatus;
  paymentStatus: PaymentStatus;
  checkInDate: string | null;
  checkOutDate: string | null;
  totalAmount: number | null;
  currency: string;
  isLastMinute: boolean;
  sentAt: string | null;
  sentBy: Actor | null;
  completedAt: string | null;
  completedBy: Actor | null;
  createdAt: string;
}

export interface ListResponse<T> {
  bookings: T[];
  pagination: Pagination;
}

export interface ExtractResponse {
  booking: { id: string; status: BookingStatus };
  suggestedBranch: Branch | null;
  branchConfident: boolean;
  requiresManualConfirmation: boolean;
  warnings: WarningView[];
}

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
  extract: (rawText: string) => api.post<ExtractResponse>('/bookings/extract', { rawText }),

  adminDetail: (id: string) => api.get<{ booking: BookingDetail }>(`/admin/bookings/${id}`),
  update: (id: string, edit: BookingEdit) => api.put<{ booking: BookingDetail }>(`/admin/bookings/${id}`, edit),
  markReady: (id: string, note?: string) => api.post<{ booking: BookingDetail }>(`/admin/bookings/${id}/ready`, { note }),
  send: (id: string, branchId: number, acknowledgedWarningCodes: string[]) =>
    api.post<{ booking: BookingDetail }>(`/admin/bookings/${id}/send`, { branchId, acknowledgedWarningCodes }),

  detail: (id: string) => api.get<{ booking: BookingDetail }>(`/bookings/${id}`),
  complete: (id: string, completionNote?: string) =>
    api.post<{ booking: BookingDetail }>(`/bookings/${id}/complete`, { completionNote }),

  listNew: (params: { branchId?: number; page?: number; pageSize?: number } = {}) =>
    api.get<ListResponse<NewListItem>>(`/bookings/new${query(params)}`),
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

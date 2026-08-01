/**
 * The Admin OTA review API (Agoda and CTrip).
 *
 * The server is authoritative. This module carries the Admin's corrections up
 * and brings the resolved review back down; it deliberately reimplements NONE
 * of the business rules. The note shown on screen is the note the server
 * generated, the list of selectable PMS codes is the list the server said is
 * valid for the selected branch, and `canDispatch` is the server's answer — not
 * a conclusion the browser reached on its own.
 */
import { api } from './client';

/** The two platforms this review serves. Booking.com has its own flow. */
export type OtaReviewSource = 'AGODA' | 'CTRIP';

/** How the guest pays, as the operator words it. */
export type OtaPaymentMode = 'CN' | 'HOTEL_PAYMENT';

/** The exact Vietnamese wording — never "THANH TOÁN TẠI KHÁCH SẠN". */
export const OTA_PAYMENT_LABEL: Record<OtaPaymentMode, string> = {
  CN: 'CN',
  HOTEL_PAYMENT: 'THANH TOÁN KHÁCH SẠN',
};

export const OTA_SOURCE_LABEL: Record<OtaReviewSource, string> = {
  AGODA: 'Agoda',
  CTRIP: 'CTrip',
};

export interface OtaReviewRoomLine {
  quantity: number;
  otaRoomName: string | null;
  otaRoomTypeId: string | null;
  /** null while unresolved. Never free text — chosen from validPmsCodes. */
  pmsCode: string | null;
  requiresManualMapping: boolean;
}

export interface OtaReviewNightly {
  stayDate: string;
  amount: number | null;
}

export interface OtaReviewWarning {
  code: string;
  message: string;
  severity: 'INFO' | 'WARNING' | 'ERROR';
}

export interface OtaReview {
  source: OtaReviewSource;
  branchId: number | null;
  branchCode: string | null;
  branchAddress: string | null;
  requiresManualBranch: boolean;
  bookingCode: string | null;
  guestName: string | null;
  checkIn: string | null;
  checkOut: string | null;
  nights: number | null;
  rooms: OtaReviewRoomLine[];
  nightlyRates: OtaReviewNightly[];
  branchPrice: number | null;
  guestBookedPrice: number | null;
  breakfastIncluded: boolean | null;
  paymentMode: OtaPaymentMode;
  note: string | null;
  noteError: string | null;
  warnings: OtaReviewWarning[];
  canDispatch: boolean;
  blockingReasons: string[];
}

export interface OtaBranchOption {
  id: number;
  code: string;
  branchNumber: number;
  address: string;
  hotelName: string;
}

export interface OtaReviewResponse {
  review: OtaReview;
  branchOptions: OtaBranchOption[];
  /** Only these may be offered in the manual PMS-code selector. */
  validPmsCodes: string[];
  knownOtaRoomNames: { otaRoomName: string; pmsCode: string }[];
}

/** The Admin's corrections. Only what changed needs sending. */
export interface OtaReviewOverrides {
  branchId?: number | null;
  bookingCode?: string | null;
  guestName?: string | null;
  checkIn?: string | null;
  checkOut?: string | null;
  rooms?: OtaReviewRoomLine[];
  branchPrice?: number | null;
  guestBookedPrice?: number | null;
  breakfastIncluded?: boolean | null;
  paymentMode?: OtaPaymentMode;
}

export const otaReviewApi = {
  review: (source: OtaReviewSource, rawText: string, overrides?: OtaReviewOverrides) =>
    api.post<OtaReviewResponse>('/admin/ota/review', { source, rawText, overrides }),
};

export type ParsedPaymentStatus = 'PAY_BEFORE' | 'PAY_AFTER';

export type WarningSeverity = 'INFO' | 'WARNING' | 'ERROR';

/** How confidently a scalar field was extracted, for the admin preview. */
export type FieldConfidence = 'CONFIDENT' | 'AMBIGUOUS' | 'MISSING';

/** A branch as needed by the matcher (shape shared by the DB row and fixtures). */
export interface MatchableBranch {
  id: number;
  code: string;
  hotelName: string;
  address: string;
}

export interface ExtractWarning {
  code: string;
  message: string;
  severity: WarningSeverity;
}

export interface ParsedNight {
  /** ISO "YYYY-MM-DD". */
  stayDate: string;
  /** Whole VND, or null when Booking.com did not state a nightly amount. */
  amount: number | null;
  currency: string;
  /** The engine never estimates money, so this is always false here. */
  isEstimated: boolean;
}

export interface ParsedRoom {
  roomIndex: number;
  roomName: string | null;
  /** Whole VND room total when stated, else null. */
  roomTotal: number | null;
  nights: ParsedNight[];
}

export interface ParsedBooking {
  hotelName: string | null;
  guestName: string | null;
  phone: string | null;
  bookingCode: string | null;
  /** ISO "YYYY-MM-DD" or null when absent/unparseable. */
  checkIn: string | null;
  checkOut: string | null;
  currency: string;
  totalAmount: number | null;
  paymentStatus: ParsedPaymentStatus;
  /**
   * Retained for backwards compatibility. The payment rule is authoritative and
   * always yields a definite answer, so this is always true.
   */
  paymentStatusKnown: boolean;
  rooms: ParsedRoom[];
  /** Best branch candidate (>= suggest threshold), even when not auto-assigned. */
  suggestedBranch: MatchableBranch | null;
  branchMatchScore: number;
  /** True when the branch match is strong enough to auto-assign without review. */
  branchConfident: boolean;
  /** True when the admin must confirm the branch before dispatch. */
  requiresManualConfirmation: boolean;
  /** Per-field extraction confidence for the preview. */
  fieldConfidence: Record<string, FieldConfidence>;
  warnings: ExtractWarning[];
  parserVersion: string;
}

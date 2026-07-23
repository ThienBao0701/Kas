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

/**
 * An operational *completeness* score for the extracted booking (0–100). It is
 * NOT an AI confidence: it is a deterministic weighted measure of how many of the
 * fields a receptionist needs were extracted cleanly, plus whether an admin must
 * re-check the booking before dispatch. Preview metadata only; never persisted.
 */
export interface ParserQuality {
  score: number;
  level: 'HIGH' | 'MEDIUM' | 'LOW';
  requiresAdminReview: boolean;
  missingCriticalFields: string[];
  warningCount: number;
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
  /** Operational arrival note distilled from the guest chat, or null. */
  specialRequest: string | null;
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
  /** The branch match score on a stable 0–100 scale (round of branchMatchScore). */
  branchConfidence: number;
  /** True when the branch match is strong enough to auto-assign without review. */
  branchConfident: boolean;
  /** True when the admin must confirm the branch before dispatch. */
  requiresManualConfirmation: boolean;
  /** Per-field extraction confidence for the preview. */
  fieldConfidence: Record<string, FieldConfidence>;
  /** Operational completeness score + admin-review flag (preview metadata). */
  parserQuality: ParserQuality;
  warnings: ExtractWarning[];
  parserVersion: string;
}

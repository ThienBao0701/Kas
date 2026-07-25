/**
 * Types for the proof-vs-booking compare engine. Everything here is **advisory**:
 * a comparison never approves/rejects a proof and never changes any status. It
 * only reports, field by field, how the persisted booking (what the Admin sent)
 * relates to the OCR-detected values from the proof screenshot.
 */

/** Per-field result. NOT_APPLICABLE is excluded from the overall aggregate. */
export type FieldResult = 'MATCH' | 'MISMATCH' | 'WARNING' | 'NOT_FOUND' | 'NOT_APPLICABLE';

/** Whether a field is business-critical for the overall verdict. */
export type FieldImportance = 'CRITICAL' | 'OPERATIONAL';

/** Overall comparison verdict. */
export type OverallStatus = 'MATCH' | 'WARNING' | 'MISMATCH' | 'UNAVAILABLE';

/** Stable identifier for each compared field. */
export type FieldKey =
  | 'BOOKING_CODE'
  | 'CHECK_IN'
  | 'CHECK_OUT'
  | 'TOTAL_AMOUNT'
  | 'ROOM_QUANTITY'
  | 'CUSTOMER_NAME'
  | 'ROOM_TYPE'
  | 'PAYMENT_STATUS'
  | 'NIGHTS'
  | 'NIGHTLY_PRICES'
  | 'PMS_NOTE';

/**
 * Structured, deterministic explanation of a field difference (C.3.5). Every
 * property is optional and additive — it enriches a field without changing the
 * C.3 result. Old stored rows simply omit it.
 */
export interface FieldDetails {
  differenceType?:
    | 'AMOUNT_DIFFERENCE'
    | 'DATE_DIFFERENCE'
    | 'NIGHT_DIFFERENCE'
    | 'QUANTITY_DIFFERENCE'
    | 'CODE_DIFFERENCE'
    | 'TYPE_DIFFERENCE'
    | 'NAME_DIFFERENCE'
    | 'PAYMENT_DIFFERENCE';
  /** Money: detected − expected (whole VND). Negative = image lower than Admin. */
  deltaAmount?: number;
  expectedAmount?: number;
  detectedAmount?: number;
  /** Dates: detected − expected in whole days. */
  deltaDays?: number;
  /** Nights: detected − expected. */
  deltaNights?: number;
  expectedNights?: number;
  detectedNights?: number;
  /** Room quantity: detected − expected. */
  deltaQuantity?: number;
  /** Booking-code digit changes at aligned positions. */
  changedPositions?: { index: number; expected: string; detected: string }[];
  missingCount?: number;
  extraCount?: number;
  /** Per-room-type group differences. */
  roomGroups?: { type: string; expectedCount: number; detectedCount: number; delta: number }[];
  /** Room types OCR detected that the booking did not expect. */
  addedTypes?: { type: string; count: number }[];
  direction?: 'HIGHER' | 'LOWER' | 'EARLIER' | 'LATER' | 'MISSING' | 'EXTRA';
}

/** One segment of a token/character diff. */
export interface DiffSegment {
  text: string;
  op: 'unchanged' | 'added' | 'removed';
}

export type ConfidenceLabel = 'HIGH' | 'MEDIUM' | 'LOW';

/** One line of the PMS-note component checklist. */
export interface NoteComponent {
  key: string;
  label: string;
  result: FieldResult;
}

/** One field's comparison outcome, ready to serialise + render. */
export interface FieldComparison {
  field: FieldKey;
  label: string;
  importance: FieldImportance;
  result: FieldResult;
  /** Human-readable expected value (from the booking), or null. */
  expected: string | null;
  /** Human-readable detected value (from OCR), or null. */
  detected: string | null;
  /** Short Vietnamese explanation (length-capped). */
  message: string;
  // --- Additive smart-explanation fields (C.3.5) ---
  details?: FieldDetails;
  /** A concise Vietnamese sentence explaining the difference (or an accent-match note). */
  explanation?: string;
  /** A concise Vietnamese "what to check" hint for a non-matching field. */
  suggestion?: string;
  /** Safe token/char diff segments (rendered by the client, never as HTML). */
  diffSegments?: DiffSegment[];
  /** OCR confidence bucket for this field, when OCR provided a confidence. */
  confidenceLabel?: ConfidenceLabel;
  confidenceMessage?: string;
}

export interface ComparisonSummary {
  matchCount: number;
  mismatchCount: number;
  warningCount: number;
  notFoundCount: number;
}

/** The full, validated comparison result stored as JSON text. */
export interface ComparisonResult {
  overall: OverallStatus;
  version: string;
  summary: ComparisonSummary;
  fields: FieldComparison[];
  // --- Additive smart-explanation fields (C.3.5) ---
  /** One operational sentence for the overall status. */
  headline?: string;
  /** De-duplicated, ordered "Admin nên kiểm tra" hints. */
  suggestions?: string[];
  /** PMS-note component checklist (additive to the PMS_NOTE field). */
  noteComponents?: NoteComponent[];
}

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
}

import { api } from './client';

/**
 * Admin-only proof-vs-booking comparison (advisory). It reports how the persisted
 * booking relates to the OCR-detected values — it never approves/rejects and never
 * changes any status. The Admin remains the decision-maker.
 */
export type OverallStatus = 'MATCH' | 'WARNING' | 'MISMATCH' | 'UNAVAILABLE';
export type FieldResult = 'MATCH' | 'MISMATCH' | 'WARNING' | 'NOT_FOUND' | 'NOT_APPLICABLE';
export type FieldImportance = 'CRITICAL' | 'OPERATIONAL';

export type ConfidenceLabel = 'HIGH' | 'MEDIUM' | 'LOW';

/** A safe token/char diff segment (rendered as text, never as HTML). */
export interface DiffSegment {
  text: string;
  op: 'unchanged' | 'added' | 'removed';
}

/** Structured difference detail (C.3.5). All fields optional/additive. */
export interface FieldDetails {
  differenceType?: string;
  deltaAmount?: number;
  expectedAmount?: number;
  detectedAmount?: number;
  deltaDays?: number;
  deltaNights?: number;
  deltaQuantity?: number;
  changedPositions?: { index: number; expected: string; detected: string }[];
  missingCount?: number;
  extraCount?: number;
  roomGroups?: { type: string; expectedCount: number; detectedCount: number; delta: number }[];
  addedTypes?: { type: string; count: number }[];
  direction?: string;
}

export interface NoteComponent {
  key: string;
  label: string;
  result: FieldResult;
}

export interface FieldComparison {
  field: string;
  label: string;
  importance: FieldImportance;
  result: FieldResult;
  expected: string | null;
  detected: string | null;
  message: string;
  // --- Additive smart fields (C.3.5); absent on older stored rows ---
  details?: FieldDetails;
  explanation?: string;
  suggestion?: string;
  diffSegments?: DiffSegment[];
  confidenceLabel?: ConfidenceLabel;
  confidenceMessage?: string;
}

export interface ComparisonResult {
  overall: OverallStatus;
  version: string;
  summary: { matchCount: number; mismatchCount: number; warningCount: number; notFoundCount: number };
  fields: FieldComparison[];
  // --- Additive smart fields (C.3.5) ---
  headline?: string;
  suggestions?: string[];
  noteComponents?: NoteComponent[];
}

export interface ProofComparison {
  id: string;
  bookingId: string;
  proofId: string;
  analysisId: string;
  overallStatus: OverallStatus;
  comparisonVersion: string;
  result: ComparisonResult | null;
  errorMessage: string | null;
  createdAt: string;
}

export const compareApi = {
  latest: (bookingId: string, proofId: string) =>
    api.get<{ comparison: ProofComparison | null }>(`/admin/bookings/${bookingId}/proofs/${proofId}/comparisons/latest`),
  list: (bookingId: string, proofId: string) =>
    api.get<{ comparisons: ProofComparison[] }>(`/admin/bookings/${bookingId}/proofs/${proofId}/comparisons`),
  compare: (bookingId: string, proofId: string) =>
    api.post<{ comparison: ProofComparison }>(`/admin/bookings/${bookingId}/proofs/${proofId}/compare`),
};

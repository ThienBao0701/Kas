import { api } from './client';

/**
 * Admin-only proof-vs-booking comparison (advisory). It reports how the persisted
 * booking relates to the OCR-detected values — it never approves/rejects and never
 * changes any status. The Admin remains the decision-maker.
 */
export type OverallStatus = 'MATCH' | 'WARNING' | 'MISMATCH' | 'UNAVAILABLE';
export type FieldResult = 'MATCH' | 'MISMATCH' | 'WARNING' | 'NOT_FOUND' | 'NOT_APPLICABLE';
export type FieldImportance = 'CRITICAL' | 'OPERATIONAL';

export interface FieldComparison {
  field: string;
  label: string;
  importance: FieldImportance;
  result: FieldResult;
  expected: string | null;
  detected: string | null;
  message: string;
}

export interface ComparisonResult {
  overall: OverallStatus;
  version: string;
  summary: { matchCount: number; mismatchCount: number; warningCount: number; notFoundCount: number };
  fields: FieldComparison[];
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

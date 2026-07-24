import { useQuery } from '@tanstack/react-query';
import { compareApi } from '../api/compare';

/** Shared query key so the comparison card and the approve flow read one cache. */
export function proofComparisonKey(bookingId: string, proofId: string) {
  return ['proof-comparison', bookingId, proofId] as const;
}

/**
 * Latest proof-vs-booking comparison for a proof. Polls until a run exists, then
 * stops (the comparison is created automatically after OCR completes).
 */
export function useProofComparison(bookingId: string, proofId: string) {
  return useQuery({
    queryKey: proofComparisonKey(bookingId, proofId),
    queryFn: () => compareApi.latest(bookingId, proofId),
    refetchInterval: (q) => (q.state.data?.comparison ? false : 5_000),
  });
}

import { api } from './client';

/**
 * Admin-only proof OCR (advisory extraction). These results are what OCR *read*
 * from the screenshot — never a MATCH/MISMATCH verdict and never an approval
 * recommendation. The Admin still checks the image before confirming.
 */
export type ProofAnalysisStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'DISABLED';

export interface OcrField<T> {
  value: T;
  confidence: number;
}

export interface OcrRoomType {
  value: string;
  quantity: number | null;
  confidence: number;
}

export interface ProofExtractedData {
  bookingCode: OcrField<string> | null;
  customerName: OcrField<string> | null;
  checkInDate: OcrField<string> | null;
  checkOutDate: OcrField<string> | null;
  nights: OcrField<number> | null;
  roomTypes: OcrRoomType[];
  roomQuantity: OcrField<number> | null;
  totalAmount: (OcrField<number> & { currency: string }) | null;
  paymentStatus: OcrField<'PAY_BEFORE' | 'PAY_AFTER'> | null;
  note: OcrField<string> | null;
}

export interface ProofAnalysis {
  id: string;
  proofId: string;
  status: ProofAnalysisStatus;
  provider: string;
  analysisVersion: string;
  extractedText: string | null;
  fields: ProofExtractedData | null;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

/** True while an analysis is still running (worth polling for). */
export function isAnalysisPending(status: ProofAnalysisStatus | undefined): boolean {
  return status === 'PENDING' || status === 'PROCESSING';
}

export const ocrApi = {
  latest: (bookingId: string, proofId: string) =>
    api.get<{ analysis: ProofAnalysis | null }>(`/admin/bookings/${bookingId}/proofs/${proofId}/analyses/latest`),
  list: (bookingId: string, proofId: string) =>
    api.get<{ analyses: ProofAnalysis[] }>(`/admin/bookings/${bookingId}/proofs/${proofId}/analyses`),
  analyze: (bookingId: string, proofId: string) =>
    api.post<{ analysis: ProofAnalysis }>(`/admin/bookings/${bookingId}/proofs/${proofId}/analyze`),
};

import type { ProofOcrProvider, RawOcrOutput } from '../../src/booking/ocr/types';

/** A deterministic provider that returns fixed OCR text — no real Tesseract. */
export function mockSuccessProvider(rawText: string, meanConfidence: number | null = 90): ProofOcrProvider {
  return {
    name: 'mock',
    enabled: true,
    recognize: (): Promise<RawOcrOutput> => Promise.resolve({ rawText, meanConfidence }),
  };
}

/** A provider that always throws — exercises the FAILED path + error sanitising. */
export function mockFailingProvider(message = 'internal tesseract failure at C:\\secret\\path'): ProofOcrProvider {
  return {
    name: 'mock',
    enabled: true,
    recognize: (): Promise<RawOcrOutput> => Promise.reject(new Error(message)),
  };
}

/** A provider whose recognition is held open until `resolve` is called. */
export function deferredProvider(rawText = 'Booking ID: 6039118394'): {
  provider: ProofOcrProvider;
  resolve: () => void;
} {
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const provider: ProofOcrProvider = {
    name: 'mock',
    enabled: true,
    recognize: async (): Promise<RawOcrOutput> => {
      await gate;
      return { rawText, meanConfidence: 88 };
    },
  };
  return { provider, resolve: release };
}

/** OCR text used across integration tests (anonymised). */
export const SAMPLE_OCR_TEXT = [
  'Booking ID: 6039118394',
  'Guest name: Nguyen Van A',
  'Check-in: 24/07/2026',
  'Check-out: 28/07/2026',
  'Room type: Superior Double',
  'Total: VND 4.720.680',
  'PAY AFTER CHECK-IN',
  'Special request: Late check-in around 22:00',
].join('\n');

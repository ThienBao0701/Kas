/**
 * Pluggable OCR providers. The active provider is chosen from configuration, so
 * no paid or heavy cloud service is ever hard-coded and the app always starts:
 *
 *  - PROOF_OCR_ENABLED=false → {@link NullOcrProvider} (recorded as DISABLED).
 *  - PROOF_OCR_ENABLED=true  → {@link TesseractOcrProvider}, which lazily loads
 *    the OPTIONAL `tesseract.js` dependency only when it actually recognises. If
 *    that package is not installed, recognition throws and the analysis is
 *    recorded as FAILED — proof upload is unaffected either way.
 *
 * Tests inject a deterministic mock provider via {@link setOcrProvider}; they
 * never require real Tesseract processing.
 */
import { env } from '../../config/env';
import type { ProofOcrProvider, RawOcrOutput } from './types';

/** Disabled backend: never recognises; the service records the run as DISABLED. */
export class NullOcrProvider implements ProofOcrProvider {
  readonly name = 'disabled';
  readonly enabled = false;
  recognize(): Promise<RawOcrOutput> {
    return Promise.reject(new Error('OCR is disabled'));
  }
}

/** The minimal shape we use from tesseract.js, resolved at runtime only. */
interface TesseractLike {
  createWorker(
    lang?: string,
  ): Promise<{
    recognize(image: Buffer): Promise<{ data: { text: string; confidence: number } }>;
    terminate(): Promise<unknown>;
  }>;
}

/**
 * Local OCR via the optional `tesseract.js` package. The specifier is held in a
 * variable so the type-checker never requires the (optional) module to be
 * present; a missing package simply throws at runtime and becomes a FAILED run.
 */
export class TesseractOcrProvider implements ProofOcrProvider {
  readonly name = 'tesseract';
  readonly enabled = true;

  async recognize(image: Buffer, language: string): Promise<RawOcrOutput> {
    const specifier = 'tesseract.js';
    const mod = (await import(specifier)) as unknown as TesseractLike;
    const worker = await mod.createWorker(language);
    try {
      const { data } = await worker.recognize(image);
      return { rawText: data.text ?? '', meanConfidence: typeof data.confidence === 'number' ? data.confidence : null };
    } finally {
      await worker.terminate();
    }
  }
}

let override: ProofOcrProvider | null = null;

/** The provider selected by configuration (or a test override). */
export function getOcrProvider(): ProofOcrProvider {
  if (override) return override;
  return env.PROOF_OCR_ENABLED ? new TesseractOcrProvider() : new NullOcrProvider();
}

/** Test-only: pin the active provider. Always pair with {@link resetOcrProvider}. */
export function setOcrProvider(provider: ProofOcrProvider): void {
  override = provider;
}

export function resetOcrProvider(): void {
  override = null;
}

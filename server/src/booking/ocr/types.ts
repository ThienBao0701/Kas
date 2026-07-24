/**
 * Types for the proof-OCR feature. Everything here is **advisory extraction
 * only** — it reads text out of a receptionist's proof screenshot to help the
 * Admin. It never carries a MATCH/MISMATCH verdict, never compares against the
 * booking, and never recommends approval or rejection. Those belong to a later
 * milestone; this milestone only extracts and displays what OCR detected.
 */

/** A single detected value plus the OCR confidence for that value (0–100). */
export interface OcrField<T> {
  value: T;
  /** OCR confidence 0–100. NOT a statement about proof correctness. */
  confidence: number;
}

/** A detected room type with an optional detected quantity. */
export interface OcrRoomType {
  value: string;
  quantity: number | null;
  confidence: number;
}

/** Payment wording normalised to the app's two canonical values. */
export type OcrPaymentValue = 'PAY_BEFORE' | 'PAY_AFTER';

/**
 * The structured fields OCR may detect. Every field is nullable: when OCR is
 * uncertain the extractor returns null (NOT_FOUND) rather than inventing a value.
 */
export interface ProofExtractedData {
  bookingCode: OcrField<string> | null;
  customerName: OcrField<string> | null;
  checkInDate: OcrField<string> | null; // ISO "YYYY-MM-DD"
  checkOutDate: OcrField<string> | null; // ISO "YYYY-MM-DD"
  nights: OcrField<number> | null;
  roomTypes: OcrRoomType[];
  roomQuantity: OcrField<number> | null;
  totalAmount: (OcrField<number> & { currency: string }) | null;
  paymentStatus: OcrField<OcrPaymentValue> | null;
  note: OcrField<string> | null;
}

/** Raw output from a provider before field extraction. */
export interface RawOcrOutput {
  rawText: string;
  /** Mean per-word OCR confidence 0–100 when the engine reports it, else null. */
  meanConfidence: number | null;
}

/**
 * A pluggable OCR backend. `enabled: false` providers are never asked to
 * recognise — the service records the run as DISABLED. This keeps a paid or heavy
 * cloud service from ever being hard-coded or required.
 */
export interface ProofOcrProvider {
  readonly name: string;
  readonly enabled: boolean;
  /** Recognises text from image bytes. May throw; the service treats that as FAILED. */
  recognize(image: Buffer, language: string): Promise<RawOcrOutput>;
}

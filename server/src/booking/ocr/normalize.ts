/**
 * Safe normalisation + structured extraction of OCR text from a proof screenshot.
 *
 * Design rules (advisory extraction only):
 *  - Never invent a value when uncertain — return null (NOT_FOUND).
 *  - Preserve detected values exactly after a *safe* normalisation (e.g. keep
 *    every digit of a booking code; never guess a missing digit).
 *  - Confidence is an OCR/heuristic signal, NOT a statement of proof correctness.
 *  - No comparison against the booking happens here.
 *
 * This module is pure and deterministic so it can be unit-tested without a real
 * OCR engine.
 */
import type {
  OcrField,
  OcrPaymentValue,
  OcrRoomType,
  ProofExtractedData,
} from './types';

/** Hard cap on stored OCR text, so a pathological image can't bloat the row. */
export const MAX_OCR_TEXT_LENGTH = 20_000;

/** Truncates OCR text to the storage cap (adds an ellipsis marker when cut). */
export function limitOcrText(text: string): string {
  if (text.length <= MAX_OCR_TEXT_LENGTH) return text;
  return `${text.slice(0, MAX_OCR_TEXT_LENGTH - 1)}…`;
}

const clampConfidence = (n: number): number => Math.max(1, Math.min(100, Math.round(n)));

/** Blends a heuristic confidence with the engine's mean confidence when present. */
function confidenceWith(base: number, mean: number | null | undefined): number {
  if (mean == null || Number.isNaN(mean)) return clampConfidence(base);
  return clampConfidence((base + mean) / 2);
}

// ---------------------------------------------------------------------------
// MONEY
// ---------------------------------------------------------------------------
/**
 * Parses a VND-style money token to a whole number. Handles "4.720.680",
 * "4,720,680", "4720680" and "VND 4.720.680". Returns null when the token has no
 * usable digits. VND has no minor unit, so all separators are grouping and are
 * simply removed.
 */
export function normalizeMoney(raw: string): number | null {
  const digits = raw.replace(/[^\d]/g, '');
  if (digits.length === 0) return null;
  const value = Number.parseInt(digits, 10);
  return Number.isFinite(value) ? value : null;
}

// A money token: optional currency marker, then 3+ chars of digits/grouping.
const MONEY_TOKEN = /(?:VND|₫|đ|\$|USD)?\s*(\d{1,3}(?:[.,]\d{3})+|\d{4,})\s*(?:VND|₫|đ)?/gi;

interface MoneyHit {
  value: number;
  currency: string;
  index: number;
}

function currencyNear(text: string, index: number, token: string): string {
  const window = text.slice(Math.max(0, index - 6), index + token.length + 6);
  if (/\$|USD/i.test(window)) return 'USD';
  return 'VND';
}

function findMoneyHits(text: string): MoneyHit[] {
  const hits: MoneyHit[] = [];
  for (const m of text.matchAll(MONEY_TOKEN)) {
    const value = normalizeMoney(m[1]!);
    if (value == null) continue;
    // Ignore 4-digit bare numbers that look like a year (avoid dates as money).
    if (/^\d{4}$/.test(m[1]!) && value >= 1900 && value <= 2100) continue;
    hits.push({ value, currency: currencyNear(text, m.index ?? 0, m[0]), index: m.index ?? 0 });
  }
  return hits;
}

// ---------------------------------------------------------------------------
// DATES
// ---------------------------------------------------------------------------
function isoFrom(y: number, mo: number, d: number): string | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const yyyy = String(y).padStart(4, '0');
  const mm = String(mo).padStart(2, '0');
  const dd = String(d).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Parses a single date token to ISO "YYYY-MM-DD". Accepts:
 *   24/07/2026, 24-07-2026  (day-first, the Booking.com / Vietnamese convention)
 *   2026-07-24, 2026/07/24  (ISO, year-first)
 * Returns null for anything else. Day-first is assumed for D?D/M?M/YYYY.
 */
export function normalizeDate(raw: string): string | null {
  const s = raw.trim();
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
  if (m) return isoFrom(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s);
  if (m) return isoFrom(Number(m[3]), Number(m[2]), Number(m[1]));
  return null;
}

const DATE_TOKEN = /\b(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{4})\b/g;

interface DateHit {
  iso: string;
  index: number;
}

function findDateHits(text: string): DateHit[] {
  const hits: DateHit[] = [];
  for (const m of text.matchAll(DATE_TOKEN)) {
    const iso = normalizeDate(m[1]!);
    if (iso) hits.push({ iso, index: m.index ?? 0 });
  }
  return hits;
}

/** Whole nights between two ISO dates (check-out exclusive), or null. */
function nightsBetween(checkIn: string, checkOut: string): number | null {
  const a = Date.parse(`${checkIn}T00:00:00Z`);
  const b = Date.parse(`${checkOut}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b) || b <= a) return null;
  return Math.round((b - a) / 86_400_000);
}

// ---------------------------------------------------------------------------
// PAYMENT
// ---------------------------------------------------------------------------
/**
 * Normalises payment wording to PAY_BEFORE / PAY_AFTER, or null when unclear.
 * Explicit "PAY BEFORE/AFTER (CHECK-IN|CI)" is the strongest signal.
 */
export function normalizePayment(text: string): OcrField<OcrPaymentValue> | null {
  const t = text.toLowerCase();
  if (/pay\s*before\s*(?:check[-\s]*in|ci)\b/.test(t)) return { value: 'PAY_BEFORE', confidence: 88 };
  if (/pay\s*after\s*(?:check[-\s]*in|ci)\b/.test(t)) return { value: 'PAY_AFTER', confidence: 88 };
  // Weaker but common phrasings.
  if (/prepaid|đã thanh toán|thanh toán trước|trả trước|paid online/.test(t)) {
    return { value: 'PAY_BEFORE', confidence: 72 };
  }
  if (/pay at (?:the )?(?:hotel|property)|thanh toán tại (?:khách sạn|nơi ở)|thu (?:tiền )?khi nhận phòng|trả sau/.test(t)) {
    return { value: 'PAY_AFTER', confidence: 72 };
  }
  return null;
}

// ---------------------------------------------------------------------------
// FIELD-LEVEL HELPERS
// ---------------------------------------------------------------------------
function firstMatch(text: string, re: RegExp): string | null {
  const m = re.exec(text);
  return m && m[1] != null ? m[1].trim() : null;
}

/** A short, safe single-line value (labels can capture trailing noise). */
function cleanLine(value: string): string {
  return value.split(/[\r\n|]/)[0]!.trim().replace(/\s{2,}/g, ' ').slice(0, 200);
}

function extractBookingCode(text: string, mean: number | null): OcrField<string> | null {
  // Labelled forms are the most reliable.
  const labelled = firstMatch(
    text,
    /(?:booking(?:[\s.]*(?:code|id|number|no\.?|\.com))?|confirmation(?:\s*(?:number|no\.?|code|id))?|mã\s*(?:đặt\s*phòng|booking|xác\s*nhận)?|reservation(?:\s*(?:id|number|no\.?))?)\s*[:#]?\s*([0-9]{6,15})\b/i,
  );
  if (labelled) return { value: labelled, confidence: confidenceWith(92, mean) };
  // Fallback: a lone long digit run (9–12) that is not a date or money grouping.
  const lone = firstMatch(text, /(?:^|\s)(\d{9,12})(?:\s|$)/);
  if (lone) return { value: lone, confidence: confidenceWith(66, mean) };
  return null;
}

function extractCustomerName(text: string, mean: number | null): OcrField<string> | null {
  const raw = firstMatch(
    text,
    /(?:guest(?:\s*name)?|customer(?:\s*name)?|tên\s*khách(?:\s*hàng)?|họ\s*(?:và\s*)?tên|name)\s*[:]\s*([^\r\n|]{2,80})/i,
  );
  if (!raw) return null;
  const value = cleanLine(raw);
  // Reject values that are obviously not a name (all digits / dates).
  if (value.length < 2 || /^[\d\s./-]+$/.test(value)) return null;
  return { value, confidence: confidenceWith(70, mean) };
}

function extractDates(
  text: string,
  mean: number | null,
): { checkIn: OcrField<string> | null; checkOut: OcrField<string> | null } {
  const inLabel = firstMatch(
    text,
    /(?:check[-\s]*in|checkin|arrival|nhận\s*phòng|ngày\s*đến)\D{0,20}?(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{4})/i,
  );
  const outLabel = firstMatch(
    text,
    /(?:check[-\s]*out|checkout|departure|trả\s*phòng|ngày\s*đi)\D{0,20}?(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{4})/i,
  );
  let checkIn = inLabel ? normalizeDate(inLabel) : null;
  let checkOut = outLabel ? normalizeDate(outLabel) : null;

  // No labels but exactly two dates → first is arrival, second is departure.
  if (!checkIn && !checkOut) {
    const hits = findDateHits(text);
    if (hits.length >= 2) {
      checkIn = hits[0]!.iso;
      checkOut = hits[1]!.iso;
    }
  }
  return {
    checkIn: checkIn ? { value: checkIn, confidence: confidenceWith(inLabel ? 90 : 74, mean) } : null,
    checkOut: checkOut ? { value: checkOut, confidence: confidenceWith(outLabel ? 90 : 74, mean) } : null,
  };
}

function extractTotal(
  text: string,
  mean: number | null,
): (OcrField<number> & { currency: string }) | null {
  // Labelled total is strongest.
  const labelledMatch =
    /(?:grand\s*total|total(?:\s*(?:amount|price|payable|charge|due))?|amount\s*due|tổng(?:\s*(?:cộng|tiền|thanh\s*toán|giá))?)\s*[:]?\s*((?:VND|₫|đ|\$|USD)?\s*\d{1,3}(?:[.,]\d{3})+|\d{4,})/i.exec(
      text,
    );
  if (labelledMatch) {
    const value = normalizeMoney(labelledMatch[1]!);
    if (value != null) {
      return { value, currency: currencyNear(text, labelledMatch.index, labelledMatch[0]), confidence: confidenceWith(92, mean) };
    }
  }
  // Fallback: the largest money value found (proof totals dominate line items).
  const hits = findMoneyHits(text);
  if (hits.length > 0) {
    const top = hits.reduce((a, b) => (b.value > a.value ? b : a));
    return { value: top.value, currency: top.currency, confidence: confidenceWith(64, mean) };
  }
  return null;
}

function extractRoomTypes(text: string, mean: number | null): OcrRoomType[] {
  const raw = firstMatch(
    text,
    /(?:room\s*type|hạng\s*phòng|loại\s*phòng|room)\s*[:]\s*([^\r\n|]{2,80})/i,
  );
  if (!raw) return [];
  const value = cleanLine(raw);
  if (value.length < 2 || /^\d+$/.test(value)) return [];
  const qty = extractRoomQuantity(text);
  return [{ value, quantity: qty?.value ?? null, confidence: confidenceWith(74, mean) }];
}

function extractRoomQuantity(text: string): OcrField<number> | null {
  const m = /(\d+)\s*(?:phòng|rooms?|x\b)/i.exec(text);
  if (m) {
    const n = Number.parseInt(m[1]!, 10);
    if (n > 0 && n < 100) return { value: n, confidence: 80 };
  }
  return null;
}

function extractNights(text: string, checkIn: string | null, checkOut: string | null, mean: number | null): OcrField<number> | null {
  const m = /(\d+)\s*(?:nights?|đêm)\b/i.exec(text);
  if (m) {
    const n = Number.parseInt(m[1]!, 10);
    if (n > 0 && n < 366) return { value: n, confidence: confidenceWith(82, mean) };
  }
  if (checkIn && checkOut) {
    const n = nightsBetween(checkIn, checkOut);
    if (n != null) return { value: n, confidence: confidenceWith(70, mean) };
  }
  return null;
}

function extractNote(text: string, mean: number | null): OcrField<string> | null {
  const raw = firstMatch(
    text,
    /(?:special\s*requests?|guest\s*requests?|remarks?|notes?|ghi\s*chú|yêu\s*cầu(?:\s*đặc\s*biệt)?)\s*[:]\s*([^\r\n|]{2,300})/i,
  );
  if (!raw) return null;
  const value = cleanLine(raw);
  if (value.length < 2) return null;
  return { value, confidence: confidenceWith(66, mean) };
}

// ---------------------------------------------------------------------------
// PUBLIC ENTRY POINT
// ---------------------------------------------------------------------------
export interface ExtractOptions {
  /** Mean per-word OCR confidence 0–100 from the engine, if known. */
  meanConfidence?: number | null;
}

/**
 * Extracts structured fields from OCR text. Deterministic and side-effect free.
 * Every field is best-effort and nullable — an uncertain field is null, never
 * guessed. No comparison against the real booking is performed.
 */
export function extractProofFields(rawText: string, opts: ExtractOptions = {}): ProofExtractedData {
  const text = rawText ?? '';
  const mean = opts.meanConfidence ?? null;

  const { checkIn, checkOut } = extractDates(text, mean);

  return {
    bookingCode: extractBookingCode(text, mean),
    customerName: extractCustomerName(text, mean),
    checkInDate: checkIn,
    checkOutDate: checkOut,
    nights: extractNights(text, checkIn?.value ?? null, checkOut?.value ?? null, mean),
    roomTypes: extractRoomTypes(text, mean),
    roomQuantity: extractRoomQuantity(text),
    totalAmount: extractTotal(text, mean),
    paymentStatus: normalizePayment(text),
    note: extractNote(text, mean),
  };
}

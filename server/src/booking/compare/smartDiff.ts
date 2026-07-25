/**
 * Deterministic, local "smart diff" helpers (C.3.5). They only *explain* an
 * existing comparison result — they never change a result, never repair a value,
 * and never call anything external. All inputs are length-bounded.
 */
import type { ConfidenceLabel, DiffSegment, FieldDetails } from './types';
import { canonicalRoomType, fold } from './textNormalize';

const MAX_INPUT = 200;
const cap = (s: string): string => (s.length > MAX_INPUT ? s.slice(0, MAX_INPUT) : s);

// --- Booking code -----------------------------------------------------------
/**
 * Digit-by-digit booking-code diff. Reports changed aligned positions and any
 * length shortfall/excess. Never repairs or fuzzy-matches.
 */
export function diffCode(expected: string, detected: string): FieldDetails {
  const e = cap(expected).replace(/\D/g, '');
  const d = cap(detected).replace(/\D/g, '');
  const common = Math.min(e.length, d.length);
  const changedPositions: { index: number; expected: string; detected: string }[] = [];
  for (let i = 0; i < common; i++) {
    if (e[i] !== d[i]) changedPositions.push({ index: i, expected: e[i]!, detected: d[i]! });
  }
  const missingCount = Math.max(0, e.length - d.length);
  const extraCount = Math.max(0, d.length - e.length);
  return { differenceType: 'CODE_DIFFERENCE', changedPositions, missingCount, extraCount };
}

// --- Money ------------------------------------------------------------------
export function diffMoney(expected: number, detected: number): FieldDetails {
  const deltaAmount = detected - expected;
  return {
    differenceType: 'AMOUNT_DIFFERENCE',
    expectedAmount: expected,
    detectedAmount: detected,
    deltaAmount,
    direction: deltaAmount === 0 ? undefined : deltaAmount > 0 ? 'HIGHER' : 'LOWER',
  };
}

// --- Dates ------------------------------------------------------------------
/** Whole-day difference (detected − expected) between two ISO dates, or null. */
export function diffDate(expectedIso: string, detectedIso: string): FieldDetails | null {
  const a = Date.parse(`${expectedIso}T00:00:00Z`);
  const b = Date.parse(`${detectedIso}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  const deltaDays = Math.round((b - a) / 86_400_000);
  return { differenceType: 'DATE_DIFFERENCE', deltaDays, direction: deltaDays === 0 ? undefined : deltaDays > 0 ? 'LATER' : 'EARLIER' };
}

// --- Nights -----------------------------------------------------------------
export function diffNights(expected: number, detected: number): FieldDetails {
  const deltaNights = detected - expected;
  return {
    differenceType: 'NIGHT_DIFFERENCE',
    expectedNights: expected,
    detectedNights: detected,
    deltaNights,
    direction: deltaNights === 0 ? undefined : deltaNights > 0 ? 'EXTRA' : 'MISSING',
  };
}

// --- Rooms ------------------------------------------------------------------
export interface DetectedRoomTypeLite {
  value: string;
  quantity: number | null;
}
function canonKey(v: string): string {
  return canonicalRoomType(v) ?? fold(v).toUpperCase();
}
/**
 * Room-quantity + per-canonical-type group differences. `expectedTypes` is one
 * entry per physical room; `detected` carries a quantity per detected type.
 */
export function diffRooms(expectedQty: number, detectedQty: number | null, expectedTypes: string[], detected: DetectedRoomTypeLite[]): FieldDetails {
  const deltaQuantity = detectedQty == null ? 0 : detectedQty - expectedQty;
  const expMap = new Map<string, number>();
  for (const t of expectedTypes) expMap.set(canonKey(t), (expMap.get(canonKey(t)) ?? 0) + 1);
  const detMap = new Map<string, number>();
  for (const d of detected) detMap.set(canonKey(d.value), (detMap.get(canonKey(d.value)) ?? 0) + (d.quantity && d.quantity > 0 ? d.quantity : 1));

  const roomGroups: { type: string; expectedCount: number; detectedCount: number; delta: number }[] = [];
  for (const [type, expectedCount] of expMap) {
    const detectedCount = detMap.get(type) ?? 0;
    if (detectedCount !== expectedCount) roomGroups.push({ type, expectedCount, detectedCount, delta: detectedCount - expectedCount });
  }
  const addedTypes: { type: string; count: number }[] = [];
  for (const [type, count] of detMap) {
    if (!expMap.has(type)) addedTypes.push({ type, count });
  }
  return { differenceType: 'QUANTITY_DIFFERENCE', deltaQuantity, roomGroups, addedTypes };
}

// --- Token diff -------------------------------------------------------------
/**
 * A small, deterministic word-level diff (accent/case-insensitive comparison,
 * original tokens preserved in the output). Uses an LCS table on folded tokens.
 * Never emits HTML.
 */
export function diffTextTokens(expected: string, detected: string): DiffSegment[] {
  const e = cap(expected).split(/\s+/).filter(Boolean);
  const d = cap(detected).split(/\s+/).filter(Boolean);
  const fe = e.map((t) => fold(t));
  const fd = d.map((t) => fold(t));
  const n = fe.length;
  const m = fd.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] = fe[i] === fd[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const segs: DiffSegment[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (fe[i] === fd[j]) {
      segs.push({ text: e[i]!, op: 'unchanged' });
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      segs.push({ text: e[i]!, op: 'removed' });
      i++;
    } else {
      segs.push({ text: d[j]!, op: 'added' });
      j++;
    }
  }
  while (i < n) segs.push({ text: e[i++]!, op: 'removed' });
  while (j < m) segs.push({ text: d[j++]!, op: 'added' });
  return segs;
}

// --- OCR confidence ---------------------------------------------------------
export function explainConfidence(confidence: number): { label: ConfidenceLabel; message: string } {
  if (confidence >= 90) return { label: 'HIGH', message: 'Ảnh được nhận diện khá rõ.' };
  if (confidence >= 70) return { label: 'MEDIUM', message: 'Một số ký tự có thể chưa chính xác.' };
  return { label: 'LOW', message: 'Ảnh mờ hoặc nội dung khó đọc. Admin nên kiểm tra kỹ.' };
}

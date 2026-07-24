/**
 * Deterministic, local field comparators for the proof compare engine. Each
 * function is pure and independently testable. None of them approve/reject or
 * mutate anything — they only classify a field as MATCH / MISMATCH / WARNING /
 * NOT_FOUND / NOT_APPLICABLE with a short Vietnamese message.
 */
import type { FieldComparison, FieldKey, FieldResult, FieldImportance } from './types';
import { canonicalRoomType, digitsOnly, editDistance, fold, normalizeDate, tokenSet } from './textNormalize';

const MAX_MESSAGE = 200;
const vnd = new Intl.NumberFormat('vi-VN');

const clip = (s: string): string => (s.length > MAX_MESSAGE ? s.slice(0, MAX_MESSAGE - 1) + '…' : s);
export function formatVnd(n: number | null | undefined): string {
  return n == null ? '—' : vnd.format(n);
}

function mk(
  field: FieldKey,
  label: string,
  importance: FieldImportance,
  result: FieldResult,
  expected: string | null,
  detected: string | null,
  message: string,
): FieldComparison {
  return { field, label, importance, result, expected, detected, message: clip(message) };
}

// --- Booking code (CRITICAL): exact digit equality, never fuzzy -------------
export function compareBookingCode(expected: string | null, detected: string | null): FieldComparison {
  const exp = digitsOnly(expected);
  const det = digitsOnly(detected);
  const label = 'Mã Booking';
  if (!exp) return mk('BOOKING_CODE', label, 'CRITICAL', 'NOT_APPLICABLE', null, det || null, 'Đơn chưa có mã Booking để đối chiếu.');
  if (!det) return mk('BOOKING_CODE', label, 'CRITICAL', 'NOT_FOUND', exp, null, 'Không nhận diện được mã Booking từ ảnh.');
  if (exp === det) return mk('BOOKING_CODE', label, 'CRITICAL', 'MATCH', exp, det, 'Mã Booking khớp.');
  return mk('BOOKING_CODE', label, 'CRITICAL', 'MISMATCH', exp, det, 'Mã Booking trong ảnh không khớp.');
}

// --- Dates (CRITICAL) -------------------------------------------------------
function isoDisplay(iso: string | null): string | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}
export function compareDate(field: 'CHECK_IN' | 'CHECK_OUT', label: string, expectedIso: string | null, detectedIso: string | null): FieldComparison {
  const exp = expectedIso ? normalizeDate(expectedIso) : null;
  if (!detectedIso) return mk(field, label, 'CRITICAL', exp ? 'NOT_FOUND' : 'NOT_APPLICABLE', isoDisplay(exp), null, exp ? 'Không nhận diện được ngày từ ảnh.' : 'Đơn chưa có ngày để đối chiếu.');
  const det = normalizeDate(detectedIso);
  if (!det) return mk(field, label, 'CRITICAL', 'WARNING', isoDisplay(exp), detectedIso, 'Ngày trong ảnh không hợp lệ, cần kiểm tra.');
  if (!exp) return mk(field, label, 'CRITICAL', 'NOT_APPLICABLE', null, isoDisplay(det), 'Đơn chưa có ngày để đối chiếu.');
  if (exp === det) return mk(field, label, 'CRITICAL', 'MATCH', isoDisplay(exp), isoDisplay(det), 'Ngày khớp.');
  return mk(field, label, 'CRITICAL', 'MISMATCH', isoDisplay(exp), isoDisplay(det), 'Ngày trong ảnh không khớp.');
}

// --- Total amount (CRITICAL) ------------------------------------------------
export function compareTotal(expected: number | null, detected: number | null): FieldComparison {
  const label = 'Giá tổng';
  if (expected == null) return mk('TOTAL_AMOUNT', label, 'CRITICAL', 'NOT_APPLICABLE', null, detected != null ? formatVnd(detected) : null, 'Đơn chưa có giá tổng để đối chiếu.');
  if (detected == null) return mk('TOTAL_AMOUNT', label, 'CRITICAL', 'NOT_FOUND', formatVnd(expected), null, 'Không nhận diện được giá tổng từ ảnh.');
  if (expected === detected) return mk('TOTAL_AMOUNT', label, 'CRITICAL', 'MATCH', formatVnd(expected), formatVnd(detected), 'Giá tổng khớp.');
  return mk('TOTAL_AMOUNT', label, 'CRITICAL', 'MISMATCH', formatVnd(expected), formatVnd(detected), 'Giá tổng trong ảnh không khớp.');
}

// --- Room quantity (CRITICAL) ----------------------------------------------
export function compareRoomQuantity(expected: number, detected: number | null): FieldComparison {
  const label = 'Số lượng phòng';
  if (detected == null) return mk('ROOM_QUANTITY', label, 'CRITICAL', 'NOT_FOUND', String(expected), null, 'Không nhận diện được số lượng phòng từ ảnh.');
  if (expected === detected) return mk('ROOM_QUANTITY', label, 'CRITICAL', 'MATCH', String(expected), String(detected), 'Số lượng phòng khớp.');
  return mk('ROOM_QUANTITY', label, 'CRITICAL', 'MISMATCH', String(expected), String(detected), 'Số lượng phòng trong ảnh không khớp.');
}

// --- Customer name (OPERATIONAL): accent-insensitive, bounded edit distance --
export function compareCustomerName(expected: string | null, detected: string | null): FieldComparison {
  const label = 'Tên khách';
  if (!expected) return mk('CUSTOMER_NAME', label, 'OPERATIONAL', 'NOT_APPLICABLE', null, detected, 'Đơn chưa có tên khách để đối chiếu.');
  if (!detected) return mk('CUSTOMER_NAME', label, 'OPERATIONAL', 'NOT_FOUND', expected, null, 'Không nhận diện được tên khách từ ảnh.');
  const fe = fold(expected);
  const fd = fold(detected);
  if (fe === fd || tokenSet(expected) === tokenSet(detected)) return mk('CUSTOMER_NAME', label, 'OPERATIONAL', 'MATCH', expected, detected, 'Tên khách khớp.');
  const allowed = Math.max(1, Math.round(Math.max(fe.length, fd.length) * 0.2));
  const dist = editDistance(fe, fd, allowed);
  if (dist <= allowed) return mk('CUSTOMER_NAME', label, 'OPERATIONAL', 'WARNING', expected, detected, 'Tên khách gần giống, cần kiểm tra.');
  return mk('CUSTOMER_NAME', label, 'OPERATIONAL', 'MISMATCH', expected, detected, 'Tên khách trong ảnh không khớp.');
}

// --- Room type / summary (OPERATIONAL) -------------------------------------
export interface DetectedRoomType {
  value: string;
  quantity: number | null;
}
function multiset(canon: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const c of canon) m.set(c, (m.get(c) ?? 0) + 1);
  return m;
}
function summarize(canon: string[]): string {
  const m = multiset(canon);
  return [...m.entries()].map(([k, v]) => (v > 1 ? `${k} (${v})` : k)).join(', ');
}
export function compareRoomSummary(expectedTypes: string[], detected: DetectedRoomType[]): FieldComparison {
  const label = 'Hạng phòng';
  const expandedDetected: string[] = [];
  for (const d of detected) {
    const n = d.quantity && d.quantity > 0 ? d.quantity : 1;
    for (let i = 0; i < n; i++) expandedDetected.push(d.value);
  }
  const expText = summarize(expectedTypes.map((t) => canonicalRoomType(t) ?? fold(t).toUpperCase()));
  if (expandedDetected.length === 0) {
    return mk('ROOM_TYPE', label, 'OPERATIONAL', 'NOT_FOUND', expText || null, null, 'Không nhận diện được hạng phòng từ ảnh.');
  }
  const detCanon = expandedDetected.map((v) => canonicalRoomType(v));
  const detText = summarize(expandedDetected.map((v) => canonicalRoomType(v) ?? fold(v).toUpperCase()));
  // Any unrecognised room type is ambiguous → WARNING (never a silent match).
  if (detCanon.some((c) => c === null)) {
    return mk('ROOM_TYPE', label, 'OPERATIONAL', 'WARNING', expText || null, detText || null, 'Hạng phòng trong ảnh chưa rõ, cần kiểm tra.');
  }
  const expCanon = expectedTypes.map((t) => canonicalRoomType(t) ?? `?${fold(t)}`);
  const em = multiset(expCanon);
  const dm = multiset(detCanon as string[]);
  const equal = em.size === dm.size && [...em.entries()].every(([k, v]) => dm.get(k) === v);
  if (equal) return mk('ROOM_TYPE', label, 'OPERATIONAL', 'MATCH', expText, detText, 'Hạng phòng khớp.');
  return mk('ROOM_TYPE', label, 'OPERATIONAL', 'MISMATCH', expText, detText, 'Hạng phòng trong ảnh không khớp.');
}

// --- Payment status (OPERATIONAL; opposite → MISMATCH) ----------------------
const PAY_DISPLAY: Record<'PAY_BEFORE' | 'PAY_AFTER', string> = {
  PAY_BEFORE: 'PAY BEFORE CHECK-IN',
  PAY_AFTER: 'PAY AFTER CHECK-IN',
};
export function comparePayment(expected: 'PAY_BEFORE' | 'PAY_AFTER', detected: 'PAY_BEFORE' | 'PAY_AFTER' | null): FieldComparison {
  const label = 'Thanh toán';
  const exp = PAY_DISPLAY[expected];
  if (!detected) return mk('PAYMENT_STATUS', label, 'OPERATIONAL', 'NOT_FOUND', exp, null, 'Không nhận diện được hình thức thanh toán từ ảnh.');
  if (expected === detected) return mk('PAYMENT_STATUS', label, 'OPERATIONAL', 'MATCH', exp, PAY_DISPLAY[detected], 'Hình thức thanh toán khớp.');
  return mk('PAYMENT_STATUS', label, 'OPERATIONAL', 'MISMATCH', exp, PAY_DISPLAY[detected], 'Hình thức thanh toán trong ảnh ngược với đơn.');
}

// --- Night count (OPERATIONAL; different → WARNING) -------------------------
export function compareNights(expected: number, detected: number | null): FieldComparison {
  const label = 'Số đêm';
  if (detected == null) return mk('NIGHTS', label, 'OPERATIONAL', 'NOT_FOUND', String(expected), null, 'Không nhận diện được số đêm từ ảnh.');
  if (expected === detected) return mk('NIGHTS', label, 'OPERATIONAL', 'MATCH', String(expected), String(detected), 'Số đêm khớp.');
  return mk('NIGHTS', label, 'OPERATIONAL', 'WARNING', String(expected), String(detected), 'Số đêm trong ảnh khác với đơn, cần kiểm tra.');
}

// --- Nightly prices (OPERATIONAL) ------------------------------------------
export interface NightPrice {
  date: string; // ISO
  amount: number | null;
}
export function compareNightlyPrices(expected: NightPrice[], detected: NightPrice[]): FieldComparison {
  const label = 'Giá từng đêm';
  if (detected.length === 0) {
    // Not readable from OCR — explicitly excluded from the verdict (never "wrong").
    return mk('NIGHTLY_PRICES', label, 'OPERATIONAL', 'NOT_APPLICABLE', null, null, 'Không đủ dữ liệu để so sánh giá từng đêm.');
  }
  const dmap = new Map(detected.map((d) => [d.date, d.amount]));
  let missing = 0;
  for (const e of expected) {
    if (!dmap.has(e.date)) {
      missing++;
      continue;
    }
    const dv = dmap.get(e.date)!;
    if (e.amount != null && dv != null && e.amount !== dv) {
      return mk('NIGHTLY_PRICES', label, 'OPERATIONAL', 'MISMATCH', formatVnd(e.amount), formatVnd(dv), `Giá đêm ${e.date} trong ảnh không khớp.`);
    }
  }
  const extra = detected.length > expected.length;
  if (missing > 0 || extra) return mk('NIGHTLY_PRICES', label, 'OPERATIONAL', 'WARNING', null, null, 'Giá từng đêm chưa đủ để đối chiếu, cần kiểm tra.');
  return mk('NIGHTLY_PRICES', label, 'OPERATIONAL', 'MATCH', null, null, 'Giá từng đêm khớp.');
}

// --- PMS note (OPERATIONAL) -------------------------------------------------
export interface ExpectedNote {
  bookingCode: string | null;
  nights: number;
  total: number | null;
  payment: 'PAY_BEFORE' | 'PAY_AFTER';
  partner: boolean;
  breakfast: boolean;
  arrival: string; // '' when none
}
export interface DetectedNote {
  bookingCode: string | null;
  total: number | null;
  payment: 'PAY_BEFORE' | 'PAY_AFTER' | null;
  nights: number | null;
  noteText: string | null;
}
export function comparePmsNote(expected: ExpectedNote, detected: DetectedNote): FieldComparison {
  const label = 'Ghi chú';
  const expText = `BK ${expected.bookingCode ?? '—'} · ${expected.nights} đêm · ${formatVnd(expected.total)} · ${PAY_DISPLAY[expected.payment]}${expected.partner ? ' · ĐƠN ĐỐI TÁC' : ''}`;
  const detText = detected.noteText ?? null;
  const anyDetected = detected.bookingCode || detected.total != null || detected.payment || detected.nights != null || detected.noteText;
  if (!anyDetected) return mk('PMS_NOTE', label, 'OPERATIONAL', 'NOT_APPLICABLE', expText, null, 'Không có ghi chú nhận diện được để đối chiếu.');

  // A clearly-opposite operational component makes the note wrong.
  if (detected.payment && detected.payment !== expected.payment) {
    return mk('PMS_NOTE', label, 'OPERATIONAL', 'MISMATCH', expText, detText, 'Ghi chú có hình thức thanh toán ngược với đơn.');
  }
  if (detected.bookingCode && expected.bookingCode && digitsOnly(detected.bookingCode) !== digitsOnly(expected.bookingCode)) {
    return mk('PMS_NOTE', label, 'OPERATIONAL', 'MISMATCH', expText, detText, 'Ghi chú có mã Booking không khớp.');
  }

  // Required components present & consistent?
  const requiredPresent =
    !!detected.bookingCode &&
    detected.total != null &&
    !!detected.payment &&
    detected.nights != null;
  const arrivalExpected = expected.arrival.length > 0;
  const arrivalPresent = arrivalExpected
    ? !!detected.noteText && fold(detected.noteText).includes(fold(expected.arrival).split(' ')[0] ?? '')
    : true;

  if (requiredPresent && arrivalPresent) return mk('PMS_NOTE', label, 'OPERATIONAL', 'MATCH', expText, detText, 'Các thành phần ghi chú bắt buộc đã khớp.');
  return mk('PMS_NOTE', label, 'OPERATIONAL', 'WARNING', expText, detText, 'Ghi chú thiếu một số thành phần, cần kiểm tra.');
}

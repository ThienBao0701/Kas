/**
 * Additive, deterministic enrichment of a C.3 comparison result (C.3.5). It never
 * changes a field's `result` or the `overall` status — it only appends smart
 * explanations, structured deltas, a PMS-note checklist, per-field OCR-confidence
 * labels, and de-duplicated suggestions. Old stored rows (without these fields)
 * remain fully readable.
 */
import type {
  ComparisonResult,
  ConfidenceLabel,
  FieldComparison,
  FieldKey,
  NoteComponent,
  OverallStatus,
} from './types';
import { formatVnd } from './comparators';
import { canonicalRoomType, digitsOnly, fold } from './textNormalize';
import { diffCode, diffDate, diffMoney, diffNights, diffRooms, diffTextTokens, explainConfidence } from './smartDiff';
import { FIELD_SUGGESTION, suggestAdminChecks } from './suggest';
import type { DetectedProof, ExpectedBooking } from './engine';

/** Per-field OCR confidence (0–100) for fields OCR reads, when available. */
export interface DetectedConfidences {
  bookingCode?: number;
  checkIn?: number;
  checkOut?: number;
  total?: number;
  roomQuantity?: number;
  customerName?: number;
  roomType?: number;
  payment?: number;
  nights?: number;
  note?: number;
}

const CONFIDENCE_KEY: Partial<Record<FieldKey, keyof DetectedConfidences>> = {
  BOOKING_CODE: 'bookingCode',
  CHECK_IN: 'checkIn',
  CHECK_OUT: 'checkOut',
  TOTAL_AMOUNT: 'total',
  ROOM_QUANTITY: 'roomQuantity',
  CUSTOMER_NAME: 'customerName',
  ROOM_TYPE: 'roomType',
  PAYMENT_STATUS: 'payment',
  NIGHTS: 'nights',
  PMS_NOTE: 'note',
};

const HEADLINE: Record<OverallStatus, string> = {
  MATCH: 'Không phát hiện sai khác quan trọng.',
  WARNING: 'Còn thông tin thiếu hoặc chưa đủ chắc chắn.',
  MISMATCH: 'Phát hiện thông tin không khớp cần Admin kiểm tra.',
  UNAVAILABLE: 'Chưa có đủ dữ liệu để đối chiếu.',
};

const NON_MATCH = new Set(['MISMATCH', 'WARNING', 'NOT_FOUND']);

// --- PMS-note checklist -----------------------------------------------------
function componentNum(exp: number | null, det: number | null): NoteComponent['result'] {
  if (det == null) return 'NOT_FOUND';
  return exp != null && exp === det ? 'MATCH' : exp != null ? 'MISMATCH' : 'NOT_FOUND';
}
function buildNoteComponents(expected: ExpectedBooking, detected: DetectedProof): NoteComponent[] {
  const en = expected.note;
  const dn = detected.note;
  const noteFold = fold(dn.noteText ?? '');
  const comps: NoteComponent[] = [
    { key: 'BOOKING_CODE', label: 'Mã Booking', result: !dn.bookingCode ? 'NOT_FOUND' : digitsOnly(dn.bookingCode) === digitsOnly(en.bookingCode) ? 'MATCH' : 'MISMATCH' },
    { key: 'ROOM_ABBR', label: 'Hạng phòng', result: detected.roomTypes.length > 0 ? 'MATCH' : 'NOT_FOUND' },
    { key: 'NIGHTS', label: 'Số đêm', result: componentNum(en.nights, dn.nights) },
    { key: 'TOTAL', label: 'Giá tổng', result: componentNum(en.total, dn.total) },
    { key: 'PAYMENT', label: 'Thanh toán', result: !dn.payment ? 'NOT_FOUND' : dn.payment === en.payment ? 'MATCH' : 'MISMATCH' },
    { key: 'CI', label: 'CI', result: dn.payment ? 'MATCH' : 'NOT_FOUND' },
  ];
  if (en.breakfast) comps.push({ key: 'BREAKFAST', label: 'Ăn sáng', result: /an sang|breakfast/.test(noteFold) ? 'MATCH' : 'NOT_FOUND' });
  if (en.partner) comps.push({ key: 'PARTNER', label: 'Đơn đối tác', result: /doi tac|partner/.test(noteFold) ? 'MATCH' : 'NOT_FOUND' });
  if (en.arrival) comps.push({ key: 'ARRIVAL_NOTE', label: 'Giờ đến', result: noteFold.includes(fold(en.arrival)) ? 'MATCH' : 'NOT_FOUND' });
  return comps;
}

// --- Per-field enrichment ---------------------------------------------------
function enrichBookingCode(f: FieldComparison, expected: string, detected: string): void {
  const d = diffCode(expected, detected);
  f.details = d;
  if ((d.missingCount ?? 0) > 0) f.explanation = `Thiếu ${d.missingCount} chữ số ở cuối mã Booking.`;
  else if ((d.extraCount ?? 0) > 0) f.explanation = `Dư ${d.extraCount} chữ số ở cuối mã Booking.`;
  else if (d.changedPositions && d.changedPositions.length === 1) {
    const c = d.changedPositions[0]!;
    const pos = c.index === digitsOnly(expected).length - 1 ? 'cuối' : `${c.index + 1}`;
    f.explanation = `Sai 1 ký tự tại vị trí ${pos}: ${c.expected} → ${c.detected}`;
  } else if (d.changedPositions && d.changedPositions.length > 1) {
    f.explanation = `Sai ${d.changedPositions.length} ký tự trong mã Booking.`;
  }
}

function enrichDate(f: FieldComparison, expectedIso: string, detectedIso: string): void {
  const d = diffDate(expectedIso, detectedIso);
  if (!d || d.deltaDays === 0) return;
  f.details = d;
  f.explanation = d.deltaDays! > 0 ? `Ngày trong ảnh trễ hơn ${d.deltaDays} ngày.` : `Ngày trong ảnh sớm hơn ${Math.abs(d.deltaDays!)} ngày.`;
}

function enrichRooms(f: FieldComparison, expected: ExpectedBooking, detected: DetectedProof): void {
  const d = diffRooms(expected.roomQuantity, detected.roomQuantity, expected.roomTypes, detected.roomTypes);
  f.details = d;
  const lines: string[] = [];
  if (d.deltaQuantity && d.deltaQuantity !== 0) lines.push(d.deltaQuantity < 0 ? `Thiếu ${Math.abs(d.deltaQuantity)} phòng.` : `Dư ${d.deltaQuantity} phòng.`);
  for (const g of d.roomGroups ?? []) {
    lines.push(g.delta < 0 ? `${g.type}: thiếu ${Math.abs(g.delta)} phòng.` : `${g.type}: dư ${g.delta} phòng.`);
  }
  for (const a of d.addedTypes ?? []) lines.push(`Phát hiện thêm hạng phòng: ${a.type} (${a.count}).`);
  if (lines.length > 0) f.explanation = lines.join(' ');
}

function enrichRoomType(f: FieldComparison, expected: ExpectedBooking, detected: DetectedProof): void {
  const expText = expected.roomTypes.join(', ');
  const detText = detected.roomTypes.map((r) => r.value).join(', ');
  if (expText && detText) f.diffSegments = diffTextTokens(expText, detText);
  const expCanon = expected.roomTypes.map((t) => canonicalRoomType(t)).filter(Boolean).join('+');
  const detCanon = detected.roomTypes.map((r) => canonicalRoomType(r.value)).filter(Boolean).join('+');
  const segs = f.diffSegments ?? [];
  const onlyAdded = segs.some((s) => s.op === 'added') && !segs.some((s) => s.op === 'removed');
  if (onlyAdded) {
    const added = segs.filter((s) => s.op === 'added').map((s) => s.text).join(' ');
    f.explanation = `OCR nhận diện thêm từ: ${added}`;
  } else if (expCanon && detCanon && expCanon !== detCanon) {
    f.explanation = `Hạng phòng không tương đương: ${expText} → ${detText}`;
  }
  f.details = { differenceType: 'TYPE_DIFFERENCE' };
}

function enrichName(f: FieldComparison, expected: string, detected: string): void {
  f.details = { differenceType: 'NAME_DIFFERENCE' };
  if (f.result === 'MATCH') {
    if (fold(expected) === fold(detected) && expected.trim() !== detected.trim()) f.explanation = 'Khớp sau khi bỏ dấu tiếng Việt.';
    return;
  }
  f.diffSegments = diffTextTokens(expected, detected);
  f.explanation = f.result === 'WARNING' ? 'Tên gần giống nhưng có khác biệt nhỏ.' : 'Tên khách trong ảnh khác dữ liệu Admin.';
}

/**
 * Returns a new, enriched copy of the comparison result. Additive only: results
 * and overall status are unchanged.
 */
export function enrichComparisonResult(
  base: ComparisonResult,
  expected: ExpectedBooking,
  detected: DetectedProof,
  confidences: DetectedConfidences = {},
): ComparisonResult {
  const noteComponents = buildNoteComponents(expected, detected);

  const fields: FieldComparison[] = base.fields.map((orig) => {
    const f: FieldComparison = { ...orig };

    switch (f.field) {
      case 'BOOKING_CODE':
        if (f.result === 'MISMATCH' && expected.bookingCode && detected.bookingCode) enrichBookingCode(f, expected.bookingCode, detected.bookingCode);
        break;
      case 'CHECK_IN':
        if (f.result === 'MISMATCH' && expected.checkInDate && detected.checkInDate) enrichDate(f, expected.checkInDate, detected.checkInDate);
        break;
      case 'CHECK_OUT':
        if (f.result === 'MISMATCH' && expected.checkOutDate && detected.checkOutDate) enrichDate(f, expected.checkOutDate, detected.checkOutDate);
        break;
      case 'TOTAL_AMOUNT':
        if (f.result === 'MISMATCH' && expected.totalAmount != null && detected.totalAmount != null) {
          const d = diffMoney(expected.totalAmount, detected.totalAmount);
          f.details = d;
          f.explanation = d.deltaAmount! < 0 ? `Ảnh thấp hơn dữ liệu Admin ${formatVnd(Math.abs(d.deltaAmount!))} đ.` : `Ảnh cao hơn dữ liệu Admin ${formatVnd(d.deltaAmount!)} đ.`;
        }
        break;
      case 'ROOM_QUANTITY':
        if (f.result === 'MISMATCH') enrichRooms(f, expected, detected);
        break;
      case 'ROOM_TYPE':
        if (f.result === 'MISMATCH' || f.result === 'WARNING') enrichRoomType(f, expected, detected);
        break;
      case 'NIGHTS':
        if ((f.result === 'WARNING' || f.result === 'MISMATCH') && detected.nights != null) {
          const d = diffNights(expected.nights, detected.nights);
          f.details = d;
          f.explanation = d.deltaNights! < 0 ? `Thiếu ${Math.abs(d.deltaNights!)} đêm.` : `Dư ${d.deltaNights} đêm.`;
        }
        break;
      case 'CUSTOMER_NAME':
        if (expected.customerName && detected.customerName) enrichName(f, expected.customerName, detected.customerName);
        break;
      case 'PAYMENT_STATUS':
        if (f.result === 'MISMATCH') {
          f.details = { differenceType: 'PAYMENT_DIFFERENCE' };
          f.explanation = 'Sai trạng thái thanh toán.';
        }
        break;
      default:
        break;
    }

    // Per-field OCR confidence label (only where OCR provided one + a value read).
    const ckey = CONFIDENCE_KEY[f.field];
    const conf = ckey ? confidences[ckey] : undefined;
    if (typeof conf === 'number' && f.detected != null) {
      const c: { label: ConfidenceLabel; message: string } = explainConfidence(conf);
      f.confidenceLabel = c.label;
      f.confidenceMessage = c.message;
    }

    if (NON_MATCH.has(f.result)) f.suggestion = FIELD_SUGGESTION[f.field];
    return f;
  });

  return {
    ...base,
    fields,
    headline: HEADLINE[base.overall],
    suggestions: suggestAdminChecks(fields, noteComponents),
    noteComponents,
  };
}

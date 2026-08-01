/**
 * Generates the receptionist-ready "Ghi chú tạo đơn" note — the short plain-text
 * line the receptionist pastes when creating the reservation in the external
 * hotel system. Everything here is pure and deterministic (the current date is
 * injected) so the exact output can be unit-tested.
 *
 * Layout:
 *   LINE 1: BK <CODE>_<ROOM_ABBR>_<NIGHTS> ĐÊM <TOTAL> <PAY> CI
 *   LINE 2: [ĂN SÁNG ]<DD/MM> <CONTACT>[ <ARRIVAL>]
 */
import type { BookingDetail, PaymentStatus, RoomView } from '../api/bookings';
import { formatAmountCopy, hcmDayMonth, nightCount } from './format';

const NO_CODE_MESSAGE = 'Chưa có mã Booking để tạo ghi chú.';

/** Lower-cases and strips Vietnamese diacritics (incl. đ) for keyword matching. */
const COMBINING_MARKS = /[̀-ͯ]/g;
function fold(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(COMBINING_MARKS, '').replace(/đ/g, 'd');
}

/**
 * LEGACY room-type abbreviations, most-specific first. Room *class* keywords
 * (standard/superior/deluxe/suite/family) are checked before *bed* keywords
 * (twin/double) so "Phòng Tiêu Chuẩn Giường Đôi" resolves to STAN, not DBL.
 *
 * Since C.3.8 this table is only the FALLBACK. A room whose branch room class
 * was resolved carries an immutable `roomClassPmsCode` snapshot, and that code
 * always wins — see {@link roomAbbreviation}. This global, branch-agnostic
 * table is kept solely so bookings that predate the mapping (or whose room name
 * could not be resolved deterministically) keep producing exactly the note they
 * produced before, rather than losing their code.
 */
const ROOM_ABBREVIATIONS: ReadonlyArray<{ keys: string[]; abbr: string }> = [
  { keys: ['standard', 'tieu chuan'], abbr: 'STAN' },
  { keys: ['superior'], abbr: 'SUP' },
  { keys: ['deluxe'], abbr: 'DLX' },
  { keys: ['suite'], abbr: 'SUITE' },
  { keys: ['family', 'gia dinh'], abbr: 'FAM' },
  { keys: ['twin', 'hai giuong don'], abbr: 'TWIN' },
  { keys: ['double', 'giuong doi'], abbr: 'DBL' },
];

/** A single room type → abbreviation, with a safe readable fallback. */
export function abbreviateRoomType(roomType: string | null | undefined): string {
  const folded = fold((roomType ?? '').trim());
  if (folded.length === 0) return 'PHONG';
  for (const { keys, abbr } of ROOM_ABBREVIATIONS) {
    if (keys.some((k) => folded.includes(k))) return abbr;
  }
  // Unknown type: never return empty — take the first word's letters, upper-cased.
  const firstWord = folded.replace(/[^a-z0-9\s]/g, '').trim().split(/\s+/)[0] ?? '';
  return (firstWord.slice(0, 4) || 'PHONG').toUpperCase();
}

/**
 * The PMS code for ONE room.
 *
 * The branch-specific snapshot taken when the booking was created always wins.
 * That is what makes a note stable: the code was resolved against the booking's
 * own branch at the time, stored on the row, and is never recomputed — so an
 * Admin activating a new room-class mapping cannot change what an existing
 * booking prints.
 *
 * Only a room with no snapshot (pre-C.3.8, or a name that could not be resolved
 * deterministically) falls back to the legacy keyword table.
 */
export function roomAbbreviation(room: RoomView): string {
  const snapshot = room.roomClassPmsCode?.trim();
  if (snapshot) return snapshot;
  return abbreviateRoomType(room.roomType);
}

/**
 * The room-abbreviation segment for a whole booking.
 * - one type → "STAN" (or "STANx2" for 2 rooms of that type)
 * - mixed types → each group joined with "+", e.g. "STAN+DLX" / "STANx2+DLX".
 * No room type is ever silently dropped.
 */
export function roomsAbbreviation(rooms: RoomView[]): string {
  if (rooms.length === 0) return 'PHONG';
  // Preserve first-seen order while counting duplicates.
  const order: string[] = [];
  const counts = new Map<string, number>();
  for (const room of rooms) {
    const abbr = roomAbbreviation(room);
    if (!counts.has(abbr)) order.push(abbr);
    counts.set(abbr, (counts.get(abbr) ?? 0) + 1);
  }
  return order.map((abbr) => (counts.get(abbr)! > 1 ? `${abbr}x${counts.get(abbr)}` : abbr)).join('+');
}

/**
 * Nights = check-in (inclusive) → check-out (exclusive). Falls back to the
 * longest room's nightly-row count only when the dates cannot yield a value.
 */
export function noteNights(b: Pick<BookingDetail, 'checkInDate' | 'checkOutDate' | 'rooms'>): number {
  const fromDates = nightCount(b.checkInDate, b.checkOutDate);
  if (fromDates > 0) return fromDates;
  return b.rooms.reduce((max, r) => Math.max(max, r.nights.length), 0);
}

/** PAY_BEFORE → "PAY BEFORE CHECK-IN", PAY_AFTER → "PAY AFTER CHECK-IN". */
export function paymentCode(status: PaymentStatus): string {
  return status === 'PAY_BEFORE' ? 'PAY BEFORE CHECK-IN' : 'PAY AFTER CHECK-IN';
}

/**
 * The contact label from an optional phone. Vietnamese numbers → "CÓ ZL",
 * other international numbers → "CÓ WA", missing → "NO CONTACT".
 */
export function contactLabel(phone: string | null | undefined): string {
  if (!phone) return 'NO CONTACT';
  // Keep digits and a single leading '+'.
  let norm = phone.trim().replace(/[^\d+]/g, '');
  norm = norm.replace(/(?!^)\+/g, '');
  if (norm === '') return 'NO CONTACT';

  if (norm.startsWith('+84') || norm.startsWith('0084')) return 'CÓ ZL';
  if (norm.startsWith('+') || norm.startsWith('00')) return 'CÓ WA';
  if (norm.startsWith('0')) return 'CÓ ZL';
  if (norm.startsWith('84')) return 'CÓ ZL';
  return 'CÓ WA';
}

/**
 * Extracts a concise arrival-time note from specialRequest, e.g.
 * "Khách dự kiến đến khoảng 13:00." → "KHÁCH ĐẾN KHOẢNG 13:00".
 * Returns '' when there is no arrival-time information (never a placeholder).
 */
export function arrivalNote(specialRequest: string | null | undefined): string {
  if (!specialRequest) return '';
  const time = specialRequest.match(/\b(\d{1,2}:\d{2})\b/);
  if (!time) return '';
  const folded = fold(specialRequest);
  if (!folded.includes('den')) return ''; // must mention arrival ("đến")
  let qualifier = '';
  if (folded.includes('khoang')) qualifier = 'KHOẢNG ';
  else if (folded.includes('luc')) qualifier = 'LÚC ';
  return `KHÁCH ĐẾN ${qualifier}${time[1]}`;
}

export interface PmsNoteResult {
  ok: boolean;
  /** The two-line note when ok. */
  text?: string;
  /** A user-facing reason when the note cannot be generated. */
  error?: string;
}

/** Builds the full note, or a reason it cannot be generated. `now` is injectable. */
export function buildPmsNote(b: BookingDetail, now: Date = new Date()): PmsNoteResult {
  const code = b.bookingCode?.trim();
  if (!code) return { ok: false, error: NO_CODE_MESSAGE };

  // Exactly one space after "BK" and between every token — collapse any accidental
  // run of spaces so the first line is always cleanly "BK <code>_… CI".
  const line1 = `BK ${code}_${roomsAbbreviation(b.rooms)}_${noteNights(b)} ĐÊM ${formatAmountCopy(
    b.totalAmount,
  )} ${paymentCode(b.paymentStatus)} CI`.replace(/ {2,}/g, ' ');

  // Breakfast comes from the branch's own configuration (Branch.breakfastIncluded),
  // which an Admin edits in "Khách sạn & chi nhánh" and which applies to every
  // branch alike. It is never inferred from a branch code, id or list position.
  const breakfast = b.branch?.breakfastIncluded === true;
  const arrival = arrivalNote(b.specialRequest);
  // For a partner booking the contact label (CÓ ZL / CÓ WA / NO CONTACT) is
  // replaced by "ĐƠN ĐỐI TÁC"; breakfast, date, arrival and requests are kept.
  const contact = b.businessType === 'PARTNER' ? 'ĐƠN ĐỐI TÁC' : contactLabel(b.phone);
  const line2 = `${breakfast ? 'ĂN SÁNG ' : ''}${hcmDayMonth(now)} ${contact}${
    arrival ? ` ${arrival}` : ''
  }`;

  return { ok: true, text: `${line1}\n${line2}` };
}

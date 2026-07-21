/**
 * Plain-text copy builders for the receptionist workflow.
 *
 * The receptionist re-types each dispatched booking into a separate hotel
 * system, so the exact copied text matters more than anything on screen.
 * These helpers produce deterministic, accent-preserving plain text — no
 * Markdown, no HTML, no JSON — matching the agreed field layout.
 *
 * Rules that this module guarantees:
 *   - Missing phone            -> "(Hiển thị số điện thoại)"
 *   - Missing nightly amount   -> "Chưa xác định"
 *   - Money uses Vietnamese thousand separators, prefixed with "VND"
 *   - Every room and every stay night appears
 *   - The check-out date is never emitted as a stay night (nights come from
 *     the backend, which already excludes it)
 */
import type { BookingDetail, PaymentStatus, RoomView } from '../api/bookings';

const MISSING_PHONE = '(Hiển thị số điện thoại)';
const MISSING_AMOUNT = 'Chưa xác định';
const MISSING_ROOM_TYPE = 'Chưa xác định';
const NO_NOTE = 'Không có';

const vnAmount = new Intl.NumberFormat('vi-VN');

const WEEKDAYS_VI = [
  'Chủ Nhật',
  'Thứ Hai',
  'Thứ Ba',
  'Thứ Tư',
  'Thứ Năm',
  'Thứ Sáu',
  'Thứ Bảy',
];

/** "VND 850.000", or "Chưa xác định" when the amount is unknown. */
export function copyMoney(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return MISSING_AMOUNT;
  return `VND ${vnAmount.format(amount)}`;
}

/** ISO "YYYY-MM-DD" -> "01/08/2026". */
export function copyDate(iso: string | null | undefined): string {
  if (!iso) return MISSING_AMOUNT;
  const [y, m, d] = iso.slice(0, 10).split('-');
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

/** ISO "YYYY-MM-DD" -> "Thứ Bảy, 01/08/2026" (weekday computed in UTC). */
export function copyDateFull(iso: string | null | undefined): string {
  if (!iso) return MISSING_AMOUNT;
  const date = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return copyDate(iso);
  return `${WEEKDAYS_VI[date.getUTCDay()]}, ${copyDate(iso)}`;
}

/** PAY_BEFORE -> "PAY BEFORE", PAY_AFTER -> "PAY AFTER". */
export function paymentCopyLabel(status: PaymentStatus): string {
  return status === 'PAY_BEFORE' ? 'PAY BEFORE' : 'PAY AFTER';
}

/** The phone value or the "(Hiển thị số điện thoại)" placeholder. */
export function copyPhone(phone: string | null | undefined): string {
  return phone && phone.trim().length > 0 ? phone.trim() : MISSING_PHONE;
}

/** The nightly-price lines for one room, e.g. "* Đêm 01/08/2026: VND 850.000". */
export function buildNightlyLines(room: RoomView): string[] {
  return room.nights.map((n) => `* Đêm ${copyDate(n.stayDate)}: ${copyMoney(n.amount)}`);
}

/** A complete "PHÒNG n" block: index, room type and every nightly line. */
export function buildRoomBlock(room: RoomView): string {
  return [
    `PHÒNG ${room.roomIndex}:`,
    `HẠNG PHÒNG: ${room.roomType?.trim() || MISSING_ROOM_TYPE}`,
    ...buildNightlyLines(room),
  ].join('\n');
}

/**
 * The full booking, formatted for one-click "Sao chép toàn bộ".
 * Kept as a flat line list so the exact structure is easy to verify in tests.
 */
export function buildFullCopy(b: BookingDetail): string {
  const lines: string[] = [
    `CHI NHÁNH: ${b.branch?.address ?? '—'}`,
    `NAME: ${b.customerName ?? '—'}`,
    `SDT: ${copyPhone(b.phone)}`,
    `MÃ BOOKING: ${b.bookingCode ?? '—'}`,
    `GIÁ TIỀN TỔNG: ${copyMoney(b.totalAmount)}`,
    `SỐ LƯỢNG PHÒNG: ${b.rooms.length}`,
    `NGÀY CHECK IN: ${copyDateFull(b.checkInDate)}`,
    `NGÀY CHECK OUT: ${copyDateFull(b.checkOutDate)}`,
    'GIÁ TIỀN CHO TỪNG ĐÊM CỦA TỪNG PHÒNG:',
  ];

  for (const room of b.rooms) {
    lines.push('');
    lines.push(buildRoomBlock(room));
  }

  lines.push('');
  lines.push(`GHI CHÚ: ${b.specialRequest?.trim() || NO_NOTE}`);
  lines.push('');
  lines.push(`TRẠNG THÁI: ${paymentCopyLabel(b.paymentStatus)}`);

  return lines.join('\n');
}

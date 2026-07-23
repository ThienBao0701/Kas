import type { BookingDetail, RoomView } from '../api/bookings';
import { formatViWeekdayDate, payStatusCopy } from './format';

/**
 * Plain-text copy builders for the receptionist. The output is deliberately
 * plain text — no Markdown, HTML or JSON — with Vietnamese accents and VND
 * grouping preserved, so it pastes cleanly into an external hotel system.
 */

const vnd = new Intl.NumberFormat('vi-VN');

/** Whole VND with grouping and a đồng sign, or "Chưa xác định" when unknown. */
export function copyMoney(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return 'Chưa xác định';
  return `${vnd.format(amount)} ₫`;
}

/** Phone as-is, or the agreed placeholder when Booking.com hid it. */
export function copyPhone(phone: string | null | undefined): string {
  return phone && phone.trim().length > 0 ? phone : '(Hiển thị số điện thoại)';
}

function copyDate(iso: string | null | undefined): string {
  return iso ? formatViWeekdayDate(iso) : 'Chưa xác định';
}

/** One "PHÒNG N" section: room type then one line per expected night. */
export function roomSection(room: RoomView, index: number): string {
  const lines = [
    `PHÒNG ${index}:`,
    `HẠNG PHÒNG: ${room.roomType && room.roomType.trim() ? room.roomType : 'Chưa xác định'}`,
  ];
  for (const night of room.nights) {
    const date = night.stayDate ? formatViWeekdayDate(night.stayDate).replace(/^.*, /, '') : 'Chưa xác định';
    lines.push(`* Đêm ${date}: ${copyMoney(night.amount)}`);
  }
  return lines.join('\n');
}

/** A single room block with its subtotal — the per-room "copy whole room" text. */
export function roomBlock(room: RoomView, index: number): string {
  return `${roomSection(room, index)}\nTẠM TÍNH PHÒNG: ${copyMoney(room.roomSubtotal)}`;
}

/** Just the nightly lines of a room, for "copy all nightly prices". */
export function roomNightsText(room: RoomView): string {
  return room.nights
    .map((n) => {
      const date = n.stayDate ? formatViWeekdayDate(n.stayDate).replace(/^.*, /, '') : 'Chưa xác định';
      return `* Đêm ${date}: ${copyMoney(n.amount)}`;
    })
    .join('\n');
}

/**
 * The full "Sao chép toàn bộ" block in the exact agreed layout. Shows every room
 * and every expected night; missing values render as "Chưa xác định".
 */
export function buildCopyAll(b: BookingDetail): string {
  const lines: string[] = [
    `CHI NHÁNH: ${b.branch ? b.branch.address : 'Chưa xác định'}`,
    `NAME: ${b.customerName ?? 'Chưa xác định'}`,
    `SDT: ${copyPhone(b.phone)}`,
    `MÃ BOOKING: ${b.bookingCode ?? 'Chưa xác định'}`,
    `GIÁ TIỀN TỔNG: ${copyMoney(b.totalAmount)}`,
    `NGÀY CHECK IN: ${copyDate(b.checkInDate)}`,
    `NGÀY CHECK OUT: ${copyDate(b.checkOutDate)}`,
    'GIÁ TIỀN CHO TỪNG ĐÊM CỦA TỪNG PHÒNG:',
    '',
  ];
  b.rooms.forEach((room, i) => {
    lines.push(roomSection(room, i + 1), '');
  });
  if (b.specialRequest && b.specialRequest.trim().length > 0) {
    lines.push(`YÊU CẦU ĐẶC BIỆT: ${b.specialRequest}`, '');
  }
  lines.push(`TRẠNG THÁI: ${payStatusCopy(b.paymentStatus)}`);
  return lines.join('\n');
}

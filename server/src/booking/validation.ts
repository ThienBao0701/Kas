import { generateStayDates } from './dates';

/**
 * Reusable booking validation shared by the "ready", "send" and edit flows.
 * Blocking errors stop a booking from advancing; warnings do not stop it but
 * must be acknowledged before sending. It never mutates the booking and never
 * invents data — it only inspects what is stored.
 */

export interface ValidationFinding {
  code: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationFinding[];
  warnings: ValidationFinding[];
}

interface ValidatableNight {
  stayDate: Date;
  amount: number | null;
}

interface ValidatableRoom {
  roomIndex: number;
  roomType: string | null;
  roomSubtotal: number | null;
  nights: ValidatableNight[];
}

export interface ValidatableBooking {
  status: string;
  branchId: number | null;
  bookingCode: string;
  customerName: string;
  phone: string | null;
  checkInDate: Date | null;
  checkOutDate: Date | null;
  totalAmount: number | null;
  rooms: ValidatableRoom[];
  warnings: { code: string }[];
}

export type ValidationIntent = 'ready' | 'send';

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function validateBooking(
  booking: ValidatableBooking,
  intent: ValidationIntent,
): ValidationResult {
  const errors: ValidationFinding[] = [];
  const warnings: ValidationFinding[] = [];
  const seenError = new Set<string>();
  const addError = (code: string, message: string): void => {
    if (seenError.has(code)) return;
    seenError.add(code);
    errors.push({ code, message });
  };

  // --- Blocking errors ------------------------------------------------------
  if (booking.status === 'COMPLETED') addError('ALREADY_COMPLETED', 'Đơn đã hoàn thành.');
  if (intent === 'send' && ['NEW', 'COMPLETED', 'ARCHIVED'].includes(booking.status)) {
    addError('ALREADY_SENT', 'Đơn đã được gửi trước đó.');
  }
  if (booking.branchId == null) addError('BRANCH_NOT_SELECTED', 'Chưa chọn chi nhánh.');
  if (booking.bookingCode.trim().length === 0) {
    addError('MISSING_BOOKING_CODE', 'Thiếu mã đặt phòng.');
  }
  if (booking.customerName.trim().length === 0) {
    addError('MISSING_CUSTOMER_NAME', 'Thiếu tên khách.');
  }
  if (!booking.checkInDate) addError('MISSING_CHECK_IN', 'Thiếu ngày nhận phòng.');
  if (!booking.checkOutDate) addError('MISSING_CHECK_OUT', 'Thiếu ngày trả phòng.');

  const ci = booking.checkInDate ? isoDate(booking.checkInDate) : null;
  const co = booking.checkOutDate ? isoDate(booking.checkOutDate) : null;
  const rangeValid = ci !== null && co !== null && co > ci;
  if (ci !== null && co !== null && co <= ci) {
    addError('INVALID_DATE_RANGE', 'Ngày trả phòng phải sau ngày nhận phòng.');
  }

  if (booking.rooms.length === 0) {
    addError('NO_ROOM', 'Chưa có phòng nào.');
  }
  const indices = new Set<number>();
  for (const room of booking.rooms) {
    if (indices.has(room.roomIndex)) {
      addError('DUPLICATE_ROOM_INDEX', 'Số thứ tự phòng bị trùng.');
    }
    indices.add(room.roomIndex);
  }

  if (rangeValid) {
    const expected = generateStayDates(ci, co);
    const expectedSet = new Set(expected);
    for (const room of booking.rooms) {
      const dates = room.nights.map((n) => isoDate(n.stayDate));
      const dateSet = new Set(dates);
      if (dateSet.has(co)) addError('CHECKOUT_AS_NIGHT', 'Ngày trả phòng không được là một đêm lưu trú.');
      if (dates.some((d) => !expectedSet.has(d))) {
        addError('NIGHT_OUTSIDE_RANGE', 'Có đêm lưu trú nằm ngoài khoảng thời gian ở.');
      }
      if (expected.some((d) => !dateSet.has(d))) {
        addError('MISSING_STAY_DATES', 'Thiếu một số đêm lưu trú theo khoảng thời gian ở.');
      }
    }
  }

  // --- Non-blocking warnings ------------------------------------------------
  if (!booking.phone || booking.phone.trim().length === 0) {
    warnings.push({ code: 'MISSING_PHONE', message: 'Thiếu số điện thoại của khách.' });
  }
  if (booking.totalAmount == null) {
    warnings.push({ code: 'MISSING_TOTAL', message: 'Thiếu tổng tiền của đơn.' });
  }
  if (booking.rooms.some((r) => r.nights.some((n) => n.amount === null))) {
    warnings.push({ code: 'NULL_NIGHTLY_PRICE', message: 'Có đêm chưa có giá.' });
  }
  if (booking.rooms.some((r) => !r.roomType || r.roomType.trim().length === 0)) {
    warnings.push({ code: 'MISSING_ROOM_TYPE', message: 'Có phòng chưa có loại phòng.' });
  }

  for (const room of booking.rooms) {
    const amounts = room.nights.map((n) => n.amount);
    if (room.roomSubtotal != null && amounts.length > 0 && amounts.every((a) => a !== null)) {
      const sum = amounts.reduce<number>((acc, a) => acc + (a ?? 0), 0);
      if (sum !== room.roomSubtotal) {
        warnings.push({
          code: 'NIGHTLY_SUBTOTAL_MISMATCH',
          message: `Phòng ${room.roomIndex}: tổng giá đêm không khớp với tạm tính phòng.`,
        });
      }
    }
  }

  const subtotals = booking.rooms.map((r) => r.roomSubtotal);
  if (booking.totalAmount != null && subtotals.length > 0 && subtotals.every((s) => s != null)) {
    const sum = subtotals.reduce<number>((acc, s) => acc + (s ?? 0), 0);
    if (sum !== booking.totalAmount) {
      warnings.push({
        code: 'ROOM_TOTAL_MISMATCH',
        message: 'Tổng tạm tính các phòng không khớp với tổng tiền của đơn.',
      });
    }
  }

  const extractCodes = new Set(booking.warnings.map((w) => w.code));
  if (extractCodes.has('UNKNOWN_HOTEL') || extractCodes.has('LOW_BRANCH_CONFIDENCE')) {
    warnings.push({
      code: 'LOW_CONFIDENCE_BRANCH',
      message: 'Chi nhánh có độ tin cậy thấp hoặc được chọn thủ công; vui lòng xác nhận.',
    });
  }
  if (booking.warnings.length > 0) {
    warnings.push({
      code: 'UNRESOLVED_EXTRACT_WARNINGS',
      message: 'Vẫn còn cảnh báo từ bước trích xuất chưa được xử lý.',
    });
  }

  return { valid: errors.length === 0, errors, warnings };
}

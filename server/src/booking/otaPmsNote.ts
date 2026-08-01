/**
 * The operator's exact PMS note for Agoda and CTrip bookings.
 *
 * This is a STRING CONTRACT, not a formatting preference: the receptionist
 * pastes the result straight into the hotel system, so every space, underscore
 * and separator below is deliberate and pinned by exact-string tests.
 *
 *   Agoda,  card payment (CN):
 *     AGD 1756162808_1SUP_4DEM 2.728.024 CN
 *     GIÁ KHÁCH ĐẶT 4.507.750 KHONG AN SANG
 *
 *   Agoda,  hotel payment — ONE line, nothing appended:
 *     AGD 1756162808_1SUP_4DEM 2.728.024 THANH TOÁN KHÁCH SẠN
 *
 *   CTrip,  card payment (CN):
 *     CTRIP_1658113703317875_1STAN_7DEM 4.645.956 CN
 *     GIÁ KHÁCH ĐẶT 6.637.080 KHONG AN SANG
 *
 *   CTrip,  hotel payment — ONE line, nothing appended:
 *     CTRIP_1658113703317875_1STAN_7DEM 4.645.956 THANH TOÁN KHÁCH SẠN
 *
 * Two prefix differences that are easy to get wrong and are asserted directly:
 *   - "AGD" is followed by a SPACE before the booking code.
 *   - "CTRIP" is followed IMMEDIATELY by an underscore, with no space.
 *
 * Booking.com notes are NOT produced here. That format is different, already
 * operational, and lives in `client/src/lib/pmsNote.ts`; nothing in this module
 * is reachable from the Booking.com path.
 */

/** Which platform's note layout to produce. */
export type OtaNoteSource = 'AGODA' | 'CTRIP';

/**
 * How the guest pays, as the operator words it.
 * CN            = settled by card/OTA; the note carries the guest-booked price.
 * HOTEL_PAYMENT = collected at the hotel; the note is a single line.
 */
export type OtaPaymentMode = 'CN' | 'HOTEL_PAYMENT';

/** The exact Vietnamese wording. "THANH TOÁN KHÁCH SẠN" — never "TẠI". */
export const OTA_PAYMENT_LABEL: Record<OtaPaymentMode, string> = {
  CN: 'CN',
  HOTEL_PAYMENT: 'THANH TOÁN KHÁCH SẠN',
};

/** The confirmed no-breakfast wording. */
export const NO_BREAKFAST_TEXT = 'KHONG AN SANG';

/** One room line: how many rooms of one resolved internal code. */
export interface OtaNoteRoomLine {
  quantity: number;
  /** The branch's internal PMS code. Null when the mapping is unresolved. */
  pmsCode: string | null;
}

export interface OtaNoteInput {
  source: OtaNoteSource;
  bookingCode: string | null;
  rooms: OtaNoteRoomLine[];
  nights: number | null;
  /** What the branch receives. Agoda: Net rate. CTrip: Your payout. */
  branchPrice: number | null;
  /** What the guest paid. Agoda: Reference sell rate. CTrip: Original room rate. */
  guestBookedPrice: number | null;
  paymentMode: OtaPaymentMode;
  /**
   * Whether breakfast is included. Only `false` has confirmed note wording; a
   * `true` value has no approved phrase yet, so the note is refused rather than
   * inventing one.
   */
  breakfastIncluded: boolean;
}

export type OtaNoteResult =
  | { ok: true; text: string }
  | { ok: false; error: string };

/** VND with dot thousands separators: 2728024 -> "2.728.024". */
export function formatVndDots(amount: number): string {
  return Math.round(amount)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/**
 * "_2SUP_1DEL" — one fragment per room line, in the order given.
 *
 * Different room types are NEVER merged, even when they share a code by
 * coincidence: the operator reads the fragments as the physical room list.
 */
function roomFragments(rooms: OtaNoteRoomLine[]): string {
  return rooms.map((r) => `${r.quantity}${r.pmsCode}`).join('_');
}

/**
 * Builds the note, or explains exactly what is missing.
 *
 * Nothing is guessed: an absent price, an unresolved room mapping or a missing
 * booking code produces a refusal naming the field, because a note built on a
 * guess would be pasted into the hotel system as if it were fact.
 */
export function buildOtaPmsNote(input: OtaNoteInput): OtaNoteResult {
  const missing: string[] = [];

  if (!input.bookingCode || input.bookingCode.trim().length === 0) {
    missing.push(input.source === 'AGODA' ? 'Booking ID' : 'mã đặt phòng');
  }
  if (input.rooms.length === 0) missing.push('hạng phòng');
  if (input.rooms.some((r) => !r.pmsCode)) missing.push('mã hạng phòng nội bộ');
  if (input.rooms.some((r) => !Number.isInteger(r.quantity) || r.quantity <= 0)) {
    missing.push('số lượng phòng');
  }
  if (input.nights == null || input.nights <= 0) missing.push('số đêm');
  if (input.branchPrice == null) {
    missing.push(input.source === 'AGODA' ? 'Net rate' : 'Your payout');
  }
  // The guest-booked price is only ever RENDERED on a CN note, so it is only
  // ever REQUIRED for one.
  if (input.paymentMode === 'CN' && input.guestBookedPrice == null) {
    missing.push(input.source === 'AGODA' ? 'Reference sell rate' : 'Original room rate');
  }
  // No positive-breakfast wording has been approved. Refusing is the honest
  // outcome; inventing a phrase would put unapproved text in front of a guest.
  if (input.paymentMode === 'CN' && input.breakfastIncluded) {
    missing.push('nội dung ăn sáng (chưa được duyệt)');
  }

  if (missing.length > 0) {
    return {
      ok: false,
      error: `Chưa đủ dữ liệu để tạo ghi chú: ${missing.join(', ')}.`,
    };
  }

  const prefix =
    input.source === 'AGODA'
      ? `AGD ${input.bookingCode}` // one space after AGD
      : `CTRIP_${input.bookingCode}`; // underscore immediately after CTRIP

  const line1 =
    `${prefix}_${roomFragments(input.rooms)}_${input.nights}DEM ` +
    `${formatVndDots(input.branchPrice!)} ${OTA_PAYMENT_LABEL[input.paymentMode]}`;

  // A hotel-payment note is exactly one line: no guest-booked price, no
  // breakfast suffix, no trailing newline.
  if (input.paymentMode === 'HOTEL_PAYMENT') {
    return { ok: true, text: line1 };
  }

  const line2 = `GIÁ KHÁCH ĐẶT ${formatVndDots(input.guestBookedPrice!)} ${NO_BREAKFAST_TEXT}`;
  return { ok: true, text: `${line1}\n${line2}` };
}

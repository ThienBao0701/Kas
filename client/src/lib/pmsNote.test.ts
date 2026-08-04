import { describe, expect, it } from 'vitest';
import type { BookingDetail, RoomView } from '../api/bookings';
import {
  abbreviateRoomType,
  arrivalNote,
  buildPmsNote,
  contactLabel,
  noteNights,
  roomsAbbreviation,
} from './pmsNote';

// A fixed "now": 22 July 2026, 03:00 UTC = 10:00 in Asia/Ho_Chi_Minh → 22/07.
const NOW = new Date('2026-07-22T03:00:00.000Z');

function nightRow(stayDate: string, amount: number | null): RoomView['nights'][number] {
  return { id: stayDate, stayDate, amount, currency: 'VND', manuallyCorrected: false, isEstimated: false };
}

function room(roomType: string | null, nights = 1): RoomView {
  return {
    id: `r-${roomType}`,
    roomIndex: 1,
    roomType,
    roomSubtotal: null,
    taxAmount: null,
    feeAmount: null,
    nights: Array.from({ length: nights }, (_, i) => nightRow(`2026-07-${22 + i}`, 609_120)),
  };
}

function booking(overrides: Partial<BookingDetail> = {}): BookingDetail {
  return {
    id: 'b1',
    status: 'NEW',
    sourcePlatform: 'BOOKING_COM',
    verificationStatus: 'NOT_SUBMITTED',
    businessType: 'DIRECT',
    businessTypeManuallyConfirmed: false,
    hotelName: 'H',
    branch: { id: 1, code: 'TRUONG_DINH_05', hotelName: 'H', address: '05 Trương Định' },
    branchId: 1,
    customerName: 'Khách',
    phone: null,
    bookingCode: '6037224525',
    checkInDate: '2026-07-22',
    checkOutDate: '2026-07-23',
    checkInTime: null,
    checkOutTime: null,
    totalAmount: 609_120,
    currency: 'VND',
    paymentStatus: 'PAY_AFTER',
    specialRequest: null,
    parserVersion: '4a',
    isLastMinute: false,
    rooms: [room('Standard Double Room')],
    warnings: [],
    statusHistory: [],
    // 5.2b: a Booking.com fixture collects no Admin note, so both are null.
    adminPmsNote: null,
    reviewedPaymentMode: null,
    // Phase 5 operational blocks — a Booking.com fixture stores none of the
    // OTA metadata, exactly as the database does.
    ota: {
      sourcePlatform: 'BOOKING_COM',
      sourcePropertyId: null,
      otaBookingStatus: null,
      ratePlanName: null,
      cancellationPolicy: null,
      countryOfResidence: null,
      websiteLanguage: null,
      paymentType: null,
      benefitsIncluded: null,
      parserVersion: null,
      reviewVersion: null,
      rawTextSha256: null,
    },
    operational: {
      receivedAt: null,
      receivedBy: null,
      actualCheckInAt: null,
      checkedInBy: null,
      actualCheckOutAt: null,
      checkedOutBy: null,
      cancelledAt: null,
      cancelledBy: null,
      cancellationReason: null,
    },
    corrections: [],
    timeline: [],
    proofs: [],
    createdBy: null,
    sentBy: null,
    completedBy: null,
    reviewedBy: null,
    createdAt: '2026-07-22T00:00:00.000Z',
    updatedAt: '2026-07-22T00:00:00.000Z',
    sentAt: '2026-07-22T00:00:00.000Z',
    completedAt: null,
    completionNote: null,
    reviewedAt: null,
    ...overrides,
  };
}

describe('room-class snapshot (C.3.8)', () => {
  /** A room carrying the immutable branch room-class snapshot. */
  function snapshotRoom(sourceText: string, pmsCode: string): RoomView {
    return {
      ...room(sourceText),
      roomClassPmsCode: pmsCode,
      roomClassDisplayName: sourceText,
      roomClassStatus: 'RESOLVED',
    };
  }

  it('uses the stored branch-specific code instead of the global keyword table', () => {
    // "Premium" is not in the legacy table at all — only the snapshot knows it.
    expect(roomsAbbreviation([snapshotRoom('Premium', 'LUXDEL')])).toBe('LUXDEL');
    // Where the two disagree the snapshot wins: the legacy table maps any
    // "deluxe" to DLX, but this branch's configured code is DEBAL.
    expect(roomsAbbreviation([snapshotRoom('Deluxe-Bal', 'DEBAL')])).toBe('DEBAL');
    expect(abbreviateRoomType('Deluxe-Bal')).toBe('DLX');
  });

  it('keeps the legacy abbreviation for a room with no snapshot', () => {
    // Pre-C.3.8 bookings must produce exactly the note they always produced.
    expect(roomsAbbreviation([room('Phòng Tiêu Chuẩn Giường Đôi')])).toBe('STAN');
    expect(roomsAbbreviation([room('Superior Twin')])).toBe('SUP');
  });

  it('groups and counts snapshot codes like any other', () => {
    expect(roomsAbbreviation([snapshotRoom('Premium', 'LUXDEL'), snapshotRoom('Premium', 'LUXDEL')]))
      .toBe('LUXDELx2');
    expect(roomsAbbreviation([snapshotRoom('King Bal', 'KINGBAL'), room('Standard')]))
      .toBe('KINGBAL+STAN');
  });

  it('an existing note is unaffected by a later mapping change', () => {
    // The booking stores LUXDEL; whatever the branch mapping says today, the
    // note still prints LUXDEL because nothing ever recomputes it.
    const b = booking({ rooms: [snapshotRoom('Premium', 'LUXDEL')] });
    expect(buildPmsNote(b, NOW).text).toContain('_LUXDEL_');
  });
});

describe('abbreviateRoomType — most-specific wins', () => {
  it('resolves a Standard Double to STAN, not DBL', () => {
    expect(abbreviateRoomType('Phòng Tiêu Chuẩn Giường Đôi')).toBe('STAN');
    expect(abbreviateRoomType('Standard Double Room')).toBe('STAN');
  });

  it('maps the common room classes', () => {
    expect(abbreviateRoomType('Superior')).toBe('SUP');
    expect(abbreviateRoomType('Deluxe King')).toBe('DLX');
    expect(abbreviateRoomType('Executive Suite')).toBe('SUITE');
    expect(abbreviateRoomType('Family Room')).toBe('FAM');
    expect(abbreviateRoomType('Twin Room')).toBe('TWIN');
    expect(abbreviateRoomType('Double Room')).toBe('DBL');
  });

  it('never returns empty for an unknown type', () => {
    expect(abbreviateRoomType('Bungalow')).toBe('BUNG');
    expect(abbreviateRoomType('')).toBe('PHONG');
    expect(abbreviateRoomType(null)).toBe('PHONG');
  });
});

describe('roomsAbbreviation — multiple rooms are never dropped', () => {
  it('collapses identical types with a count', () => {
    expect(roomsAbbreviation([room('Standard'), room('Standard')])).toBe('STANx2');
  });
  it('joins different types with +', () => {
    expect(roomsAbbreviation([room('Standard'), room('Deluxe')])).toBe('STAN+DLX');
  });
});

describe('noteNights', () => {
  it('uses the date range (check-out exclusive)', () => {
    expect(noteNights({ checkInDate: '2026-07-23', checkOutDate: '2026-07-24', rooms: [] })).toBe(1);
    expect(noteNights({ checkInDate: '2026-07-22', checkOutDate: '2026-07-24', rooms: [] })).toBe(2);
  });
  it('falls back to nightly rows only when dates are unusable', () => {
    expect(noteNights({ checkInDate: null, checkOutDate: null, rooms: [room('Standard', 3)] })).toBe(3);
  });
});

describe('contactLabel', () => {
  it('classifies Vietnamese numbers as CÓ ZL', () => {
    expect(contactLabel('+84 901 234 567')).toBe('CÓ ZL');
    expect(contactLabel('0901 234 567')).toBe('CÓ ZL');
  });
  it('classifies foreign numbers as CÓ WA', () => {
    expect(contactLabel('+64 210 812 1300')).toBe('CÓ WA');
    expect(contactLabel('0064 21 555 000')).toBe('CÓ WA');
  });
  it('returns NO CONTACT when absent', () => {
    expect(contactLabel(null)).toBe('NO CONTACT');
    expect(contactLabel('   ')).toBe('NO CONTACT');
  });
});

describe('arrivalNote', () => {
  it('extracts a concise arrival time', () => {
    expect(arrivalNote('Khách dự kiến đến khoảng 13:00.')).toBe('KHÁCH ĐẾN KHOẢNG 13:00');
    expect(arrivalNote('Khách đến lúc 22:30.')).toBe('KHÁCH ĐẾN LÚC 22:30');
  });
  it('appends nothing without arrival-time info', () => {
    expect(arrivalNote('Yêu cầu phòng tầng cao, thêm giường.')).toBe('');
    expect(arrivalNote(null)).toBe('');
  });
});

describe('buildPmsNote — exact output', () => {
  it('A — no breakfast, no phone', () => {
    const res = buildPmsNote(booking(), NOW);
    expect(res.ok).toBe(true);
    expect(res.text).toBe('BK 6037224525_STAN_1 ĐÊM 609.120 PAY AFTER CHECK-IN CI\n22/07 NO CONTACT');
  });

  it('B — breakfast branch, Vietnamese phone', () => {
    const res = buildPmsNote(
      booking({
        bookingCode: '6339476198',
        branch: { id: 2, code: 'LY_TU_TRONG_260', hotelName: 'L', address: '260 Lý Tự Trọng', breakfastIncluded: true },
        totalAmount: 510_138,
        paymentStatus: 'PAY_BEFORE',
        phone: '+84 901 234 567',
      }),
      NOW,
    );
    expect(res.text).toBe('BK 6339476198_STAN_1 ĐÊM 510.138 PAY BEFORE CHECK-IN CI\nĂN SÁNG 22/07 CÓ ZL');
  });

  it('C — breakfast branch, foreign phone and arrival note', () => {
    const res = buildPmsNote(
      booking({
        bookingCode: '6339476198',
        branch: { id: 3, code: 'NGUYEN_TRAI_47A', hotelName: 'L', address: '47A Nguyễn Trãi', breakfastIncluded: true },
        totalAmount: 510_138,
        paymentStatus: 'PAY_BEFORE',
        phone: '+64 210 812 1300',
        specialRequest: 'Khách dự kiến đến khoảng 13:00.',
      }),
      NOW,
    );
    expect(res.text).toBe(
      'BK 6339476198_STAN_1 ĐÊM 510.138 PAY BEFORE CHECK-IN CI\nĂN SÁNG 22/07 CÓ WA KHÁCH ĐẾN KHOẢNG 13:00',
    );
  });

  it('D — non-breakfast branch, two-night Deluxe, foreign phone', () => {
    const res = buildPmsNote(
      booking({
        bookingCode: '6339476198',
        checkInDate: '2026-07-22',
        checkOutDate: '2026-07-24',
        totalAmount: 1_200_000,
        rooms: [room('Deluxe King', 2)],
        phone: '+64 210 812 1300',
      }),
      NOW,
    );
    expect(res.text).toBe('BK 6339476198_DLX_2 ĐÊM 1.200.000 PAY AFTER CHECK-IN CI\n22/07 CÓ WA');
  });

  it('E — PARTNER booking replaces the contact label with ĐƠN ĐỐI TÁC (breakfast kept)', () => {
    const res = buildPmsNote(
      booking({
        bookingCode: '6339476198',
        branch: { id: 2, code: 'LY_TU_TRONG_260', hotelName: 'L', address: '260 Lý Tự Trọng', breakfastIncluded: true },
        totalAmount: 510_138,
        paymentStatus: 'PAY_AFTER',
        phone: '+84 901 234 567',
        businessType: 'PARTNER',
      }),
      NOW,
    );
    // No CÓ ZL / CÓ WA / NO CONTACT for a partner; breakfast + date preserved.
    expect(res.text).toBe('BK 6339476198_STAN_1 ĐÊM 510.138 PAY AFTER CHECK-IN CI\nĂN SÁNG 22/07 ĐƠN ĐỐI TÁC');
    expect(res.text).not.toContain('CÓ ZL');
    expect(res.text).not.toContain('CÓ WA');
    expect(res.text).not.toContain('NO CONTACT');
  });

  it('F — PARTNER booking keeps the arrival note after ĐƠN ĐỐI TÁC', () => {
    const res = buildPmsNote(
      booking({
        bookingCode: '6339476198',
        branch: { id: 3, code: 'NGUYEN_TRAI_47A', hotelName: 'L', address: '47A Nguyễn Trãi', breakfastIncluded: true },
        totalAmount: 510_138,
        paymentStatus: 'PAY_BEFORE',
        phone: '+84 901 234 567',
        businessType: 'PARTNER',
        specialRequest: 'Khách dự kiến đến khoảng 13:00.',
      }),
      NOW,
    );
    expect(res.text).toBe(
      'BK 6339476198_STAN_1 ĐÊM 510.138 PAY BEFORE CHECK-IN CI\nĂN SÁNG 22/07 ĐƠN ĐỐI TÁC KHÁCH ĐẾN KHOẢNG 13:00',
    );
  });

  // ------------------------------------------------------------------
  // Breakfast is branch CONFIGURATION, not a branch code.
  //
  // These two cases are the regression guard: the note used to be driven by a
  // hardcoded set of three branch codes, so an Admin toggling "phục vụ ăn sáng"
  // in branch management changed nothing. Each case pairs a branch code with
  // the OPPOSITE of what that old table said, so the assertions can only pass
  // if Branch.breakfastIncluded is what decides. They also prove the behaviour
  // is available to every branch, not a privileged three.
  // ------------------------------------------------------------------
  it('B1 — a historically-breakfast branch code with breakfastIncluded=false gets NO ĂN SÁNG', () => {
    const res = buildPmsNote(
      booking({
        branch: {
          id: 2,
          code: 'LY_TU_TRONG_260',
          hotelName: 'L',
          address: '260 Lý Tự Trọng',
          breakfastIncluded: false,
        },
      }),
      NOW,
    );
    expect(res.text).not.toContain('ĂN SÁNG');
    expect(res.text!.split('\n')[1]).toBe('22/07 NO CONTACT');
  });

  it('B2 — any other branch with breakfastIncluded=true gets ĂN SÁNG', () => {
    const res = buildPmsNote(
      booking({
        branch: {
          id: 8,
          code: 'LE_THANH_TON_191',
          hotelName: 'D',
          address: '191 Lê Thánh Tôn',
          breakfastIncluded: true,
        },
      }),
      NOW,
    );
    expect(res.text!.split('\n')[1]).toBe('ĂN SÁNG 22/07 NO CONTACT');
  });

  it('B3 — a branch payload without the field is treated as no breakfast', () => {
    // Older cached payloads may predate the field; absence must never be read
    // as "serves breakfast".
    const res = buildPmsNote(booking(), NOW);
    expect(res.text).not.toContain('ĂN SÁNG');
  });

  it('G — first line has exactly one space after "BK" (never "BK<digit>")', () => {
    const res = buildPmsNote(booking(), NOW);
    const line1 = res.text!.split('\n')[0]!;
    expect(line1.startsWith('BK ')).toBe(true);
    expect(line1).not.toMatch(/^BK {2,}/); // no double space
    expect(line1).not.toMatch(/^BK\d/); // never glued to the code
    // Even a code with stray whitespace normalises to one space.
    const padded = buildPmsNote(booking({ bookingCode: '  6037224525  ' }), NOW);
    expect(padded.text!.split('\n')[0]).toMatch(/^BK 6037224525_/);
  });

  it('blocks generation when the booking code is missing', () => {
    const res = buildPmsNote(booking({ bookingCode: null }), NOW);
    expect(res.ok).toBe(false);
    expect(res.error).toBe('Chưa có mã Booking để tạo ghi chú.');
  });
});

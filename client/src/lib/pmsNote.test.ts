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
    createdBy: null,
    sentBy: null,
    completedBy: null,
    createdAt: '2026-07-22T00:00:00.000Z',
    updatedAt: '2026-07-22T00:00:00.000Z',
    sentAt: '2026-07-22T00:00:00.000Z',
    completedAt: null,
    completionNote: null,
    ...overrides,
  };
}

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
    expect(res.text).toBe('BK 6037224525_STAN_1 ĐÊM 609.120 PAY AFTER CI\n22/07 NO CONTACT');
  });

  it('B — breakfast branch, Vietnamese phone', () => {
    const res = buildPmsNote(
      booking({
        bookingCode: '6339476198',
        branch: { id: 2, code: 'LY_TU_TRONG_260', hotelName: 'L', address: '260 Lý Tự Trọng' },
        totalAmount: 510_138,
        paymentStatus: 'PAY_BEFORE',
        phone: '+84 901 234 567',
      }),
      NOW,
    );
    expect(res.text).toBe('BK 6339476198_STAN_1 ĐÊM 510.138 PAY BEFORE CI\nĂN SÁNG 22/07 CÓ ZL');
  });

  it('C — breakfast branch, foreign phone and arrival note', () => {
    const res = buildPmsNote(
      booking({
        bookingCode: '6339476198',
        branch: { id: 3, code: 'NGUYEN_TRAI_47A', hotelName: 'L', address: '47A Nguyễn Trãi' },
        totalAmount: 510_138,
        paymentStatus: 'PAY_BEFORE',
        phone: '+64 210 812 1300',
        specialRequest: 'Khách dự kiến đến khoảng 13:00.',
      }),
      NOW,
    );
    expect(res.text).toBe(
      'BK 6339476198_STAN_1 ĐÊM 510.138 PAY BEFORE CI\nĂN SÁNG 22/07 CÓ WA KHÁCH ĐẾN KHOẢNG 13:00',
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
    expect(res.text).toBe('BK 6339476198_DLX_2 ĐÊM 1.200.000 PAY AFTER CI\n22/07 CÓ WA');
  });

  it('blocks generation when the booking code is missing', () => {
    const res = buildPmsNote(booking({ bookingCode: null }), NOW);
    expect(res.ok).toBe(false);
    expect(res.error).toBe('Chưa có mã Booking để tạo ghi chú.');
  });
});

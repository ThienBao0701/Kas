import { describe, expect, it } from 'vitest';
import type { BookingDetail, RoomView } from '../api/bookings';
import {
  buildFullCopy,
  buildNightlyLines,
  buildRoomBlock,
  copyDateFull,
  copyMoney,
  copyPhone,
  paymentCopyLabel,
} from './bookingCopy';

function room(overrides: Partial<RoomView> = {}): RoomView {
  return {
    id: 'r1',
    roomIndex: 1,
    roomType: 'Deluxe Double Room',
    roomSubtotal: 1_700_000,
    taxAmount: null,
    feeAmount: null,
    nights: [
      { id: 'n1', stayDate: '2026-08-01', amount: 850_000, currency: 'VND', manuallyCorrected: false, isEstimated: false },
      { id: 'n2', stayDate: '2026-08-02', amount: 850_000, currency: 'VND', manuallyCorrected: false, isEstimated: false },
    ],
    ...overrides,
  };
}

function booking(overrides: Partial<BookingDetail> = {}): BookingDetail {
  return {
    id: 'b1',
    status: 'NEW',
    hotelName: 'Saigon Hotel',
    branch: { id: 1, code: 'LY_TU_TRONG_260', hotelName: 'Saigon Hotel', address: '260 Lý Tự Trọng' },
    branchId: 1,
    customerName: 'Nguyễn Văn A',
    phone: '0901234567',
    bookingCode: '489234523',
    checkInDate: '2026-08-01',
    checkOutDate: '2026-08-03',
    checkInTime: null,
    checkOutTime: null,
    totalAmount: 1_700_000,
    currency: 'VND',
    paymentStatus: 'PAY_AFTER',
    specialRequest: null,
    parserVersion: '4a',
    isLastMinute: false,
    rooms: [room()],
    warnings: [],
    statusHistory: [],
    createdBy: null,
    sentBy: null,
    completedBy: null,
    createdAt: '2026-07-30T02:00:00.000Z',
    updatedAt: '2026-07-30T02:00:00.000Z',
    sentAt: '2026-07-30T02:00:00.000Z',
    completedAt: null,
    completionNote: null,
    ...overrides,
  };
}

describe('copy primitives', () => {
  it('formats money with Vietnamese separators and a VND prefix', () => {
    expect(copyMoney(850_000)).toBe('VND 850.000');
    expect(copyMoney(1_700_000)).toBe('VND 1.700.000');
  });

  it('renders a missing amount as "Chưa xác định"', () => {
    expect(copyMoney(null)).toBe('Chưa xác định');
    expect(copyMoney(undefined)).toBe('Chưa xác định');
  });

  it('formats the full date with a Vietnamese weekday', () => {
    // 2026-08-01 is a Saturday.
    expect(copyDateFull('2026-08-01')).toBe('Thứ Bảy, 01/08/2026');
  });

  it('maps payment status to PAY BEFORE / PAY AFTER', () => {
    expect(paymentCopyLabel('PAY_BEFORE')).toBe('PAY BEFORE');
    expect(paymentCopyLabel('PAY_AFTER')).toBe('PAY AFTER');
  });

  it('replaces a missing phone with the reveal placeholder', () => {
    expect(copyPhone(null)).toBe('(Hiển thị số điện thoại)');
    expect(copyPhone('  ')).toBe('(Hiển thị số điện thoại)');
    expect(copyPhone('0901234567')).toBe('0901234567');
  });
});

describe('buildNightlyLines / buildRoomBlock', () => {
  it('emits one line per stay night', () => {
    expect(buildNightlyLines(room())).toEqual([
      '* Đêm 01/08/2026: VND 850.000',
      '* Đêm 02/08/2026: VND 850.000',
    ]);
  });

  it('shows "Chưa xác định" for a missing nightly amount', () => {
    const r = room({
      nights: [
        { id: 'n1', stayDate: '2026-08-01', amount: null, currency: 'VND', manuallyCorrected: false, isEstimated: false },
      ],
    });
    expect(buildNightlyLines(r)).toEqual(['* Đêm 01/08/2026: Chưa xác định']);
  });

  it('builds a full room block with type and nights', () => {
    expect(buildRoomBlock(room({ roomIndex: 2, roomType: 'Superior' }))).toBe(
      ['PHÒNG 2:', 'HẠNG PHÒNG: Superior', '* Đêm 01/08/2026: VND 850.000', '* Đêm 02/08/2026: VND 850.000'].join('\n'),
    );
  });

  it('falls back to "Chưa xác định" for a missing room type', () => {
    expect(buildRoomBlock(room({ roomType: null }))).toContain('HẠNG PHÒNG: Chưa xác định');
  });
});

describe('buildFullCopy — exact "Sao chép toàn bộ" output', () => {
  it('produces the agreed structure for a two-room booking', () => {
    const b = booking({
      specialRequest: 'Yêu cầu phòng tầng cao',
      rooms: [
        room({ roomIndex: 1, roomType: 'Deluxe Double Room' }),
        room({
          id: 'r2',
          roomIndex: 2,
          roomType: 'Standard Twin',
          nights: [
            { id: 'm1', stayDate: '2026-08-01', amount: 700_000, currency: 'VND', manuallyCorrected: false, isEstimated: false },
            { id: 'm2', stayDate: '2026-08-02', amount: null, currency: 'VND', manuallyCorrected: false, isEstimated: false },
          ],
        }),
      ],
    });

    expect(buildFullCopy(b)).toBe(
      [
        'CHI NHÁNH: 260 Lý Tự Trọng',
        'NAME: Nguyễn Văn A',
        'SDT: 0901234567',
        'MÃ BOOKING: 489234523',
        'GIÁ TIỀN TỔNG: VND 1.700.000',
        'SỐ LƯỢNG PHÒNG: 2',
        'NGÀY CHECK IN: Thứ Bảy, 01/08/2026',
        'NGÀY CHECK OUT: Thứ Hai, 03/08/2026',
        'GIÁ TIỀN CHO TỪNG ĐÊM CỦA TỪNG PHÒNG:',
        '',
        'PHÒNG 1:',
        'HẠNG PHÒNG: Deluxe Double Room',
        '* Đêm 01/08/2026: VND 850.000',
        '* Đêm 02/08/2026: VND 850.000',
        '',
        'PHÒNG 2:',
        'HẠNG PHÒNG: Standard Twin',
        '* Đêm 01/08/2026: VND 700.000',
        '* Đêm 02/08/2026: Chưa xác định',
        '',
        'GHI CHÚ: Yêu cầu phòng tầng cao',
        '',
        'TRẠNG THÁI: PAY AFTER',
      ].join('\n'),
    );
  });

  it('uses placeholders for a missing phone and note', () => {
    const text = buildFullCopy(booking({ phone: null, specialRequest: null, paymentStatus: 'PAY_BEFORE' }));
    expect(text).toContain('SDT: (Hiển thị số điện thoại)');
    expect(text).toContain('GHI CHÚ: Không có');
    expect(text).toContain('TRẠNG THÁI: PAY BEFORE');
  });

  it('never emits the check-out date as a stay night', () => {
    // Check-out is 2026-08-03; nights only cover 01 and 02.
    const text = buildFullCopy(booking());
    expect(text).not.toContain('Đêm 03/08/2026');
  });
});

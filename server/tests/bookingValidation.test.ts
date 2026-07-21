import { describe, expect, it } from 'vitest';
import { validateBooking, type ValidatableBooking } from '../src/booking/validation';

function utc(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

function base(overrides: Partial<ValidatableBooking> = {}): ValidatableBooking {
  return {
    status: 'DRAFT',
    branchId: 1,
    bookingCode: '1234567890',
    customerName: 'Nguyễn Văn A',
    phone: '0901234567',
    checkInDate: utc('2026-07-19'),
    checkOutDate: utc('2026-07-22'),
    totalAmount: 2_550_000,
    rooms: [
      {
        roomIndex: 1,
        roomType: 'Deluxe Double Room',
        roomSubtotal: 2_550_000,
        nights: [
          { stayDate: utc('2026-07-19'), amount: 850_000 },
          { stayDate: utc('2026-07-20'), amount: 850_000 },
          { stayDate: utc('2026-07-21'), amount: 850_000 },
        ],
      },
    ],
    warnings: [],
    ...overrides,
  };
}

function errorCodes(b: ValidatableBooking) {
  return validateBooking(b, 'send').errors.map((e) => e.code);
}
function warningCodes(b: ValidatableBooking) {
  return validateBooking(b, 'send').warnings.map((w) => w.code);
}

describe('validateBooking — blocking errors', () => {
  it('accepts a complete booking', () => {
    const result = validateBooking(base(), 'send');
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('flags a missing branch', () => {
    expect(errorCodes(base({ branchId: null }))).toContain('BRANCH_NOT_SELECTED');
  });

  it('flags missing code, customer and dates', () => {
    const codes = errorCodes(base({ bookingCode: '  ', customerName: '', checkInDate: null, checkOutDate: null }));
    expect(codes).toContain('MISSING_BOOKING_CODE');
    expect(codes).toContain('MISSING_CUSTOMER_NAME');
    expect(codes).toContain('MISSING_CHECK_IN');
    expect(codes).toContain('MISSING_CHECK_OUT');
  });

  it('flags an inverted date range', () => {
    expect(errorCodes(base({ checkInDate: utc('2026-07-22'), checkOutDate: utc('2026-07-19') }))).toContain(
      'INVALID_DATE_RANGE',
    );
  });

  it('flags a missing expected stay date', () => {
    const b = base();
    b.rooms[0]!.nights = b.rooms[0]!.nights.slice(0, 2); // drop 2026-07-21
    expect(errorCodes(b)).toContain('MISSING_STAY_DATES');
  });

  it('flags the check-out date used as a stay night and out-of-range nights', () => {
    const b = base();
    b.rooms[0]!.nights.push({ stayDate: utc('2026-07-22'), amount: 100 }); // check-out night
    const codes = errorCodes(b);
    expect(codes).toContain('CHECKOUT_AS_NIGHT');
    expect(codes).toContain('NIGHT_OUTSIDE_RANGE');
  });

  it('flags a duplicate room index and no rooms', () => {
    const dup = base();
    dup.rooms = [dup.rooms[0]!, { ...dup.rooms[0]!, roomType: 'Twin' }];
    expect(errorCodes(dup)).toContain('DUPLICATE_ROOM_INDEX');
    expect(errorCodes(base({ rooms: [] }))).toContain('NO_ROOM');
  });
});

describe('validateBooking — non-blocking warnings', () => {
  it('warns without blocking on missing phone/total/nightly/room-type', () => {
    const b = base({ phone: null, totalAmount: null });
    b.rooms[0]!.roomType = null;
    b.rooms[0]!.nights[1]!.amount = null;
    const result = validateBooking(b, 'send');
    expect(result.valid).toBe(true); // warnings never block on their own
    const codes = result.warnings.map((w) => w.code);
    expect(codes).toContain('MISSING_PHONE');
    expect(codes).toContain('MISSING_TOTAL');
    expect(codes).toContain('NULL_NIGHTLY_PRICE');
    expect(codes).toContain('MISSING_ROOM_TYPE');
  });

  it('warns when nightly totals do not reconcile with the room subtotal', () => {
    const b = base();
    b.rooms[0]!.roomSubtotal = 9_999_999;
    expect(warningCodes(b)).toContain('NIGHTLY_SUBTOTAL_MISMATCH');
  });

  it('warns when room subtotals do not reconcile with the booking total', () => {
    expect(warningCodes(base({ totalAmount: 1 }))).toContain('ROOM_TOTAL_MISMATCH');
  });

  it('surfaces unresolved extraction warnings and low branch confidence', () => {
    const b = base({ warnings: [{ code: 'LOW_BRANCH_CONFIDENCE' }] });
    const codes = warningCodes(b);
    expect(codes).toContain('LOW_CONFIDENCE_BRANCH');
    expect(codes).toContain('UNRESOLVED_EXTRACT_WARNINGS');
  });
});

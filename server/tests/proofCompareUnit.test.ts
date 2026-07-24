import { describe, expect, it } from 'vitest';
import {
  compareBookingCode,
  compareCustomerName,
  compareDate,
  compareNightlyPrices,
  compareNights,
  comparePayment,
  comparePmsNote,
  compareRoomQuantity,
  compareRoomSummary,
  compareTotal,
} from '../src/booking/compare/comparators';
import { aggregateOverallStatus, buildComparisonResult, type DetectedProof, type ExpectedBooking } from '../src/booking/compare/engine';

describe('compare — booking code (critical, exact digits)', () => {
  it('exact match', () => expect(compareBookingCode('6039118394', '6039118394').result).toBe('MATCH'));
  it('mismatch (one digit)', () => expect(compareBookingCode('6039118394', '6039118391').result).toBe('MISMATCH'));
  it('missing', () => expect(compareBookingCode('6039118394', null).result).toBe('NOT_FOUND'));
  it('does not fuzzy-repair', () => expect(compareBookingCode('6039118394', '603911839').result).toBe('MISMATCH'));
});

describe('compare — dates (critical)', () => {
  it('check-in exact', () => expect(compareDate('CHECK_IN', 'Check-in', '2026-07-24', '2026-07-24').result).toBe('MATCH'));
  it('check-in mismatch', () => expect(compareDate('CHECK_IN', 'Check-in', '2026-07-24', '2026-07-25').result).toBe('MISMATCH'));
  it('check-out exact', () => expect(compareDate('CHECK_OUT', 'Check-out', '2026-07-28', '2026-07-28').result).toBe('MATCH'));
  it('date not found', () => expect(compareDate('CHECK_IN', 'Check-in', '2026-07-24', null).result).toBe('NOT_FOUND'));
});

describe('compare — total (critical, normalized money)', () => {
  it('exact match', () => expect(compareTotal(4_720_680, 4_720_680).result).toBe('MATCH'));
  it('mismatch', () => expect(compareTotal(4_720_680, 4_726_800).result).toBe('MISMATCH'));
  it('missing', () => expect(compareTotal(4_720_680, null).result).toBe('NOT_FOUND'));
  it('formats expected/detected with dot grouping', () => {
    const c = compareTotal(4_720_680, 4_726_800);
    expect(c.expected).toBe('4.720.680');
    expect(c.detected).toBe('4.726.800');
  });
});

describe('compare — customer name (accent-insensitive)', () => {
  it('accent-insensitive match', () =>
    expect(compareCustomerName('Hoàng Thị Thu Thủy', 'Hoang Thi Thu Thuy').result).toBe('MATCH'));
  it('small variation → warning', () =>
    expect(compareCustomerName('Nguyen Van Anh', 'Nguyen Van Ang').result).toBe('WARNING'));
  it('clear mismatch', () => expect(compareCustomerName('Nguyen Van A', 'Tran Thi B').result).toBe('MISMATCH'));
  it('missing', () => expect(compareCustomerName('Nguyen Van A', null).result).toBe('NOT_FOUND'));
});

describe('compare — room quantity (critical)', () => {
  it('match', () => expect(compareRoomQuantity(2, 2).result).toBe('MATCH'));
  it('mismatch', () => expect(compareRoomQuantity(2, 1).result).toBe('MISMATCH'));
  it('missing', () => expect(compareRoomQuantity(2, null).result).toBe('NOT_FOUND'));
});

describe('compare — room type / summary (alias map)', () => {
  it('alias match (Standard Double ≈ STAN)', () =>
    expect(compareRoomSummary(['Standard Double Room'], [{ value: 'STAN', quantity: 1 }]).result).toBe('MATCH'));
  it('multi-type quantities match', () =>
    expect(
      compareRoomSummary(['Superior Double', 'Superior Double', 'Deluxe Double'], [
        { value: 'Superior Double', quantity: 2 },
        { value: 'Deluxe Double', quantity: 1 },
      ]).result,
    ).toBe('MATCH'));
  it('quantity per type mismatch', () =>
    expect(
      compareRoomSummary(['Superior Double', 'Superior Double'], [{ value: 'Superior Double', quantity: 1 }]).result,
    ).toBe('MISMATCH'));
  it('unrecognised type → ambiguity warning', () =>
    expect(compareRoomSummary(['Superior Double'], [{ value: 'Zzz Mystery Room', quantity: 1 }]).result).toBe('WARNING'));
  it('clearly different type mismatch', () =>
    expect(compareRoomSummary(['Superior Double'], [{ value: 'Deluxe Double', quantity: 1 }]).result).toBe('MISMATCH'));
  it('missing', () => expect(compareRoomSummary(['Superior Double'], []).result).toBe('NOT_FOUND'));
});

describe('compare — payment', () => {
  it('match', () => expect(comparePayment('PAY_AFTER', 'PAY_AFTER').result).toBe('MATCH'));
  it('opposite → mismatch', () => expect(comparePayment('PAY_AFTER', 'PAY_BEFORE').result).toBe('MISMATCH'));
  it('missing', () => expect(comparePayment('PAY_AFTER', null).result).toBe('NOT_FOUND'));
});

describe('compare — nights', () => {
  it('match', () => expect(compareNights(4, 4).result).toBe('MATCH'));
  it('different → warning', () => expect(compareNights(4, 3).result).toBe('WARNING'));
  it('missing', () => expect(compareNights(4, null).result).toBe('NOT_FOUND'));
});

describe('compare — nightly prices', () => {
  const exp = [
    { date: '2026-07-24', amount: 1_000_000 },
    { date: '2026-07-25', amount: 1_000_000 },
  ];
  it('exact match', () => expect(compareNightlyPrices(exp, exp).result).toBe('MATCH'));
  it('mismatch', () =>
    expect(
      compareNightlyPrices(exp, [
        { date: '2026-07-24', amount: 1_000_000 },
        { date: '2026-07-25', amount: 900_000 },
      ]).result,
    ).toBe('MISMATCH'));
  it('unavailable → not applicable with a clear message', () => {
    const c = compareNightlyPrices(exp, []);
    expect(c.result).toBe('NOT_APPLICABLE');
    expect(c.message).toContain('Không đủ dữ liệu');
  });
});

describe('compare — PMS note', () => {
  const expectedNote = { bookingCode: '6039118394', nights: 4, total: 4_720_680, payment: 'PAY_AFTER' as const, partner: false, breakfast: false, arrival: '' };
  it('required components present → match', () =>
    expect(
      comparePmsNote(expectedNote, { bookingCode: '6039118394', total: 4_720_680, payment: 'PAY_AFTER', nights: 4, noteText: 'BK 6039118394' }).result,
    ).toBe('MATCH'));
  it('missing optional/required component → warning', () =>
    expect(comparePmsNote(expectedNote, { bookingCode: '6039118394', total: null, payment: 'PAY_AFTER', nights: 4, noteText: 'x' }).result).toBe('WARNING'));
  it('wrong booking code → mismatch', () =>
    expect(comparePmsNote(expectedNote, { bookingCode: '6039118391', total: 4_720_680, payment: 'PAY_AFTER', nights: 4, noteText: 'x' }).result).toBe('MISMATCH'));
  it('opposite payment → mismatch', () =>
    expect(comparePmsNote(expectedNote, { bookingCode: '6039118394', total: 4_720_680, payment: 'PAY_BEFORE', nights: 4, noteText: 'x' }).result).toBe('MISMATCH'));
});

// --- Aggregation -----------------------------------------------------------
function expected(over: Partial<ExpectedBooking> = {}): ExpectedBooking {
  return {
    bookingCode: '6039118394',
    checkInDate: '2026-07-24',
    checkOutDate: '2026-07-28',
    totalAmount: 4_720_680,
    currency: 'VND',
    roomQuantity: 1,
    customerName: 'Nguyen Van A',
    roomTypes: ['Superior Double'],
    paymentStatus: 'PAY_AFTER',
    nights: 4,
    nightlyPrices: [],
    note: { bookingCode: '6039118394', nights: 4, total: 4_720_680, payment: 'PAY_AFTER', partner: false, breakfast: false, arrival: '' },
    ...over,
  };
}
function detected(over: Partial<DetectedProof> = {}): DetectedProof {
  return {
    bookingCode: '6039118394',
    checkInDate: '2026-07-24',
    checkOutDate: '2026-07-28',
    totalAmount: 4_720_680,
    roomQuantity: 1,
    customerName: 'Nguyen Van A',
    roomTypes: [{ value: 'Superior Double', quantity: 1 }],
    paymentStatus: 'PAY_AFTER',
    nights: 4,
    nightlyPrices: [],
    note: { bookingCode: '6039118394', total: 4_720_680, payment: 'PAY_AFTER', nights: 4, noteText: 'BK 6039118394' },
    ...over,
  };
}

describe('compare — overall aggregation', () => {
  it('all fields match → overall MATCH', () => {
    const r = buildComparisonResult(expected(), detected());
    expect(r.overall).toBe('MATCH');
    expect(r.summary.mismatchCount).toBe(0);
  });
  it('missing non-critical data → overall WARNING', () => {
    const r = buildComparisonResult(expected(), detected({ paymentStatus: null, note: { bookingCode: '6039118394', total: 4_720_680, payment: null, nights: 4, noteText: 'x' } }));
    expect(r.overall).toBe('WARNING');
  });
  it('a critical mismatch → overall MISMATCH', () => {
    const r = buildComparisonResult(expected(), detected({ totalAmount: 4_726_800 }));
    expect(r.overall).toBe('MISMATCH');
    expect(r.summary.mismatchCount).toBeGreaterThan(0);
  });
  it('unreadable nightly prices alone do not lower a full match', () => {
    // Everything matches; nightly prices are NOT_APPLICABLE (excluded).
    const r = buildComparisonResult(expected({ nightlyPrices: [{ date: '2026-07-24', amount: 1 }] }), detected());
    expect(r.overall).toBe('MATCH');
  });
  it('aggregate helper: NOT_APPLICABLE is excluded', () => {
    expect(aggregateOverallStatus([{ field: 'NIGHTLY_PRICES', label: 'x', importance: 'OPERATIONAL', result: 'NOT_APPLICABLE', expected: null, detected: null, message: '' }])).toBe('MATCH');
  });
});

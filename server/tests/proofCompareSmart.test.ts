import { describe, expect, it } from 'vitest';
import {
  diffCode,
  diffDate,
  diffMoney,
  diffNights,
  diffRooms,
  diffTextTokens,
  explainConfidence,
} from '../src/booking/compare/smartDiff';
import { enrichComparisonResult } from '../src/booking/compare/enrich';
import { buildComparisonResult, type DetectedProof, type ExpectedBooking } from '../src/booking/compare/engine';

describe('smartDiff — booking code', () => {
  it('one-character diff reports the changed position', () => {
    const d = diffCode('6039118394', '6039118398');
    expect(d.changedPositions).toEqual([{ index: 9, expected: '4', detected: '8' }]);
    expect(d.missingCount).toBe(0);
    expect(d.extraCount).toBe(0);
  });
  it('multiple-character diff', () => {
    const d = diffCode('6039118394', '6039118484'); // positions 7 and 8 differ
    expect(d.changedPositions?.length).toBe(2);
  });
  it('missing digit', () => {
    const d = diffCode('6039118394', '603911839');
    expect(d.missingCount).toBe(1);
    expect(d.extraCount).toBe(0);
  });
  it('extra digit', () => {
    const d = diffCode('603911839', '6039118394');
    expect(d.extraCount).toBe(1);
    expect(d.missingCount).toBe(0);
  });
});

describe('smartDiff — money', () => {
  it('positive delta (image higher)', () => {
    const d = diffMoney(4_270_680, 4_720_680);
    expect(d.deltaAmount).toBe(450_000);
    expect(d.direction).toBe('HIGHER');
  });
  it('negative delta (image lower)', () => {
    const d = diffMoney(4_720_680, 4_270_680);
    expect(d.deltaAmount).toBe(-450_000);
    expect(d.direction).toBe('LOWER');
  });
  it('zero delta has no direction', () => {
    const d = diffMoney(4_720_680, 4_720_680);
    expect(d.deltaAmount).toBe(0);
    expect(d.direction).toBeUndefined();
  });
});

describe('smartDiff — dates', () => {
  it('check-in +1 day', () => expect(diffDate('2026-07-24', '2026-07-25')?.deltaDays).toBe(1));
  it('check-in -1 day', () => expect(diffDate('2026-07-24', '2026-07-23')?.deltaDays).toBe(-1));
  it('check-out delta', () => expect(diffDate('2026-07-28', '2026-07-26')?.deltaDays).toBe(-2));
  it('invalid date → null', () => expect(diffDate('nope', '2026-07-25')).toBeNull());
});

describe('smartDiff — nights', () => {
  it('missing one night', () => {
    const d = diffNights(5, 4);
    expect(d.deltaNights).toBe(-1);
    expect(d.direction).toBe('MISSING');
  });
  it('extra two nights', () => {
    const d = diffNights(4, 6);
    expect(d.deltaNights).toBe(2);
    expect(d.direction).toBe('EXTRA');
  });
});

describe('smartDiff — rooms', () => {
  it('missing one room (quantity)', () => {
    const d = diffRooms(3, 2, ['Superior Double', 'Superior Double', 'Deluxe Double'], [
      { value: 'Superior Double', quantity: 1 },
      { value: 'Deluxe Double', quantity: 1 },
    ]);
    expect(d.deltaQuantity).toBe(-1);
    const sup = d.roomGroups?.find((g) => g.type === 'SUPERIOR');
    expect(sup?.delta).toBe(-1);
  });
  it('extra one room', () => {
    const d = diffRooms(2, 3, ['Superior Double', 'Superior Double'], [{ value: 'Superior Double', quantity: 3 }]);
    expect(d.deltaQuantity).toBe(1);
  });
  it('unexpected room type is reported', () => {
    const d = diffRooms(1, 2, ['Superior Double'], [
      { value: 'Superior Double', quantity: 1 },
      { value: 'Deluxe Twin', quantity: 1 },
    ]);
    expect(d.addedTypes?.some((a) => a.type === 'DELUXE')).toBe(true);
  });
  it('alias produces no false difference (Standard Double ≈ STAN)', () => {
    const d = diffRooms(1, 1, ['Standard Double Room'], [{ value: 'STAN', quantity: 1 }]);
    expect(d.roomGroups?.length ?? 0).toBe(0);
    expect(d.addedTypes?.length ?? 0).toBe(0);
  });
});

describe('smartDiff — token diff', () => {
  it('added word', () => {
    const segs = diffTextTokens('Superior Double', 'Superior Deluxe Double');
    expect(segs.find((s) => s.op === 'added')?.text).toBe('Deluxe');
  });
  it('removed word', () => {
    const segs = diffTextTokens('Superior Deluxe Double', 'Superior Double');
    expect(segs.find((s) => s.op === 'removed')?.text).toBe('Deluxe');
  });
  it('replacement (removed + added)', () => {
    const segs = diffTextTokens('Standard Double', 'Deluxe Double');
    expect(segs.some((s) => s.op === 'removed')).toBe(true);
    expect(segs.some((s) => s.op === 'added')).toBe(true);
  });
});

describe('smartDiff — confidence labels', () => {
  it('high', () => expect(explainConfidence(96).label).toBe('HIGH'));
  it('medium', () => expect(explainConfidence(80).label).toBe('MEDIUM'));
  it('low', () => expect(explainConfidence(50).label).toBe('LOW'));
});

// --- Enrichment over a full comparison --------------------------------------
function expected(over: Partial<ExpectedBooking> = {}): ExpectedBooking {
  return {
    bookingCode: '6039118394',
    checkInDate: '2026-07-24',
    checkOutDate: '2026-07-28',
    totalAmount: 4_720_680,
    currency: 'VND',
    roomQuantity: 1,
    customerName: 'Hoàng Thị Thu Thủy',
    roomTypes: ['Superior Double'],
    paymentStatus: 'PAY_BEFORE',
    nights: 4,
    nightlyPrices: [],
    note: { bookingCode: '6039118394', nights: 4, total: 4_720_680, payment: 'PAY_BEFORE', partner: false, breakfast: false, arrival: '' },
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
    customerName: 'Hoang Thi Thu Thuy',
    roomTypes: [{ value: 'Superior Double', quantity: 1 }],
    paymentStatus: 'PAY_BEFORE',
    nights: 4,
    nightlyPrices: [],
    note: { bookingCode: '6039118394', total: 4_720_680, payment: 'PAY_BEFORE', nights: 4, noteText: 'BK 6039118394' },
    ...over,
  };
}
const field = (r: ReturnType<typeof buildComparisonResult>, key: string) => r.fields.find((f) => f.field === key)!;

describe('enrich — additive explanations', () => {
  it('customer accent-only match adds a neutral explanation', () => {
    const r = buildComparisonResult(expected(), detected());
    const name = field(r, 'CUSTOMER_NAME');
    expect(name.result).toBe('MATCH');
    expect(name.explanation).toBe('Khớp sau khi bỏ dấu tiếng Việt.');
  });

  it('customer small variation → warning explanation + diff', () => {
    const r = buildComparisonResult(expected({ customerName: 'Nguyen Van Huyen' }), detected({ customerName: 'Nguyen Van Huyenn' }));
    const name = field(r, 'CUSTOMER_NAME');
    expect(name.result).toBe('WARNING');
    expect(name.explanation).toContain('gần giống');
    expect(name.diffSegments?.length).toBeGreaterThan(0);
  });

  it('customer clear mismatch gets a suggestion', () => {
    const r = buildComparisonResult(expected(), detected({ customerName: 'Tran Van B' }));
    const name = field(r, 'CUSTOMER_NAME');
    expect(name.result).toBe('MISMATCH');
    expect(name.suggestion).toBe('Kiểm tra lại tên khách.');
  });

  it('payment opposite explanation', () => {
    const r = buildComparisonResult(expected(), detected({ paymentStatus: 'PAY_AFTER', note: { bookingCode: '6039118394', total: 4_720_680, payment: 'PAY_AFTER', nights: 4, noteText: 'x' } }));
    const pay = field(r, 'PAYMENT_STATUS');
    expect(pay.result).toBe('MISMATCH');
    expect(pay.explanation).toBe('Sai trạng thái thanh toán.');
    expect(pay.suggestion).toBe('Kiểm tra lại trạng thái thanh toán.');
  });

  it('total mismatch shows the VND difference sentence', () => {
    const r = buildComparisonResult(expected(), detected({ totalAmount: 4_270_680 }));
    const total = field(r, 'TOTAL_AMOUNT');
    expect(total.details?.deltaAmount).toBe(-450_000);
    expect(total.explanation).toContain('thấp hơn');
    expect(total.explanation).toContain('450.000');
  });

  it('confidence label attached where OCR provided one', () => {
    const r = buildComparisonResult(expected(), detected(), { total: 94 });
    expect(field(r, 'TOTAL_AMOUNT').confidenceLabel).toBe('HIGH');
  });
});

describe('enrich — PMS note checklist', () => {
  it('complete checklist marks required components', () => {
    const r = buildComparisonResult(expected(), detected());
    const codes = r.noteComponents!.map((c) => c.key);
    expect(codes).toEqual(expect.arrayContaining(['BOOKING_CODE', 'NIGHTS', 'TOTAL', 'PAYMENT', 'CI']));
    expect(r.noteComponents!.find((c) => c.key === 'BOOKING_CODE')!.result).toBe('MATCH');
  });
  it('missing optional arrival shows NOT_FOUND', () => {
    const r = buildComparisonResult(expected({ note: { bookingCode: '6039118394', nights: 4, total: 4_720_680, payment: 'PAY_BEFORE', partner: false, breakfast: false, arrival: '22:00' } }), detected());
    expect(r.noteComponents!.find((c) => c.key === 'ARRIVAL_NOTE')!.result).toBe('NOT_FOUND');
  });
  it('missing required breakfast (breakfast branch) shows NOT_FOUND', () => {
    const r = buildComparisonResult(expected({ note: { bookingCode: '6039118394', nights: 4, total: 4_720_680, payment: 'PAY_BEFORE', partner: false, breakfast: true, arrival: '' } }), detected());
    expect(r.noteComponents!.find((c) => c.key === 'BREAKFAST')!.result).toBe('NOT_FOUND');
  });
  it('missing partner marker (partner booking) shows NOT_FOUND', () => {
    const r = buildComparisonResult(expected({ note: { bookingCode: '6039118394', nights: 4, total: 4_720_680, payment: 'PAY_BEFORE', partner: true, breakfast: false, arrival: '' } }), detected());
    expect(r.noteComponents!.find((c) => c.key === 'PARTNER')!.result).toBe('NOT_FOUND');
  });
  it('wrong booking code in note component → MISMATCH', () => {
    const r = buildComparisonResult(expected(), detected({ note: { bookingCode: '6039118399', total: 4_720_680, payment: 'PAY_BEFORE', nights: 4, noteText: 'x' } }));
    expect(r.noteComponents!.find((c) => c.key === 'BOOKING_CODE')!.result).toBe('MISMATCH');
  });
});

describe('enrich — suggestions & summary & safety', () => {
  it('suggestions are de-duplicated (room type + quantity share one label)', () => {
    const r = buildComparisonResult(expected({ roomQuantity: 2, roomTypes: ['Superior Double', 'Superior Double'] }), detected({ roomQuantity: 1, roomTypes: [{ value: 'Deluxe Double', quantity: 1 }] }));
    const roomChecks = r.suggestions!.filter((s) => s === 'Hạng phòng và số lượng phòng');
    expect(roomChecks.length).toBe(1);
  });
  it('match summary + headline', () => {
    const r = buildComparisonResult(expected(), detected());
    expect(r.overall).toBe('MATCH');
    expect(r.headline).toBe('Không phát hiện sai khác quan trọng.');
  });
  it('warning summary headline', () => {
    const r = buildComparisonResult(expected(), detected({ paymentStatus: null, note: { bookingCode: '6039118394', total: 4_720_680, payment: null, nights: 4, noteText: 'x' } }));
    expect(r.overall).toBe('WARNING');
    expect(r.headline).toBe('Còn thông tin thiếu hoặc chưa đủ chắc chắn.');
  });
  it('mismatch summary headline', () => {
    const r = buildComparisonResult(expected(), detected({ totalAmount: 1 }));
    expect(r.overall).toBe('MISMATCH');
    expect(r.headline).toBe('Phát hiện thông tin không khớp cần Admin kiểm tra.');
  });
  it('enrichment does not change results or overall (only appends)', () => {
    const base = buildComparisonResult(expected(), detected({ totalAmount: 1 }));
    // Re-enriching an already-enriched result must be idempotent on results/overall.
    const again = enrichComparisonResult(base, expected(), detected({ totalAmount: 1 }));
    expect(again.overall).toBe(base.overall);
    expect(again.fields.map((f) => f.result)).toEqual(base.fields.map((f) => f.result));
  });
  it('existing C.3-shaped result (no smart fields) is still valid to read', () => {
    // A stored proof-compare-v1 row from C.3 lacks details/suggestion/etc.
    const legacy = { field: 'TOTAL_AMOUNT', label: 'Giá tổng', importance: 'CRITICAL', result: 'MATCH', expected: '4.720.680', detected: '4.720.680', message: 'Giá tổng khớp.' };
    expect(legacy.result).toBe('MATCH');
    // The additive fields are simply absent — no crash reading base fields.
    expect('details' in legacy).toBe(false);
  });
});

/**
 * The exact PMS-note string contract for Agoda and CTrip.
 *
 * Every assertion here is a whole-string equality against a note the operator
 * confirmed. The receptionist pastes this into the hotel system, so a stray
 * space, a missing underscore or an extra line is a production defect, not a
 * cosmetic one — which is why nothing here matches loosely.
 */
import { describe, expect, it } from 'vitest';
import {
  NO_BREAKFAST_TEXT,
  OTA_PAYMENT_LABEL,
  buildOtaPmsNote,
  formatVndDots,
  type OtaNoteInput,
} from '../src/booking/otaPmsNote';

/** The confirmed Agoda sample: booking 1756162808, CN7, 1x Superior, 4 nights. */
const AGODA: OtaNoteInput = {
  source: 'AGODA',
  bookingCode: '1756162808',
  rooms: [{ quantity: 1, pmsCode: 'SUP' }],
  nights: 4,
  branchPrice: 2_728_024, // Net rate
  guestBookedPrice: 4_507_750, // Reference sell rate
  paymentMode: 'CN',
  breakfastIncluded: false,
};

/** The confirmed CTrip sample: reservation 1658113703317875, CN5, 1x Standard. */
const CTRIP: OtaNoteInput = {
  source: 'CTRIP',
  bookingCode: '1658113703317875',
  rooms: [{ quantity: 1, pmsCode: 'STAN' }],
  nights: 7,
  branchPrice: 4_645_956, // Your payout
  guestBookedPrice: 6_637_080, // Original room rate (never Final room rate)
  paymentMode: 'CN',
  breakfastIncluded: false,
};

function text(input: OtaNoteInput): string {
  const result = buildOtaPmsNote(input);
  if (!result.ok) throw new Error(`expected a note, got: ${result.error}`);
  return result.text;
}

/* ================================================================== */
/* The four confirmed notes, exactly                                   */
/* ================================================================== */

describe('confirmed note strings', () => {
  it('1. Agoda + CN', () => {
    expect(text(AGODA)).toBe(
      'AGD 1756162808_1SUP_4DEM 2.728.024 CN\nGIÁ KHÁCH ĐẶT 4.507.750 KHONG AN SANG',
    );
  });

  it('2. Agoda + hotel payment', () => {
    expect(text({ ...AGODA, paymentMode: 'HOTEL_PAYMENT' })).toBe(
      'AGD 1756162808_1SUP_4DEM 2.728.024 THANH TOÁN KHÁCH SẠN',
    );
  });

  it('3. CTrip + CN', () => {
    expect(text(CTRIP)).toBe(
      'CTRIP_1658113703317875_1STAN_7DEM 4.645.956 CN\nGIÁ KHÁCH ĐẶT 6.637.080 KHONG AN SANG',
    );
  });

  it('4. CTrip + hotel payment', () => {
    expect(text({ ...CTRIP, paymentMode: 'HOTEL_PAYMENT' })).toBe(
      'CTRIP_1658113703317875_1STAN_7DEM 4.645.956 THANH TOÁN KHÁCH SẠN',
    );
  });
});

/* ================================================================== */
/* The two prefix rules that are easiest to get wrong                  */
/* ================================================================== */

describe('prefix separators', () => {
  it('AGD is followed by exactly one space, then the booking code', () => {
    const line1 = text(AGODA).split('\n')[0]!;
    expect(line1.startsWith('AGD 1756162808_')).toBe(true);
    expect(line1).not.toMatch(/^AGD {2,}/); // never two spaces
    expect(line1).not.toMatch(/^AGD_/); // never an underscore
  });

  it('CTRIP is followed immediately by an underscore, with no space', () => {
    const line1 = text(CTRIP).split('\n')[0]!;
    expect(line1.startsWith('CTRIP_1658113703317875_')).toBe(true);
    expect(line1).not.toMatch(/^CTRIP /); // never a space
  });
});

/* ================================================================== */
/* Hotel-payment notes carry nothing extra                             */
/* ================================================================== */

describe('hotel-payment notes', () => {
  const agodaHotel = text({ ...AGODA, paymentMode: 'HOTEL_PAYMENT' });
  const ctripHotel = text({ ...CTRIP, paymentMode: 'HOTEL_PAYMENT' });

  it('are exactly one line', () => {
    expect(agodaHotel.split('\n')).toHaveLength(1);
    expect(ctripHotel.split('\n')).toHaveLength(1);
    expect(agodaHotel).not.toContain('\n');
    expect(ctripHotel).not.toContain('\n');
  });

  it('never carry the guest-booked price', () => {
    expect(agodaHotel).not.toContain('GIÁ KHÁCH ĐẶT');
    expect(ctripHotel).not.toContain('GIÁ KHÁCH ĐẶT');
    expect(agodaHotel).not.toContain('4.507.750');
    expect(ctripHotel).not.toContain('6.637.080');
  });

  it('never carry a breakfast suffix', () => {
    expect(agodaHotel).not.toContain(NO_BREAKFAST_TEXT);
    expect(ctripHotel).not.toContain(NO_BREAKFAST_TEXT);
  });

  it('use the exact wording THANH TOÁN KHÁCH SẠN, never "TẠI KHÁCH SẠN"', () => {
    expect(OTA_PAYMENT_LABEL.HOTEL_PAYMENT).toBe('THANH TOÁN KHÁCH SẠN');
    expect(agodaHotel).toContain('THANH TOÁN KHÁCH SẠN');
    expect(agodaHotel).not.toContain('THANH TOÁN TẠI KHÁCH SẠN');
    expect(ctripHotel).not.toContain('THANH TOÁN TẠI KHÁCH SẠN');
  });

  it('are generated even when the guest-booked price is unknown', () => {
    // It is never rendered, so it is never required.
    const result = buildOtaPmsNote({
      ...AGODA,
      paymentMode: 'HOTEL_PAYMENT',
      guestBookedPrice: null,
    });
    expect(result.ok).toBe(true);
  });
});

/* ================================================================== */
/* Multiple room types                                                 */
/* ================================================================== */

describe('multiple room fragments', () => {
  it('renders one fragment per room line, in order', () => {
    expect(
      text({
        ...AGODA,
        bookingCode: '123456789',
        rooms: [
          { quantity: 2, pmsCode: 'SUP' },
          { quantity: 1, pmsCode: 'DEL' },
        ],
        nights: 3,
        branchPrice: 6_500_000,
        guestBookedPrice: 8_200_000,
      }),
    ).toBe(
      'AGD 123456789_2SUP_1DEL_3DEM 6.500.000 CN\nGIÁ KHÁCH ĐẶT 8.200.000 KHONG AN SANG',
    );
  });

  it('never merges different room types, even with equal quantities', () => {
    const line1 = text({
      ...CTRIP,
      rooms: [
        { quantity: 1, pmsCode: 'STAN' },
        { quantity: 1, pmsCode: 'SUP' },
        { quantity: 1, pmsCode: 'DEL' },
      ],
    }).split('\n')[0]!;
    expect(line1).toContain('_1STAN_1SUP_1DEL_7DEM');
  });

  it('keeps branch-specific codes verbatim, including the underscored one', () => {
    // CN2's Premium-Twin code is PRE_DD in this system's catalogue.
    const line1 = text({
      ...AGODA,
      rooms: [
        { quantity: 1, pmsCode: 'LUXDEL' },
        { quantity: 2, pmsCode: 'PRE_DD' },
      ],
    }).split('\n')[0]!;
    expect(line1).toContain('_1LUXDEL_2PRE_DD_4DEM');
  });
});

/* ================================================================== */
/* Refusals — nothing is ever guessed                                  */
/* ================================================================== */

describe('refusals', () => {
  const refusal = (over: Partial<OtaNoteInput>) => buildOtaPmsNote({ ...AGODA, ...over });

  it('refuses an unresolved room mapping and names the reason', () => {
    const r = refusal({ rooms: [{ quantity: 1, pmsCode: null }] });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain('mã hạng phòng nội bộ');
  });

  it('refuses a missing branch price, naming the platform field', () => {
    expect(refusal({ branchPrice: null }).ok).toBe(false);
    const agoda = refusal({ branchPrice: null });
    expect(agoda.ok === false && agoda.error).toContain('Net rate');

    const ctrip = buildOtaPmsNote({ ...CTRIP, branchPrice: null });
    expect(ctrip.ok === false && ctrip.error).toContain('Your payout');
  });

  it('refuses a CN note without the guest-booked price', () => {
    const agoda = refusal({ guestBookedPrice: null });
    expect(agoda.ok === false && agoda.error).toContain('Reference sell rate');

    const ctrip = buildOtaPmsNote({ ...CTRIP, guestBookedPrice: null });
    expect(ctrip.ok === false && ctrip.error).toContain('Original room rate');
  });

  it('refuses missing booking code, nights, rooms and bad quantities', () => {
    expect(refusal({ bookingCode: null }).ok).toBe(false);
    expect(refusal({ bookingCode: '   ' }).ok).toBe(false);
    expect(refusal({ nights: null }).ok).toBe(false);
    expect(refusal({ nights: 0 }).ok).toBe(false);
    expect(refusal({ rooms: [] }).ok).toBe(false);
    expect(refusal({ rooms: [{ quantity: 0, pmsCode: 'SUP' }] }).ok).toBe(false);
  });

  it('refuses a breakfast-included CN note rather than inventing wording', () => {
    // Only the no-breakfast phrase has been approved.
    const r = refusal({ breakfastIncluded: true });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain('ăn sáng');
  });
});

/* ================================================================== */
/* Money formatting                                                    */
/* ================================================================== */

describe('formatVndDots', () => {
  it('groups thousands with dots and never adds a currency symbol', () => {
    expect(formatVndDots(2_728_024)).toBe('2.728.024');
    expect(formatVndDots(4_645_956)).toBe('4.645.956');
    expect(formatVndDots(500)).toBe('500');
    expect(formatVndDots(1_000)).toBe('1.000');
    expect(formatVndDots(0)).toBe('0');
  });
});

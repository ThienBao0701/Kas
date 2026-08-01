/**
 * CTrip structured field extraction, against the operator-confirmed
 * reservation.
 *
 * The price rules are the point of this file. CTrip shows three amounts and
 * only two are ours; reading the wrong one would misstate what the hotel is
 * owed or what the guest paid.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  extractCtripFields,
  nightsBetween,
  parseCtripAmount,
  parseCtripDate,
} from '../src/booking/ctripFields';

const CONFIRMED = fs.readFileSync(
  path.join(__dirname, 'fixtures', 'ctrip', '04-confirmed-partner-reservation.txt'),
  'utf8',
);

describe('the confirmed CTrip reservation', () => {
  const f = extractCtripFields(CONFIRMED);

  it('reads every operational field exactly', () => {
    expect(f.reservationCode).toBe('1658113703317875');
    expect(f.propertyName).toBe('KAS Zody Boutique Hotel');
    expect(f.guestName).toBe('LEE/JENSON HWEE');
    expect(f.checkIn).toBe('2026-08-01');
    expect(f.checkOut).toBe('2026-08-08');
    expect(f.roomType).toBe('Standard Double Room No Window');
    expect(f.roomQuantity).toBe(1);
  });

  it('derives 7 nights from the stay dates', () => {
    expect(nightsBetween(f.checkIn, f.checkOut)).toBe(7);
  });

  it('takes the BRANCH price from "Your payout"', () => {
    expect(f.payout).toBe(4_645_956);
  });

  it('takes the GUEST-BOOKED price from "Original room rate", not "Final room rate"', () => {
    expect(f.originalRoomRate).toBe(6_637_080);
    // Final room rate is read for display only and must never become the
    // guest-booked price while Original exists.
    expect(f.finalRoomRate).toBe(4_645_956);
    expect(f.originalRoomRate).not.toBe(f.finalRoomRate);
  });

  it('ignores Discounts entirely', () => {
    // 1.991.124 appears in the source but is never one of our fields.
    expect(CONFIRMED).toContain('1991124');
    expect(Object.values(f)).not.toContain(1_991_124);
  });

  it('reads "No meals" as breakfast not included', () => {
    expect(f.breakfastIncluded).toBe(false);
  });

  it('exposes no nightly rates, because CTrip states none', () => {
    // There is no nightly field to fabricate into…
    expect(f).not.toHaveProperty('nightlyRates');
    expect(f).not.toHaveProperty('nightlyDebt');

    // …and no extracted value is the payout divided by the nights. This payout
    // happens to divide exactly (4.645.956 / 7 = 663.708), which is precisely
    // the case where an accidental "helpful" split would look like real data.
    const perNight = 4_645_956 / 7;
    expect(Number.isInteger(perNight)).toBe(true);
    expect(Object.values(f)).not.toContain(perNight);
  });
});

describe('field parsing', () => {
  it('parses raw and grouped amounts, and refuses non-numeric', () => {
    expect(parseCtripAmount('6637080')).toBe(6_637_080);
    expect(parseCtripAmount('6.637.080')).toBe(6_637_080);
    expect(parseCtripAmount('VND 6,637,080')).toBe(6_637_080);
    // Absent stays absent — never 0, which is a real price.
    expect(parseCtripAmount(null)).toBeNull();
    expect(parseCtripAmount('—')).toBeNull();
  });

  it('parses DD/MM/YYYY and ISO dates', () => {
    expect(parseCtripDate('01/08/2026')).toBe('2026-08-01');
    expect(parseCtripDate('1/8/2026')).toBe('2026-08-01');
    expect(parseCtripDate('2026-08-01')).toBe('2026-08-01');
    expect(parseCtripDate('not a date')).toBeNull();
  });

  it('returns null nights for missing or inverted stay dates', () => {
    expect(nightsBetween(null, '2026-08-08')).toBeNull();
    expect(nightsBetween('2026-08-08', '2026-08-01')).toBeNull();
    expect(nightsBetween('2026-08-01', '2026-08-01')).toBeNull();
  });
});

describe('absent fields stay absent', () => {
  it('a reservation without a Property name leaves it null for the Admin to choose', () => {
    const f = extractCtripFields(
      ['Reservation: 999', 'Guest: A B', 'Check-in: 01/08/2026', 'Check-out: 02/08/2026'].join('\n'),
    );
    expect(f.propertyName).toBeNull();
    expect(f.reservationCode).toBe('999');
  });

  it('missing prices are null, never zero or derived', () => {
    const f = extractCtripFields('Reservation: 999\nRoom type: Standard');
    expect(f.payout).toBeNull();
    expect(f.originalRoomRate).toBeNull();
    expect(f.finalRoomRate).toBeNull();
  });

  it('an unstated Meals line leaves breakfast unknown rather than assuming', () => {
    const f = extractCtripFields('Reservation: 999');
    expect(f.breakfastIncluded).toBeNull();
  });
});

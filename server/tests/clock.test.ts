import { describe, expect, it } from 'vitest';
import { hcmDateOnly, isLastMinute } from '../src/lib/clock';

describe('Asia/Ho_Chi_Minh business time', () => {
  it('rolls the calendar date at HCM midnight (UTC+7), not UTC midnight', () => {
    // 23:59 on the 21st in HCM is still 16:59 UTC on the 21st.
    expect(hcmDateOnly(new Date('2026-07-21T16:59:00.000Z'))).toBe('2026-07-21');
    // One minute later it is 00:00 on the 22nd in HCM.
    expect(hcmDateOnly(new Date('2026-07-21T17:00:00.000Z'))).toBe('2026-07-22');
  });

  it('marks a booking last-minute only when check-in is today in HCM', () => {
    const checkIn = new Date('2026-07-22T00:00:00.000Z');
    // 08:00 UTC on the 22nd -> 15:00 HCM on the 22nd -> same day.
    expect(isLastMinute(checkIn, new Date('2026-07-22T08:00:00.000Z'))).toBe(true);
    // 17:00 UTC on the 21st -> 00:00 HCM on the 22nd -> still last minute.
    expect(isLastMinute(checkIn, new Date('2026-07-21T17:00:00.000Z'))).toBe(true);
    // 16:59 UTC on the 21st -> 23:59 HCM on the 21st -> not yet.
    expect(isLastMinute(checkIn, new Date('2026-07-21T16:59:00.000Z'))).toBe(false);
    // The day after is not last-minute.
    expect(isLastMinute(checkIn, new Date('2026-07-23T02:00:00.000Z'))).toBe(false);
  });

  it('is never last-minute without a check-in date', () => {
    expect(isLastMinute(null, new Date('2026-07-22T08:00:00.000Z'))).toBe(false);
  });
});

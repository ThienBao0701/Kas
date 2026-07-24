import { describe, expect, it } from 'vitest';
import { detectBusinessType } from '../src/booking/businessType';
import { BUSINESS_TYPE_CONFIDENCE_THRESHOLD } from '../src/booking/partnerDetectionRules';

const BKCOM_CHROME = 'Booking.com for Partners\nChi tiết đặt phòng\n';

describe('business-type detector', () => {
  it('classifies a normal Booking.com retail booking as DIRECT', () => {
    const r = detectBusinessType({
      rawText: `${BKCOM_CHROME}Fully flexible, Domestic rate, Bao gồm bữa sáng\nVND 648.000`,
    });
    expect(r.type).toBe('DIRECT');
    expect(r.confidence).toBeGreaterThanOrEqual(BUSINESS_TYPE_CONFIDENCE_THRESHOLD);
    expect(r.requiresAdminConfirmation).toBe(false);
  });

  it('never classifies the "Booking.com for Partners" chrome or OTA source as PARTNER', () => {
    const r = detectBusinessType({ rawText: 'Booking.com for Partners\nAgoda\nChi tiết đặt phòng' });
    expect(r.type).not.toBe('PARTNER');
  });

  it('leaves a normal Agoda booking as DIRECT or UNKNOWN, never PARTNER', () => {
    const retail = detectBusinessType({ rawText: 'Agoda\nBest available rate\nVND 900.000' });
    expect(retail.type).toBe('DIRECT');
    const bare = detectBusinessType({ rawText: 'Agoda\nBooking confirmed\nVND 900.000' });
    expect(['DIRECT', 'UNKNOWN']).toContain(bare.type);
    expect(bare.type).not.toBe('PARTNER');
  });

  it('classifies an explicit partner-rate booking as PARTNER', () => {
    const r = detectBusinessType({ rawText: `${BKCOM_CHROME}Rate plan: Partner Rate (B2B)` });
    expect(r.type).toBe('PARTNER');
    expect(r.confidence).toBeGreaterThanOrEqual(BUSINESS_TYPE_CONFIDENCE_THRESHOLD);
    expect(r.matchedRules).toContain('partner-rate');
  });

  it('classifies a corporate booking as PARTNER', () => {
    const r = detectBusinessType({ rawText: 'Corporate booking for ACME Co.\nMã đặt phòng 123' });
    expect(r.type).toBe('PARTNER');
    expect(r.matchedRules).toContain('corporate');
  });

  it('classifies a travel-agent booking as PARTNER', () => {
    const r = detectBusinessType({ rawText: 'Reserved via a travel agency for a group tour.' });
    expect(r.type).toBe('PARTNER');
    expect(r.matchedRules).toContain('travel-agent');
  });

  it('returns UNKNOWN for weak/ambiguous evidence and requires confirmation', () => {
    const r = detectBusinessType({ rawText: 'Chi tiết đặt phòng\nTên khách: A\nMã đặt phòng 123' });
    expect(r.type).toBe('UNKNOWN');
    expect(r.confidence).toBeLessThan(BUSINESS_TYPE_CONFIDENCE_THRESHOLD);
    expect(r.requiresAdminConfirmation).toBe(true);
  });

  it('never uses the phone number to determine the type', () => {
    // A phone that happens to contain digits like "84" or "2b2" never triggers.
    const r = detectBusinessType({ rawText: 'Số điện thoại: +84 964 934 713\nTên khách: A' });
    expect(r.type).toBe('UNKNOWN');
    expect(r.matchedRules).toEqual([]);
  });

  it('lets partner evidence win over direct evidence when both are present', () => {
    const r = detectBusinessType({
      rawText: 'Domestic rate, fully flexible\nCorporate booking for ACME',
    });
    expect(r.type).toBe('PARTNER');
  });

  it('is deterministic (same input → same result)', () => {
    const input = { rawText: 'Corporate booking' };
    expect(detectBusinessType(input)).toEqual(detectBusinessType(input));
  });
});

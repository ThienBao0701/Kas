import { describe, expect, it } from 'vitest';
import {
  MAX_OCR_TEXT_LENGTH,
  extractProofFields,
  limitOcrText,
  normalizeDate,
  normalizeMoney,
  normalizePayment,
} from '../src/booking/ocr/normalize';

describe('OCR normalize — money', () => {
  it.each([
    ['4.720.680', 4_720_680],
    ['4,720,680', 4_720_680],
    ['4720680', 4_720_680],
    ['VND 4.720.680', 4_720_680],
    ['1.234.567 đ', 1_234_567],
  ])('parses %s → %d', (input, expected) => {
    expect(normalizeMoney(input)).toBe(expected);
  });

  it('returns null for a token with no digits', () => {
    expect(normalizeMoney('VND')).toBeNull();
  });
});

describe('OCR normalize — dates', () => {
  it.each([
    ['24/07/2026', '2026-07-24'],
    ['24-07-2026', '2026-07-24'],
    ['2026-07-24', '2026-07-24'],
    ['2026/07/24', '2026-07-24'],
  ])('parses %s → %s', (input, expected) => {
    expect(normalizeDate(input)).toBe(expected);
  });

  it('returns null for an invalid date', () => {
    expect(normalizeDate('not a date')).toBeNull();
    expect(normalizeDate('99/99/2026')).toBeNull();
  });
});

describe('OCR normalize — payment wording', () => {
  it.each([
    ['PAY BEFORE CHECK-IN', 'PAY_BEFORE'],
    ['Pay before CI', 'PAY_BEFORE'],
    ['PAY AFTER CHECK-IN', 'PAY_AFTER'],
    ['pay after ci', 'PAY_AFTER'],
  ])('%s → %s', (input, expected) => {
    expect(normalizePayment(input)?.value).toBe(expected);
  });

  it('returns null when payment wording is absent', () => {
    expect(normalizePayment('nothing relevant here')).toBeNull();
  });
});

describe('OCR normalize — text length limit', () => {
  it('caps stored text at the maximum length', () => {
    const huge = 'a'.repeat(MAX_OCR_TEXT_LENGTH + 5000);
    const capped = limitOcrText(huge);
    expect(capped.length).toBe(MAX_OCR_TEXT_LENGTH);
    expect(capped.endsWith('…')).toBe(true);
  });

  it('leaves short text untouched', () => {
    expect(limitOcrText('short')).toBe('short');
  });
});

// A realistic (anonymised) proof-screenshot OCR text used across extraction tests.
const SAMPLE = [
  'Booking.com Confirmation',
  'Booking ID: 6039118394',
  'Guest name: Nguyen Van A',
  'Check-in: 24/07/2026',
  'Check-out: 28/07/2026',
  '4 nights',
  'Room type: Superior Double',
  '1 phòng',
  'Total: VND 4.720.680',
  'PAY AFTER CHECK-IN',
  'Special request: Late check-in around 22:00',
].join('\n');

describe('OCR extractProofFields — extraction', () => {
  const fields = extractProofFields(SAMPLE);

  it('extracts the booking code exactly (no guessing)', () => {
    expect(fields.bookingCode?.value).toBe('6039118394');
    expect(fields.bookingCode!.confidence).toBeGreaterThan(0);
  });

  it('extracts the check-in date as ISO', () => {
    expect(fields.checkInDate?.value).toBe('2026-07-24');
  });

  it('extracts the check-out date as ISO', () => {
    expect(fields.checkOutDate?.value).toBe('2026-07-28');
  });

  it('extracts the total amount and currency', () => {
    expect(fields.totalAmount?.value).toBe(4_720_680);
    expect(fields.totalAmount?.currency).toBe('VND');
  });

  it('extracts the payment wording', () => {
    expect(fields.paymentStatus?.value).toBe('PAY_AFTER');
  });

  it('extracts the room type', () => {
    expect(fields.roomTypes[0]?.value).toContain('Superior Double');
  });

  it('extracts the note when visible', () => {
    expect(fields.note?.value).toContain('Late check-in');
  });

  it('extracts nights and room quantity', () => {
    expect(fields.nights?.value).toBe(4);
    expect(fields.roomQuantity?.value).toBe(1);
  });

  it('every confidence is within 0–100', () => {
    const confidences = [
      fields.bookingCode?.confidence,
      fields.checkInDate?.confidence,
      fields.checkOutDate?.confidence,
      fields.totalAmount?.confidence,
      fields.paymentStatus?.confidence,
    ].filter((c): c is number => typeof c === 'number');
    for (const c of confidences) {
      expect(c).toBeGreaterThan(0);
      expect(c).toBeLessThanOrEqual(100);
    }
  });
});

describe('OCR extractProofFields — uncertainty', () => {
  it('returns null for fields that are not present (never invents a value)', () => {
    const fields = extractProofFields('Some unrelated screenshot text with no booking fields.');
    expect(fields.bookingCode).toBeNull();
    expect(fields.checkInDate).toBeNull();
    expect(fields.checkOutDate).toBeNull();
    expect(fields.totalAmount).toBeNull();
    expect(fields.paymentStatus).toBeNull();
    expect(fields.note).toBeNull();
    expect(fields.roomTypes).toEqual([]);
  });

  it('handles empty text safely', () => {
    const fields = extractProofFields('');
    expect(fields.bookingCode).toBeNull();
    expect(fields.roomTypes).toEqual([]);
  });
});

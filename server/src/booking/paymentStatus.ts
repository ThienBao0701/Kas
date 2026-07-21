import { normalizeForPhrase, removeDiacritics } from './text';
import type { ParsedPaymentStatus } from './types';

/**
 * The authoritative Booking.com "prepaid" signal. When the reservation was paid
 * through Booking.com (virtual card / prepaid), the reservation-detail page hides
 * the card and shows this exact sentence. Its presence therefore means the guest
 * has already paid (PAY_BEFORE); its absence means the property collects payment
 * on arrival (PAY_AFTER).
 */
export const CREDIT_CARD_HIDDEN_PHRASE =
  'Quý vị không có quyền xem chi tiết thẻ tín dụng này.';

const CREDIT_CARD_HIDDEN_NEEDLE = normalizeForPhrase(CREDIT_CARD_HIDDEN_PHRASE);

/**
 * True when the raw pasted text contains the credit-card-hidden sentence.
 * Matching is diacritic- and whitespace-insensitive so broken line wrapping or
 * lost accents in the copied text cannot hide it.
 */
export function containsCardHiddenPhrase(rawText: string): boolean {
  return normalizeForPhrase(rawText).includes(CREDIT_CARD_HIDDEN_NEEDLE);
}

/**
 * Maps free-form payment text to a payment status, or null when the text does
 * not clearly indicate either. Used only as a secondary hint for the labelled
 * "Thanh toán:" field; the whole-document credit-card rule (see
 * {@link resolvePaymentStatus}) is authoritative.
 *
 * PAY_AFTER  = guest pays at the property on arrival/stay.
 * PAY_BEFORE = already paid / prepaid / online.
 */
export function parsePaymentStatus(raw: string | undefined | null): ParsedPaymentStatus | null {
  if (!raw) return null;
  const text = removeDiacritics(raw).toLowerCase();

  const payAfterHints = [
    'tai cho',
    'tai khach san',
    'khi nhan phong',
    'thanh toan sau',
    'thanh toan tai',
    'chua thanh toan',
    'pay at',
    'pay after',
    'collect',
    'at the property',
  ];
  const payBeforeHints = [
    'da thanh toan',
    'thanh toan truoc',
    'tra truoc',
    'thanh toan online',
    'prepaid',
    'pay before',
    'paid online',
    'da tra',
  ];

  if (payBeforeHints.some((hint) => text.includes(hint))) return 'PAY_BEFORE';
  if (payAfterHints.some((hint) => text.includes(hint))) return 'PAY_AFTER';
  // A bare "đã thanh toán" without other qualifiers still means prepaid.
  if (/\bda thanh toan\b/.test(text)) return 'PAY_BEFORE';
  return null;
}

/**
 * Resolves the final payment status for a booking. The rule is authoritative and
 * always yields a definite answer (never "unknown"):
 *
 *   1. If the raw text contains the credit-card-hidden sentence  -> PAY_BEFORE.
 *   2. Else if a "Thanh toán:" label clearly says prepaid/at-property, honour it
 *      (preserves the labelled synthetic format).
 *   3. Otherwise                                                  -> PAY_AFTER.
 *
 * The credit-card sentence wins over any conflicting label.
 */
export function resolvePaymentStatus(
  rawText: string,
  paymentLabelValue: string | undefined | null,
): ParsedPaymentStatus {
  if (containsCardHiddenPhrase(rawText)) return 'PAY_BEFORE';
  const labelHint = parsePaymentStatus(paymentLabelValue);
  if (labelHint) return labelHint;
  return 'PAY_AFTER';
}

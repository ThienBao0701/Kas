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
 * Strong prepayment-policy phrases (diacritic-free, whitespace-collapsed). Their
 * presence anywhere in the reservation-detail policy text means the guest is
 * charged in advance (PAY_BEFORE). Each is specific enough that a "no prepayment
 * needed" section ("không cần thanh toán trước") never matches — note the
 * "toàn bộ" / "in advance" qualifiers.
 */
const PREPAYMENT_POLICY_NEEDLES: readonly string[] = [
  'khach se phai thanh toan truoc',
  'phai thanh toan truoc toan bo',
  'thanh toan truoc toan bo tien phong',
  'prepayment required',
  'charged the total price in advance',
  'will be charged the total price in advance',
  // Agoda prepaid signals.
  'you have already paid',
  'this booking has been prepaid',
  'prepaid to agoda',
  'fully prepaid',
  'da thanh toan cho agoda',
  'da tra truoc cho agoda',
].map((p) => normalizeForPhrase(p));

/**
 * True when the raw pasted text contains the credit-card-hidden sentence.
 * Matching is diacritic- and whitespace-insensitive so broken line wrapping or
 * lost accents in the copied text cannot hide it.
 */
export function containsCardHiddenPhrase(rawText: string): boolean {
  return normalizeForPhrase(rawText).includes(CREDIT_CARD_HIDDEN_NEEDLE);
}

/** True when the text states an explicit "pay in advance" prepayment policy. */
export function containsPrepaymentPolicy(rawText: string): boolean {
  const flat = normalizeForPhrase(rawText);
  return PREPAYMENT_POLICY_NEEDLES.some((needle) => flat.includes(needle));
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
 *   2. Else if the text states an explicit prepayment policy     -> PAY_BEFORE.
 *   3. Else if a "Thanh toán:" label clearly says prepaid/at-property, honour it
 *      (preserves the labelled synthetic format).
 *   4. Otherwise                                                 -> PAY_AFTER.
 *
 * The credit-card / prepayment signals win over any conflicting label.
 */
export function resolvePaymentStatus(
  rawText: string,
  paymentLabelValue: string | undefined | null,
): ParsedPaymentStatus {
  if (containsCardHiddenPhrase(rawText)) return 'PAY_BEFORE';
  if (containsPrepaymentPolicy(rawText)) return 'PAY_BEFORE';
  const labelHint = parsePaymentStatus(paymentLabelValue);
  if (labelHint) return labelHint;
  return 'PAY_AFTER';
}

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
 * Explicit "no prepayment" phrases. Their presence means the guest pays at the
 * property (PAY_AFTER) and must override a generic "Trả trước" heading or a
 * prepayment-policy phrase that appears elsewhere in the same document — a
 * property page often shows the "Trả trước" section header even when that
 * section's body says no prepayment is needed.
 */
const NO_PREPAYMENT_NEEDLES: readonly string[] = [
  'khong can thanh toan truoc',
  'khong yeu cau thanh toan truoc',
  'khong phai thanh toan truoc',
  'no prepayment needed',
  'no prepayment is needed',
  'no prepayment required',
  'no prepayment is required',
].map((p) => normalizeForPhrase(p));

/** True when the text explicitly states that no prepayment is needed. */
export function containsNoPrepayment(rawText: string): boolean {
  const flat = normalizeForPhrase(rawText);
  return NO_PREPAYMENT_NEEDLES.some((needle) => flat.includes(needle));
}

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
 *   2. Else if the text explicitly says no prepayment is needed  -> PAY_AFTER
 *      (a negative phrase overrides a generic "Trả trước" heading or policy line).
 *   3. Else if the text states an explicit prepayment policy     -> PAY_BEFORE.
 *   4. Else if a "Thanh toán:" label clearly says prepaid/at-property, honour it
 *      (preserves the labelled synthetic format).
 *   5. Otherwise                                                 -> PAY_AFTER.
 *
 * The credit-card signal is the strongest (it means the card was already charged);
 * after it, an explicit no-prepayment statement wins over any prepayment keyword.
 */
export function resolvePaymentStatus(
  rawText: string,
  paymentLabelValue: string | undefined | null,
): ParsedPaymentStatus {
  if (containsCardHiddenPhrase(rawText)) return 'PAY_BEFORE';
  if (containsNoPrepayment(rawText)) return 'PAY_AFTER';
  if (containsPrepaymentPolicy(rawText)) return 'PAY_BEFORE';
  const labelHint = parsePaymentStatus(paymentLabelValue);
  if (labelHint) return labelHint;
  return 'PAY_AFTER';
}

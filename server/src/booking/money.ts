import { removeDiacritics } from './text';

// A grouped amount: 850.000, 2.650.000, 1,250,000 (thousands separators).
const GROUPED_AMOUNT = /\d{1,3}(?:[.,]\d{3})+/;
// A currency marker sitting next to a number.
const CURRENCY_MARKER = /(?:₫|vnd|dong|\d\s*d\b|usd|\$)/i;

/**
 * Parses a VND money token into whole đồng, or null when no amount is present.
 *
 * VND has no minor unit, so grouping separators ("." or ",") are simply removed:
 *   "850.000 VND" -> 850000, "2,650,000" -> 2650000, "850000đ" -> 850000.
 * Placeholders that explicitly mean "unknown" resolve to null — money is never
 * invented.
 */
export function parseVndAmount(raw: string | undefined | null): number | null {
  if (!raw) return null;
  const normalized = removeDiacritics(raw).toLowerCase();
  if (
    normalized.includes('chua xac dinh') ||
    normalized.includes('n/a') ||
    normalized.includes('khong xac dinh') ||
    normalized.includes('mien phi') ||
    normalized.includes('free')
  ) {
    return null;
  }
  const digits = raw.replace(/[^\d]/g, '');
  if (digits.length === 0) return null;
  const value = Number(digits);
  return Number.isSafeInteger(value) ? value : null;
}

/**
 * True when a line genuinely looks like a monetary amount, so a bare time
 * ("14:00"), a night count ("3 đêm") or a PIN ("Mã PIN 4821") is never mistaken
 * for money. Requires either a thousands-grouped number or a currency marker
 * sitting next to a run of at least four digits.
 */
export function looksLikeMoney(raw: string | undefined | null): boolean {
  if (!raw) return false;
  if (GROUPED_AMOUNT.test(raw)) return true;
  if (CURRENCY_MARKER.test(raw) && /\d{4,}/.test(raw.replace(/[.,]/g, ''))) return true;
  return false;
}

/**
 * Extracts the *first* monetary amount from a line, or null when none is
 * present. Only the first amount is read so a line carrying both a crossed-out
 * original price and a final price does not concatenate into a nonsense number —
 * strip anything you do not want (dates, the original price) before calling.
 */
export function parseFirstAmount(raw: string | undefined | null): number | null {
  if (!raw) return null;
  const s = removeDiacritics(raw).toLowerCase();
  if (
    s.includes('chua xac dinh') ||
    s.includes('khong xac dinh') ||
    s.includes('mien phi') ||
    s.includes('n/a') ||
    s.includes('free')
  ) {
    return null;
  }
  const grouped = s.match(/\d{1,3}(?:[.,]\d{3})+/);
  if (grouped) return toWholeVnd(grouped[0]);
  const tagged =
    s.match(/(\d{4,})\s*(?:vnd|dong|d|₫)\b/) ?? s.match(/(?:vnd|\$|₫)\s*(\d{4,})/);
  if (tagged && tagged[1]) return toWholeVnd(tagged[1]);
  return null;
}

function toWholeVnd(token: string): number | null {
  const digits = token.replace(/[^\d]/g, '');
  if (digits.length === 0) return null;
  const value = Number(digits);
  return Number.isSafeInteger(value) ? value : null;
}

/**
 * Splits a whole-VND total into `parts` integer amounts that sum EXACTLY to the
 * total. VND has no minor unit, so an indivisible remainder is distributed one
 * đồng at a time to the EARLIEST parts (deterministic largest-remainder):
 *
 *   allocateEvenly(1_016_710, 2) -> [508_355, 508_355]
 *   allocateEvenly(1_000_001, 2) -> [500_001, 500_000]
 *
 * The total is never rounded, never changed and the remainder is never lost.
 * Returns [] for a non-positive part count.
 */
export function allocateEvenly(total: number, parts: number): number[] {
  if (!Number.isFinite(total) || !Number.isFinite(parts) || parts <= 0) return [];
  const whole = Math.trunc(total);
  const base = Math.trunc(whole / parts);
  const remainder = whole - base * parts;
  return Array.from({ length: parts }, (_, i) => base + (i < remainder ? 1 : 0));
}

/** Detects an explicit currency token in a value, defaulting to null. */
export function detectCurrency(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const upper = raw.toUpperCase();
  if (upper.includes('VND') || raw.includes('₫')) return 'VND';
  const noDiacritics = removeDiacritics(raw).toLowerCase();
  // "dong", or "đ" (folded to d) right after the amount: "850.000 đ", "850000d".
  if (noDiacritics.includes('dong') || /\d\s*d\b/.test(noDiacritics)) return 'VND';
  if (upper.includes('USD') || raw.includes('$')) return 'USD';
  return null;
}

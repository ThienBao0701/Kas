/**
 * Text-normalisation helpers used across the extraction engine so that
 * Vietnamese diacritics and inconsistent spacing never break matching.
 */

/** Strips Vietnamese (and other) diacritics and folds d-stroke to d. */
export function removeDiacritics(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

// Horizontal whitespace variants Booking.com pastes in: tab, NBSP, narrow/thin/
// en/em/hair spaces, ideographic space. Written with \u escapes so the source
// stays pure ASCII and passes no-irregular-whitespace.
const HORIZONTAL_WS = /[\t\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/g;
// Zero-width space / non-joiner / joiner / BOM: carry no meaning here. Written
// as an alternation (not a character class) to satisfy no-misleading-character-class.
const ZERO_WIDTH = /\u200b|\u200c|\u200d|\ufeff/g;

/**
 * Collapses the whitespace noise that Booking.com's copied text is full of:
 * non-breaking spaces, thin/en/em spaces, tabs and zero-width characters all
 * become a single ASCII space (or nothing). Line breaks are preserved.
 */
export function normalizeWhitespace(input: string): string {
  return input
    .replace(/\r\n?/g, '\n')
    .replace(HORIZONTAL_WS, ' ')
    .replace(ZERO_WIDTH, '')
    .replace(/ {2,}/g, ' ');
}

/**
 * Lower-cased, diacritic-free, alphanumeric-token form used for label and hotel
 * matching. "Dien thoai" -> "dien thoai", "Phong 1" -> "phong 1".
 */
export function normalizeText(input: string): string {
  return removeDiacritics(input)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Whole-document form for substring phrase checks (e.g. the credit-card rule):
 * diacritic-free, lower-cased, every whitespace run collapsed to one space so
 * broken line-wrapping in the pasted text cannot hide a phrase.
 */
export function normalizeForPhrase(input: string): string {
  return removeDiacritics(input)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Splits into non-empty, trimmed lines after collapsing whitespace noise. */
export function toLines(raw: string): string[] {
  return normalizeWhitespace(raw)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

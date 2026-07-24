/**
 * Normalisation helpers for the compare engine. Comparison is deterministic and
 * accent/case-insensitive, but never *loosely* fuzzy: it uses controlled alias
 * maps and a bounded edit-distance, so it errs toward WARNING rather than a false
 * MATCH. Money/date parsing is reused from the OCR normaliser.
 */
export { normalizeMoney, normalizeDate } from '../ocr/normalize';

const COMBINING_MARKS = /[̀-ͯ]/g;

/** Lower-cases, strips Vietnamese diacritics (incl. đ) and trims. */
export function fold(s: string | null | undefined): string {
  return (s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .replace(/đ/g, 'd')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Digits only — used for booking-code equality (no fuzzy repair). */
export function digitsOnly(s: string | null | undefined): string {
  return (s ?? '').replace(/\D/g, '');
}

// Room-type class keywords → canonical token. Class keywords win over bed
// keywords (so "Phòng Tiêu Chuẩn Giường Đôi" → STAN, not DBL). Aliases include the
// abbreviations OCR may surface directly (STAN / SUP / DLX / …).
const ROOM_ALIASES: ReadonlyArray<{ keys: string[]; canon: string }> = [
  { keys: ['standard', 'tieu chuan', 'stan'], canon: 'STANDARD' },
  { keys: ['superior', 'sup'], canon: 'SUPERIOR' },
  { keys: ['deluxe', 'dlx'], canon: 'DELUXE' },
  { keys: ['suite'], canon: 'SUITE' },
  { keys: ['family', 'gia dinh', 'fam'], canon: 'FAMILY' },
  { keys: ['twin', 'hai giuong don'], canon: 'TWIN' },
  { keys: ['double', 'giuong doi', 'dbl'], canon: 'DOUBLE' },
];

/**
 * Canonical room-type token via the controlled alias map, or null when nothing in
 * the map is recognised (the caller treats an unknown type as ambiguous →
 * WARNING, never a silent match). English parentheticals are ignored by folding.
 */
export function canonicalRoomType(roomType: string | null | undefined): string | null {
  const folded = fold(roomType);
  if (folded.length === 0) return null;
  for (const { keys, canon } of ROOM_ALIASES) {
    if (keys.some((k) => new RegExp(`\\b${k}\\b`).test(folded) || folded.includes(k))) return canon;
  }
  return null;
}

/** Bounded Levenshtein distance (early-exits at `max + 1`). */
export function editDistance(a: string, b: string, max = 3): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = curr[0]!;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
      rowMin = Math.min(rowMin, curr[j]!);
    }
    if (rowMin > max) return max + 1;
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j]!;
  }
  return prev[b.length]!;
}

/** Sorted, folded token set — order-insensitive name comparison. */
export function tokenSet(s: string | null | undefined): string {
  return fold(s).split(' ').filter(Boolean).sort().join(' ');
}

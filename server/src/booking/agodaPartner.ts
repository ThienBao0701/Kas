/**
 * Agoda **hotel-partner (YCS) booking email** parser.
 *
 * This is a different document from the guest-facing Agoda confirmation page that
 * `agoda.ts` already handles: the partner email carries the hotel's commercial
 * rows ("Reference sell rate", "Net rate", "Commission", …) plus a labelled
 * reservation table. It is parsed here by a dedicated deterministic extractor so
 * the operator's exact two-line PMS note can be produced.
 *
 * Hard rules encoded below:
 *  - The PMS note's first amount is ALWAYS the labelled **Net rate**; the second is
 *    ALWAYS the labelled **Reference sell rate**. Commission, promotions,
 *    withholding tax, tax-on-commission and compensation rows are never used and
 *    are never arithmetically derived.
 *  - Nights = checkOut − checkIn (calendar days only), never the nightly-row count.
 *  - Room quantity comes only from "No. of Rooms" — never occupancy/adults/beds.
 *  - An unknown room type is preserved verbatim and flagged for manual review; it
 *    is never guessed into an existing code.
 *  - Everything is pure and deterministic.
 */
import { findDate } from './dates';
import { allocateEvenly } from './money';
import { removeDiacritics } from './text';
import type { ExtractWarning } from './types';

/** Version stamp for the partner-email extraction rules. */
export const AGODA_PARTNER_PARSER_VERSION = 'agoda-partner-1.0.0';

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------
/** Lower-cases, strips diacritics and collapses whitespace (comparison only). */
export function fold(s: string | null | undefined): string {
  return removeDiacritics(s ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function lines(rawText: string): string[] {
  return rawText.split(/\r?\n/).map((l) => l.trim());
}

/**
 * Reads a labelled value. Handles both "Label: value" on one line and a "Label:"
 * line whose value sits on the following non-empty line (the common table
 * rendering). Returns null when the label is absent or carries no value.
 */
function labelValue(all: string[], labelPattern: RegExp): string | null {
  for (let i = 0; i < all.length; i++) {
    const line = all[i]!;
    if (!labelPattern.test(fold(line))) continue;
    // Same-line value after the first ":".
    const colon = line.indexOf(':');
    if (colon >= 0) {
      const inline = line.slice(colon + 1).trim();
      if (inline.length > 0) return inline;
    }
    // Otherwise the next non-empty line.
    for (let j = i + 1; j < all.length && j <= i + 3; j++) {
      const next = all[j]!;
      if (next.length > 0) return next;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------
/** Normalises a single money TOKEN ("1,016,710.00") to whole VND. */
function tokenToVnd(token: string): number | null {
  // Drop a 2-digit decimal fraction (".00" / ",00"); 3-digit groups are kept.
  const digits = token.replace(/[.,]\d{2}$/, '').replace(/[^\d]/g, '');
  if (digits.length === 0) return null;
  const value = Number(digits);
  return Number.isSafeInteger(value) ? value : null;
}

/**
 * Extracts an Agoda money amount from a line and normalises it to whole VND.
 *
 * Handles "VND 1,016,710.00", "VND 508,355.00", "1,680,000 VND" and
 * "1.016.710 VND". A trailing separator followed by exactly two digits is a
 * decimal fraction and is dropped; a separator followed by three digits is a
 * thousands group and is kept.
 *
 * The currency-adjacent forms are tried FIRST so a date on the same row
 * ("July 27, 2026  VND 508,355.00") can never be read as the amount. Returns null
 * when no amount is present — money is never invented.
 */
export function parseAgodaMoney(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const tagged =
    raw.match(/(?:VND|₫)\s*(\d[\d.,]*)/i) ??
    raw.match(/(\d[\d.,]*)\s*(?:VND|₫)/i);
  if (tagged?.[1]) return tokenToVnd(tagged[1]);
  // Untagged: require a real thousands group so a bare year is never money.
  const grouped = raw.match(/\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{2})?/);
  if (grouped) return tokenToVnd(grouped[0]);
  return null;
}

/** Formats whole VND with Vietnamese dot separators: 1016710 → "1.016.710". */
export function formatVndDots(amount: number): string {
  const sign = amount < 0 ? '-' : '';
  const digits = Math.abs(Math.trunc(amount)).toString();
  return sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

// ---------------------------------------------------------------------------
// Room-type mapping
// ---------------------------------------------------------------------------
/**
 * Room-type → internal abbreviation. **Order matters**: the most specific
 * patterns are evaluated first, so "Deluxe Room - 01" resolves to LUXDEL (not
 * DEL), "Deluxe Family" to DEFAM (not DEL/FAM) and "Deluxe Balcony" to DEBAL.
 * Patterns run against the folded (accent-free, lower-case) room type.
 */
const ROOM_CODE_RULES: ReadonlyArray<{ code: string; test: RegExp }> = [
  { code: 'LUXDEL', test: /\bdeluxe\s+room\s*-\s*0*1\b/ },
  { code: 'DD', test: /\bd\s*-\s*d\s+room\s*-\s*0*3\b/ },
  { code: 'DD', test: /\bdeluxe\s+giuong\s+doi\b/ },
  { code: 'DEBAL', test: /\bdeluxe\s+balcony\b/ },
  { code: 'KINGBAL', test: /\bking\s+balcony\b/ },
  { code: 'DEFAM', test: /\bdeluxe\s+family\b/ },
  { code: 'STAN', test: /\bstandard\b/ },
  { code: 'SUP', test: /\bsuperior\b/ },
  { code: 'DEL', test: /\bdeluxe\b/ },
  { code: 'FAM', test: /\bfamily\b/ },
];

/**
 * Normalises a raw room type for matching: folds case/accents, removes a
 * parenthetical numeric suffix such as "(0)" and harmless punctuation noise, and
 * collapses whitespace. The ORIGINAL text is always preserved by the caller.
 */
export function normalizeRoomType(raw: string | null | undefined): string {
  return fold(
    (raw ?? '')
      .replace(/\(\s*\d+\s*\)/g, ' ') // "(0)" numeric suffix
      .replace(/[·•|]+/g, ' '),
  );
}

export interface RoomCodeResult {
  /** The abbreviation, or null when the type is not in the controlled map. */
  code: string | null;
  /** The original room-type text, always preserved verbatim. */
  original: string | null;
  /** False when the type is unknown and needs manual review. */
  known: boolean;
}

/** Maps a room type to its abbreviation using the controlled, ordered map. */
export function mapAgodaRoomCode(raw: string | null | undefined): RoomCodeResult {
  const original = raw && raw.trim().length > 0 ? raw.trim() : null;
  const normalized = normalizeRoomType(raw);
  if (normalized.length === 0) return { code: null, original, known: false };
  for (const rule of ROOM_CODE_RULES) {
    if (rule.test.test(normalized)) return { code: rule.code, original, known: true };
  }
  return { code: null, original, known: false };
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------
// Partner-email-specific markers. A generic "booking confirmation" is NOT one.
const PARTNER_MARKERS: readonly RegExp[] = [
  /reference sell rate/,
  /net rate/,
  /customer first name/,
  /customer last name/,
  /no\.? of rooms/,
  /no\.? of extra bed/,
  /rate ?plan/,
  /reservation information/,
];

// Markers that identify Agoda at all (domain / explicit Agoda booking id).
const AGODA_MARKERS: readonly RegExp[] = [/agoda\.com/, /agoda booking id/, /\bagoda\b/];

/** Counts how many of the given patterns appear in the folded text. */
function countMarkers(folded: string, patterns: readonly RegExp[]): number {
  return patterns.reduce((n, p) => (p.test(folded) ? n + 1 : n), 0);
}

/**
 * True for an Agoda **hotel-partner** booking email. Requires at least two
 * partner-specific markers, so a Booking.com email, a manually typed booking or a
 * generic "Booking confirmation" line can never be misclassified.
 */
export function isAgodaPartnerEmail(rawText: string): boolean {
  return countMarkers(fold(rawText), PARTNER_MARKERS) >= 2;
}

/**
 * True when the text is an Agoda document at all — an agoda.com domain or an
 * explicit "Agoda Booking ID", or the partner format. Never decided by a generic
 * phrase such as "Booking confirmation" on its own.
 */
export function isAgodaEmail(rawText: string): boolean {
  const folded = fold(rawText);
  if (/agoda\.com/.test(folded) || /agoda booking id/.test(folded)) return true;
  if (isAgodaPartnerEmail(rawText)) return true;
  // A bare "agoda" mention only counts alongside a booking-id style marker.
  return countMarkers(folded, AGODA_MARKERS) >= 1 && /booking id/.test(folded);
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------
export interface AgodaNightlyRate {
  /** ISO "YYYY-MM-DD". */
  stayDate: string;
  amount: number | null;
}

export interface AgodaPartnerBooking {
  source: 'AGODA';
  bookingId: string | null;
  /**
   * The public Agoda property name ("KAS Sonata Luxury Hotel"). This is a
   * branch-RESOLUTION input only — the normalized booking shows the resolved
   * branch address, exactly like Booking.com. Agoda's Property ID is never read.
   */
  sourceHotelName: string | null;
  customerFirstName: string | null;
  customerLastName: string | null;
  customerFullName: string | null;
  countryOfResidence: string | null;
  /** ISO "YYYY-MM-DD". */
  checkIn: string | null;
  checkOut: string | null;
  /** checkOut − checkIn in calendar days; null when either date is unusable. */
  nights: number | null;
  roomTypeOriginal: string | null;
  roomCode: string | null;
  roomTypeKnown: boolean;
  roomQuantity: number | null;
  occupancy: string | null;
  extraBeds: number | null;
  payment: string | null;
  ratePlan: string | null;
  cancellationPolicy: string | null;
  customerPhone: string | null;
  customerNotes: string | null;
  /** Agoda's own per-night rows. Diagnostics/consistency only — NOT the debt schedule. */
  nightlyRates: AgodaNightlyRate[];
  /** The guest booking price ("Giá khách đặt"). */
  referenceSellRate: number | null;
  /** The TOTAL hotel receivable / debt. Drives PMS-note line 1 and the schedule. */
  netRate: number | null;
  /**
   * The authoritative internal debt schedule: the total Net rate split evenly over
   * the stay nights (check-in inclusive → check-out exclusive), summing exactly to
   * the Net rate. Never derived from Agoda's own nightly rows.
   */
  nightlyDebt: AgodaNightlyRate[];
  warnings: ExtractWarning[];
  parserVersion: string;
}

const warn = (code: string, message: string, severity: ExtractWarning['severity'] = 'WARNING'): ExtractWarning => ({ code, message, severity });

/** Whole calendar days between two ISO dates, or null when invalid/negative. */
export function nightsBetween(checkIn: string | null, checkOut: string | null): number | null {
  if (!checkIn || !checkOut) return null;
  const a = Date.parse(`${checkIn}T00:00:00Z`);
  const b = Date.parse(`${checkOut}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  const diff = Math.round((b - a) / 86_400_000);
  return diff > 0 ? diff : null;
}

/**
 * Finds a labelled rate row. Prefers the "(incl. taxes & fees)" variant and takes
 * the LAST such row (the final total), so a per-night or interim row can never
 * shadow the authoritative amount. Commission / promotion / tax rows are never
 * consulted because the label itself must match.
 */
function findRate(all: string[], labelPattern: RegExp): number | null {
  const withIncl: number[] = [];
  const plain: number[] = [];
  for (let i = 0; i < all.length; i++) {
    const line = all[i]!;
    const folded = fold(line);
    if (!labelPattern.test(folded)) continue;
    // The amount sits on the label line, or on the next non-empty line.
    let amount = parseAgodaMoney(line);
    if (amount == null) {
      for (let j = i + 1; j < all.length && j <= i + 2; j++) {
        if (all[j]!.length === 0) continue;
        amount = parseAgodaMoney(all[j]!);
        break;
      }
    }
    if (amount == null) continue;
    (/incl/.test(folded) ? withIncl : plain).push(amount);
  }
  // Prefer the "(incl. taxes & fees)" rows and take the LAST (the final total).
  const pool = withIncl.length > 0 ? withIncl : plain;
  return pool.length > 0 ? pool[pool.length - 1]! : null;
}

/** Rows that are commercial summaries, never per-night stay rows. */
const SUMMARY_ROW =
  /reference sell rate|net rate|commission|promotion|withholding|tax on|compensation|other program|total/;

/** Reads the nightly-rate rows ("July 27, 2026  VND 508,355.00"). */
function extractNightlyRates(all: string[]): AgodaNightlyRate[] {
  const out: AgodaNightlyRate[] = [];
  const seen = new Set<string>();
  for (const line of all) {
    if (SUMMARY_ROW.test(fold(line))) continue;
    // A nightly row needs BOTH a date and an explicit currency-tagged amount.
    if (!/(?:VND|₫)\s*\d|\d\s*(?:VND|₫)/i.test(line)) continue;
    const iso = findDate(line);
    if (!iso || seen.has(iso)) continue;
    seen.add(iso);
    out.push({ stayDate: iso, amount: parseAgodaMoney(line) });
  }
  return out;
}

/**
 * Extracts the Agoda partner booking. Never throws: missing values become null
 * and a warning, so the Admin sees exactly what needs manual review.
 */
export function parseAgodaPartnerBooking(rawText: string): AgodaPartnerBooking {
  const all = lines(rawText);
  const warnings: ExtractWarning[] = [];

  const bookingId = (labelValue(all, /(?:agoda )?booking id/) ?? '').replace(/[^\d A-Za-z-]/g, '').trim() || null;
  if (!bookingId) warnings.push(warn('AGODA_MISSING_BOOKING_ID', 'Không đọc được Booking ID của Agoda.', 'ERROR'));

  const first = labelValue(all, /customer first name/);
  const last = labelValue(all, /customer last name/);
  const fullName = [first, last].filter((p) => p && p.length > 0).join(' ').trim() || null;
  if (!fullName) warnings.push(warn('AGODA_MISSING_CUSTOMER', 'Không đọc được tên khách chính.'));

  const checkIn = findDate(labelValue(all, /check[- ]?in/) ?? '');
  const checkOut = findDate(labelValue(all, /check[- ]?out/) ?? '');
  if (!checkIn) warnings.push(warn('AGODA_MISSING_CHECK_IN', 'Không đọc được ngày nhận phòng.', 'ERROR'));
  if (!checkOut) warnings.push(warn('AGODA_MISSING_CHECK_OUT', 'Không đọc được ngày trả phòng.', 'ERROR'));
  const nights = nightsBetween(checkIn, checkOut);
  if (checkIn && checkOut && nights == null) {
    warnings.push(warn('AGODA_INVALID_DATE_RANGE', 'Ngày trả phòng phải sau ngày nhận phòng.', 'ERROR'));
  }

  const roomTypeRaw = labelValue(all, /room ?type/);
  const room = mapAgodaRoomCode(roomTypeRaw);
  if (!room.original) {
    warnings.push(warn('AGODA_MISSING_ROOM_TYPE', 'Không đọc được hạng phòng.', 'ERROR'));
  } else if (!room.known) {
    warnings.push(
      warn('AGODA_UNKNOWN_ROOM_TYPE', `Hạng phòng "${room.original}" chưa có mã nội bộ — cần kiểm tra thủ công.`, 'ERROR'),
    );
  }

  const roomsRaw = labelValue(all, /no\.? of rooms/);
  const roomQuantity = roomsRaw ? Number.parseInt(roomsRaw.replace(/[^\d]/g, ''), 10) : NaN;
  const roomQty = Number.isFinite(roomQuantity) && roomQuantity > 0 ? roomQuantity : null;
  if (roomQty == null) warnings.push(warn('AGODA_MISSING_ROOM_QUANTITY', 'Không đọc được số lượng phòng.', 'ERROR'));

  const extraBedRaw = labelValue(all, /no\.? of extra bed/);
  const extraParsed = extraBedRaw ? Number.parseInt(extraBedRaw.replace(/[^\d]/g, ''), 10) : NaN;

  const referenceSellRate = findRate(all, /reference sell rate/);
  if (referenceSellRate == null) {
    warnings.push(warn('AGODA_MISSING_SELL_RATE', 'Không đọc được "Reference sell rate" — cần kiểm tra thủ công.', 'ERROR'));
  }
  const netRate = findRate(all, /net rate/);
  if (netRate == null) {
    warnings.push(warn('AGODA_MISSING_NET_RATE', 'Không đọc được "Net rate" — cần kiểm tra thủ công.', 'ERROR'));
  }

  const paymentRaw = labelValue(all, /^payment|payment (?:type|model|method)/);
  const payment = paymentRaw ? paymentRaw.trim().toUpperCase().slice(0, 40) : /\bprepaid\b/.test(fold(rawText)) ? 'PREPAID' : null;

  // The authoritative debt schedule: the TOTAL Net rate split evenly per night.
  // Agoda's own nightly rows are never used for this; they are only cross-checked.
  const stayDates = checkIn && nights != null ? stayDatesFrom(checkIn, nights) : [];
  const nightlyDebt: AgodaNightlyRate[] =
    netRate != null && stayDates.length > 0
      ? allocateEvenly(netRate, stayDates.length).map((amount, i) => ({ stayDate: stayDates[i]!, amount }))
      : [];
  const nightlyRates = extractNightlyRates(all);
  if (nightlyDebt.length > 0 && nightlyRates.length > 0 && differsFromAgodaRows(nightlyDebt, nightlyRates)) {
    warnings.push(
      warn(
        'AGODA_NIGHTLY_ROWS_DIFFER',
        'Giá từng đêm Agoda khác với công nợ chia đều — vui lòng kiểm tra (tổng công nợ giữ nguyên).',
        'INFO',
      ),
    );
  }

  return {
    source: 'AGODA',
    bookingId,
    sourceHotelName: extractHotelName(all),
    customerFirstName: first,
    customerLastName: last,
    customerFullName: fullName,
    countryOfResidence: labelValue(all, /country of residence/),
    checkIn,
    checkOut,
    nights,
    roomTypeOriginal: room.original,
    roomCode: room.code,
    roomTypeKnown: room.known,
    roomQuantity: roomQty,
    occupancy: labelValue(all, /occupancy/),
    extraBeds: Number.isFinite(extraParsed) ? extraParsed : null,
    payment,
    ratePlan: labelValue(all, /rate ?plan(?: name)?/),
    cancellationPolicy: labelValue(all, /cancellation policy/),
    customerPhone: labelValue(all, /(?:customer )?(?:phone|mobile|contact number)/),
    customerNotes: labelValue(all, /customer notes?|special request|remarks?/),
    nightlyRates,
    referenceSellRate,
    netRate,
    nightlyDebt,
    warnings,
    parserVersion: AGODA_PARTNER_PARSER_VERSION,
  };
}

/** Stay dates: check-in inclusive → check-out exclusive. */
function stayDatesFrom(checkInIso: string, nights: number): string[] {
  const start = Date.parse(`${checkInIso}T00:00:00Z`);
  if (Number.isNaN(start)) return [];
  return Array.from({ length: nights }, (_, i) => new Date(start + i * 86_400_000).toISOString().slice(0, 10));
}

/** True when Agoda's own rows disagree with the generated equal allocation. */
function differsFromAgodaRows(debt: AgodaNightlyRate[], rows: AgodaNightlyRate[]): boolean {
  const byDate = new Map(rows.map((r) => [r.stayDate, r.amount]));
  return debt.some((d) => {
    const stated = byDate.get(d.stayDate);
    return stated != null && stated !== d.amount;
  });
}

/**
 * The public Agoda property name. Agoda renders it above a "(Property ID …)" line;
 * the id is deliberately ignored — it is never read, stored, shown or tested.
 */
function extractHotelName(all: string[]): string | null {
  const labelled = labelValue(all, /property name|hotel name/);
  const candidate = labelled ?? all.find((l) => /^kas\b/i.test(l.trim())) ?? null;
  if (!candidate) return null;
  const cleaned = candidate
    .replace(/\(\s*property\s*id[^)]*\)/gi, ' ') // drop "(Property ID 245858)"
    .replace(/\bproperty\s*id\b\s*:?\s*\d+/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return cleaned.length > 0 ? cleaned : null;
}

// ---------------------------------------------------------------------------
// PMS note
// ---------------------------------------------------------------------------
export interface AgodaPmsNoteResult {
  ok: boolean;
  /** The exact two-line note when ok. */
  text?: string;
  /** A user-facing reason when the note cannot be generated. */
  error?: string;
}

/**
 * Builds the operator's exact two-line Agoda note:
 *
 *   AGD <BOOKING_ID>_<QTY><ROOM_CODE>_<NIGHTS>DEM <NET_RATE> CN
 *   GIÁ KHÁCH ĐẶT <REFERENCE_SELL_RATE> KHONG AN SANG
 *
 * The breakfast phrase is a fixed Agoda business rule: guest benefits such as
 * coffee/tea, drinking water or a welcome drink are NOT breakfast, so the second
 * line always ends "KHONG AN SANG".
 */
export function buildAgodaPmsNote(b: AgodaPartnerBooking): AgodaPmsNoteResult {
  const missing: string[] = [];
  if (!b.bookingId) missing.push('Booking ID');
  if (b.roomQuantity == null) missing.push('số lượng phòng');
  if (!b.roomCode) missing.push('mã hạng phòng');
  if (b.nights == null) missing.push('số đêm');
  if (b.netRate == null) missing.push('Net rate');
  if (b.referenceSellRate == null) missing.push('Reference sell rate');
  if (missing.length > 0) {
    return { ok: false, error: `Chưa đủ dữ liệu để tạo ghi chú Agoda: ${missing.join(', ')}.` };
  }

  const line1 = `AGD ${b.bookingId}_${b.roomQuantity}${b.roomCode}_${b.nights}DEM ${formatVndDots(b.netRate!)} CN`;
  const line2 = `GIÁ KHÁCH ĐẶT ${formatVndDots(b.referenceSellRate!)} KHONG AN SANG`;
  return { ok: true, text: `${line1}\n${line2}` };
}

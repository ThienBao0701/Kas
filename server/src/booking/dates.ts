/**
 * Date parsing and stay-night generation. All dates are handled as date-only
 * values at UTC midnight and represented as ISO "YYYY-MM-DD" strings inside the
 * parser (the store converts to Date objects for Prisma).
 */

import { removeDiacritics } from './text';

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

function buildIso(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  // Reject impossible dates such as 2026-02-30 (which JS would roll over).
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return `${year.toString().padStart(4, '0')}-${pad2(month)}-${pad2(day)}`;
}

/**
 * Parses a leading date token, returning the ISO date and the remaining text.
 * Supported: ISO "YYYY-MM-DD" and day-first "DD/MM/YYYY" (also "." or "-"),
 * matching how Booking.com text and Vietnamese locale present dates.
 */
export function parseLeadingDate(raw: string): { iso: string; rest: string } | null {
  const isoMatch = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(.*)$/);
  if (isoMatch) {
    const iso = buildIso(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));
    if (iso) return { iso, rest: (isoMatch[4] ?? '').trim() };
  }
  const dmyMatch = raw.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})(.*)$/);
  if (dmyMatch) {
    const iso = buildIso(Number(dmyMatch[3]), Number(dmyMatch[2]), Number(dmyMatch[1]));
    if (iso) return { iso, rest: (dmyMatch[4] ?? '').trim() };
  }
  return null;
}

// English month names (and common 3-letter abbreviations) -> month number.
const MONTH_NAMES: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function monthFromName(word: string): number | null {
  const key = word.slice(0, 3).toLowerCase();
  return MONTH_NAMES[key] ?? null;
}

/**
 * Finds the first real calendar date anywhere in a noisy line and returns its
 * ISO form, tolerating the weekday/time/label text Booking.com wraps around it.
 * Recognised forms (Vietnamese and English):
 *   - ISO           2026-07-19
 *   - Day-first     19/07/2026, 19.07.2026, 19-07-2026
 *   - Vietnamese    "Thứ Bảy, 19 tháng 7 2026", "19 Thg 7, 2026"
 *   - English long  "Sat, 19 July 2026", "July 19, 2026"
 * Returns null when no valid date is present (times like "14:00" are ignored).
 */
export function findDate(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const text = raw.trim();
  if (text.length === 0) return null;

  // ISO anywhere.
  const iso = text.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    const built = buildIso(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    if (built) return built;
  }

  // Day-first numeric anywhere (guard the 4-digit year so a time like 14:00 or a
  // grouped amount 850.000 is never read as a date).
  const dmy = text.match(/(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})/);
  if (dmy) {
    const built = buildIso(Number(dmy[3]), Number(dmy[2]), Number(dmy[1]));
    if (built) return built;
  }

  // Named-month forms run on the diacritic-free text ("tháng" -> "thang").
  const flat = removeDiacritics(text).toLowerCase();

  // Vietnamese: "19 thang 7 2026" / "19 thg 7, 2026".
  const vi = flat.match(/(\d{1,2})\s*(?:thang|thg)\s*(\d{1,2})\D{1,4}(\d{4})/);
  if (vi) {
    const built = buildIso(Number(vi[3]), Number(vi[2]), Number(vi[1]));
    if (built) return built;
  }

  // English day-first: "19 July 2026" / "19 Jul, 2026".
  const enDay = flat.match(/(\d{1,2})\s+([a-z]{3,9})\.?,?\s+(\d{4})/);
  if (enDay) {
    const month = monthFromName(enDay[2] ?? '');
    if (month) {
      const built = buildIso(Number(enDay[3]), month, Number(enDay[1]));
      if (built) return built;
    }
  }

  // English month-first: "July 19, 2026".
  const enMonth = flat.match(/([a-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/);
  if (enMonth) {
    const month = monthFromName(enMonth[1] ?? '');
    if (month) {
      const built = buildIso(Number(enMonth[3]), month, Number(enMonth[2]));
      if (built) return built;
    }
  }

  return null;
}

// English month names for a year-less rate row.
const RANGE_MONTH_NAMES: Record<string, number> = MONTH_NAMES;

function monthFromEn(name: string | undefined): number | null {
  return name ? (RANGE_MONTH_NAMES[name.slice(0, 3)] ?? null) : null;
}

function prevMonth(month: number): number {
  return month === 1 ? 12 : month - 1;
}

interface RangeEndpoints {
  day1: number;
  month1: number | null;
  day2: number;
  month2: number | null;
}

/**
 * Parses the two endpoints (and any printed months) of a year-less nightly-rate
 * range row. Supports every layout Booking.com emits for the row, in Vietnamese
 * and English, with the month attached to either endpoint, both, or only the
 * second — including a month-boundary row where the second endpoint rolls into a
 * new month:
 *
 *   A  "26 - 27 Tháng 7"              (bare days, trailing VN month)
 *   B  "31 - 01 Tháng 8"             (month boundary: start is the previous month)
 *   C  "Tháng 7 31 - 01 Tháng 8"     (explicit month on both endpoints)
 *   D  "31 Jul - 01 Aug"            (English, day-first, month on both)
 *   E  "Jul 31 - Aug 01"            (English, month-first, month on both)
 *      plus the English single-month variants "31 - 01 Aug" and "Jul 31 - 01".
 *
 * Returns null for anything that is not a range row.
 */
function parseRangeEndpoints(flat: string): RangeEndpoints | null {
  // Vietnamese, explicit leading month (Format C), trailing month optional.
  let m = flat.match(/^(?:thang|thg)\s*(\d{1,2})\s+(\d{1,2})\s*[-–]\s*(\d{1,2})(?:\s*(?:thang|thg)\s*(\d{1,2}))?\b/);
  if (m) {
    return { month1: Number(m[1]), day1: Number(m[2]), day2: Number(m[3]), month2: m[4] ? Number(m[4]) : null };
  }
  // Vietnamese, bare days with a trailing month (Formats A and B).
  m = flat.match(/^(\d{1,2})\s*[-–]\s*(\d{1,2})\s*(?:thang|thg)\s*(\d{1,2})\b/);
  if (m) {
    return { month1: null, day1: Number(m[1]), day2: Number(m[2]), month2: Number(m[3]) };
  }
  // English, day-first, month on both endpoints (Format D).
  m = flat.match(/^(\d{1,2})\s+([a-z]{3,9})\s*[-–]\s*(\d{1,2})\s+([a-z]{3,9})\b/);
  if (m) {
    const mo1 = monthFromEn(m[2]);
    const mo2 = monthFromEn(m[4]);
    if (mo1 && mo2) return { month1: mo1, day1: Number(m[1]), day2: Number(m[3]), month2: mo2 };
  }
  // English, month-first, month on both endpoints (Format E).
  m = flat.match(/^([a-z]{3,9})\s+(\d{1,2})\s*[-–]\s*([a-z]{3,9})\s+(\d{1,2})\b/);
  if (m) {
    const mo1 = monthFromEn(m[1]);
    const mo2 = monthFromEn(m[3]);
    if (mo1 && mo2) return { month1: mo1, day1: Number(m[2]), day2: Number(m[4]), month2: mo2 };
  }
  // English, bare days with a trailing month ("31 - 01 Aug", "23 - 24 Jul").
  m = flat.match(/^(\d{1,2})\s*[-–]\s*(\d{1,2})\s+([a-z]{3,9})\b/);
  if (m) {
    const mo2 = monthFromEn(m[3]);
    if (mo2) return { month1: null, day1: Number(m[1]), day2: Number(m[2]), month2: mo2 };
  }
  // English, month-first, leading month only ("Jul 31 - 01").
  m = flat.match(/^([a-z]{3,9})\s+(\d{1,2})\s*[-–]\s*(\d{1,2})\b/);
  if (m) {
    const mo1 = monthFromEn(m[1]);
    if (mo1) return { month1: mo1, day1: Number(m[2]), day2: Number(m[3]), month2: null };
  }
  return null;
}

/**
 * The stay date (the FIRST day of the range) of a Booking.com nightly-rate-table
 * row that shows a date range *without a year*. The second day is that night's
 * check-out and is ignored. The year is not printed, so it is inferred from the
 * reservation (`yearHint`, the check-in year).
 *
 * Crucially this normalizes a month-boundary row without shifting later nights:
 * when only the second endpoint carries a month and the first day is greater than
 * the second (e.g. "31 - 01 Tháng 8"), the start belongs to the *previous* month
 * (31 July, not 31 August). When both endpoints carry a month, each is honoured
 * directly. Returns null for anything that is not a range row.
 */
export function parseDateRangeStayDate(
  raw: string | undefined | null,
  yearHint: number | null,
): string | null {
  if (!raw || yearHint === null) return null;
  const flat = removeDiacritics(raw).trim().toLowerCase();

  const ends = parseRangeEndpoints(flat);
  if (!ends) return null;

  let month1 = ends.month1;
  if (month1 === null) {
    if (ends.month2 === null) return null; // no month printed anywhere
    // Same month when the days ascend ("26 - 27"); a descending pair ("31 - 01")
    // is a month rollover, so the start is the month before the printed one.
    month1 = ends.day1 <= ends.day2 ? ends.month2 : prevMonth(ends.month2);
  }

  // The start year is the reservation's check-in year. A December→January rollover
  // (start month December) keeps that year; the check-out endpoint's own year is
  // never needed because only the start day is the stay night.
  return buildIso(yearHint, month1, ends.day1);
}

/** Parses a whole-string date, or null. */
export function parseDate(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const result = parseLeadingDate(trimmed);
  if (result && result.rest.length === 0) return result.iso;
  return null;
}

/**
 * Every stay night from check-in (inclusive) to check-out (exclusive).
 * Returns [] when the range is empty or inverted.
 */
export function generateStayDates(checkInIso: string, checkOutIso: string): string[] {
  const start = Date.parse(`${checkInIso}T00:00:00.000Z`);
  const end = Date.parse(`${checkOutIso}T00:00:00.000Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return [];
  const dates: string[] = [];
  const dayMs = 24 * 60 * 60 * 1000;
  for (let t = start; t < end; t += dayMs) {
    dates.push(new Date(t).toISOString().slice(0, 10));
  }
  return dates;
}

/** Converts an ISO date string to a UTC-midnight Date for storage. */
export function isoToUtcDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

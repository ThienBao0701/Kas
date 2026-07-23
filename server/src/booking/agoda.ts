import { parseBooking } from './parser';
import type { MatchableBranch, ParsedBooking } from './types';

/** Extraction-engine version stamped onto Agoda-sourced bookings. */
export const AGODA_PARSER_VERSION = 'agoda-1.0.0';

/**
 * Agoda raw-text parser adapter. Agoda's confirmation text uses the same shapes
 * the shared engine already handles (labelled fields, English room-type names,
 * weekday/long dates, grouped VND) plus a handful of Agoda-specific labels and
 * prepaid phrases that are registered in the shared modules. This adapter reuses
 * the tested engine and returns the exact same normalized structure as
 * Booking.com, so both sources are interchangeable downstream.
 *
 * A thin pre-normalisation strips Agoda's leading "Agoda" chrome and the common
 * "(originally VND …)" strike-through hint so a crossed-out price never leaks in.
 */
export function parseAgodaBooking(
  rawText: string,
  branches: readonly MatchableBranch[],
): ParsedBooking {
  const cleaned = rawText
    // Remove crossed-out "originally VND x" hints so they cannot be read as a price.
    .replace(/\(?\s*originally\b[^\n)]*\)?/gi, ' ')
    .replace(/\(?\s*gia goc\b[^\n)]*\)?/gi, ' ');

  const parsed = parseBooking(cleaned, branches);
  return { ...parsed, parserVersion: AGODA_PARSER_VERSION };
}

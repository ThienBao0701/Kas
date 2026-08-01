/**
 * Structured extraction of the CTrip / Trip.com partner reservation fields.
 *
 * Every label handled here is one the operator confirmed from a real CTrip
 * reservation. Nothing is inferred from a guessed layout: a label that is not
 * on this list is not read, and a field that is absent stays absent so the
 * Admin is asked rather than told something untrue.
 *
 * ── THE PRICE RULES, AND WHY THEY MATTER ──────────────────────────────────
 * CTrip shows three amounts. Only two of them are ours, and confusing them
 * would misstate what the hotel is owed:
 *
 *   Original room rate  -> GUEST-BOOKED price (what the guest paid)
 *   Final room rate     -> IGNORED when Original exists; it is the
 *                          post-discount figure, not what the guest booked at
 *   Your payout         -> BRANCH price (what the hotel actually receives)
 *   Discounts           -> IGNORED entirely
 *
 * ── NIGHTLY RATES ─────────────────────────────────────────────────────────
 * The confirmed CTrip layout carries no per-night breakdown. Nightly prices are
 * therefore left EMPTY. They are never derived by dividing the payout by the
 * number of nights: a fabricated per-night figure looks like data and would be
 * copied into the PMS as if CTrip had stated it.
 */
import { normalizeForPhrase, normalizeWhitespace } from './text';

export interface CtripFields {
  /** "Reservation" — the CTrip reservation number. */
  reservationCode: string | null;
  /** "Property name" — absent means the Admin must choose the branch. */
  propertyName: string | null;
  guestName: string | null;
  /** ISO "YYYY-MM-DD". */
  checkIn: string | null;
  checkOut: string | null;
  /** "Room type" as CTrip words it — resolved against the branch's mappings. */
  roomType: string | null;
  roomQuantity: number | null;
  /** "Original room rate" — the guest-booked price. */
  originalRoomRate: number | null;
  /** "Final room rate" — read for display only; never the guest-booked price. */
  finalRoomRate: number | null;
  /** "Your payout" — the branch price. */
  payout: number | null;
  /** From "Meals": false for "No meals". Null when not stated. */
  breakfastIncluded: boolean | null;
}

/** Reads one labelled value, tolerating a value on the following line. */
function labelled(lines: readonly string[], labels: readonly string[]): string | null {
  const wanted = labels.map((l) => normalizeForPhrase(l));
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const colon = line.indexOf(':');
    const head = normalizeForPhrase(colon >= 0 ? line.slice(0, colon) : line);
    if (!wanted.includes(head)) continue;

    const inline = colon >= 0 ? line.slice(colon + 1).trim() : '';
    if (inline.length > 0) return inline;
    // CTrip wraps some values onto the next line.
    const next = lines[i + 1]?.trim();
    if (next && !next.includes(':')) return next;
  }
  return null;
}

/**
 * Whole VND from a CTrip amount. Handles both the raw form ("6637080") and a
 * grouped form ("6.637.080" / "6,637,080"). Returns null rather than 0 when
 * nothing numeric is present — 0 is a real price and must not be invented.
 */
export function parseCtripAmount(raw: string | null): number | null {
  if (!raw) return null;
  const digits = raw.replace(/[^\d]/g, '');
  if (digits.length === 0) return null;
  const value = Number.parseInt(digits, 10);
  return Number.isFinite(value) ? value : null;
}

/** DD/MM/YYYY (CTrip's confirmed form) or an ISO date, to ISO "YYYY-MM-DD". */
export function parseCtripDate(raw: string | null): string | null {
  if (!raw) return null;
  const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(raw);
  if (!dmy) return null;
  const day = dmy[1]!.padStart(2, '0');
  const month = dmy[2]!.padStart(2, '0');
  return `${dmy[3]}-${month}-${day}`;
}

/** Whole nights between two ISO dates, or null when either is missing. */
export function nightsBetween(checkIn: string | null, checkOut: string | null): number | null {
  if (!checkIn || !checkOut) return null;
  const a = Date.parse(`${checkIn}T00:00:00Z`);
  const b = Date.parse(`${checkOut}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b) || b <= a) return null;
  return Math.round((b - a) / 86_400_000);
}

/**
 * Reads the confirmed CTrip labels. Absent fields stay null — this never
 * substitutes one field for another, and never computes a value CTrip did not
 * state.
 */
export function extractCtripFields(rawText: string): CtripFields {
  const lines = normalizeWhitespace(rawText)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const meals = labelled(lines, ['Meals', 'Meal', 'Bữa ăn']);

  return {
    reservationCode: labelled(lines, ['Reservation', 'Reservation number', 'Reservation ID']),
    propertyName: labelled(lines, ['Property name', 'Property', 'Hotel name']),
    guestName: labelled(lines, ['Guest', 'Guest name', 'Khách']),
    checkIn: parseCtripDate(labelled(lines, ['Check-in', 'Check in', 'Nhận phòng'])),
    checkOut: parseCtripDate(labelled(lines, ['Check-out', 'Check out', 'Trả phòng'])),
    roomType: labelled(lines, ['Room type', 'Room', 'Hạng phòng']),
    roomQuantity: (() => {
      const raw = labelled(lines, ['Room quantity', 'Rooms', 'Number of rooms', 'Số lượng phòng']);
      const parsed = raw ? Number.parseInt(raw.replace(/[^\d]/g, ''), 10) : NaN;
      return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    })(),
    // The guest-booked price. Never replaced by "Final room rate".
    originalRoomRate: parseCtripAmount(labelled(lines, ['Original room rate'])),
    // Read for the review screen only — deliberately not used as any price.
    finalRoomRate: parseCtripAmount(labelled(lines, ['Final room rate'])),
    // The branch price.
    payout: parseCtripAmount(labelled(lines, ['Your payout', 'Payout'])),
    breakfastIncluded: meals === null ? null : !/no\s*meals?/i.test(meals),
  };
}

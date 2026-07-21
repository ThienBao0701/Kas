/**
 * Business time. Dispatch decisions (notably "last minute") must be made in the
 * property's timezone on the server, never trusting the browser. Vietnam uses
 * Asia/Ho_Chi_Minh, a fixed UTC+7 with no daylight saving, so a constant offset
 * is exact and dependency-free.
 *
 * A tiny injectable clock keeps time deterministic in tests: production uses the
 * system clock; a test can pin "now" with {@link setClock} / {@link resetClock}.
 */

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

let activeClock: Clock = systemClock;

export function getClock(): Clock {
  return activeClock;
}

/** Test-only: pin the clock. Always pair with {@link resetClock} in teardown. */
export function setClock(clock: Clock): void {
  activeClock = clock;
}

export function resetClock(): void {
  activeClock = systemClock;
}

const HCM_OFFSET_MS = 7 * 60 * 60 * 1000;

/** The calendar date in Asia/Ho_Chi_Minh for an instant, as ISO "YYYY-MM-DD". */
export function hcmDateOnly(instant: Date): string {
  return new Date(instant.getTime() + HCM_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * A booking is "last minute" when its check-in date equals today in
 * Asia/Ho_Chi_Minh at the moment it is dispatched. Check-in dates are stored at
 * UTC midnight, so their date-only form is the intended calendar day.
 */
export function isLastMinute(checkInDate: Date | null | undefined, now: Date): boolean {
  if (!checkInDate) return false;
  return checkInDate.toISOString().slice(0, 10) === hcmDateOnly(now);
}

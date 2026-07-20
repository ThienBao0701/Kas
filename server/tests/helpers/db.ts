import { prisma } from '../../src/db/prisma';

/**
 * The suite shares the application's own Prisma client rather than opening a
 * second one. SQLite allows a single writer, so two clients writing at once
 * (the app under test plus the test's own assertions) would intermittently hit
 * SQLITE_BUSY. One shared connection serializes every query and keeps the
 * session-writing auth tests deterministic. vitest.config.ts points
 * DATABASE_URL at the throwaway test database before any import runs.
 */
export const testPrisma = prisma;

/** Removes booking data between tests; branches are left in place by default. */
export async function resetBookingData(): Promise<void> {
  // Order matters only for clarity — the schema cascades from Booking.
  await testPrisma.notification.deleteMany();
  await testPrisma.bookingStatusHistory.deleteMany();
  await testPrisma.bookingNightPrice.deleteMany();
  await testPrisma.bookingRoom.deleteMany();
  await testPrisma.booking.deleteMany();
}

export async function resetAll(): Promise<void> {
  await resetBookingData();
  await testPrisma.user.deleteMany();
  await testPrisma.branch.deleteMany();
}

/** Date-only helper matching how the app stores dates (UTC midnight). */
export function utcDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

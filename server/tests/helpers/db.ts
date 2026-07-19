import { PrismaClient } from '@prisma/client';

/**
 * One client for the whole suite. vitest.config.ts sets DATABASE_URL to the
 * throwaway test database before any test file is imported.
 */
export const testPrisma = new PrismaClient();

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

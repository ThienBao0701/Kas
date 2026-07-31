import { prisma } from '../../src/db/prisma';

/**
 * The suite shares the application's own Prisma client rather than opening a
 * second one, so a test's assertions and the code under test always observe
 * the same connection state. vitest.config.ts points DATABASE_URL at the
 * suite's own PostgreSQL schema before any import runs.
 *
 * Unlike the SQLite pilot — where a second client would intermittently hit
 * SQLITE_BUSY because only one writer is allowed — PostgreSQL handles
 * concurrent writers fine. Tests that specifically need TWO simultaneous
 * writers therefore open their own extra clients deliberately; see
 * tests/pg/concurrency.test.ts.
 */
export const testPrisma = prisma;

/**
 * Removes booking data between tests; branches are left in place by default.
 *
 * Deleting Booking cascades to rooms, nights, guests, audit events, warnings,
 * proofs and comparisons via the schema's ON DELETE CASCADE, but the explicit
 * deletes are kept: they document the shape, and they keep the reset working
 * if a cascade is ever relaxed.
 */
export async function resetBookingData(): Promise<void> {
  await testPrisma.notification.deleteMany();
  await testPrisma.bookingStatusHistory.deleteMany();
  await testPrisma.bookingAuditEvent.deleteMany();
  await testPrisma.bookingGuest.deleteMany();
  await testPrisma.bookingNightPrice.deleteMany();
  await testPrisma.bookingRoom.deleteMany();
  await testPrisma.booking.deleteMany();
}

export async function resetAll(): Promise<void> {
  await resetBookingData();
  // HotelIssue holds RESTRICT FKs to User/Branch, so it must be cleared first.
  await testPrisma.hotelIssue.deleteMany();
  // Room-mapping rows reference both Branch and User; clear them before either.
  await testPrisma.branchRoomClassAlias.deleteMany();
  await testPrisma.branchRoomClass.deleteMany();
  await testPrisma.branchRoomMappingVersion.deleteMany();
  await testPrisma.branchChangeLog.deleteMany();
  await testPrisma.branchSourceAlias.deleteMany();
  await testPrisma.session.deleteMany();
  await testPrisma.user.deleteMany();
  await testPrisma.branch.deleteMany();
}

/**
 * Resets the sequence-backed identity columns so explicit-id fixtures and
 * auto-generated ids cannot collide between tests.
 *
 * On SQLite this was unnecessary — deleting every row reset the ROWID counter.
 * PostgreSQL sequences do not rewind on DELETE, which is a real behavioural
 * difference the D.1 migration introduced.
 */
export async function resetSequences(): Promise<void> {
  for (const table of ['Branch', 'User', 'BranchSourceAlias']) {
    await testPrisma.$executeRawUnsafe(
      `SELECT setval(pg_get_serial_sequence('"${table}"', 'id'),
                     COALESCE((SELECT MAX(id) FROM "${table}"), 0) + 1, false)`,
    );
  }
}

/** Date-only helper matching how the app stores dates (UTC midnight). */
export function utcDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

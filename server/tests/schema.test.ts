import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedBranches } from '../src/db/seed';
import { resetAll, resetBookingData, testPrisma, utcDate } from './helpers/db';

/**
 * Guards the schema rules the booking data depends on: one row per room per
 * booking, and one price row per stay night per room.
 */
describe('schema constraints', () => {
  let branchId: number;

  beforeAll(async () => {
    await resetAll();
    await seedBranches(testPrisma);
    const branch = await testPrisma.branch.findUniqueOrThrow({
      where: { code: 'TRUONG_DINH_05' },
    });
    branchId = branch.id;
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  async function createBooking() {
    await resetBookingData();
    return testPrisma.booking.create({
      data: {
        bookingCode: '1234567890',
        hotelName: 'Saigon Hotel & Ben Thanh',
        branchId,
        customerName: 'Nguyễn Văn A',
        phone: '0900000000',
        checkInDate: utcDate('2026-07-19'),
        checkOutDate: utcDate('2026-07-22'),
        totalAmount: 2_650_000,
        paymentStatus: 'PAY_AFTER',
        rawText: 'raw booking text',
        status: 'DRAFT',
      },
    });
  }

  it('stores VND money as integers', async () => {
    const booking = await createBooking();

    expect(booking.totalAmount).toBe(2_650_000);
    expect(Number.isInteger(booking.totalAmount)).toBe(true);
    expect(booking.currency).toBe('VND');
  });

  it('rejects a duplicate room index within the same booking', async () => {
    const booking = await createBooking();

    await testPrisma.bookingRoom.create({
      data: { bookingId: booking.id, roomIndex: 1, roomType: 'Deluxe Double Room' },
    });

    await expect(
      testPrisma.bookingRoom.create({
        data: { bookingId: booking.id, roomIndex: 1, roomType: 'Superior Twin Room' },
      }),
    ).rejects.toThrow();
  });

  it('allows the same room index across different bookings', async () => {
    const first = await createBooking();
    await testPrisma.bookingRoom.create({
      data: { bookingId: first.id, roomIndex: 1, roomType: 'Deluxe Double Room' },
    });

    const second = await testPrisma.booking.create({
      data: {
        bookingCode: '9876543210',
        branchId,
        customerName: 'Trần Thị B',
        checkInDate: utcDate('2026-08-01'),
        checkOutDate: utcDate('2026-08-03'),
        paymentStatus: 'PAY_BEFORE',
        rawText: 'raw booking text 2',
      },
    });

    const room = await testPrisma.bookingRoom.create({
      data: { bookingId: second.id, roomIndex: 1, roomType: 'Deluxe Double Room' },
    });

    expect(room.roomIndex).toBe(1);
  });

  it('rejects a duplicate stay date for the same room', async () => {
    const booking = await createBooking();
    const room = await testPrisma.bookingRoom.create({
      data: { bookingId: booking.id, roomIndex: 1, roomType: 'Deluxe Double Room' },
    });

    await testPrisma.bookingNightPrice.create({
      data: { bookingRoomId: room.id, stayDate: utcDate('2026-07-19'), amount: 850_000 },
    });

    await expect(
      testPrisma.bookingNightPrice.create({
        data: { bookingRoomId: room.id, stayDate: utcDate('2026-07-19'), amount: 920_000 },
      }),
    ).rejects.toThrow();
  });

  it('keeps each room‘s nightly prices separate for the same stay date', async () => {
    const booking = await createBooking();

    const roomOne = await testPrisma.bookingRoom.create({
      data: { bookingId: booking.id, roomIndex: 1, roomType: 'Deluxe Double Room' },
    });
    const roomTwo = await testPrisma.bookingRoom.create({
      data: { bookingId: booking.id, roomIndex: 2, roomType: 'Superior Twin Room' },
    });

    await testPrisma.bookingNightPrice.create({
      data: { bookingRoomId: roomOne.id, stayDate: utcDate('2026-07-19'), amount: 850_000 },
    });
    await testPrisma.bookingNightPrice.create({
      data: { bookingRoomId: roomTwo.id, stayDate: utcDate('2026-07-19'), amount: 780_000 },
    });

    const nights = await testPrisma.bookingNightPrice.findMany({
      where: { stayDate: utcDate('2026-07-19') },
      orderBy: { amount: 'desc' },
    });

    expect(nights).toHaveLength(2);
    expect(nights.map((n) => n.amount)).toEqual([850_000, 780_000]);
  });

  it('accepts a null nightly amount for an unresolved night', async () => {
    const booking = await createBooking();
    const room = await testPrisma.bookingRoom.create({
      data: { bookingId: booking.id, roomIndex: 1 },
    });

    const night = await testPrisma.bookingNightPrice.create({
      data: { bookingRoomId: room.id, stayDate: utcDate('2026-07-21'), amount: null },
    });

    expect(night.amount).toBeNull();
    expect(night.manuallyCorrected).toBe(false);
  });

  it('cascades room and night rows when a booking is removed', async () => {
    const booking = await createBooking();
    const room = await testPrisma.bookingRoom.create({
      data: { bookingId: booking.id, roomIndex: 1 },
    });
    await testPrisma.bookingNightPrice.create({
      data: { bookingRoomId: room.id, stayDate: utcDate('2026-07-19'), amount: 850_000 },
    });

    await testPrisma.booking.delete({ where: { id: booking.id } });

    expect(await testPrisma.bookingRoom.count()).toBe(0);
    expect(await testPrisma.bookingNightPrice.count()).toBe(0);
  });
});

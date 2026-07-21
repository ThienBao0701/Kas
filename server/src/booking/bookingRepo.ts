import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../db/prisma';
import { ApiError } from '../lib/errors';
import { BOOKING_DETAIL_INCLUDE, type BookingDetail } from './bookingView';

/** A Prisma client or an interactive-transaction client — both expose the models. */
export type Db = PrismaClient | Prisma.TransactionClient;

/** Loads a booking with every relation the detail view and services need. */
export async function loadBookingDetail(id: string, client: Db = prisma): Promise<BookingDetail> {
  const booking = await client.booking.findUnique({
    where: { id },
    include: BOOKING_DETAIL_INCLUDE,
  });
  if (!booking) throw ApiError.notFound('Không tìm thấy đơn đặt phòng.');
  return booking;
}

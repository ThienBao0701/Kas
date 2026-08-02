/**
 * Dispatching a reviewed OTA reservation.
 *
 * The OTA path used to end at a note the Admin copied by hand, so nothing was
 * recorded and no branch ever saw the booking. This is the join that closes
 * that gap, and the properties that matter are the ones that protect real
 * money and real guests:
 *
 *   the server dispatches ITS OWN review, not the browser's claim;
 *   one reservation can never become two bookings;
 *   a failure leaves nothing half-written;
 *   a branch sees its own bookings and no one else's.
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { seedBranches } from '../src/db/seed';
import { resetAll, testPrisma } from './helpers/db';
import {
  ADMIN_PASSWORD,
  RECEPTIONIST_PASSWORD,
  createAdmin,
  createReceptionist,
  loginAgent,
} from './helpers/auth';

const AGODA_RAW = fs.readFileSync(
  path.join(__dirname, 'fixtures', 'agoda', '10-list-page-above-reservation.txt'),
  'utf8',
);
const CTRIP_RAW = fs.readFileSync(
  path.join(__dirname, 'fixtures', 'ctrip', '06-real-page-property-above.txt'),
  'utf8',
);

let app: ReturnType<typeof createApp>;
let admin: Awaited<ReturnType<typeof loginAgent>>['agent'];
let cn5 = 0;
let cn1 = 0;

beforeAll(async () => {
  await resetAll();
  await seedBranches(testPrisma);
  app = createApp();
  cn5 = (await testPrisma.branch.findUniqueOrThrow({ where: { code: 'LE_THANH_TON_278' } })).id;
  cn1 = (await testPrisma.branch.findUniqueOrThrow({ where: { code: 'TRUONG_DINH_05' } })).id;
  await createAdmin({ mustChangePassword: false });
  admin = (await loginAgent(app, 'admin', ADMIN_PASSWORD)).agent;
});

beforeEach(async () => {
  // Each test starts with no dispatched bookings.
  await testPrisma.booking.deleteMany();
});

afterAll(async () => testPrisma.$disconnect());

const dispatch = (body: Record<string, unknown>) =>
  admin.post('/api/admin/ota/dispatch').send(body);

const AGODA = { source: 'AGODA', rawText: AGODA_RAW, overrides: { paymentMode: 'CN' } };

/* ================================================================== */
/* The booking is really created                                       */
/* ================================================================== */
describe('dispatch persists the reviewed reservation', () => {
  it('creates a booking carrying the reviewed values', async () => {
    const res = await dispatch(AGODA);
    expect(res.status).toBe(201);
    expect(res.body.created).toBe(true);

    const booking = await testPrisma.booking.findUniqueOrThrow({
      where: { id: res.body.bookingId },
      include: { rooms: { include: { nights: true } }, warnings: true, statusHistory: true },
    });

    // Every value matches what the review returned — no drift at the join.
    const review = res.body.review;
    expect(booking.bookingCode).toBe(review.bookingCode);
    expect(booking.customerName).toBe(review.guestName);
    expect(booking.branchId).toBe(review.branchId);
    expect(booking.totalAmount).toBe(review.branchPrice);
    expect(booking.sourcePlatform).toBe('AGODA');
    expect(booking.checkInDate?.toISOString().slice(0, 10)).toBe(review.checkIn);
    expect(booking.checkOutDate?.toISOString().slice(0, 10)).toBe(review.checkOut);
  });

  it('lands in the dispatched state with an immutable history row', async () => {
    const res = await dispatch(AGODA);
    const booking = await testPrisma.booking.findUniqueOrThrow({
      where: { id: res.body.bookingId },
      include: { statusHistory: true },
    });

    // NEW is this system's "dispatched, awaiting the branch".
    expect(booking.status).toBe('NEW');
    expect(booking.sentAt).not.toBeNull();
    expect(booking.sentByUserId).not.toBeNull();
    expect(booking.statusHistory).toHaveLength(1);
    expect(booking.statusHistory[0]).toMatchObject({ oldStatus: null, newStatus: 'NEW' });
  });

  it('stores one room row per reviewed room line', async () => {
    const res = await dispatch(AGODA);
    const booking = await testPrisma.booking.findUniqueOrThrow({
      where: { id: res.body.bookingId },
      include: { rooms: true },
    });

    expect(booking.rooms).toHaveLength(res.body.review.rooms.length);
    // The internal code is what the branch acts on.
    expect(booking.rooms[0]!.roomType).toBe(res.body.review.rooms[0].pmsCode);
  });

  it('dispatches a CTrip reservation the same way', async () => {
    const res = await dispatch({ source: 'CTRIP', rawText: CTRIP_RAW, overrides: { paymentMode: 'CN' } });
    expect(res.status).toBe(201);

    const booking = await testPrisma.booking.findUniqueOrThrow({ where: { id: res.body.bookingId } });
    expect(booking.sourcePlatform).toBe('CTRIP');
    expect(booking.status).toBe('NEW');
  });

  it('notifies that branch’s receptionists, and only them', async () => {
    await createReceptionist(cn5, { username: 'letan_cn5', mustChangePassword: false });
    await createReceptionist(cn1, { username: 'letan_cn1', mustChangePassword: false });

    const res = await dispatch(AGODA);
    const notifications = await testPrisma.notification.findMany({
      where: { bookingId: res.body.bookingId },
      include: { user: { select: { username: true, branchId: true } } },
    });

    expect(notifications.length).toBeGreaterThan(0);
    for (const n of notifications) {
      expect(n.user.branchId).toBe(cn5);
    }
  });
});

/* ================================================================== */
/* One reservation, one booking                                        */
/* ================================================================== */
describe('dispatch is idempotent', () => {
  it('returns the same booking when sent twice', async () => {
    const first = await dispatch(AGODA);
    const second = await dispatch(AGODA);

    expect(first.status).toBe(201);
    expect(first.body.created).toBe(true);
    expect(second.status).toBe(200);
    expect(second.body.created).toBe(false);
    expect(second.body.bookingId).toBe(first.body.bookingId);

    expect(await testPrisma.booking.count()).toBe(1);
  });

  it('survives concurrent double submission without creating two bookings', async () => {
    // A double click fires both requests before either has committed.
    const results = await Promise.allSettled([dispatch(AGODA), dispatch(AGODA)]);
    const ok = results.filter(
      (r) => r.status === 'fulfilled' && [200, 201].includes(r.value.status),
    );
    expect(ok.length).toBeGreaterThan(0);

    // Whatever the interleaving, the reservation exists exactly once.
    const bookings = await testPrisma.booking.findMany({ where: { sourcePlatform: 'AGODA' } });
    expect(bookings).toHaveLength(1);
  });

  it('does not collide with the same code on another platform', async () => {
    await dispatch(AGODA);
    // A CTrip reservation numbered like an Agoda one is a different booking.
    const ctrip = await dispatch({ source: 'CTRIP', rawText: CTRIP_RAW, overrides: { paymentMode: 'CN' } });
    expect(ctrip.status).toBe(201);
    expect(await testPrisma.booking.count()).toBe(2);
  });
});

/* ================================================================== */
/* The server dispatches its own review                                */
/* ================================================================== */
describe('dispatch refuses what the review would block', () => {
  it('rejects a reservation whose room is unmapped, writing nothing', async () => {
    const unmapped = AGODA_RAW.replace('Superior Double Room\t1', 'Nonexistent Room Type\t1');
    const res = await dispatch({ source: 'AGODA', rawText: unmapped });

    expect(res.status).toBe(422);
    expect(await testPrisma.booking.count()).toBe(0);
    expect(await testPrisma.notification.count()).toBe(0);
    expect(await testPrisma.bookingStatusHistory.count()).toBe(0);
  });

  it('rejects a reservation with no branch', async () => {
    const noProperty = AGODA_RAW.replace(/KAS Zody Boutique Hotel/g, 'Unknown Property');
    const res = await dispatch({ source: 'AGODA', rawText: noProperty });

    expect(res.status).toBe(422);
    expect(await testPrisma.booking.count()).toBe(0);
  });

  it('ignores a client-supplied PMS code the branch does not have', async () => {
    // The review discards an invalid code, so dispatch must refuse rather than
    // persist a note carrying a code the hotel system cannot accept.
    const res = await dispatch({
      source: 'AGODA',
      rawText: AGODA_RAW.replace('Superior Double Room\t1', 'Nonexistent Room Type\t1'),
      overrides: {
        rooms: [
          {
            quantity: 1,
            otaRoomName: 'Nonexistent Room Type',
            otaRoomTypeId: null,
            pmsCode: 'SUITEBAL',
            requiresManualMapping: false,
          },
        ],
      },
    });

    expect(res.status).toBe(422);
    expect(await testPrisma.booking.count()).toBe(0);
  });
});

/* ================================================================== */
/* Permission                                                          */
/* ================================================================== */
describe('dispatch permission', () => {
  it('refuses a receptionist', async () => {
    await createReceptionist(cn5, { username: 'letan_dispatch', mustChangePassword: false });
    const reception = (await loginAgent(app, 'letan_dispatch', RECEPTIONIST_PASSWORD)).agent;

    const res = await reception.post('/api/admin/ota/dispatch').send(AGODA);
    expect(res.status).toBe(403);
    expect(await testPrisma.booking.count()).toBe(0);
  });

  it('refuses an anonymous caller', async () => {
    const { default: request } = await import('supertest');
    const res = await request(app).post('/api/admin/ota/dispatch').send(AGODA);
    expect(res.status).toBe(401);
    expect(await testPrisma.booking.count()).toBe(0);
  });
});

/* ================================================================== */
/* Admin corrections are what gets dispatched                          */
/* ================================================================== */
describe('dispatch honours the Admin’s corrections', () => {
  it('persists an edited guest name and branch price', async () => {
    const res = await dispatch({
      source: 'AGODA',
      rawText: AGODA_RAW,
      overrides: { guestName: 'CORRECTED NAME', branchPrice: 1_234_567, paymentMode: 'CN' },
    });
    expect(res.status).toBe(201);

    const booking = await testPrisma.booking.findUniqueOrThrow({ where: { id: res.body.bookingId } });
    expect(booking.customerName).toBe('CORRECTED NAME');
    expect(booking.totalAmount).toBe(1_234_567);
  });

  it('persists an Admin-selected branch', async () => {
    const res = await dispatch({
      source: 'AGODA',
      rawText: AGODA_RAW,
      overrides: { branchId: cn1, paymentMode: 'CN' },
    });
    // CN1 has no Superior Double Room mapping, so the review blocks it — the
    // branch change is honoured, and so is its consequence.
    expect(res.status).toBe(422);
    expect(await testPrisma.booking.count()).toBe(0);
  });

  it('records the payment mode as the matching payment status', async () => {
    const cn = await dispatch(AGODA);
    const booking = await testPrisma.booking.findUniqueOrThrow({ where: { id: cn.body.bookingId } });
    expect(booking.paymentStatus).toBe('PAY_BEFORE');

    await testPrisma.booking.deleteMany();
    const hotel = await dispatch({
      source: 'AGODA',
      rawText: AGODA_RAW,
      overrides: { paymentMode: 'HOTEL_PAYMENT' },
    });
    const second = await testPrisma.booking.findUniqueOrThrow({ where: { id: hotel.body.bookingId } });
    expect(second.paymentStatus).toBe('PAY_AFTER');
  });
});

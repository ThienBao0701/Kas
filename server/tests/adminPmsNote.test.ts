/**
 * The Admin PMS note and the reviewed payment mode.
 *
 * WHY THESE EXIST AT ALL: a receptionist looking at a reservation that looks
 * wrong needs a person to ask. The system used to answer with a generated note,
 * which names nobody, and it threw away the payment mode the Admin had just
 * reviewed — so CTrip reservations reached the branch with no payment
 * information whatsoever.
 *
 * The sharpest tests here are the negative ones: dispatch must REFUSE without a
 * note, and refusing must write nothing at all. A partial write would leave a
 * booking the branch can see but nobody is accountable for.
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

const NOTE = 'Nguyen Van A\nCa sáng';

beforeAll(async () => {
  await resetAll();
  await seedBranches(testPrisma);
  app = createApp();
  await createAdmin({ mustChangePassword: false });
  admin = (await loginAgent(app, 'admin', ADMIN_PASSWORD)).agent;
});

beforeEach(async () => {
  await testPrisma.booking.deleteMany();
});

afterAll(async () => testPrisma.$disconnect());

/** Dispatches an OTA reservation with the given body. */
const dispatch = (body: Record<string, unknown>) => admin.post('/api/admin/ota/dispatch').send(body);

const agodaBody = (over: Record<string, unknown> = {}) => ({
  source: 'AGODA',
  rawText: AGODA_RAW,
  adminPmsNote: NOTE,
  overrides: { paymentMode: 'CN' },
  ...over,
});

/* ================================================================== */
/* The note is required                                                */
/* ================================================================== */
describe('dispatch refuses without an Admin PMS note', () => {
  it('rejects a body with no note at all', async () => {
    const { adminPmsNote: _omitted, ...withoutNote } = agodaBody();
    expect((await dispatch(withoutNote)).status).toBe(422);
  });

  it('rejects an empty note', async () => {
    expect((await dispatch(agodaBody({ adminPmsNote: '' }))).status).toBe(422);
  });

  it('rejects whitespace pretending to be a note', async () => {
    // A space would satisfy "not empty" while naming nobody.
    expect((await dispatch(agodaBody({ adminPmsNote: '   ' }))).status).toBe(422);
  });

  it('writes NOTHING when it refuses', async () => {
    // A rejected dispatch that still created the booking would leave the branch
    // holding a reservation nobody is accountable for.
    await dispatch(agodaBody({ adminPmsNote: '' }));
    expect(await testPrisma.booking.count()).toBe(0);
    expect(await testPrisma.bookingRoom.count()).toBe(0);
    expect(await testPrisma.bookingStatusHistory.count()).toBe(0);
  });

  it('names the missing field in the error', async () => {
    const res = await dispatch(agodaBody({ adminPmsNote: '' }));
    expect(JSON.stringify(res.body)).toContain('người tạo PMS');
  });
});

/* ================================================================== */
/* It is stored, verbatim                                              */
/* ================================================================== */
describe('what dispatch stores', () => {
  it('stores the note exactly as typed, newlines and all', async () => {
    const res = await dispatch(agodaBody());
    expect(res.status).toBe(201);

    const booking = await testPrisma.booking.findUniqueOrThrow({
      where: { id: res.body.bookingId as string },
    });
    expect(booking.adminPmsNote).toBe(NOTE);
    // The two lines are a name and a shift; collapsing them loses a real
    // distinction the operator made.
    expect(booking.adminPmsNote).toContain('\n');
  });

  it('trims surrounding whitespace but nothing inside', async () => {
    const res = await dispatch(agodaBody({ adminPmsNote: `  ${NOTE}  ` }));
    const booking = await testPrisma.booking.findUniqueOrThrow({
      where: { id: res.body.bookingId as string },
    });
    expect(booking.adminPmsNote).toBe(NOTE);
  });

  it('stores the payment mode the Admin reviewed', async () => {
    const res = await dispatch(agodaBody({ overrides: { paymentMode: 'HOTEL_PAYMENT' } }));
    const booking = await testPrisma.booking.findUniqueOrThrow({
      where: { id: res.body.bookingId as string },
    });
    expect(booking.reviewedPaymentMode).toBe('HOTEL_PAYMENT');
  });

  it('stores it for CTrip too — the platform that had nothing before', async () => {
    const res = await dispatch({
      source: 'CTRIP',
      rawText: CTRIP_RAW,
      adminPmsNote: NOTE,
      overrides: { paymentMode: 'CN' },
    });
    expect(res.status).toBe(201);

    const booking = await testPrisma.booking.findUniqueOrThrow({
      where: { id: res.body.bookingId as string },
    });
    expect(booking.reviewedPaymentMode).toBe('CN');
    expect(booking.adminPmsNote).toBe(NOTE);
  });

  it('keeps the reviewed mode separate from what the mail said', async () => {
    // paymentType records the MAIL's wording; reviewedPaymentMode records the
    // Admin's decision. Conflating them destroys the distinction exactly when
    // the two disagree, which is when it matters.
    const res = await dispatch(agodaBody({ overrides: { paymentMode: 'HOTEL_PAYMENT' } }));
    const booking = await testPrisma.booking.findUniqueOrThrow({
      where: { id: res.body.bookingId as string },
    });
    expect(booking.reviewedPaymentMode).toBe('HOTEL_PAYMENT');
    expect(booking.reviewedPaymentMode).not.toBe(booking.paymentType);
  });

  it('serves both back on the booking detail', async () => {
    const res = await dispatch(agodaBody());
    const detail = await admin.get(`/api/bookings/${res.body.bookingId}`);
    expect(detail.body.booking.adminPmsNote).toBe(NOTE);
    expect(detail.body.booking.reviewedPaymentMode).toBe('CN');
  });

  it('serves the note in the history list', async () => {
    await dispatch(agodaBody());
    const history = await admin.get('/api/bookings/history?pageSize=10');
    expect(history.body.bookings[0].adminPmsNote).toBe(NOTE);
  });
});

/* ================================================================== */
/* Editing after dispatch                                              */
/* ================================================================== */
describe('editing the note after dispatch', () => {
  /** Dispatches one booking and returns its id. */
  async function dispatched(): Promise<string> {
    const res = await dispatch(agodaBody());
    expect(res.status).toBe(201);
    return res.body.bookingId as string;
  }

  const edit = (id: string, body: Record<string, unknown>) =>
    admin.patch(`/api/admin/bookings/${id}/ota-fields`).send(body);

  it('updates the note and records an immutable correction', async () => {
    const id = await dispatched();
    const res = await edit(id, { adminPmsNote: 'Tran Thi B\nCa đêm' });
    expect(res.status).toBe(200);

    const booking = await testPrisma.booking.findUniqueOrThrow({ where: { id } });
    expect(booking.adminPmsNote).toBe('Tran Thi B\nCa đêm');

    const corrections = await testPrisma.bookingCorrection.findMany({
      where: { bookingId: id, field: 'adminPmsNote' },
    });
    expect(corrections).toHaveLength(1);
    expect(corrections[0]!.oldValue).toBe(NOTE);
    expect(corrections[0]!.newValue).toBe('Tran Thi B\nCa đêm');
  });

  it('records who made the change and when', async () => {
    const id = await dispatched();
    await edit(id, { adminPmsNote: 'Tran Thi B' });

    const correction = await testPrisma.bookingCorrection.findFirstOrThrow({
      where: { bookingId: id, field: 'adminPmsNote' },
    });
    expect(correction.correctedByUserId).not.toBeNull();
    expect(correction.correctedAt).toBeInstanceOf(Date);
    // Same provenance every other correction carries.
    expect(correction.requestAuditId).not.toBeNull();
  });

  it('records a payment change the same way', async () => {
    const id = await dispatched();
    await edit(id, { reviewedPaymentMode: 'HOTEL_PAYMENT' });

    const correction = await testPrisma.bookingCorrection.findFirstOrThrow({
      where: { bookingId: id, field: 'reviewedPaymentMode' },
    });
    expect(correction.oldValue).toBe('CN');
    expect(correction.newValue).toBe('HOTEL_PAYMENT');
  });

  it('never overwrites silently — the old value survives in the correction', async () => {
    const id = await dispatched();
    await edit(id, { adminPmsNote: 'Second' });
    await edit(id, { adminPmsNote: 'Third' });

    const corrections = await testPrisma.bookingCorrection.findMany({
      where: { bookingId: id, field: 'adminPmsNote' },
      orderBy: { correctedAt: 'asc' },
    });
    expect(corrections).toHaveLength(2);
    expect(corrections[0]!.oldValue).toBe(NOTE);
    expect(corrections[1]!.oldValue).toBe('Second');
  });

  it('writes no correction when nothing actually changed', async () => {
    // Re-submitting the same value would otherwise fill the history with rows
    // that record nothing and bury the ones that matter.
    const id = await dispatched();
    const res = await edit(id, { adminPmsNote: NOTE });
    expect(res.status).toBe(200);
    expect(res.body.changed).toEqual([]);
    expect(await testPrisma.bookingCorrection.count({ where: { bookingId: id } })).toBe(0);
  });

  it('rejects an empty note rather than erasing the creator', async () => {
    const id = await dispatched();
    expect((await edit(id, { adminPmsNote: '' })).status).toBe(422);
    const booking = await testPrisma.booking.findUniqueOrThrow({ where: { id } });
    expect(booking.adminPmsNote).toBe(NOTE);
  });

  it('refuses a receptionist — this is an Admin correction', async () => {
    const id = await dispatched();
    const branchId = (await testPrisma.booking.findUniqueOrThrow({ where: { id } })).branchId!;
    await createReceptionist(branchId, { username: 'letan_note', mustChangePassword: false });
    const reception = (await loginAgent(app, 'letan_note', RECEPTIONIST_PASSWORD)).agent;

    expect((await reception.patch(`/api/admin/bookings/${id}/ota-fields`).send({ adminPmsNote: 'X' })).status).toBe(403);
    const booking = await testPrisma.booking.findUniqueOrThrow({ where: { id } });
    expect(booking.adminPmsNote).toBe(NOTE);
  });
});

/* ================================================================== */
/* Booking.com is untouched                                            */
/* ================================================================== */
describe('Booking.com', () => {
  it('still dispatches with no note, and stores none', async () => {
    // Its send endpoint deliberately did not change: a newly-required field
    // would reject requests that succeed today.
    const booking = await testPrisma.booking.create({
      data: {
        bookingCode: 'BCOM-1',
        customerName: 'Guest',
        sourcePlatform: 'BOOKING_COM',
        paymentStatus: 'PAY_BEFORE',
        rawText: 'x',
        status: 'NEW',
        sentAt: new Date(),
      },
    });
    expect(booking.adminPmsNote).toBeNull();
    expect(booking.reviewedPaymentMode).toBeNull();

    const detail = await admin.get(`/api/bookings/${booking.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.booking.adminPmsNote).toBeNull();
  });
});

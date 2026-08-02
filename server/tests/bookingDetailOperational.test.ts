/**
 * Booking detail: the operational record Phase 5 accumulated.
 *
 * Every fact asserted here was ALREADY being stored — by the dispatcher, the
 * amendment flow and the lifecycle — and simply never left the server. The
 * point of these tests is that exposing it did not change it: warnings are the
 * parser's own words, nightly rates stay per night, corrections stay in the
 * order they were applied, and nothing absent is invented to fill a gap.
 *
 * The sharpest assertion is the negative one. Request provenance — IP, user
 * agent, session, correlation — identifies the DEVICE a change came from. An
 * Admin auditing a dispute needs it; a receptionist serving a guest does not,
 * and shipping it to every branch terminal would quietly turn an audit trail
 * into surveillance of colleagues. So the receptionist's payload is searched
 * for those values as raw substrings, anywhere at any depth.
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

/** The same reservation, later check-out. */
const AMENDED_RAW = AGODA_RAW.replace(
  'Check-out Trả phòng\t5-Aug-2026 (5-08-2026)',
  'Check-out Trả phòng\t7-Aug-2026 (7-08-2026)',
);

const UA = 'KasTestAgent/9.9 (audit-probe)';

let app: ReturnType<typeof createApp>;
let admin: Awaited<ReturnType<typeof loginAgent>>['agent'];
let reception: Awaited<ReturnType<typeof loginAgent>>['agent'];
let bookingId = '';
let branchId = 0;

/** The detail as each role receives it from the one operational endpoint. */
const asAdmin = async () => (await admin.get(`/api/bookings/${bookingId}`)).body.booking;
const asReception = async () => {
  const res = await reception.get(`/api/bookings/${bookingId}`);
  expect(res.status).toBe(200);
  return res.body.booking;
};

beforeAll(async () => {
  await resetAll();
  await seedBranches(testPrisma);
  app = createApp();
  await createAdmin({ mustChangePassword: false });
  admin = (await loginAgent(app, 'admin', ADMIN_PASSWORD)).agent;

  // Dispatch, then amend — so the booking carries corrections and an audited
  // request, not just extraction output.
  const dispatched = await admin
    .post('/api/admin/ota/dispatch')
    .set('User-Agent', UA)
    .send({ source: 'AGODA', rawText: AGODA_RAW, overrides: { paymentMode: 'CN' } });
  expect(dispatched.status).toBe(201);
  bookingId = dispatched.body.bookingId as string;

  const booking = await testPrisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
  branchId = booking.branchId!;

  const preview = await admin
    .post('/api/admin/ota/amendment')
    .send({ source: 'AGODA', rawText: AMENDED_RAW, overrides: { paymentMode: 'CN' } });
  expect(preview.status).toBe(200);
  const applied = await admin
    .post('/api/admin/ota/amendment/apply')
    .set('User-Agent', UA)
    .send({
      source: 'AGODA',
      rawText: AMENDED_RAW,
      overrides: { paymentMode: 'CN' },
      bookingId,
      expectedVersion: preview.body.expectedVersion,
      acceptedFields: preview.body.changes.map((c: { field: string }) => c.field),
    });
  expect(applied.status).toBe(200);

  await createReceptionist(branchId, { username: 'letan_detail', mustChangePassword: false });
  reception = (await loginAgent(app, 'letan_detail', RECEPTIONIST_PASSWORD)).agent;
});

afterAll(async () => testPrisma.$disconnect());

/* ================================================================== */
/* Request provenance is Admin-only                                    */
/* ================================================================== */
describe('who may see where a change came from', () => {
  it('gives an Admin the request audit, with build identity', async () => {
    const b = await asAdmin();
    expect(b.requestAudit).toBeDefined();
    expect(b.requestAudit.requests.length).toBeGreaterThan(0);
    const row = b.requestAudit.requests[0];
    expect(row.route).toBeTruthy();
    expect(row.userAgent).toBe(UA);
  });

  it('omits the key entirely for a receptionist — absence is the boundary', async () => {
    const b = await asReception();
    expect(b.requestAudit).toBeUndefined();
    expect(Object.keys(b)).not.toContain('requestAudit');
  });

  it('leaks no IP, user agent, session or correlation anywhere in the payload', async () => {
    // Whole-payload substring search, so a future field that happens to carry
    // one of these values fails here rather than in production.
    const adminBody = await asAdmin();
    const secrets = [
      UA,
      ...adminBody.requestAudit.requests.flatMap((r: Record<string, string | null>) =>
        [r.ipAddress, r.sessionId, r.correlationId, r.id].filter((v): v is string => Boolean(v)),
      ),
    ];
    expect(secrets.length).toBeGreaterThan(1);

    const receptionJson = JSON.stringify(await asReception());
    for (const secret of secrets) expect(receptionJson).not.toContain(secret);
  });

  it('still gives the receptionist the booking itself', async () => {
    // The restriction is on provenance, not on the guest's reservation.
    const b = await asReception();
    expect(b.id).toBe(bookingId);
    expect(b.rooms.length).toBeGreaterThan(0);
    expect(b.timeline.length).toBeGreaterThan(0);
    expect(b.corrections.length).toBeGreaterThan(0);
  });

  it('keeps raw text and detection debug away from the receptionist', async () => {
    const b = await asReception();
    expect(b.rawText).toBeUndefined();
    expect(b.businessTypeConfidence).toBeUndefined();
    expect(b.businessTypeDetectionSource).toBeUndefined();
  });
});

/* ================================================================== */
/* Corrections                                                         */
/* ================================================================== */
describe('the correction history', () => {
  it('reports every applied change, old beside new', async () => {
    const b = await asAdmin();
    const checkOut = b.corrections.find((c: { field: string }) => c.field === 'checkOut');
    expect(checkOut).toBeDefined();
    expect(checkOut.oldValue).toBe('2026-08-05');
    expect(checkOut.newValue).toBe('2026-08-07');
    expect(checkOut.appliedBy.fullName).toBeTruthy();
  });

  it('orders them oldest first, as applied', async () => {
    const b = await asAdmin();
    const times = b.corrections.map((c: { appliedAt: string }) => c.appliedAt);
    expect(times).toEqual([...times].sort());
  });

  it('invents no reason — the column does not exist', async () => {
    // The spec asked for a reason; nothing stores one. A plausible sentence
    // generated here would be a fabricated audit record, which is worse than
    // an absent field.
    const b = await asAdmin();
    for (const c of b.corrections) expect(c).not.toHaveProperty('reason');
  });

  it('shows the same corrections to a receptionist — this is booking data', async () => {
    const [a, r] = [await asAdmin(), await asReception()];
    expect(r.corrections).toEqual(a.corrections);
  });
});

/* ================================================================== */
/* Timeline                                                            */
/* ================================================================== */
describe('the timeline', () => {
  it('is ordered oldest first', async () => {
    const b = await asAdmin();
    const times = b.timeline.map((e: { at: string }) => e.at);
    expect(times).toEqual([...times].sort());
  });

  it('records the amendment as ONE event, not one per field', async () => {
    // Corrections written by a single request are a single human action.
    const b = await asAdmin();
    const amendments = b.timeline.filter((e: { type: string }) => e.type === 'AMENDMENT_APPLIED');
    expect(amendments).toHaveLength(1);
    expect(amendments[0].description).toContain('checkOut');
  });

  it('includes the dispatch that created the booking', async () => {
    const b = await asAdmin();
    const types = b.timeline.map((e: { type: string }) => e.type);
    expect(types.some((t: string) => t.startsWith('STATUS_'))).toBe(true);
  });

  it('carries no request metadata in its events', async () => {
    const b = await asAdmin();
    for (const e of b.timeline) {
      expect(Object.keys(e).sort()).toEqual(['actor', 'at', 'description', 'type']);
    }
  });
});

/* ================================================================== */
/* OTA metadata and parser identity                                    */
/* ================================================================== */
describe('what the OTA said', () => {
  it('exposes the stored platform metadata', async () => {
    const b = await asAdmin();
    expect(b.ota.sourcePlatform).toBe('AGODA');
    expect(b.ota.parserVersion).toBeTruthy();
    expect(b.ota.rawTextSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('keeps the property ID as reference metadata only', async () => {
    // It is audit data. Branch resolution never consults it, and the booking
    // resolved to a branch by platform identity alone.
    const b = await asAdmin();
    expect(b.branchId).toBe(branchId);
    expect('sourcePropertyId' in b.ota).toBe(true);
  });

  it('holds parser commit and build ID under the Admin-only block', async () => {
    const b = await asAdmin();
    expect('parserCommit' in b.requestAudit).toBe(true);
    expect('reviewBuildId' in b.requestAudit).toBe(true);
    expect(b.ota).not.toHaveProperty('parserCommit');
    expect(b.ota).not.toHaveProperty('reviewBuildId');
  });

  it('reports nulls rather than guesses for a Booking.com booking', async () => {
    const plain = await testPrisma.booking.create({
      data: {
        bookingCode: 'BC-1',
        customerName: 'Guest',
        sourcePlatform: 'BOOKING_COM',
        paymentStatus: 'PAY_BEFORE',
        rawText: 'x',
        status: 'NEW',
        branchId,
        sentAt: new Date(),
      },
    });
    const b = (await admin.get(`/api/bookings/${plain.id}`)).body.booking;
    expect(b.ota.otaBookingStatus).toBeNull();
    expect(b.ota.ratePlanName).toBeNull();
    expect(b.ota.rawTextSha256).toBeNull();
    expect(b.corrections).toEqual([]);
    expect(b.requestAudit.requests).toEqual([]);
  });
});

/* ================================================================== */
/* Rooms, nightly rates and warnings                                   */
/* ================================================================== */
describe('rooms and warnings, unchanged by exposure', () => {
  it('exposes exactly the nightly rows that are stored', async () => {
    const b = await asAdmin();
    const stored = await testPrisma.bookingNightPrice.findMany({
      where: { bookingRoom: { bookingId } },
    });
    const exposed = b.rooms.flatMap((r: { nights: unknown[] }) => r.nights);
    expect(exposed).toHaveLength(stored.length);
  });

  it('keeps every night of a multi-night stay separate — never summed', async () => {
    // Built directly, because the dispatch fixture is a single night and would
    // pass this assertion without ever exercising it. Three nights at three
    // different prices: a serializer that aggregated would show one row, or one
    // amount, and both are caught here.
    const multi = await testPrisma.booking.create({
      data: {
        bookingCode: 'MULTI-1',
        customerName: 'Guest',
        sourcePlatform: 'AGODA',
        paymentStatus: 'PAY_BEFORE',
        rawText: 'x',
        status: 'NEW',
        branchId,
        sentAt: new Date(),
        rooms: {
          create: {
            roomIndex: 1,
            roomType: 'Deluxe',
            nights: {
              create: [
                { stayDate: new Date('2026-09-01T00:00:00.000Z'), amount: 500_000 },
                { stayDate: new Date('2026-09-02T00:00:00.000Z'), amount: 700_000 },
                { stayDate: new Date('2026-09-03T00:00:00.000Z'), amount: null },
              ],
            },
          },
        },
      },
    });

    const b = (await admin.get(`/api/bookings/${multi.id}`)).body.booking;
    const nights = b.rooms[0].nights;
    expect(nights).toHaveLength(3);
    expect(nights.map((n: { stayDate: string }) => n.stayDate)).toEqual([
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
    ]);
    expect(nights.map((n: { amount: number | null }) => n.amount)).toEqual([500_000, 700_000, null]);
    // The unknown night stays unknown — never averaged from the two known ones.
    expect(nights[2].amount).toBeNull();
  });

  it('marks an estimated night as estimated rather than presenting it as read', async () => {
    const b = await asAdmin();
    for (const room of b.rooms) {
      for (const night of room.nights) {
        expect(night).toHaveProperty('isEstimated');
        expect(night).toHaveProperty('manuallyCorrected');
        expect(night.stayDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    }
  });

  it('reports the parser warnings verbatim, never reworded', async () => {
    const stored = await testPrisma.bookingExtractWarning.findMany({ where: { bookingId } });
    const b = await asAdmin();
    expect(b.warnings.map((w: { message: string }) => w.message).sort()).toEqual(
      stored.map((w) => w.message).sort(),
    );
  });
});

/* ================================================================== */
/* Operational timestamps                                              */
/* ================================================================== */
describe('the operational record', () => {
  it('reports the real stay events as null until they happen', async () => {
    const b = await asAdmin();
    expect(b.operational.actualCheckInAt).toBeNull();
    expect(b.operational.actualCheckOutAt).toBeNull();
    expect(b.operational.cancelledAt).toBeNull();
  });

  it('reports the actor once an event is recorded', async () => {
    const received = await admin.post(`/api/bookings/${bookingId}/receive`).send({});
    expect(received.status).toBe(200);
    const b = await asAdmin();
    expect(b.operational.receivedAt).not.toBeNull();
    expect(b.operational.receivedBy?.fullName).toBeTruthy();
    // And it never leaks the actor's password hash or username.
    expect(Object.keys(b.operational.receivedBy).sort()).toEqual(['fullName', 'id']);
  });
});

import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
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

let app: ReturnType<typeof createApp>;
let adminAgent: Awaited<ReturnType<typeof loginAgent>>['agent'];

const SINGLE_ROOM = `Saigon Hotel & Ben Thanh
Mã đặt phòng: 1234567890
Khách: Nguyễn Văn A
Điện thoại: 0901234567
Nhận phòng: 2026-07-19
Trả phòng: 2026-07-22
Phòng 1: Deluxe Double Room
2026-07-19: 850.000 VND
2026-07-20: 850.000 VND
2026-07-21: 950.000 VND
Tổng cộng: 2.650.000 VND
Thanh toán: Thanh toán tại chỗ`;

beforeEach(async () => {
  await resetAll();
  await seedBranches(testPrisma);
  app = createApp();
  await createAdmin({ mustChangePassword: false });
  adminAgent = (await loginAgent(app, 'admin', ADMIN_PASSWORD)).agent;
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

describe('POST /api/bookings/extract', () => {
  it('extracts, stores a DRAFT, and returns the structured preview', async () => {
    const res = await adminAgent.post('/api/bookings/extract').send({ rawText: SINGLE_ROOM });

    expect(res.status).toBe(201);
    expect(res.body.booking.status).toBe('DRAFT');
    expect(res.body.booking.guestName).toBe('Nguyễn Văn A');
    expect(res.body.booking.bookingCode).toBe('1234567890');
    expect(res.body.booking.checkIn).toBe('2026-07-19');
    expect(res.body.booking.checkOut).toBe('2026-07-22');
    expect(res.body.booking.totalAmount).toBe(2_650_000);
    expect(res.body.booking.parserVersion).toBeTruthy();

    expect(res.body.suggestedBranch.address).toBe('05 Trương Định');
    expect(res.body.rooms).toHaveLength(1);
    expect(res.body.rooms[0].roomName).toBe('Deluxe Double Room');
    expect(res.body.rooms[0].nights).toHaveLength(3);
    expect(res.body.rooms[0].nights.map((n: { amount: number }) => n.amount)).toEqual([
      850_000, 850_000, 950_000,
    ]);
    expect(res.body.warnings).toEqual([]);

    // Persisted as a DRAFT with rooms, nights and the admin as creator.
    const stored = await testPrisma.booking.findUniqueOrThrow({
      where: { id: res.body.booking.id },
      include: { rooms: { include: { nights: true } } },
    });
    expect(stored.status).toBe('DRAFT');
    expect(stored.createdByUserId).not.toBeNull();
    expect(stored.rooms).toHaveLength(1);
    expect(stored.rooms[0]!.nights).toHaveLength(3);
  });

  it('flows the two-room nightly-table sample through store + serialize to the review payload', async () => {
    const raw = fs.readFileSync(
      path.join(__dirname, 'fixtures', 'booking', '25-real-sample-two-room-nightly.txt'),
      'utf8',
    );
    const res = await adminAgent.post('/api/bookings/extract').send({ rawText: raw });

    expect(res.status).toBe(201);
    // The exact review-form fields the frontend renders.
    expect(res.body.booking.hotelName).toBe('Saigon Hotel & Ben Thanh Market');
    expect(res.body.booking.guestName).toBe('Thùy Chi Phan');
    expect(res.body.booking.phone).toBe('+84 964 934 713');
    expect(res.body.booking.bookingCode).toBe('6312474567');
    expect(res.body.booking.totalAmount).toBe(3_078_000);
    expect(res.body.booking.checkIn).toBe('2026-07-23');
    expect(res.body.booking.checkOut).toBe('2026-07-25');
    expect(res.body.booking.paymentStatus).toBe('PAY_AFTER');
    expect(res.body.booking.specialRequest).toBe(
      'Khách dự kiến đến trong khoảng 13:00 - 14:00. Có thể gửi hành lý nếu phòng chưa sẵn sàng.',
    );
    expect(res.body.suggestedBranch.address).toBe('05 Trương Định');

    expect(res.body.rooms).toHaveLength(2);
    for (const room of res.body.rooms) {
      expect(room.roomName).toBe('Phòng Tiêu Chuẩn Giường Đôi');
      expect(room.roomTotal).toBe(1_539_000);
      expect(room.nights.map((n: { stayDate: string }) => n.stayDate)).toEqual([
        '2026-07-23',
        '2026-07-24',
      ]);
      expect(room.nights.map((n: { amount: number }) => n.amount)).toEqual([648_000, 891_000]);
    }
    expect(res.body.warnings).toEqual([]);

    // Persisted through the store exactly as previewed.
    const stored = await testPrisma.booking.findUniqueOrThrow({
      where: { id: res.body.booking.id },
      include: { rooms: { include: { nights: true } } },
    });
    expect(stored.rooms).toHaveLength(2);
    expect(stored.totalAmount).toBe(3_078_000);
    expect(stored.rooms.every((r) => r.nights.length === 2)).toBe(true);
  });

  it('persists extraction warnings for a missing nightly price', async () => {
    const text = `Saigon Hotel & Ben Thanh
Mã đặt phòng: 999
Khách: Test Guest
Nhận phòng: 2026-07-19
Trả phòng: 2026-07-22
Phòng 1: Deluxe Double Room
2026-07-19: 850.000 VND
2026-07-20:
2026-07-21: 950.000 VND
Thanh toán: Thanh toán tại chỗ`;

    const res = await adminAgent.post('/api/bookings/extract').send({ rawText: text });
    expect(res.status).toBe(201);
    const codes = res.body.warnings.map((w: { code: string }) => w.code);
    expect(codes).toContain('MISSING_NIGHTLY_PRICE');

    const warningRows = await testPrisma.bookingExtractWarning.findMany({
      where: { bookingId: res.body.booking.id },
    });
    expect(warningRows.some((w) => w.code === 'MISSING_NIGHTLY_PRICE')).toBe(true);
  });

  it('returns an unknown-hotel warning with no suggested branch', async () => {
    const text = `Some Random Guesthouse
Mã đặt phòng: 888
Khách: Test Guest
Nhận phòng: 2026-09-01
Trả phòng: 2026-09-02
Phòng 1: Standard Room
2026-09-01: 500.000 VND
Thanh toán: Thanh toán tại chỗ`;

    const res = await adminAgent.post('/api/bookings/extract').send({ rawText: text });
    expect(res.status).toBe(201);
    expect(res.body.suggestedBranch).toBeNull();
    expect(res.body.warnings.map((w: { code: string }) => w.code)).toContain('UNKNOWN_HOTEL');
  });

  it('rejects empty rawText with a validation error', async () => {
    const res = await adminAgent.post('/api/bookings/extract').send({ rawText: '' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('forbids a receptionist from extracting', async () => {
    const branch = await testPrisma.branch.findFirstOrThrow();
    await createReceptionist(branch.id, { username: 'letan', mustChangePassword: false });
    const { agent } = await loginAgent(app, 'letan', RECEPTIONIST_PASSWORD);

    const res = await agent.post('/api/bookings/extract').send({ rawText: SINGLE_ROOM });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('requires authentication', async () => {
    const res = await request(app).post('/api/bookings/extract').send({ rawText: SINGLE_ROOM });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_REQUIRED');
  });
});

describe('POST /api/bookings/extract — branch confidence & persistence safety', () => {
  const LOW_CONFIDENCE = `Luxury Hotel Ben Thanh
Số xác nhận đặt phòng
5566778899
Nhận phòng
2026-09-01
Trả phòng
2026-09-02
Tên khách
Test Guest
Deluxe Room
2026-09-01
800.000 VND`;

  it('surfaces a low-confidence branch candidate but does not auto-assign it', async () => {
    const res = await adminAgent.post('/api/bookings/extract').send({ rawText: LOW_CONFIDENCE });

    expect(res.status).toBe(201);
    expect(res.body.branchConfident).toBe(false);
    expect(res.body.requiresManualConfirmation).toBe(true);
    // The candidate is offered to the admin for confirmation…
    expect(res.body.suggestedBranch).not.toBeNull();
    expect(res.body.warnings.map((w: { code: string }) => w.code)).toContain('LOW_BRANCH_CONFIDENCE');

    // …but branchId is never written until the admin confirms it.
    const stored = await testPrisma.booking.findUniqueOrThrow({
      where: { id: res.body.booking.id },
    });
    expect(stored.branchId).toBeNull();
  });

  it('persists booking, rooms, nights and warnings atomically', async () => {
    const text = `Saigon Hotel & Ben Thanh
Mã đặt phòng: 4545454545
Khách: Atomic Guest
Nhận phòng: 2026-07-19
Trả phòng: 2026-07-22
Phòng 1: Deluxe Double Room
2026-07-19: 850.000 VND
2026-07-21: 950.000 VND
Thanh toán: Thanh toán tại chỗ`;

    const res = await adminAgent.post('/api/bookings/extract').send({ rawText: text });
    expect(res.status).toBe(201);

    const stored = await testPrisma.booking.findUniqueOrThrow({
      where: { id: res.body.booking.id },
      include: { rooms: { include: { nights: true } }, warnings: true },
    });
    // One transaction wrote the booking together with all of its children.
    expect(stored.rooms).toHaveLength(1);
    expect(stored.rooms[0]!.nights).toHaveLength(3);
    expect(stored.warnings.some((w) => w.code === 'MISSING_NIGHTLY_PRICE')).toBe(true);
  });

  it('replaces the previous DRAFT when the same code is re-extracted', async () => {
    const first = await adminAgent.post('/api/bookings/extract').send({ rawText: SINGLE_ROOM });
    const second = await adminAgent.post('/api/bookings/extract').send({ rawText: SINGLE_ROOM });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.booking.id).not.toBe(first.body.booking.id);

    // Retrying does not pile up duplicate drafts for the same confirmation code.
    const drafts = await testPrisma.booking.findMany({
      where: { bookingCode: '1234567890', status: 'DRAFT' },
    });
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.id).toBe(second.body.booking.id);

    // The superseded draft's rooms were cascaded away, leaving no orphans.
    const orphanRooms = await testPrisma.bookingRoom.findMany({
      where: { bookingId: first.body.booking.id },
    });
    expect(orphanRooms).toHaveLength(0);
  });
});

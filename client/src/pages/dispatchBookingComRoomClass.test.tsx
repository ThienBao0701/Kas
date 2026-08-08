/**
 * The Admin's Booking.com room-class selector and PMS-note review.
 *
 * What these tests are really guarding:
 *
 *   The internal code and the OTA room name are DIFFERENT FIELDS. The name
 *   Booking.com printed — "(0)" and all — is evidence of what was sold and must
 *   survive intact; the code is what our PMS calls it. Conflating them is the
 *   defect this screen exists to prevent.
 *
 *   The note is the BOOKING.COM note, from the Booking.com builder. An "AGD"
 *   prefix appearing here would mean a Booking.com reservation was printed in
 *   Agoda's format — asserted against directly, because the reference designs
 *   for this screen were Agoda screenshots.
 *
 *   The code the note prints is the one the SERVER stored. The selector writes
 *   through an endpoint and renders what comes back, so the note on screen and
 *   the note reception generates cannot disagree.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ADMIN_USER, EMPTY_OPERATIONAL_BLOCKS, installApiMock, renderApp } from '../test/utils';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const BRANCH = {
  id: 1,
  code: 'TRUONG_DINH_05',
  hotelName: 'Saigon Hotel & Ben Thanh',
  address: '05 Trương Định',
  breakfastIncluded: false,
};
const BRANCH2 = {
  id: 2,
  code: 'LY_TU_TRONG_260',
  hotelName: 'Luxury Elegance Hotel',
  address: '260 Lý Tự Trọng',
  breakfastIncluded: false,
};

/** CN1's real catalogue shape: three classes, no DEL. */
const CN1_CLASSES = [
  { id: 'rc-stan', stableKey: 'standard', displayName: 'Standard', normalizedName: 'standard', pmsCode: 'STAN', active: true, sortOrder: 1, aliases: [], updatedAt: '2026-08-01T00:00:00.000Z' },
  { id: 'rc-sup', stableKey: 'superior', displayName: 'Superior', normalizedName: 'superior', pmsCode: 'SUP', active: true, sortOrder: 2, aliases: [], updatedAt: '2026-08-01T00:00:00.000Z' },
  { id: 'rc-defam', stableKey: 'deluxe-family', displayName: 'Deluxe Family', normalizedName: 'deluxefamily', pmsCode: 'DEFAM', active: true, sortOrder: 3, aliases: [], updatedAt: '2026-08-01T00:00:00.000Z' },
];

/** CN2 codes an Admin must not be able to put on a CN1 booking. */
const CN2_CLASSES = [
  { id: 'rc2-del', stableKey: 'deluxe', displayName: 'Deluxe', normalizedName: 'deluxe', pmsCode: 'DEL', active: true, sortOrder: 1, aliases: [], updatedAt: '2026-08-01T00:00:00.000Z' },
];

const mappingBody = (branchId: number) => ({
  active: {
    id: `v-${branchId}`,
    branchId,
    versionNumber: 1,
    status: 'ACTIVE',
    changeReason: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    activatedAt: '2026-08-01T00:00:00.000Z',
    archivedAt: null,
    createdBy: null,
    activatedBy: null,
    roomClasses: branchId === 1 ? CN1_CLASSES : CN2_CLASSES,
  },
  draft: null,
});

/** The OTA name is deliberately one Booking.com really prints, "(0)" included. */
const OTA_ROOM_NAME = 'Standard Double Room No Window (0)';

function detail(overrides: Record<string, unknown> = {}, roomOverrides: Record<string, unknown> = {}) {
  return {
    id: 'd1',
    status: 'DRAFT',
    sourcePlatform: 'BOOKING_COM',
    verificationStatus: 'NOT_SUBMITTED',
    businessType: 'DIRECT',
    businessTypeManuallyConfirmed: false,
    hotelName: 'Saigon Hotel & Ben Thanh Market',
    branch: BRANCH,
    branchId: 1,
    customerName: 'Thùy Chi Phan',
    phone: '+84964934713',
    bookingCode: '6312474567',
    checkInDate: '2026-07-23',
    checkOutDate: '2026-07-25',
    checkInTime: null,
    checkOutTime: null,
    totalAmount: 3_078_000,
    currency: 'VND',
    paymentStatus: 'PAY_AFTER',
    specialRequest: null,
    rawText: 'raw',
    parserVersion: '4a.2.0',
    isLastMinute: false,
    adminPmsNote: null,
    reviewedPaymentMode: null,
    rooms: [
      {
        id: 'r1',
        roomIndex: 1,
        roomType: OTA_ROOM_NAME,
        roomSubtotal: 1_539_000,
        taxAmount: null,
        feeAmount: null,
        roomClassId: null,
        roomClassPmsCode: null,
        roomClassDisplayName: null,
        roomClassStatus: 'UNRESOLVED',
        nights: [
          { id: 'n1', stayDate: '2026-07-23', amount: 648_000, currency: 'VND', manuallyCorrected: false, isEstimated: false },
        ],
        ...roomOverrides,
      },
    ],
    warnings: [],
    ...EMPTY_OPERATIONAL_BLOCKS,
    proofs: [],
    createdBy: null,
    sentBy: null,
    completedBy: null,
    reviewedBy: null,
    createdAt: '2026-07-20T00:00:00.000Z',
    updatedAt: '2026-07-20T00:00:00.000Z',
    sentAt: null,
    completedAt: null,
    completionNote: null,
    reviewedAt: null,
    ...overrides,
  };
}

const EXTRACT = {
  booking: { id: 'd1', status: 'DRAFT' },
  suggestedBranch: BRANCH,
  branchConfidence: 100,
  branchConfident: true,
  requiresManualConfirmation: false,
  parserQuality: { score: 98, level: 'HIGH', requiresAdminReview: false, missingCriticalFields: [], warningCount: 0 },
  businessType: 'DIRECT',
  businessTypeConfidence: 90,
  businessTypeRequiresAdminConfirmation: false,
  businessTypeMatchedRules: ['retail-rate'],
  warnings: [],
};

function mount(
  bookingDetail: Record<string, unknown> = detail(),
  extra: Record<string, () => { status: number; body?: unknown }> = {},
) {
  return installApiMock({
    'GET /api/auth/me': () => ({ status: 200, body: { user: ADMIN_USER } }),
    'GET /api/notifications/unread-count': () => ({ status: 200, body: { count: 0 } }),
    'GET /api/branches': () => ({ status: 200, body: { branches: [BRANCH, BRANCH2] } }),
    'POST /api/bookings/extract': () => ({ status: 201, body: EXTRACT }),
    'GET /api/admin/bookings/d1': () => ({ status: 200, body: { booking: bookingDetail } }),
    'GET /api/admin/branches/1/room-mapping': () => ({ status: 200, body: mappingBody(1) }),
    'GET /api/admin/branches/2/room-mapping': () => ({ status: 200, body: mappingBody(2) }),
    ...extra,
  });
}

async function extract(user: ReturnType<typeof userEvent.setup>) {
  const textarea = await screen.findByRole('textbox');
  await user.type(textarea, 'Booking.com raw text');
  await user.click(screen.getByRole('button', { name: 'Trích xuất thông tin' }));
}

/* ================================================================== */
/* The OTA name and the internal code are different things             */
/* ================================================================== */

describe('the Hạng phòng section', () => {
  it('shows the Booking.com room name exactly as extracted', async () => {
    mount();
    const user = userEvent.setup();
    renderApp('/app/dispatch');
    await extract(user);

    const field = await screen.findByLabelText('Tên hạng phòng dòng 1');
    // The trailing "(0)" is part of what the platform printed.
    expect(field).toHaveValue(OTA_ROOM_NAME);
  });

  it('never replaces the OTA name with the internal code', async () => {
    mount(detail({}, { roomClassId: 'rc-stan', roomClassPmsCode: 'STAN', roomClassStatus: 'RESOLVED' }));
    const user = userEvent.setup();
    renderApp('/app/dispatch');
    await extract(user);

    expect(await screen.findByLabelText('Tên hạng phòng dòng 1')).toHaveValue(OTA_ROOM_NAME);
    // The select only carries the value once its options have arrived.
    await waitFor(() => expect(screen.getByLabelText('Mã nội bộ dòng 1')).toHaveValue('rc-stan'));
    expect(screen.getByLabelText('Tên hạng phòng dòng 1')).toHaveValue(OTA_ROOM_NAME);
  });

  it('offers the real codes of the selected branch', async () => {
    mount();
    const user = userEvent.setup();
    renderApp('/app/dispatch');
    await extract(user);

    const select = await screen.findByLabelText('Mã nội bộ dòng 1');
    await waitFor(() =>
      expect(within(select as HTMLElement).getAllByRole('option').length).toBeGreaterThan(1),
    );
    const options = within(select as HTMLElement).getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(['— Chưa chọn —', 'STAN — Standard', 'SUP — Superior', 'DEFAM — Deluxe Family']);
    // CN2's Deluxe is not a CN1 code and must not be offered here.
    expect(options.some((o) => o?.startsWith('DEL —'))).toBe(false);
  });

  it('pre-selects a code the system detected, without asking again', async () => {
    mount(detail({}, { roomClassId: 'rc-stan', roomClassPmsCode: 'STAN', roomClassStatus: 'RESOLVED' }));
    const user = userEvent.setup();
    renderApp('/app/dispatch');
    await extract(user);

    await waitFor(() => expect(screen.getByLabelText('Mã nội bộ dòng 1')).toHaveValue('rc-stan'));
    expect(screen.getByTestId('bcom-room-1-status')).toHaveTextContent('hệ thống tự nhận diện');
  });

  it('shows — Chưa chọn — when nothing could be mapped, and never guesses', async () => {
    mount();
    const user = userEvent.setup();
    renderApp('/app/dispatch');
    await extract(user);

    expect(await screen.findByLabelText('Mã nội bộ dòng 1')).toHaveValue('');
    expect(screen.getByTestId('bcom-room-1-status')).toHaveTextContent('Chưa gán mã hạng phòng');
  });
});

/* ================================================================== */
/* Selecting a code persists through the server                        */
/* ================================================================== */

describe('choosing an internal code', () => {
  it('sends the selection to the server and shows what it stored', async () => {
    const fetchMock = mount(detail(), {
      'PUT /api/bookings/d1/rooms/1/room-class': () => ({
        status: 200,
        body: { room: { roomIndex: 1, roomClassId: 'rc-sup', displayName: 'Superior', pmsCode: 'SUP', status: 'MANUAL' } },
      }),
    });
    const user = userEvent.setup();
    renderApp('/app/dispatch');
    await extract(user);

    const select = await screen.findByLabelText('Mã nội bộ dòng 1');
    await waitFor(() => expect(within(select as HTMLElement).getAllByRole('option').length).toBe(4));
    await user.selectOptions(select, 'rc-sup');

    await waitFor(() =>
      expect(screen.getByTestId('bcom-room-1-status')).toHaveTextContent('đã chọn thủ công'),
    );

    const call = fetchMock.mock.calls.find(
      ([u, i]) => String(u) === '/api/bookings/d1/rooms/1/room-class' && (i as RequestInit)?.method === 'PUT',
    );
    expect(call).toBeDefined();
    expect(JSON.parse(String((call![1] as RequestInit).body))).toEqual({ roomClassId: 'rc-sup' });
  });

  it('regenerates the PMS note from the code the server returned', async () => {
    mount(detail(), {
      'PUT /api/bookings/d1/rooms/1/room-class': () => ({
        status: 200,
        body: { room: { roomIndex: 1, roomClassId: 'rc-defam', displayName: 'Deluxe Family', pmsCode: 'DEFAM', status: 'MANUAL' } },
      }),
    });
    const user = userEvent.setup();
    renderApp('/app/dispatch');
    await extract(user);

    const select = await screen.findByLabelText('Mã nội bộ dòng 1');
    await waitFor(() => expect(within(select as HTMLElement).getAllByRole('option').length).toBe(4));
    await user.selectOptions(select, 'rc-defam');

    await waitFor(() =>
      expect((screen.getByTestId('bcom-pms-note') as HTMLTextAreaElement).value).toContain('_DEFAM_'),
    );
  });
});

/* ================================================================== */
/* The note is the BOOKING.COM note                                    */
/* ================================================================== */

describe('the Ghi chú PMS section', () => {
  it('uses the Booking.com format, never the Agoda one', async () => {
    mount(detail({}, { roomClassId: 'rc-stan', roomClassPmsCode: 'STAN', roomClassStatus: 'RESOLVED' }));
    const user = userEvent.setup();
    renderApp('/app/dispatch');
    await extract(user);

    const note = (await screen.findByTestId('bcom-pms-note')) as HTMLTextAreaElement;
    // The Booking.com builder's own layout: BK <code>_<ROOM>_<n> ĐÊM … CI
    expect(note.value).toContain('BK 6312474567_STAN_2 ĐÊM');
    expect(note.value).toContain('PAY AFTER CHECK-IN CI');
    // The reference screenshots for this screen were Agoda notes. Never here.
    expect(note.value).not.toContain('AGD ');
    expect(note.value).not.toContain('GIÁ KHÁCH ĐẶT');
    expect(note.value).not.toContain('CTRIP_');
  });

  it('carries the guest phone, as the Booking.com note does', async () => {
    mount(detail({}, { roomClassId: 'rc-stan', roomClassPmsCode: 'STAN', roomClassStatus: 'RESOLVED' }));
    const user = userEvent.setup();
    renderApp('/app/dispatch');
    await extract(user);

    const note = (await screen.findByTestId('bcom-pms-note')) as HTMLTextAreaElement;
    expect(note.value).toContain('CÓ ZL +84964934713');
  });

  it('is editable', async () => {
    mount(detail({}, { roomClassId: 'rc-stan', roomClassPmsCode: 'STAN', roomClassStatus: 'RESOLVED' }));
    const user = userEvent.setup();
    renderApp('/app/dispatch');
    await extract(user);

    const note = (await screen.findByTestId('bcom-pms-note')) as HTMLTextAreaElement;
    expect(note.readOnly).toBe(false);
    expect(note.disabled).toBe(false);

    await user.clear(note);
    await user.type(note, 'SUA TAY');
    expect(note).toHaveValue('SUA TAY');
  });

  it('copies what is on screen', async () => {
    mount(detail({}, { roomClassId: 'rc-stan', roomClassPmsCode: 'STAN', roomClassStatus: 'RESOLVED' }));
    const user = userEvent.setup();
    renderApp('/app/dispatch');
    await extract(user);
    await screen.findByTestId('bcom-pms-note');

    // Stubbed AFTER userEvent.setup(), which installs a clipboard of its own.
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    vi.stubGlobal('isSecureContext', true);

    await user.click(screen.getByRole('button', { name: /Sao chép note/ }));

    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(String(writeText.mock.calls[0]![0])).toContain('BK 6312474567_STAN_2 ĐÊM');
  });

  it('explains itself instead of printing a note it cannot build', async () => {
    // No booking code: the Booking.com builder refuses rather than inventing.
    mount(detail({ bookingCode: null }, { roomClassPmsCode: 'STAN', roomClassId: 'rc-stan' }));
    const user = userEvent.setup();
    renderApp('/app/dispatch');
    await extract(user);

    expect(await screen.findByTestId('bcom-pms-note-card')).toHaveTextContent(
      'Chưa có mã Booking để tạo ghi chú.',
    );
    expect(screen.queryByTestId('bcom-pms-note')).not.toBeInTheDocument();
  });
});

/* ================================================================== */
/* Dispatch is blocked until every room has a code                     */
/* ================================================================== */

describe('dispatch gating', () => {
  it('blocks sending and says why when a code is missing', async () => {
    mount();
    const user = userEvent.setup();
    renderApp('/app/dispatch');
    await extract(user);

    expect(await screen.findByTestId('dispatch-room-blocking')).toHaveTextContent(
      'Vui lòng chọn mã nội bộ cho tất cả hạng phòng trước khi gửi.',
    );
    expect(screen.getByRole('button', { name: /Gửi xuống chi nhánh/ })).toBeDisabled();
  });

  it('allows sending once every room carries a code', async () => {
    mount(detail({}, { roomClassId: 'rc-stan', roomClassPmsCode: 'STAN', roomClassStatus: 'RESOLVED' }));
    const user = userEvent.setup();
    renderApp('/app/dispatch');
    await extract(user);

    await screen.findByTestId('bcom-room-classes');
    expect(screen.queryByTestId('dispatch-room-blocking')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Gửi xuống chi nhánh/ })).toBeEnabled();
  });

  it('asks the Admin to save after a branch change before offering codes', async () => {
    // The server validates against the SAVED branch, so the selector waits.
    mount(detail({}, { roomClassId: 'rc-stan', roomClassPmsCode: 'STAN', roomClassStatus: 'RESOLVED' }));
    const user = userEvent.setup();
    renderApp('/app/dispatch');
    await extract(user);

    await screen.findByTestId('bcom-room-classes');
    await user.selectOptions(screen.getByLabelText('Chọn chi nhánh gửi đến'), '2');

    expect(await screen.findByTestId('bcom-branch-dirty')).toBeInTheDocument();
    expect(screen.getByLabelText('Mã nội bộ dòng 1')).toBeDisabled();
  });
});

/**
 * The operational sections of the booking detail.
 *
 * Two behaviours are worth pinning. First, a section with nothing in it is not
 * rendered: eight "—" rows on a Booking.com booking would suggest the OTA sent
 * details that were lost, when it never sent any. Second, request provenance
 * appears only for an Admin — and because the server omits the key entirely for
 * a receptionist, the test asserts on the receptionist's real payload shape
 * rather than on a client-side flag.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import {
  ADMIN_USER,
  EMPTY_OPERATIONAL_BLOCKS,
  RECEPTIONIST_USER,
  installApiMock,
  renderApp,
} from '../test/utils';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const BASE = {
  id: 'b1',
  status: 'NEW',
  sourcePlatform: 'AGODA',
  verificationStatus: 'NOT_SUBMITTED',
  businessType: 'OTA',
  businessTypeManuallyConfirmed: false,
  hotelName: 'Saigon Hotel',
  branch: { id: 1, code: 'TRUONG_DINH_05', hotelName: 'Saigon Hotel', address: '05 Trương Định' },
  branchId: 1,
  customerName: 'Nguyễn Văn A',
  phone: '0901234567',
  bookingCode: 'A-1',
  checkInDate: '2026-08-04',
  checkOutDate: '2026-08-05',
  checkInTime: null,
  checkOutTime: null,
  totalAmount: 1_000_000,
  currency: 'VND',
  paymentStatus: 'PAY_BEFORE',
  specialRequest: null,
  parserVersion: '5.0.0',
  isLastMinute: false,
  rooms: [],
  warnings: [],
  statusHistory: [],
  proofs: [],
  createdBy: null,
  sentBy: null,
  completedBy: null,
  reviewedBy: null,
  createdAt: '2026-08-01T02:00:00.000Z',
  updatedAt: '2026-08-01T02:00:00.000Z',
  sentAt: '2026-08-01T02:00:00.000Z',
  completedAt: null,
  completionNote: null,
  reviewedAt: null,
  ...EMPTY_OPERATIONAL_BLOCKS,
};

const IP = '203.0.113.9';
const UA = 'Mozilla/5.0 (KasProbe)';

/** A booking that has actually been through the Phase 5 workflow. */
const RICH = {
  ...BASE,
  ota: {
    ...EMPTY_OPERATIONAL_BLOCKS.ota,
    sourcePlatform: 'AGODA',
    sourcePropertyId: '1234567',
    otaBookingStatus: 'Confirmed',
    ratePlanName: 'Standard Rate',
    countryOfResidence: 'Vietnam',
    parserVersion: '5.0.0',
    rawTextSha256: 'a'.repeat(64),
  },
  operational: {
    ...EMPTY_OPERATIONAL_BLOCKS.operational,
    receivedAt: '2026-08-02T03:00:00.000Z',
    receivedBy: { id: 2, fullName: 'Lễ tân Một' },
  },
  corrections: [
    {
      id: 'c1',
      field: 'checkOut',
      oldValue: '2026-08-05',
      newValue: '2026-08-07',
      appliedBy: { id: 1, fullName: 'Quản trị viên' },
      appliedAt: '2026-08-02T04:00:00.000Z',
    },
  ],
  timeline: [
    {
      at: '2026-08-01T02:00:00.000Z',
      type: 'STATUS_NEW',
      description: 'Điều phối tới chi nhánh',
      actor: { id: 1, fullName: 'Quản trị viên' },
    },
    {
      at: '2026-08-02T04:00:00.000Z',
      type: 'AMENDMENT_APPLIED',
      description: 'Áp dụng 1 thay đổi: checkOut',
      actor: { id: 1, fullName: 'Quản trị viên' },
    },
  ],
  requestAudit: {
    parserCommit: 'deadbeef',
    reviewBuildId: 'build-77',
    requests: [
      {
        id: 'req-1',
        correlationId: 'corr-1',
        route: '/admin/ota/amendment/apply',
        ipAddress: IP,
        userAgent: UA,
        sessionId: 'sess-1',
        occurredAt: '2026-08-02T04:00:00.000Z',
      },
    ],
  },
};

/** What the server actually sends a receptionist: no requestAudit key at all. */
function withoutAudit(booking: Record<string, unknown>) {
  const { requestAudit: _dropped, ...rest } = booking;
  return rest;
}

function mount(booking: unknown, user: typeof ADMIN_USER) {
  installApiMock({
    'GET /api/auth/me': () => ({ status: 200, body: { user } }),
    'GET /api/notifications/unread-count': () => ({ status: 200, body: { count: 0 } }),
    'GET /api/bookings/b1': () => ({ status: 200, body: { booking } }),
  });
  renderApp('/app/booking/b1');
}

/* ================================================================== */
/* Sections appear only when they hold something                       */
/* ================================================================== */
describe('empty sections stay out of the way', () => {
  it('renders no OTA, operational, correction or timeline card for a bare booking', async () => {
    mount(BASE, ADMIN_USER);
    // Wait for the detail to load before asserting on what is absent.
    expect(await screen.findByRole('heading', { name: 'Nguyễn Văn A' })).toBeInTheDocument();
    expect(screen.queryByTestId('ota-metadata-card')).toBeNull();
    expect(screen.queryByTestId('operational-card')).toBeNull();
    expect(screen.queryByTestId('corrections-card')).toBeNull();
    expect(screen.queryByTestId('timeline-card')).toBeNull();
  });

  it('renders each one once the booking has been through the workflow', async () => {
    mount(RICH, ADMIN_USER);
    expect(await screen.findByTestId('ota-metadata-card')).toBeInTheDocument();
    expect(screen.getByTestId('operational-card')).toBeInTheDocument();
    expect(screen.getByTestId('corrections-card')).toBeInTheDocument();
    expect(screen.getByTestId('timeline-card')).toBeInTheDocument();
  });
});

/* ================================================================== */
/* Content                                                             */
/* ================================================================== */
describe('what the sections show', () => {
  it('shows the OTA values verbatim and labels Property ID as reference only', async () => {
    mount(RICH, ADMIN_USER);
    const card = await screen.findByTestId('ota-metadata-card');
    expect(card).toHaveTextContent('Confirmed');
    expect(card).toHaveTextContent('Standard Rate');
    expect(card).toHaveTextContent('1234567');
    expect(card).toHaveTextContent('chỉ để đối chiếu');
  });

  it('shows each correction with its old and new value', async () => {
    mount(RICH, ADMIN_USER);
    const rows = await screen.findAllByTestId('correction-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('checkOut');
    expect(rows[0]).toHaveTextContent('2026-08-05');
    expect(rows[0]).toHaveTextContent('2026-08-07');
  });

  it('lists every timeline event in the order it was given', async () => {
    mount(RICH, ADMIN_USER);
    const events = await screen.findAllByTestId('timeline-event');
    expect(events).toHaveLength(2);
    expect(events[0]).toHaveTextContent('Điều phối tới chi nhánh');
    expect(events[1]).toHaveTextContent('Áp dụng 1 thay đổi: checkOut');
  });

  it('names who received the booking and when', async () => {
    mount(RICH, ADMIN_USER);
    const card = await screen.findByTestId('operational-card');
    expect(card).toHaveTextContent('Đã nhận đơn');
    expect(card).toHaveTextContent('Lễ tân Một');
  });
});

/* ================================================================== */
/* Request provenance                                                  */
/* ================================================================== */
describe('request provenance', () => {
  it('shows an Admin the build identity and the request rows', async () => {
    mount(RICH, ADMIN_USER);
    const audit = await screen.findByTestId('request-audit');
    expect(audit).toHaveTextContent('deadbeef');
    expect(audit).toHaveTextContent('build-77');
    expect(screen.getByTestId('request-audit-row')).toHaveTextContent(IP);
  });

  it('shows a receptionist nothing of it, and no IP anywhere on the page', async () => {
    mount(withoutAudit(RICH), RECEPTIONIST_USER);
    // The reservation still renders; since the 5.2 pilot pack the audit-facing
    // sections do not, so the booking itself is what proves the page loaded.
    expect(await screen.findByRole('heading', { name: 'Nguyễn Văn A' })).toBeInTheDocument();
    expect(screen.queryByTestId('request-audit')).toBeNull();
    expect(screen.queryByTestId('corrections-card')).toBeNull();
    expect(document.body.textContent).not.toContain(IP);
    expect(document.body.textContent).not.toContain(UA);
    expect(document.body.textContent).not.toContain('sess-1');
    expect(document.body.textContent).not.toContain('corr-1');
  });
});

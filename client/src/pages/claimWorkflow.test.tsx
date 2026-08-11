/**
 * The CUT claim, as the receptionist experiences it.
 *
 * WHAT THESE TESTS ARE NOT: the security boundary. The server owns the claim,
 * and `server/tests/bookingClaim.test.ts` proves it — including the concurrent
 * race. What is checked here is that the screen tells the truth about who owns
 * an order, that the countdown is derived from the SERVER's deadline rather
 * than started locally, and that the duplicate warning is where a person will
 * actually see it.
 *
 * The countdown assertions freeze time with fake timers so "02:59" is exact.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ADMIN_USER, RECEPTIONIST_USER, installApiMock, renderApp } from '../test/utils';
import { claimStateOf, DUPLICATE_WARNING, formatRemaining } from '../lib/claim';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const NOW = new Date('2026-08-09T10:00:00.000Z');
const BRANCH = {
  id: 1,
  code: 'TRUONG_DINH_05',
  hotelName: 'Saigon Hotel',
  address: '05 Trương Định',
};

/** Absolute instant `ms` after NOW, as the server would send it. */
function inMs(ms: number): string {
  return new Date(NOW.getTime() + ms).toISOString();
}

function detail(over: Record<string, unknown> = {}) {
  return {
    id: 'bk1',
    status: 'NEW',
    sourcePlatform: 'BOOKING_COM',
    verificationStatus: 'NOT_SUBMITTED',
    businessType: 'DIRECT',
    businessTypeManuallyConfirmed: false,
    hotelName: 'Saigon Hotel',
    branch: BRANCH,
    branchId: 1,
    customerName: 'NGUYEN VAN A',
    phone: '+84901234567',
    bookingCode: '6037224525',
    checkInDate: '2026-08-10',
    checkOutDate: '2026-08-11',
    checkInTime: null,
    checkOutTime: null,
    totalAmount: 609_120,
    currency: 'VND',
    paymentStatus: 'PAY_AFTER',
    specialRequest: null,
    isLastMinute: false,
    rooms: [],
    warnings: [],
    proofs: [],
    guests: [],
    sentAt: NOW.toISOString(),
    sentBy: null,
    completedBy: null,
    reviewedBy: null,
    createdBy: null,
    completedAt: null,
    reviewedAt: null,
    receivedAt: null,
    adminPmsNote: null,
    // Unclaimed by default.
    claimedBy: null,
    claimedByUserId: null,
    claimedAt: null,
    claimExpiresAt: null,
    claimCycle: 0,
    ...over,
  };
}

function listItem(over: Record<string, unknown> = {}) {
  return {
    id: 'bk1',
    bookingCode: '6037224525',
    customerName: 'NGUYEN VAN A',
    phone: null,
    branch: BRANCH,
    sourcePlatform: 'BOOKING_COM',
    businessType: 'DIRECT',
    verificationStatus: 'NOT_SUBMITTED',
    checkInDate: '2026-08-10',
    checkOutDate: '2026-08-11',
    numberOfRooms: 1,
    roomSummary: '1 phòng',
    totalAmount: 609_120,
    currency: 'VND',
    paymentStatus: 'PAY_AFTER',
    isLastMinute: false,
    sentAt: NOW.toISOString(),
    sentBy: null,
    status: 'NEW',
    missingNightlyPriceCount: 0,
    warningCount: 0,
    latestAttemptNumber: 0,
    latestRejectionReason: null,
    submittedAt: null,
    reviewedAt: null,
    claimedBy: null,
    claimedByUserId: null,
    claimedAt: null,
    claimExpiresAt: null,
    claimCycle: 0,
    ...over,
  };
}

type Handler = (init: RequestInit) => { status: number; body?: unknown };

function mountQueue(
  user: typeof ADMIN_USER,
  bookingOver: Record<string, unknown> = {},
  extra: Record<string, Handler> = {},
) {
  return installApiMock({
    'GET /api/auth/me': () => ({ status: 200, body: { user } }),
    'GET /api/notifications/unread-count': () => ({ status: 200, body: { count: 0 } }),
    'GET /api/bookings/new?pageSize=100': () => ({
      status: 200,
      body: { bookings: [listItem(bookingOver)], pagination: { page: 1, pageSize: 100, total: 1 } },
    }),
    'GET /api/bookings/bk1': () => ({ status: 200, body: { booking: detail(bookingOver) } }),
    ...extra,
  });
}

/* ================================================================== */
/* Pure helpers                                                        */
/* ================================================================== */

describe('formatRemaining', () => {
  it('renders mm:ss', () => {
    expect(formatRemaining(3 * 60 * 1000)).toBe('03:00');
    expect(formatRemaining(179_000)).toBe('02:59');
    expect(formatRemaining(61_000)).toBe('01:01');
    expect(formatRemaining(1_000)).toBe('00:01');
  });

  it('floors at zero rather than going negative', () => {
    expect(formatRemaining(0)).toBe('00:00');
    expect(formatRemaining(-5_000)).toBe('00:00');
  });
});

describe('claimStateOf — derived from the absolute deadline', () => {
  const base = { claimedBy: null, claimedAt: null, claimCycle: 0 };

  it('is UNCLAIMED with no claim', () => {
    expect(claimStateOf({ ...base, claimedByUserId: null, claimExpiresAt: null }, 2)).toBe('UNCLAIMED');
  });

  it('is MINE when I hold an unexpired claim', () => {
    expect(
      claimStateOf({ ...base, claimedByUserId: 2, claimExpiresAt: inMs(60_000) }, 2, NOW.getTime()),
    ).toBe('MINE');
  });

  it('is OTHERS when someone else holds it', () => {
    expect(
      claimStateOf({ ...base, claimedByUserId: 9, claimExpiresAt: inMs(60_000) }, 2, NOW.getTime()),
    ).toBe('OTHERS');
  });

  it('is EXPIRED once the deadline passes — even for my own claim', () => {
    // A stale polled list must not keep presenting an elapsed claim as active.
    expect(
      claimStateOf({ ...base, claimedByUserId: 2, claimExpiresAt: inMs(-1) }, 2, NOW.getTime()),
    ).toBe('EXPIRED');
  });
});

/* ================================================================== */
/* The CUT button                                                      */
/* ================================================================== */

describe('the CUT button', () => {
  it('is offered to a receptionist on an unclaimed order', async () => {
    mountQueue(RECEPTIONIST_USER);
    renderApp('/app/new');
    expect(await screen.findByTestId('claim-cut')).toHaveTextContent('CUT');
  });

  it('is NOT offered to an Admin — an Admin has no creation work to own', async () => {
    mountQueue(ADMIN_USER);
    renderApp('/app/new');
    await waitFor(() => expect(screen.queryByTestId('claim-cut')).not.toBeInTheDocument());
  });

  it('POSTs to the claim endpoint', async () => {
    const fetchMock = mountQueue(RECEPTIONIST_USER, {}, {
      'POST /api/bookings/bk1/claim': () => ({
        status: 200,
        body: {
          claimedAt: NOW.toISOString(),
          claimExpiresAt: inMs(180_000),
          claimCycle: 0,
          serverNow: NOW.toISOString(),
        },
      }),
    });
    const user = userEvent.setup();
    renderApp('/app/new');

    await user.click(await screen.findByTestId('claim-cut'));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        ([u, init]) =>
          String(u) === '/api/bookings/bk1/claim' &&
          (init as RequestInit | undefined)?.method === 'POST',
      );
      expect(post).toBeDefined();
    });
  });

  it('surfaces the server conflict when someone else won the race', async () => {
    mountQueue(RECEPTIONIST_USER, {}, {
      'POST /api/bookings/bk1/claim': () => ({
        status: 409,
        body: {
          error: { code: 'CONFLICT', message: 'Đơn này đã được Lễ tân Hai nhận. Bạn không thể nhận đơn này.' },
        },
      }),
    });
    const user = userEvent.setup();
    renderApp('/app/new');

    await user.click(await screen.findByTestId('claim-cut'));
    expect(await screen.findByText(/đã được Lễ tân Hai nhận/)).toBeInTheDocument();
  });
});

/* ================================================================== */
/* Claimed states                                                      */
/* ================================================================== */

describe('when I hold the claim', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(NOW);
  });

  it('says so, counts down from the SERVER deadline, and shows the warning', async () => {
    mountQueue(RECEPTIONIST_USER, {
      claimedByUserId: RECEPTIONIST_USER.id,
      claimedBy: { id: RECEPTIONIST_USER.id, fullName: 'Lễ tân Một' },
      claimedAt: NOW.toISOString(),
      // 2:59.9 left — the server's instant, not a duration this client invented.
      // The extra 900 ms absorbs the real time that elapses during the async
      // render (fake timers run with shouldAdvanceTime), so the floored display
      // is deterministically 02:59 rather than racing the second boundary.
      claimExpiresAt: inMs(179_900),
    });
    renderApp('/app/new');

    const panel = await screen.findByTestId('claim-panel');
    expect(within(panel).getByText('Bạn đã nhận đơn này')).toBeInTheDocument();
    expect(within(panel).getByTestId('claim-countdown')).toHaveTextContent('Còn 02:59');
    // The warning is on the claim panel AND above the submit button.
    expect(within(panel).getByText(DUPLICATE_WARNING)).toBeInTheDocument();
  });

  it('ticks down without ever restarting', async () => {
    mountQueue(RECEPTIONIST_USER, {
      claimedByUserId: RECEPTIONIST_USER.id,
      claimedAt: NOW.toISOString(),
      claimExpiresAt: inMs(180_900),
    });
    renderApp('/app/new');

    const countdown = await screen.findByTestId('claim-countdown');
    expect(countdown).toHaveTextContent('Còn 03:00');

    await vi.advanceTimersByTimeAsync(5_000);
    await waitFor(() => expect(countdown).toHaveTextContent('Còn 02:55'));
  });

  it('shows an already-elapsed deadline as expired, not as time remaining', async () => {
    // Refresh/reopen lands here: the deadline is in the past and the UI must
    // not restart a fresh three minutes.
    mountQueue(RECEPTIONIST_USER, {
      claimedByUserId: RECEPTIONIST_USER.id,
      claimedAt: new Date(NOW.getTime() - 200_000).toISOString(),
      claimExpiresAt: inMs(-20_000),
    });
    renderApp('/app/new');

    // An elapsed claim is takeable again, so the panel offers CUT rather than
    // pretending the receptionist still owns it.
    expect(await screen.findByTestId('claim-cut')).toBeInTheDocument();
    expect(screen.queryByText('Bạn đã nhận đơn này')).not.toBeInTheDocument();
  });
});

describe('when another receptionist holds the claim', () => {
  it('names them and offers no way in', async () => {
    mountQueue(RECEPTIONIST_USER, {
      claimedByUserId: 999,
      claimedBy: { id: 999, fullName: 'Lễ tân Hai' },
      claimedAt: NOW.toISOString(),
      claimExpiresAt: new Date(Date.now() + 120_000).toISOString(),
    });
    renderApp('/app/new');

    const panel = await screen.findByTestId('claim-panel');
    expect(within(panel).getByText(/Lễ tân Hai đang xử lý đơn này/)).toBeInTheDocument();
    expect(screen.queryByTestId('claim-cut')).not.toBeInTheDocument();
  });
});

/* ================================================================== */
/* The duplicate warning                                               */
/* ================================================================== */

describe('the duplicate warning', () => {
  it('sits immediately above the submit button, not in a tooltip', async () => {
    mountQueue(RECEPTIONIST_USER);
    renderApp('/app/new');

    const warning = await screen.findByTestId('duplicate-warning');
    expect(warning).toHaveTextContent(DUPLICATE_WARNING);
    // Visible text, not a title/aria-only affordance.
    expect(warning.textContent).toContain('nếu gửi mà không kiểm tra sẽ bị đánh 1 lỗi');
  });

  it('uses the operator wording verbatim', () => {
    expect(DUPLICATE_WARNING).toBe(
      'Nhớ kiểm tra đơn xem có trùng không rồi gửi nè, nếu gửi mà không kiểm tra sẽ bị đánh 1 lỗi',
    );
  });
});

/* ================================================================== */
/* Existing copy actions must survive                                  */
/* ================================================================== */

describe('CUT is additive', () => {
  it('leaves "Sao chép PMS Note" in place', async () => {
    // The receptionist copies the PMS note to create the reservation. CUT
    // decides WHO may do that; it does not replace HOW.
    mountQueue(RECEPTIONIST_USER, { adminPmsNote: 'BK 6037224525_1STAN_1 ĐÊM' });
    renderApp('/app/new');
    await screen.findByTestId('claim-panel');
    expect(screen.getByRole('button', { name: /Sao chép PMS Note/ })).toBeInTheDocument();
  });
});

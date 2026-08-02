/**
 * The operational inbox.
 *
 * The property worth pinning is that a tab is a QUERY, not an endpoint. Every
 * tab hits `/bookings/history` with different parameters, so these tests assert
 * on the URL each tab produces — if someone later adds a bespoke endpoint per
 * tab, this is what notices.
 *
 * The OTA tab is checked specifically. It is the one that cannot be expressed
 * with a single-valued `source`, and it is the reason the server learned the
 * comma-separated form.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ADMIN_USER, RECEPTIONIST_USER, jsonResponse, renderApp } from '../test/utils';

/** Every /bookings/history URL the page has requested, in order. */
let requested: string[] = [];

/**
 * A fetch mock that matches on the path PREFIX.
 *
 * The shared `installApiMock` keys on the exact URL including its query string,
 * which is precisely what these tests need to vary and inspect — the whole
 * point here is which parameters each tab sends.
 */
function installPrefixMock(routes: { prefix: string; body: unknown }[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL) => {
      const href = String(url);
      if (href.includes('/bookings/history')) requested.push(href);
      const route = routes.find((r) => href.startsWith(r.prefix));
      return route
        ? jsonResponse(200, route.body)
        : jsonResponse(404, { error: { code: 'NOT_FOUND', message: `no mock for ${href}` } });
    }),
  );
}

const ROW = {
  id: 'b1',
  bookingCode: 'A-1',
  customerName: 'Nguyễn Văn A',
  phone: '0901234567',
  branch: { id: 1, code: 'TRUONG_DINH_05', hotelName: 'Saigon Hotel', address: '05 Trương Định' },
  sourcePlatform: 'AGODA',
  businessType: 'PARTNER',
  status: 'RECEIVED',
  verificationStatus: 'NOT_SUBMITTED',
  paymentStatus: 'PAY_BEFORE',
  checkInDate: '2026-08-10',
  checkOutDate: '2026-08-11',
  roomSummary: 'Deluxe (1)',
  totalAmount: 1_000_000,
  currency: 'VND',
  isLastMinute: false,
  sentAt: '2026-08-01T02:00:00.000Z',
  sentBy: null,
  completedAt: null,
  completedBy: null,
  reviewedBy: null,
  reviewedAt: null,
  createdAt: '2026-08-01T02:00:00.000Z',
};

function mountInbox(user: typeof ADMIN_USER, bookings: unknown[] = [ROW]) {
  installPrefixMock([
    { prefix: '/api/auth/me', body: { user } },
    { prefix: '/api/notifications/unread-count', body: { count: 0 } },
    { prefix: '/api/branches', body: { branches: [ROW.branch] } },
    {
      prefix: '/api/bookings/history',
      body: {
        bookings,
        pagination: { page: 1, pageSize: 25, total: bookings.length, totalPages: 1 },
      },
    },
  ]);
  renderApp('/app/inbox');
}

/** The most recent history request. */
const lastUrl = () => requested[requested.length - 1] ?? '';

beforeEach(() => {
  requested = [];
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

/* ================================================================== */
/* Tabs are queries                                                    */
/* ================================================================== */
describe('every tab is a saved query on the existing endpoint', () => {
  it('opens on today, filtered by check-in date', async () => {
    mountInbox(ADMIN_USER);
    await waitFor(() => expect(requested.length).toBeGreaterThan(0));
    expect(lastUrl()).toContain('/bookings/history');
    expect(lastUrl()).toMatch(/checkInFrom=\d{4}-\d{2}-\d{2}/);
    expect(lastUrl()).toMatch(/checkInTo=\d{4}-\d{2}-\d{2}/);
  });

  it('asks for both OTA sources on the OTA tab — the multi-value case', async () => {
    mountInbox(ADMIN_USER);
    await screen.findByTestId('inbox-tab-ota');
    await userEvent.click(screen.getByTestId('inbox-tab-ota'));
    await waitFor(() => expect(decodeURIComponent(lastUrl())).toContain('source=AGODA,CTRIP'));
  });

  it('asks for one source on a single-platform tab', async () => {
    mountInbox(ADMIN_USER);
    await userEvent.click(await screen.findByTestId('inbox-tab-agoda'));
    await waitFor(() => expect(decodeURIComponent(lastUrl())).toContain('source=AGODA'));
    expect(decodeURIComponent(lastUrl())).not.toContain('CTRIP');
  });

  it('maps each operational tab to its status', async () => {
    mountInbox(ADMIN_USER);
    for (const [tab, status] of [
      ['received', 'RECEIVED'],
      ['checked-in', 'CHECKED_IN'],
      ['checked-out', 'CHECKED_OUT'],
      ['cancelled', 'CANCELLED'],
      ['no-show', 'NO_SHOW'],
    ] as const) {
      await userEvent.click(await screen.findByTestId(`inbox-tab-${tab}`));
      await waitFor(() => expect(decodeURIComponent(lastUrl())).toContain(`status=${status}`));
    }
  });

  it('maps the verification tabs to verificationStatus, not status', async () => {
    mountInbox(ADMIN_USER);
    await userEvent.click(await screen.findByTestId('inbox-tab-pending-review'));
    await waitFor(() =>
      expect(decodeURIComponent(lastUrl())).toContain('verificationStatus=PENDING_REVIEW'),
    );
  });

  it('never calls an endpoint other than the shared history search', async () => {
    mountInbox(ADMIN_USER);
    await userEvent.click(await screen.findByTestId('inbox-tab-last-minute'));
    await waitFor(() => expect(requested.length).toBeGreaterThan(1));
    for (const url of requested) expect(url).toContain('/bookings/history');
  });
});

/* ================================================================== */
/* Accessibility and state                                             */
/* ================================================================== */
describe('the tab strip', () => {
  it('exposes tabs with a selected state', async () => {
    mountInbox(ADMIN_USER);
    const tab = await screen.findByTestId('inbox-tab-today');
    expect(tab).toHaveAttribute('role', 'tab');
    expect(tab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('inbox-tab-ota')).toHaveAttribute('aria-selected', 'false');
  });

  it('remembers the chosen tab across a remount', async () => {
    mountInbox(ADMIN_USER);
    await userEvent.click(await screen.findByTestId('inbox-tab-ctrip'));
    await waitFor(() => expect(decodeURIComponent(lastUrl())).toContain('source=CTRIP'));

    // A fresh mount, as if the operator opened a booking and came back.
    requested = [];
    mountInbox(ADMIN_USER);
    await waitFor(() => expect(requested.length).toBeGreaterThan(0));
    expect(decodeURIComponent(lastUrl())).toContain('source=CTRIP');
  });

  it('falls back to the first tab when the remembered one no longer exists', async () => {
    // A tab id from an older build must not leave the operator with a blank page.
    window.localStorage.setItem('kas.inbox.tab', JSON.stringify('a-tab-that-was-removed'));
    mountInbox(ADMIN_USER);
    expect(await screen.findByTestId('inbox-tab-today')).toHaveAttribute('aria-selected', 'true');
  });
});

/* ================================================================== */
/* Permissions and empty states                                        */
/* ================================================================== */
describe('roles and empty results', () => {
  it('gives an admin the branch selector', async () => {
    mountInbox(ADMIN_USER);
    expect(await screen.findByLabelText('Chi nhánh')).toBeInTheDocument();
  });

  it('gives a receptionist none — their branch is fixed by the server', async () => {
    mountInbox(RECEPTIONIST_USER);
    await waitFor(() => expect(requested.length).toBeGreaterThan(0));
    expect(screen.queryByLabelText('Chi nhánh')).toBeNull();
  });

  it('offers a retry when the list fails to load', async () => {
    // Without one, reception reaches for the browser reload, which costs them
    // their tab, their filters and their place in the list.
    //
    // The mock fails until the test says otherwise rather than counting
    // attempts: the app may legitimately fetch more than once before the
    // assertion, and a counter would make this pass or fail on that timing.
    let failing = true;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        const href = String(url);
        if (href.includes('/auth/me')) return jsonResponse(200, { user: ADMIN_USER });
        if (href.includes('/notifications')) return jsonResponse(200, { count: 0 });
        if (href.includes('/branches')) return jsonResponse(200, { branches: [] });
        if (failing) {
          return jsonResponse(500, { error: { code: 'SERVER_ERROR', message: 'Lỗi máy chủ.' } });
        }
        return jsonResponse(200, {
          bookings: [ROW],
          pagination: { page: 1, pageSize: 25, total: 1, totalPages: 1 },
        });
      }),
    );
    renderApp('/app/inbox');

    const retry = await screen.findByTestId('query-retry');
    expect(screen.queryAllByTestId('inbox-row')).toHaveLength(0);

    failing = false;
    await userEvent.click(retry);
    expect(await screen.findAllByTestId('inbox-row')).toHaveLength(1);
  });

  it('names the empty tab rather than showing a bare blank', async () => {
    mountInbox(ADMIN_USER, []);
    expect(await screen.findByText(/Không có đơn nào trong nhóm/)).toBeInTheDocument();
  });

  it('shows the operational status of each row', async () => {
    mountInbox(ADMIN_USER);
    // "Đã nhận đơn" is a Phase 5 status the client could not previously label.
    expect(await screen.findAllByText('Đã nhận đơn')).not.toHaveLength(0);
  });
});

/* ================================================================== */
/* Responsive rendering                                                */
/* ================================================================== */
describe('narrow and wide layouts', () => {
  /*
    jsdom does not evaluate media queries, so these check the STRUCTURE that
    the breakpoints switch between rather than which one is visible at a given
    width. That is the part that can actually regress: if the stacked list or
    the table were dropped, one class of device would lose the page entirely.
  */
  it('renders both a stacked list and a table, each hidden at the other breakpoint', async () => {
    mountInbox(ADMIN_USER);
    await screen.findAllByTestId('inbox-row');

    const stacked = document.body.querySelector('ul.md\\:hidden');
    const table = document.body.querySelector('div.hidden.md\\:block table');
    expect(stacked).not.toBeNull();
    expect(table).not.toBeNull();
  });

  it('gives the table a caption naming the current tab', async () => {
    mountInbox(ADMIN_USER);
    // The visible tab strip conveys this to sighted users; the caption is how
    // a screen reader knows which subset the table holds.
    expect(await screen.findByText('Danh sách đơn: Hôm nay')).toBeInTheDocument();
  });

  it('keeps every tab reachable when they overflow the width', async () => {
    mountInbox(ADMIN_USER);
    const strip = await screen.findByRole('tablist');
    // Sixteen tabs cannot fit a phone; they scroll rather than wrap into a
    // block that pushes the list off screen.
    expect(strip.className).toContain('overflow-x-auto');
    expect(screen.getAllByRole('tab')).toHaveLength(16);
  });
});

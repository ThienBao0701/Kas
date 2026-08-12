/**
 * The Admin UI revision, as an Admin experiences it.
 *
 * These cover the four screen changes: the dashboard's date selector, the
 * renamed/extended source list on Nhập đơn, the stripped-down History filters,
 * and the all-branches recipient on Nhắc nhở.
 *
 * The point of most of them is what is ABSENT — a removed sorting control, a
 * removed filter group. Those are asserted by querying for the thing and
 * expecting nothing, which only means something because the same file asserts
 * the controls that remain are still present and still work.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ADMIN_USER, installApiMock, renderApp } from '../test/utils';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  // These pages persist filters; a leaked selection would change the next case.
  localStorage.clear();
});

type Handler = (init: RequestInit) => { status: number; body?: unknown };

const BRANCH = { id: 1, code: 'TRUONG_DINH_05', hotelName: 'Saigon Hotel', address: '05 Trương Định' };

function summaryBody(over: Record<string, unknown> = {}) {
  return {
    date: '2026-08-11',
    totals: { waiting: 3, confirmedToday: 2, lastMinute: 1, sentToday: 5 },
    branches: [{ branch: BRANCH, waiting: 3, confirmedToday: 2, lastMinute: 1 }],
    issues: { reported: 4, stillOpen: 2 },
    ...over,
  };
}

function mount(routes: Record<string, Handler> = {}) {
  return installApiMock({
    'GET /api/auth/me': () => ({ status: 200, body: { user: ADMIN_USER } }),
    'GET /api/notifications/unread-count': () => ({ status: 200, body: { count: 0 } }),
    'GET /api/nav-badges': () => ({
      status: 200,
      body: {
        counts: { new: 0, pendingReview: 0, rejected: 0, resendOrders: 0, chat: 0, reminders: 0 },
        serverNow: '2026-08-11T05:00:00.000Z',
      },
    }),
    'GET /api/issues/summary': () => ({
      status: 200,
      body: { summary: { totalUnresolved: 0, newCount: 0, inProgressCount: 0, byBranch: [] } },
    }),
    'GET /api/branches': () => ({ status: 200, body: { branches: [BRANCH] } }),
    ...routes,
  });
}

/* ================================================================== */
/* Dashboard — single-date overview                                    */
/* ================================================================== */

describe('dashboard date selector', () => {
  it('defaults to today and asks the server for it', async () => {
    const today = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const fetchMock = mount({
      [`GET /api/admin/dashboard/summary?date=${today}`]: () => ({
        status: 200,
        body: summaryBody({ date: today }),
      }),
    });
    renderApp('/app/dashboard');

    const picker = await screen.findByTestId('dashboard-date');
    expect(picker).toHaveValue(today);

    await waitFor(() => {
      const asked = fetchMock.mock.calls.some(([u]) => String(u).includes(`date=${today}`));
      expect(asked).toBe(true);
    });
  });

  it('sends the CHOSEN date to the server, not a client-side filter', async () => {
    const today = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const fetchMock = mount({
      [`GET /api/admin/dashboard/summary?date=${today}`]: () => ({
        status: 200,
        body: summaryBody({ date: today, totals: { waiting: 3, confirmedToday: 2, lastMinute: 1, sentToday: 5 } }),
      }),
      'GET /api/admin/dashboard/summary?date=2026-08-09': () => ({
        status: 200,
        body: summaryBody({
          date: '2026-08-09',
          totals: { waiting: 9, confirmedToday: 8, lastMinute: 7, sentToday: 6 },
          issues: { reported: 1, stillOpen: 0 },
        }),
      }),
    });
    renderApp('/app/dashboard');

    const picker = await screen.findByTestId('dashboard-date');
    // fireEvent, not userEvent.type: a native date input takes a whole value,
    // and typing it character by character produces intermediate invalid states.
    fireEvent.change(picker, { target: { value: '2026-08-09' } });

    // The request carries the date…
    await waitFor(() => {
      const asked = fetchMock.mock.calls.some(([u]) => String(u).includes('date=2026-08-09'));
      expect(asked).toBe(true);
    });
    // …and the page shows THAT day's numbers, which appear nowhere in the
    // first payload — so they cannot have come from re-filtering it.
    expect(await screen.findByText('9')).toBeInTheDocument();
    expect(await screen.findByText('8')).toBeInTheDocument();
    expect(await screen.findByText('6')).toBeInTheDocument();
  });

  it('shows the day\'s issue count', async () => {
    const today = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
    mount({
      [`GET /api/admin/dashboard/summary?date=${today}`]: () => ({
        status: 200,
        body: summaryBody({ date: today, issues: { reported: 4, stillOpen: 2 } }),
      }),
    });
    renderApp('/app/dashboard');

    expect(await screen.findByText('Sự cố trong ngày')).toBeInTheDocument();
    expect(screen.getByText('2 chưa xử lý')).toBeInTheDocument();
  });
});

/* ================================================================== */
/* Nhập đơn — sources                                                  */
/* ================================================================== */

describe('order input sources', () => {
  it('lists all five sources, with Booking.com renamed to Booking', async () => {
    mount();
    renderApp('/app/dispatch');

    const tabs = await screen.findByRole('tablist', { name: 'Nguồn đặt phòng' });
    const names = within(tabs)
      .getAllByRole('tab')
      .map((t) => t.textContent?.trim());
    expect(names).toEqual(['Booking', 'Agoda', 'CTrip', 'Tripadvisor', 'G2J']);
    // The old label is gone entirely.
    expect(within(tabs).queryByText('Booking.com')).not.toBeInTheDocument();
  });

  it('keeps the working sources working — Booking, Agoda and CTrip all offer the paste box', async () => {
    mount();
    renderApp('/app/dispatch');

    const tabs = await screen.findByRole('tablist', { name: 'Nguồn đặt phòng' });
    for (const name of ['Booking', 'Agoda', 'CTrip']) {
      await userEvent.click(within(tabs).getByRole('tab', { name }));
      expect(screen.getByRole('button', { name: /Trích xuất thông tin/ })).toBeInTheDocument();
      expect(screen.queryByTestId('source-coming-soon')).not.toBeInTheDocument();
    }
  });

  it('shows the coming-soon notice for Tripadvisor, and no way to submit', async () => {
    mount();
    renderApp('/app/dispatch');

    const tabs = await screen.findByRole('tablist', { name: 'Nguồn đặt phòng' });
    await userEvent.click(within(tabs).getByRole('tab', { name: 'Tripadvisor' }));

    expect(screen.getByTestId('source-coming-soon')).toHaveTextContent(
      'Ứng dụng sẽ phát triển phần này sớm nhất',
    );
    expect(screen.queryByRole('button', { name: /Trích xuất thông tin/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('shows the coming-soon notice for G2J, and no way to submit', async () => {
    mount();
    renderApp('/app/dispatch');

    const tabs = await screen.findByRole('tablist', { name: 'Nguồn đặt phòng' });
    await userEvent.click(within(tabs).getByRole('tab', { name: 'G2J' }));

    expect(screen.getByTestId('source-coming-soon')).toHaveTextContent(
      'Ứng dụng sẽ phát triển phần này sớm nhất',
    );
    expect(screen.queryByRole('button', { name: /Trích xuất thông tin/ })).not.toBeInTheDocument();
  });

  it('never calls an extractor for a placeholder source', async () => {
    const fetchMock = mount();
    renderApp('/app/dispatch');

    const tabs = await screen.findByRole('tablist', { name: 'Nguồn đặt phòng' });
    await userEvent.click(within(tabs).getByRole('tab', { name: 'G2J' }));

    const extracted = fetchMock.mock.calls.some(([u]) => String(u).includes('/extract'));
    expect(extracted).toBe(false);
  });
});

/* ================================================================== */
/* History — filters                                                   */
/* ================================================================== */

function historyMount() {
  return mount({
    'GET /api/bookings/history?page=1&pageSize=20': () => ({
      status: 200,
      body: { bookings: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } },
    }),
  });
}

describe('history filters', () => {
  it('offers no sorting controls', async () => {
    historyMount();
    renderApp('/app/history');

    await screen.findByTestId('filter-status');
    expect(screen.queryByLabelText('Sắp xếp')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Thứ tự')).not.toBeInTheDocument();
    expect(screen.queryByText('Cập nhật gần nhất')).not.toBeInTheDocument();
    expect(screen.queryByText('Giảm dần')).not.toBeInTheDocument();
    expect(screen.queryByText('Tăng dần')).not.toBeInTheDocument();
  });

  it('offers exactly the four stay outcomes as statuses', async () => {
    historyMount();
    renderApp('/app/history');

    const group = await screen.findByTestId('filter-status');
    // MultiSelect renders each option as a toggle button, not a checkbox.
    const labels = within(group)
      .getAllByRole('button')
      .map((b) => b.textContent?.trim());
    expect(labels).toEqual([
      'Khách đã nhận phòng',
      'Khách đã trả phòng',
      'Đã huỷ',
      'Khách không đến',
    ]);
  });

  it('offers no source filter and no verification filter', async () => {
    historyMount();
    renderApp('/app/history');

    await screen.findByTestId('filter-status');
    expect(screen.queryByTestId('filter-source')).not.toBeInTheDocument();
    expect(screen.queryByTestId('filter-verification')).not.toBeInTheDocument();
  });

  it('offers exactly one date range, Từ ngày / Đến ngày', async () => {
    historyMount();
    renderApp('/app/history');

    await screen.findByTestId('filter-status');
    expect(screen.getByLabelText('Từ ngày')).toBeInTheDocument();
    expect(screen.getByLabelText('Đến ngày')).toBeInTheDocument();
    for (const gone of ['Gửi từ', 'Gửi đến', 'Nhận phòng từ', 'Nhận phòng đến', 'Trả phòng từ', 'Trả phòng đến', 'Xác nhận từ', 'Xác nhận đến']) {
      expect(screen.queryByLabelText(gone)).not.toBeInTheDocument();
    }
  });

  it('still filters — the range reaches the API', async () => {
    const fetchMock = historyMount();
    renderApp('/app/history');

    const from = await screen.findByLabelText('Từ ngày');
    await userEvent.type(from, '2026-08-01');

    await waitFor(() => {
      const asked = fetchMock.mock.calls.some(([u]) => String(u).includes('sentFrom=2026-08-01'));
      expect(asked).toBe(true);
    });
  });

  it('sends no sort or order, leaving the API default in place', async () => {
    const fetchMock = historyMount();
    renderApp('/app/history');

    await screen.findByTestId('filter-status');
    const historyCalls = fetchMock.mock.calls.filter(([u]) => String(u).includes('/bookings/history'));
    expect(historyCalls.length).toBeGreaterThan(0);
    for (const [u] of historyCalls) {
      expect(String(u)).not.toContain('sort=');
      expect(String(u)).not.toContain('order=');
    }
  });
});

/* ================================================================== */
/* Reminders — all branches                                            */
/* ================================================================== */

function reminderMount(extra: Record<string, Handler> = {}) {
  return mount({
    'GET /api/reminders': () => ({ status: 200, body: { reminders: [] } }),
    'GET /api/admin/users': () => ({
      status: 200,
      body: {
        users: [
          { id: 2, username: 'letana', fullName: 'Lễ tân Một', role: 'RECEPTIONIST', active: true, branch: BRANCH },
          { id: 3, username: 'letanb', fullName: 'Lễ tân Hai', role: 'RECEPTIONIST', active: true, branch: BRANCH },
        ],
      },
    }),
    ...extra,
  });
}

describe('reminders recipient', () => {
  it('offers "Tất cả chi nhánh" alongside each receptionist', async () => {
    reminderMount();
    renderApp('/app/reminders');

    const select = await screen.findByLabelText('Người nhận');
    // The receptionist list arrives from its own query, so wait for it rather
    // than reading the select the moment it mounts.
    await waitFor(() =>
      expect(within(select).getByRole('option', { name: 'Lễ tân Một (letana)' })).toBeInTheDocument(),
    );
    const options = within(select).getAllByRole('option').map((o) => o.textContent?.trim());
    expect(options).toContain('Tất cả chi nhánh');
    expect(options).toContain('Lễ tân Hai (letanb)');
  });

  it('sends ONE broadcast request when all branches is chosen', async () => {
    const fetchMock = reminderMount({
      'POST /api/reminders': () => ({ status: 201, body: { recipients: 2 } }),
    });
    renderApp('/app/reminders');

    await userEvent.selectOptions(await screen.findByLabelText('Người nhận'), 'ALL_BRANCHES');
    await userEvent.type(screen.getByTestId('reminder-body'), 'Nhắc cả nhà');
    await userEvent.click(screen.getByTestId('reminder-send'));

    await waitFor(() => {
      const posts = fetchMock.mock.calls.filter(
        ([u, init]) =>
          String(u) === '/api/reminders' && (init as RequestInit | undefined)?.method === 'POST',
      );
      // Exactly one request — not one per receptionist.
      expect(posts).toHaveLength(1);
      expect(String((posts[0] as unknown as [string, RequestInit])[1].body)).toContain('ALL_BRANCHES');
    });
  });

  it('still sends to ONE receptionist by id', async () => {
    const fetchMock = reminderMount({
      'POST /api/reminders': () => ({
        status: 201,
        body: { reminder: { id: 'r1', body: 'Riêng A', createdAt: '', readAt: null, recipient: null, sender: null } },
      }),
    });
    renderApp('/app/reminders');

    const select = await screen.findByLabelText('Người nhận');
    await waitFor(() =>
      expect(within(select).getByRole('option', { name: 'Lễ tân Hai (letanb)' })).toBeInTheDocument(),
    );
    await userEvent.selectOptions(select, '3');
    await userEvent.type(screen.getByTestId('reminder-body'), 'Riêng A');
    await userEvent.click(screen.getByTestId('reminder-send'));

    await waitFor(() => {
      const posts = fetchMock.mock.calls.filter(
        ([u, init]) =>
          String(u) === '/api/reminders' && (init as RequestInit | undefined)?.method === 'POST',
      );
      expect(posts).toHaveLength(1);
      const sent = String((posts[0] as unknown as [string, RequestInit])[1].body);
      expect(sent).toContain('"recipientUserId":3');
      expect(sent).not.toContain('ALL_BRANCHES');
    });
  });
});

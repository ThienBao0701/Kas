/**
 * The search experience on the history page.
 *
 * The behaviour under test is what the page ASKS THE SERVER FOR.
 *
 * The Admin revision narrowed this screen to the four stay outcomes and a single
 * dispatch-date range, and removed the sorting controls. The API still accepts
 * every parameter it ever did — these cases pin what the UI now sends, including
 * what it deliberately no longer sends.
 *
 * The debounce is tested by counting requests, not by timing them. "One request
 * per pause instead of one per keystroke" is the property that matters and it
 * is observable; wall-clock speed in jsdom is not.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ADMIN_USER, jsonResponse, renderApp } from '../test/utils';

let requested: string[] = [];

function mountHistory(bookings: unknown[] = []) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL) => {
      const href = String(url);
      if (href.includes('/bookings/history')) {
        requested.push(decodeURIComponent(href));
        return jsonResponse(200, {
          bookings,
          pagination: { page: 1, pageSize: 20, total: bookings.length, totalPages: 1 },
        });
      }
      if (href.includes('/auth/me')) return jsonResponse(200, { user: ADMIN_USER });
      if (href.includes('/notifications')) return jsonResponse(200, { count: 0 });
      if (href.includes('/branches')) {
        return jsonResponse(200, {
          branches: [{ id: 1, code: 'TRUONG_DINH_05', hotelName: 'Saigon Hotel', address: '05 Trương Định' }],
        });
      }
      return jsonResponse(404, { error: { code: 'NOT_FOUND', message: href } });
    }),
  );
  renderApp('/app/history');
}

const lastUrl = () => requested[requested.length - 1] ?? '';

/** The saved-filter shape this page writes, for the restore cases below. */
const EMPTY_SAVED = {
  search: '',
  status: [] as string[],
  paymentStatus: '',
  isLastMinute: false,
  sentFrom: '',
  sentTo: '',
  branchId: '',
};

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
/* Debounce                                                            */
/* ================================================================== */
describe('the search box settles before it queries', () => {
  it('sends one request for a burst of typing, not one per character', async () => {
    mountHistory();
    const box = await screen.findByLabelText('Tìm kiếm');
    requested = [];

    await userEvent.type(box, 'nguyen');
    // Every keystroke re-renders, but only the settled value reaches the query.
    await waitFor(() => expect(lastUrl()).toContain('search=nguyen'));

    const searches = requested.filter((u) => u.includes('search='));
    expect(searches.length).toBeLessThan(6);
    expect(searches[searches.length - 1]).toContain('search=nguyen');
  });

  it('never sends an intermediate prefix as the final query', async () => {
    mountHistory();
    await userEvent.type(await screen.findByLabelText('Tìm kiếm'), 'abc');
    await waitFor(() => expect(lastUrl()).toContain('search=abc'));
  });
});

/* ================================================================== */
/* Multi-select                                                        */
/* ================================================================== */
describe('multi-select filters', () => {
  it('sends one status as a single value', async () => {
    mountHistory();
    await userEvent.click(await screen.findByTestId('filter-status-CHECKED_IN'));
    await waitFor(() => expect(lastUrl()).toContain('status=CHECKED_IN'));
  });

  it('sends several statuses comma-separated', async () => {
    mountHistory();
    await userEvent.click(await screen.findByTestId('filter-status-CHECKED_IN'));
    await userEvent.click(screen.getByTestId('filter-status-CHECKED_OUT'));
    await waitFor(() => expect(lastUrl()).toContain('status=CHECKED_IN,CHECKED_OUT'));
  });

  it('offers only the four stay outcomes', async () => {
    // The dispatch-stage statuses have their own screens; History is about how
    // a stay ended. The API still accepts all of them — this page stops offering
    // the ones it is not about.
    mountHistory();
    await screen.findByTestId('filter-status-CHECKED_IN');
    for (const gone of ['NEW', 'RECEIVED', 'COMPLETED', 'ARCHIVED']) {
      expect(screen.queryByTestId(`filter-status-${gone}`)).toBeNull();
    }
  });

  it('deselects on a second click', async () => {
    mountHistory();
    const checkedIn = await screen.findByTestId('filter-status-CHECKED_IN');
    await userEvent.click(checkedIn);
    await waitFor(() => expect(lastUrl()).toContain('status=CHECKED_IN'));

    await userEvent.click(checkedIn);
    // Back to the unfiltered query, which is already cached — so the assertion
    // is on the state, not on a fresh request that correctly never happens.
    await waitFor(() => expect(checkedIn).toHaveAttribute('aria-pressed', 'false'));
    expect(screen.queryByTestId('filter-chip')).toBeNull();
  });

  it('announces its pressed state to assistive tech', async () => {
    mountHistory();
    const button = await screen.findByTestId('filter-status-CANCELLED');
    expect(button).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(button);
    await waitFor(() => expect(button).toHaveAttribute('aria-pressed', 'true'));
  });
});

/* ================================================================== */
/* Sorting and the wider query                                         */
/* ================================================================== */
describe('the rest of the query', () => {
  it('never sends a sort key or order, leaving the API default in force', async () => {
    // The sorting controls are gone from this screen. The list is still newest
    // dispatch first, because that is what the API does when asked for nothing.
    mountHistory();
    await screen.findByTestId('filter-status-CHECKED_IN');
    await waitFor(() => expect(requested.length).toBeGreaterThan(0));
    for (const url of requested) {
      expect(url).not.toContain('sort=');
      expect(url).not.toContain('order=');
    }
  });

  it('sends the single date range on the dispatch date', async () => {
    mountHistory();
    await userEvent.type(await screen.findByLabelText('Từ ngày'), '2026-08-10');
    await waitFor(() => expect(lastUrl()).toContain('sentFrom=2026-08-10'));

    await userEvent.type(screen.getByLabelText('Đến ngày'), '2026-08-12');
    await waitFor(() => expect(lastUrl()).toContain('sentTo=2026-08-12'));
  });

  it('offers no other date axis', async () => {
    mountHistory();
    await screen.findByLabelText('Từ ngày');
    expect(screen.queryByText('Lọc theo ngày')).toBeNull();
    for (const gone of ['Nhận phòng từ', 'Trả phòng từ', 'Xác nhận từ', 'Gửi từ']) {
      expect(screen.queryByLabelText(gone)).toBeNull();
    }
  });
});

/* ================================================================== */
/* Chips                                                               */
/* ================================================================== */
describe('active filter chips', () => {
  it('shows nothing when no filter is set', async () => {
    mountHistory();
    await screen.findByLabelText('Tìm kiếm');
    expect(screen.queryByTestId('filter-chips')).toBeNull();
  });

  it('shows one chip per active filter', async () => {
    mountHistory();
    await userEvent.click(await screen.findByTestId('filter-status-CHECKED_IN'));
    await userEvent.click(screen.getByTestId('filter-status-CANCELLED'));
    await waitFor(() => expect(screen.getAllByTestId('filter-chip')).toHaveLength(2));
  });

  it('removes just that filter when its chip is dismissed', async () => {
    mountHistory();
    await userEvent.click(await screen.findByTestId('filter-status-CHECKED_IN'));
    await userEvent.click(screen.getByTestId('filter-status-CANCELLED'));
    await waitFor(() => expect(screen.getAllByTestId('filter-chip')).toHaveLength(2));

    await userEvent.click(screen.getByLabelText('Bỏ lọc Trạng thái: Đã huỷ'));
    await waitFor(() => expect(screen.getAllByTestId('filter-chip')).toHaveLength(1));

    // Asserted on state, not on the next URL: the single-status query was
    // already fetched a moment ago, so react-query serves it from cache and
    // correctly issues no new request to inspect.
    expect(screen.getByTestId('filter-chip')).toHaveTextContent('Khách đã nhận phòng');
    expect(screen.getByTestId('filter-status-CHECKED_IN')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('filter-status-CANCELLED')).toHaveAttribute('aria-pressed', 'false');
  });

  it('gives the date range its own chips', async () => {
    mountHistory();
    await userEvent.type(await screen.findByLabelText('Từ ngày'), '2026-08-10');
    await waitFor(() => expect(screen.getAllByTestId('filter-chip')).toHaveLength(1));
    expect(screen.getByText('Từ ngày: 2026-08-10')).toBeInTheDocument();
  });

  it('clears everything at once', async () => {
    mountHistory();
    await userEvent.click(await screen.findByTestId('filter-status-CHECKED_IN'));
    await userEvent.click(screen.getByTestId('filter-status-CANCELLED'));
    await waitFor(() => expect(screen.getAllByTestId('filter-chip')).toHaveLength(2));

    await userEvent.click(screen.getByTestId('filter-clear-all'));
    await waitFor(() => expect(screen.queryByTestId('filter-chips')).toBeNull());
    // Every toggle is released; the unfiltered result comes from cache.
    expect(screen.getByTestId('filter-status-CHECKED_IN')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('filter-status-CANCELLED')).toHaveAttribute('aria-pressed', 'false');
  });
});

/* ================================================================== */
/* Saved state                                                         */
/* ================================================================== */
describe('saved filter state', () => {
  it('restores the filters on a later visit', async () => {
    mountHistory();
    await userEvent.click(await screen.findByTestId('filter-status-NO_SHOW'));
    await waitFor(() => expect(lastUrl()).toContain('status=NO_SHOW'));

    requested = [];
    mountHistory();
    await waitFor(() => expect(requested.length).toBeGreaterThan(0));
    expect(lastUrl()).toContain('status=NO_SHOW');
  });

  it('starts clean when the saved value is corrupt', async () => {
    // A half-written or outdated entry must not break the page.
    window.localStorage.setItem('kas.history.filters', '{not json');
    mountHistory();
    await waitFor(() => expect(requested.length).toBeGreaterThan(0));
    expect(lastUrl()).not.toContain('status=');
  });

  it('drops a saved status this screen no longer offers', async () => {
    /*
      These filters outlive the page. Someone who had filtered by "RECEIVED"
      before the list was narrowed would otherwise come back to a table silently
      filtered by a status with no visible control and no way to clear it.
    */
    window.localStorage.setItem(
      'kas.history.filters',
      JSON.stringify({ ...EMPTY_SAVED, status: ['RECEIVED', 'CHECKED_IN'] }),
    );
    mountHistory();
    await waitFor(() => expect(requested.length).toBeGreaterThan(0));
    expect(lastUrl()).toContain('status=CHECKED_IN');
    expect(lastUrl()).not.toContain('RECEIVED');
  });
});

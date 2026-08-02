/**
 * The search experience on the history page.
 *
 * The behaviour under test is what the page ASKS THE SERVER FOR, because that
 * is where the 7a work was going unused: ten sort keys, six date ranges and
 * multi-valued filters that the old submit-button form never sent.
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
    await userEvent.click(await screen.findByTestId('filter-status-RECEIVED'));
    await waitFor(() => expect(lastUrl()).toContain('status=RECEIVED'));
  });

  it('sends several statuses comma-separated', async () => {
    mountHistory();
    await userEvent.click(await screen.findByTestId('filter-status-RECEIVED'));
    await userEvent.click(screen.getByTestId('filter-status-CHECKED_IN'));
    await waitFor(() => expect(lastUrl()).toContain('status=RECEIVED,CHECKED_IN'));
  });

  it('sends both OTA sources when both are picked', async () => {
    mountHistory();
    await userEvent.click(await screen.findByTestId('filter-source-AGODA'));
    await userEvent.click(screen.getByTestId('filter-source-CTRIP'));
    await waitFor(() => expect(lastUrl()).toContain('source=AGODA,CTRIP'));
  });

  it('deselects on a second click', async () => {
    mountHistory();
    const agoda = await screen.findByTestId('filter-source-AGODA');
    await userEvent.click(agoda);
    await waitFor(() => expect(lastUrl()).toContain('source=AGODA'));

    await userEvent.click(agoda);
    // Back to the unfiltered query, which is already cached — so the assertion
    // is on the state, not on a fresh request that correctly never happens.
    await waitFor(() => expect(agoda).toHaveAttribute('aria-pressed', 'false'));
    expect(screen.queryByTestId('filter-chip')).toBeNull();
  });

  it('announces its pressed state to assistive tech', async () => {
    mountHistory();
    const button = await screen.findByTestId('filter-source-AGODA');
    expect(button).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(button);
    await waitFor(() => expect(button).toHaveAttribute('aria-pressed', 'true'));
  });
});

/* ================================================================== */
/* Sorting and the wider query                                         */
/* ================================================================== */
describe('the rest of the 7a query', () => {
  it('sends the chosen sort key', async () => {
    mountHistory();
    await userEvent.selectOptions(await screen.findByLabelText('Sắp xếp'), 'totalAmount');
    await waitFor(() => expect(lastUrl()).toContain('sort=totalAmount'));
  });

  it('sends an ascending order only when asked', async () => {
    mountHistory();
    expect(lastUrl()).not.toContain('order=');
    await userEvent.selectOptions(await screen.findByLabelText('Thứ tự'), 'asc');
    await waitFor(() => expect(lastUrl()).toContain('order=asc'));
  });

  it('sends the check-out range the old form could not', async () => {
    mountHistory();
    await userEvent.click(await screen.findByText('Lọc theo ngày'));
    const field = screen.getByLabelText('Trả phòng từ');
    await userEvent.type(field, '2026-08-10');
    await waitFor(() => expect(lastUrl()).toContain('checkOutFrom=2026-08-10'));
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
    await userEvent.click(await screen.findByTestId('filter-source-AGODA'));
    await userEvent.click(screen.getByTestId('filter-status-RECEIVED'));
    await waitFor(() => expect(screen.getAllByTestId('filter-chip')).toHaveLength(2));
  });

  it('removes just that filter when its chip is dismissed', async () => {
    mountHistory();
    await userEvent.click(await screen.findByTestId('filter-source-AGODA'));
    await userEvent.click(screen.getByTestId('filter-status-RECEIVED'));
    await waitFor(() => expect(screen.getAllByTestId('filter-chip')).toHaveLength(2));

    await userEvent.click(screen.getByLabelText('Bỏ lọc Nguồn: Agoda'));
    await waitFor(() => expect(screen.getAllByTestId('filter-chip')).toHaveLength(1));
    expect(lastUrl()).toContain('status=RECEIVED');
    expect(lastUrl()).not.toContain('source=');
  });

  it('clears everything at once', async () => {
    mountHistory();
    await userEvent.click(await screen.findByTestId('filter-source-AGODA'));
    await userEvent.click(screen.getByTestId('filter-status-RECEIVED'));
    await waitFor(() => expect(screen.getAllByTestId('filter-chip')).toHaveLength(2));

    await userEvent.click(screen.getByTestId('filter-clear-all'));
    await waitFor(() => expect(screen.queryByTestId('filter-chips')).toBeNull());
    // Every toggle is released; the unfiltered result comes from cache.
    expect(screen.getByTestId('filter-source-AGODA')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('filter-status-RECEIVED')).toHaveAttribute('aria-pressed', 'false');
  });
});

/* ================================================================== */
/* Saved state                                                         */
/* ================================================================== */
describe('saved filter state', () => {
  it('restores the filters on a later visit', async () => {
    mountHistory();
    await userEvent.click(await screen.findByTestId('filter-source-CTRIP'));
    await waitFor(() => expect(lastUrl()).toContain('source=CTRIP'));

    requested = [];
    mountHistory();
    await waitFor(() => expect(requested.length).toBeGreaterThan(0));
    expect(lastUrl()).toContain('source=CTRIP');
  });

  it('starts clean when the saved value is corrupt', async () => {
    // A half-written or outdated entry must not break the page.
    window.localStorage.setItem('kas.history.filters', '{not json');
    mountHistory();
    await waitFor(() => expect(requested.length).toBeGreaterThan(0));
    expect(lastUrl()).not.toContain('source=');
  });
});

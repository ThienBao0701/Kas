import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { ADMIN_USER, RECEPTIONIST_USER, installApiMock, renderApp } from '../test/utils';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const EMPTY_HISTORY = {
  status: 200,
  body: { bookings: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 } },
};

function mockHistory(user: unknown) {
  installApiMock({
    'GET /api/auth/me': () => ({ status: 200, body: { user } }),
    'GET /api/notifications/unread-count': () => ({ status: 200, body: { count: 0 } }),
    'GET /api/branches': () => ({ status: 200, body: { branches: [{ id: 1, code: 'A', hotelName: 'H', address: '05 Trương Định' }] } }),
    'GET /api/bookings/history?page=1&pageSize=20': () => EMPTY_HISTORY,
  });
}

describe('HistoryPage — branch filter is admin-only', () => {
  it('gives the receptionist no branch selector in the filters', async () => {
    mockHistory(RECEPTIONIST_USER);
    renderApp('/app/history');

    // Scope to the filter form: the sidebar also shows a "Chi nhánh" panel.
    const form = await screen.findByRole('form', { name: 'Bộ lọc lịch sử' });
    expect(within(form).queryByText('Chi nhánh')).not.toBeInTheDocument();
    // Status and payment filters are still available to the receptionist.
    expect(within(form).getByText('Trạng thái')).toBeInTheDocument();
  });

  it('gives the admin a branch selector', async () => {
    mockHistory(ADMIN_USER);
    renderApp('/app/history');

    // Wait for the page, then the branch filter label is present.
    expect(await screen.findByText('Trạng thái')).toBeInTheDocument();
    expect(screen.getByText('Chi nhánh')).toBeInTheDocument();
  });
});

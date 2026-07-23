import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { ADMIN_USER, RECEPTIONIST_USER, installApiMock, renderApp } from '../test/utils';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const EMPTY_HISTORY = {
  status: 200,
  body: { bookings: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 } },
};

function mock(user: unknown) {
  installApiMock({
    'GET /api/auth/me': () => ({ status: 200, body: { user } }),
    'GET /api/notifications/unread-count': () => ({ status: 200, body: { count: 0 } }),
    'GET /api/branches': () => ({ status: 200, body: { branches: [] } }),
    'GET /api/bookings/history?page=1&pageSize=20': () => EMPTY_HISTORY,
  });
}

describe('HistoryPage — branch restriction UI', () => {
  it('shows a branch filter to the admin', async () => {
    mock(ADMIN_USER);
    renderApp('/app/history');
    expect(await screen.findByLabelText('Chi nhánh')).toBeInTheDocument();
  });

  it('does not show an editable branch filter to a receptionist', async () => {
    mock(RECEPTIONIST_USER);
    renderApp('/app/history');
    // The search field renders, but there is no branch selector for a receptionist.
    expect(await screen.findByPlaceholderText(/Mã đặt phòng/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Chi nhánh')).not.toBeInTheDocument();
  });
});

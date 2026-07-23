import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RECEPTIONIST_USER, installApiMock, renderApp } from '../test/utils';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('NotificationBell — content and states', () => {
  it('shows notification content and highlights the last-minute one', async () => {
    installApiMock({
      'GET /api/auth/me': () => ({ status: 200, body: { user: RECEPTIONIST_USER } }),
      'GET /api/notifications/unread-count': () => ({ status: 200, body: { count: 2 } }),
      'GET /api/bookings/new?pageSize=100': () => ({
        status: 200,
        body: { bookings: [], pagination: { page: 1, pageSize: 100, total: 0, totalPages: 1 } },
      }),
      'GET /api/notifications?page=1&pageSize=15': () => ({
        status: 200,
        body: {
          notifications: [
            { id: 'n1', bookingId: 'lm', title: 'ĐƠN LAST MINUTE', body: 'Khách A nhận phòng hôm nay. Vui lòng ưu tiên xử lý.', read: false, createdAt: '2026-07-21T09:59:00.000Z', readAt: null },
            { id: 'n2', bookingId: 'x', title: 'Có đơn mới', body: 'Khách B – nhận phòng 2026-07-25', read: true, createdAt: '2026-07-21T08:00:00.000Z', readAt: '2026-07-21T08:30:00.000Z' },
          ],
          unreadCount: 1,
          pagination: { page: 1, pageSize: 15, total: 2, totalPages: 1 },
        },
      }),
    });

    const user = userEvent.setup();
    renderApp('/app/new');

    await user.click(await screen.findByRole('button', { name: /Thông báo/ }));

    const lm = await screen.findByText('ĐƠN LAST MINUTE');
    expect(lm).toBeInTheDocument();
    expect(lm.className).toContain('text-red-700');
    expect(screen.getByText('Khách A nhận phòng hôm nay. Vui lòng ưu tiên xử lý.')).toBeInTheDocument();
    expect(screen.getByText('Có đơn mới')).toBeInTheDocument();

    // Mark-all-read control is available.
    expect(within(document.body).getByRole('button', { name: /Đọc tất cả/ })).toBeInTheDocument();
  });

  it('shows an error state with retry when notifications fail to load', async () => {
    installApiMock({
      'GET /api/auth/me': () => ({ status: 200, body: { user: RECEPTIONIST_USER } }),
      'GET /api/notifications/unread-count': () => ({ status: 200, body: { count: 0 } }),
      'GET /api/bookings/new?pageSize=100': () => ({
        status: 200,
        body: { bookings: [], pagination: { page: 1, pageSize: 100, total: 0, totalPages: 1 } },
      }),
      'GET /api/notifications?page=1&pageSize=15': () => ({
        status: 500,
        body: { error: { code: 'INTERNAL_ERROR', message: 'boom' } },
      }),
    });

    const user = userEvent.setup();
    renderApp('/app/new');

    await user.click(await screen.findByRole('button', { name: /Thông báo/ }));
    expect(await screen.findByText('Không thể tải thông báo.')).toBeInTheDocument();
  });
});

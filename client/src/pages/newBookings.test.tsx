import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { RECEPTIONIST_USER, installApiMock, renderApp } from '../test/utils';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function row(overrides: Record<string, unknown>) {
  return {
    id: 'x',
    bookingCode: '1000000001',
    customerName: 'Khách',
    phone: '0900000000',
    branch: { id: 1, code: 'TRUONG_DINH_05', hotelName: 'Saigon Hotel & Ben Thanh', address: '05 Trương Định' },
    checkInDate: '2026-08-01',
    checkOutDate: '2026-08-02',
    numberOfRooms: 1,
    totalAmount: 850_000,
    currency: 'VND',
    paymentStatus: 'PAY_AFTER',
    isLastMinute: false,
    sentAt: '2026-07-30T02:00:00.000Z',
    sentBy: { id: 1, fullName: 'Admin' },
    status: 'NEW',
    missingNightlyPriceCount: 0,
    warningCount: 0,
    ...overrides,
  };
}

describe('NewBookingsPage — receptionist inbox', () => {
  it('renders dispatched bookings and flags the last-minute one', async () => {
    installApiMock({
      'GET /api/auth/me': () => ({ status: 200, body: { user: RECEPTIONIST_USER } }),
      'GET /api/notifications/unread-count': () => ({ status: 200, body: { count: 0 } }),
      'GET /api/bookings/new?page=1&pageSize=20': () => ({
        status: 200,
        body: {
          bookings: [
            row({ id: 'lm', bookingCode: 'LASTMIN001', isLastMinute: true, checkInDate: '2026-07-30' }),
            row({ id: 'later', bookingCode: 'NORMAL0001' }),
          ],
          pagination: { page: 1, pageSize: 20, total: 2, totalPages: 1 },
        },
      }),
    });

    renderApp('/app/new');

    const table = await screen.findByRole('table');
    expect(within(table).getByText('LASTMIN001')).toBeInTheDocument();
    expect(within(table).getByText('NORMAL0001')).toBeInTheDocument();
    // The last-minute badge is present in the list.
    expect(within(table).getByText(/Last minute/i)).toBeInTheDocument();
  });
});

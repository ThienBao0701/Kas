import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RECEPTIONIST_USER, installApiMock, renderApp } from '../test/utils';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function listRow(overrides: Record<string, unknown> = {}) {
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

function detail(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    status: 'NEW',
    hotelName: 'Saigon Hotel & Ben Thanh',
    branch: { id: 1, code: 'TRUONG_DINH_05', hotelName: 'Saigon Hotel & Ben Thanh', address: '05 Trương Định' },
    branchId: 1,
    customerName: 'Khách',
    phone: '0900000000',
    bookingCode: id.toUpperCase(),
    checkInDate: '2026-08-01',
    checkOutDate: '2026-08-02',
    checkInTime: null,
    checkOutTime: null,
    totalAmount: 850_000,
    currency: 'VND',
    paymentStatus: 'PAY_AFTER',
    specialRequest: null,
    parserVersion: '4a',
    isLastMinute: false,
    rooms: [
      {
        id: `${id}-r1`,
        roomIndex: 1,
        roomType: 'Deluxe Double Room',
        roomSubtotal: 850_000,
        taxAmount: null,
        feeAmount: null,
        nights: [{ id: `${id}-n1`, stayDate: '2026-08-01', amount: 850_000, currency: 'VND', manuallyCorrected: false, isEstimated: false }],
      },
    ],
    warnings: [],
    statusHistory: [],
    createdBy: null,
    sentBy: { id: 1, fullName: 'Admin' },
    completedBy: null,
    createdAt: '2026-07-30T02:00:00.000Z',
    updatedAt: '2026-07-30T02:00:00.000Z',
    sentAt: '2026-07-30T02:00:00.000Z',
    completedAt: null,
    completionNote: null,
    ...overrides,
  };
}

describe('NewBookingsPage — receptionist master-detail inbox', () => {
  it('lists dispatched bookings and gives the last-minute one visual priority', async () => {
    installApiMock({
      'GET /api/auth/me': () => ({ status: 200, body: { user: RECEPTIONIST_USER } }),
      'GET /api/notifications/unread-count': () => ({ status: 200, body: { count: 0 } }),
      'GET /api/bookings/new?pageSize=100': () => ({
        status: 200,
        body: {
          bookings: [
            listRow({ id: 'lm', bookingCode: 'LASTMIN001', isLastMinute: true, checkInDate: '2026-07-30' }),
            listRow({ id: 'later', bookingCode: 'NORMAL0001' }),
          ],
          pagination: { page: 1, pageSize: 100, total: 2, totalPages: 1 },
        },
      }),
      'GET /api/bookings/lm': () => ({ status: 200, body: { booking: detail('lm', { isLastMinute: true, bookingCode: 'LASTMIN001' }) } }),
    });

    renderApp('/app/new');

    const list = await screen.findByRole('list', { name: 'Danh sách đơn mới' });
    expect(within(list).getByText('LASTMIN001')).toBeInTheDocument();
    expect(within(list).getByText('NORMAL0001')).toBeInTheDocument();
    // The last-minute row carries the priority badge and a red accent border.
    expect(within(list).getByText(/Last minute/i)).toBeInTheDocument();
    const lmRow = within(list).getByText('LASTMIN001').closest('button')!;
    expect(lmRow.className).toContain('border-l-red-500');
    // Auto-updates note is present.
    expect(screen.getByText(/Dữ liệu tự động cập nhật mỗi 20 giây/)).toBeInTheDocument();
  });

  it('renders all bookings vertically in the left list', async () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      listRow({ id: `bk${i}`, bookingCode: `CODE${i}` }),
    );
    installApiMock({
      'GET /api/auth/me': () => ({ status: 200, body: { user: RECEPTIONIST_USER } }),
      'GET /api/notifications/unread-count': () => ({ status: 200, body: { count: 0 } }),
      'GET /api/bookings/new?pageSize=100': () => ({
        status: 200,
        body: { bookings: rows, pagination: { page: 1, pageSize: 100, total: 10, totalPages: 1 } },
      }),
      'GET /api/bookings/bk0': () => ({ status: 200, body: { booking: detail('bk0', { bookingCode: 'CODE0' }) } }),
    });

    renderApp('/app/new');

    const list = await screen.findByRole('list', { name: 'Danh sách đơn mới' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(10);
  });

  it('advances to the next booking after the selected one is confirmed', async () => {
    let completed = false;
    installApiMock({
      'GET /api/auth/me': () => ({ status: 200, body: { user: RECEPTIONIST_USER } }),
      'GET /api/notifications/unread-count': () => ({ status: 200, body: { count: 0 } }),
      'GET /api/bookings/new?pageSize=100': () => ({
        status: 200,
        body: {
          bookings: completed
            ? [listRow({ id: 'b', bookingCode: 'BBB' })]
            : [listRow({ id: 'a', bookingCode: 'AAA' }), listRow({ id: 'b', bookingCode: 'BBB' })],
          pagination: { page: 1, pageSize: 100, total: completed ? 1 : 2, totalPages: 1 },
        },
      }),
      'GET /api/bookings/a': () => ({ status: 200, body: { booking: detail('a', { bookingCode: 'AAA' }) } }),
      'GET /api/bookings/b': () => ({ status: 200, body: { booking: detail('b', { bookingCode: 'BBB' }) } }),
      'POST /api/bookings/a/complete': () => {
        completed = true;
        return { status: 200, body: { booking: detail('a', { status: 'COMPLETED' }) } };
      },
    });

    const user = userEvent.setup();
    renderApp('/app/new');

    // Booking 'a' is auto-selected; confirm it.
    await user.click(await screen.findByRole('button', { name: 'Xác nhận đã tạo' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Xác nhận đã tạo' }));

    // 'a' is gone from the list and 'b' has become the selection.
    const list = await screen.findByRole('list', { name: 'Danh sách đơn mới' });
    await screen.findByText('Đã xác nhận đã tạo. Đơn đã được chuyển khỏi danh sách Đơn mới.');
    expect(within(list).queryByText('AAA')).not.toBeInTheDocument();
    const selected = within(list).getByText('BBB').closest('button')!;
    expect(selected.getAttribute('aria-current')).toBe('true');
  });

  it('keeps the selected booking after a manual refresh', async () => {
    installApiMock({
      'GET /api/auth/me': () => ({ status: 200, body: { user: RECEPTIONIST_USER } }),
      'GET /api/notifications/unread-count': () => ({ status: 200, body: { count: 0 } }),
      'GET /api/bookings/new?pageSize=100': () => ({
        status: 200,
        body: {
          bookings: [listRow({ id: 'a', bookingCode: 'AAA' }), listRow({ id: 'b', bookingCode: 'BBB' })],
          pagination: { page: 1, pageSize: 100, total: 2, totalPages: 1 },
        },
      }),
      'GET /api/bookings/a': () => ({ status: 200, body: { booking: detail('a', { bookingCode: 'AAA' }) } }),
      'GET /api/bookings/b': () => ({ status: 200, body: { booking: detail('b', { bookingCode: 'BBB' }) } }),
    });

    const user = userEvent.setup();
    renderApp('/app/new');

    const list = await screen.findByRole('list', { name: 'Danh sách đơn mới' });
    // Select the second booking.
    await user.click(within(list).getByText('BBB'));
    // Its detail (heading with booking code) is shown.
    expect(await screen.findByRole('heading', { name: 'Khách' })).toBeInTheDocument();
    const selectedBefore = within(list).getByText('BBB').closest('button')!;
    expect(selectedBefore.getAttribute('aria-current')).toBe('true');

    // Refresh; the selection must survive.
    await user.click(screen.getByRole('button', { name: 'Làm mới danh sách' }));
    const selectedAfter = (await within(list).findByText('BBB')).closest('button')!;
    expect(selectedAfter.getAttribute('aria-current')).toBe('true');
  });

  it('keeps the existing data and warns when a refresh fails', async () => {
    let calls = 0;
    installApiMock({
      'GET /api/auth/me': () => ({ status: 200, body: { user: RECEPTIONIST_USER } }),
      'GET /api/notifications/unread-count': () => ({ status: 200, body: { count: 0 } }),
      'GET /api/bookings/new?pageSize=100': () => {
        calls += 1;
        if (calls === 1) {
          return {
            status: 200,
            body: {
              bookings: [listRow({ id: 'a', bookingCode: 'AAA' })],
              pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
            },
          };
        }
        return { status: 500, body: { error: { code: 'INTERNAL_ERROR', message: 'boom' } } };
      },
      'GET /api/bookings/a': () => ({ status: 200, body: { booking: detail('a', { bookingCode: 'AAA' }) } }),
    });

    const user = userEvent.setup();
    renderApp('/app/new');

    const list = await screen.findByRole('list', { name: 'Danh sách đơn mới' });
    expect(within(list).getByText('AAA')).toBeInTheDocument();

    // Force a failing refresh.
    await user.click(screen.getByRole('button', { name: 'Làm mới danh sách' }));

    // The warning appears but the last good data is still on screen.
    expect(
      await screen.findByText('Không thể kết nối đến máy chủ. Dữ liệu đang hiển thị có thể chưa được cập nhật.'),
    ).toBeInTheDocument();
    expect(within(list).getByText('AAA')).toBeInTheDocument();
  });

  it('removes a booking from Đơn mới after it is confirmed created', async () => {
    let completed = false;
    installApiMock({
      'GET /api/auth/me': () => ({ status: 200, body: { user: RECEPTIONIST_USER } }),
      'GET /api/notifications/unread-count': () => ({ status: 200, body: { count: 0 } }),
      'GET /api/bookings/new?pageSize=100': () => ({
        status: 200,
        body: {
          bookings: completed ? [] : [listRow({ id: 'b1', bookingCode: 'B1CODE' })],
          pagination: { page: 1, pageSize: 100, total: completed ? 0 : 1, totalPages: 1 },
        },
      }),
      'GET /api/bookings/b1': () => ({
        status: 200,
        body: { booking: detail('b1', { bookingCode: 'B1CODE', status: completed ? 'COMPLETED' : 'NEW' }) },
      }),
      'POST /api/bookings/b1/complete': () => {
        completed = true;
        return { status: 200, body: { booking: detail('b1', { status: 'COMPLETED' }) } };
      },
    });

    const user = userEvent.setup();
    renderApp('/app/new');

    // Auto-selected booking b1 detail is shown; confirm it.
    await user.click(await screen.findByRole('button', { name: 'Xác nhận đã tạo' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Xác nhận đã tạo' }));

    // After the list refetch, the empty state replaces the removed booking.
    expect(await screen.findByText('Chưa có đơn mới')).toBeInTheDocument();
  });
});

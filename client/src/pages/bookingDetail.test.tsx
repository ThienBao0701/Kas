import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RECEPTIONIST_USER, installApiMock, renderApp } from '../test/utils';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const NEW_BOOKING = {
  id: 'b1',
  status: 'NEW',
  hotelName: 'Saigon Hotel & Ben Thanh',
  branch: { id: 1, code: 'TRUONG_DINH_05', hotelName: 'Saigon Hotel & Ben Thanh', address: '05 Trương Định' },
  branchId: 1,
  customerName: 'Nguyễn Văn A',
  phone: '0901234567',
  bookingCode: '489234523',
  checkInDate: '2026-07-19',
  checkOutDate: '2026-07-21',
  checkInTime: null,
  checkOutTime: null,
  totalAmount: 1_700_000,
  currency: 'VND',
  paymentStatus: 'PAY_AFTER',
  specialRequest: null,
  parserVersion: '4a.2.0',
  isLastMinute: false,
  rooms: [
    {
      id: 'r1',
      roomIndex: 1,
      roomType: 'Deluxe Double Room',
      roomSubtotal: 1_700_000,
      taxAmount: null,
      feeAmount: null,
      nights: [
        { id: 'n1', stayDate: '2026-07-19', amount: 850_000, currency: 'VND', manuallyCorrected: false, isEstimated: false },
        { id: 'n2', stayDate: '2026-07-20', amount: 850_000, currency: 'VND', manuallyCorrected: false, isEstimated: false },
      ],
    },
  ],
  warnings: [],
  statusHistory: [],
  createdBy: null,
  sentBy: { id: 1, fullName: 'Quản trị viên' },
  completedBy: null,
  createdAt: '2026-07-15T02:00:00.000Z',
  updatedAt: '2026-07-15T02:00:00.000Z',
  sentAt: '2026-07-15T02:00:00.000Z',
  completedAt: null,
  completionNote: null,
};

describe('BookingDetailPage — receptionist confirmation', () => {
  it('shows copyable fields and confirms creation via the complete API', async () => {
    let completed = false;
    const fetchMock = installApiMock({
      'GET /api/auth/me': () => ({ status: 200, body: { user: RECEPTIONIST_USER } }),
      'GET /api/notifications/unread-count': () => ({ status: 200, body: { count: 0 } }),
      'GET /api/bookings/b1': () => ({
        status: 200,
        body: {
          booking: completed
            ? { ...NEW_BOOKING, status: 'COMPLETED', completedBy: { id: 2, fullName: 'Lễ tân Một' }, completedAt: '2026-07-16T02:00:00.000Z' }
            : NEW_BOOKING,
        },
      }),
      'POST /api/bookings/b1/complete': () => {
        completed = true;
        return { status: 200, body: { booking: { ...NEW_BOOKING, status: 'COMPLETED' } } };
      },
    });

    const user = userEvent.setup();
    renderApp('/app/booking/b1');

    // Core fields with a copy control.
    expect(await screen.findByText('489234523')).toBeInTheDocument();
    expect(screen.getByLabelText('Sao chép Mã Booking')).toBeInTheDocument();
    expect(screen.getByLabelText('Sao chép toàn bộ')).toBeInTheDocument();

    // Confirm flow: open dialog, then confirm (the modal footer button).
    await user.click(screen.getByRole('button', { name: 'Xác nhận đã tạo' }));
    expect(
      await screen.findByText('Bạn xác nhận booking này đã được tạo thành công trên hệ thống khách sạn?'),
    ).toBeInTheDocument();
    const confirmButtons = screen.getAllByRole('button', { name: 'Xác nhận đã tạo' });
    await user.click(confirmButtons[confirmButtons.length - 1]!);

    // The complete endpoint was called and the UI reflects the confirmed state.
    expect((await screen.findAllByText('Đã xác nhận tạo')).length).toBeGreaterThan(0);
    const called = fetchMock.mock.calls.some(
      ([url, init]) => String(url) === '/api/bookings/b1/complete' && (init as RequestInit).method === 'POST',
    );
    expect(called).toBe(true);
  });

  it('shows who confirmed it when another user already confirmed', async () => {
    installApiMock({
      'GET /api/auth/me': () => ({ status: 200, body: { user: RECEPTIONIST_USER } }),
      'GET /api/notifications/unread-count': () => ({ status: 200, body: { count: 0 } }),
      'GET /api/bookings/b1': () => ({
        status: 200,
        // Server already reflects the completion by a colleague.
        body: {
          booking: {
            ...NEW_BOOKING,
            status: 'COMPLETED',
            completedBy: { id: 9, fullName: 'Lễ tân Khác' },
            completedAt: '2026-07-16T02:00:00.000Z',
          },
        },
      }),
    });

    renderApp('/app/booking/b1');

    expect(await screen.findByText(/Người xác nhận: Lễ tân Khác/)).toBeInTheDocument();
    // No confirm action is offered for an already-confirmed booking.
    expect(screen.queryByRole('button', { name: 'Xác nhận đã tạo' })).not.toBeInTheDocument();
  });
});

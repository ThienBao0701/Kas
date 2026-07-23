import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ADMIN_USER, RECEPTIONIST_USER, installApiMock, jsonResponse, renderApp } from '../test/utils';

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

const COMPLETED_BOOKING = {
  ...NEW_BOOKING,
  status: 'COMPLETED',
  completedBy: { id: 2, fullName: 'Lễ tân Một' },
  completedAt: '2026-07-16T02:00:00.000Z',
  completionNote: 'Đã tạo trên hệ thống',
};

function mockDetail(booking: unknown) {
  return installApiMock({
    'GET /api/auth/me': () => ({ status: 200, body: { user: RECEPTIONIST_USER } }),
    'GET /api/notifications/unread-count': () => ({ status: 200, body: { count: 0 } }),
    'GET /api/bookings/b1': () => ({ status: 200, body: { booking } }),
  });
}

describe('BookingDetailPage — simplified copy surface', () => {
  it('exposes only a nightly-price copy on room rows (no room-block copies)', async () => {
    mockDetail(NEW_BOOKING);
    renderApp('/app/booking/b1');

    expect((await screen.findAllByLabelText(/Sao chép giá đêm/)).length).toBe(2);
    expect(screen.queryByLabelText(/hạng phòng/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/toàn bộ phòng/i)).not.toBeInTheDocument();
  });

  it('shows the phone placeholder and no warning when phone is missing', async () => {
    mockDetail({ ...NEW_BOOKING, phone: null });
    renderApp('/app/booking/b1');

    expect(await screen.findByText('(Hiển thị số điện thoại)')).toBeInTheDocument();
    // A missing phone must never raise a warning banner.
    expect(screen.queryByText(/Cảnh báo/)).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('blocks note generation when the booking code is missing', async () => {
    mockDetail({ ...NEW_BOOKING, bookingCode: null });
    renderApp('/app/booking/b1');

    expect(await screen.findByText('Chưa có mã Booking để tạo ghi chú.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sao chép ghi chú' })).not.toBeInTheDocument();
  });
});

describe('BookingDetailPage — receptionist confirmation', () => {
  it('shows copyable fields and confirms creation via the complete API', async () => {
    let completed = false;
    const fetchMock = installApiMock({
      'GET /api/auth/me': () => ({ status: 200, body: { user: RECEPTIONIST_USER } }),
      'GET /api/notifications/unread-count': () => ({ status: 200, body: { count: 0 } }),
      'GET /api/bookings/b1': () => ({
        status: 200,
        body: { booking: completed ? COMPLETED_BOOKING : NEW_BOOKING },
      }),
      'POST /api/bookings/b1/complete': () => {
        completed = true;
        return { status: 200, body: { booking: COMPLETED_BOOKING } };
      },
    });

    const user = userEvent.setup();
    renderApp('/app/booking/b1');

    // Only the four main fields have a copy button; supporting fields do not.
    expect(await screen.findByRole('heading', { name: 'Nguyễn Văn A' })).toBeInTheDocument();
    expect(screen.getByLabelText('Sao chép Tên khách')).toBeInTheDocument();
    expect(screen.getByLabelText('Sao chép Số điện thoại')).toBeInTheDocument();
    expect(screen.getByLabelText('Sao chép Mã Booking')).toBeInTheDocument();
    expect(screen.getByLabelText('Sao chép Tổng tiền')).toBeInTheDocument();
    expect(screen.queryByLabelText('Sao chép Chi nhánh')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Sao chép Check-in')).not.toBeInTheDocument();
    // The generated PMS note card offers a single "Sao chép ghi chú".
    expect(screen.getByRole('button', { name: 'Sao chép ghi chú' })).toBeInTheDocument();

    // Confirmation card wording.
    expect(
      screen.getByText('Sau khi đã tạo booking trên hệ thống khách sạn, hãy xác nhận tại đây.'),
    ).toBeInTheDocument();

    // Open the dialog and confirm.
    await user.click(screen.getByRole('button', { name: 'Xác nhận đã tạo' }));
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText('Bạn xác nhận booking này đã được tạo thành công trên hệ thống khách sạn?'),
    ).toBeInTheDocument();
    // The dialog echoes the identifying fields.
    expect(within(dialog).getByText('Nguyễn Văn A')).toBeInTheDocument();
    expect(within(dialog).getByText('489234523')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Xác nhận đã tạo' }));

    // Success feedback + confirmed state, and the complete endpoint was called.
    expect(await screen.findByText('Đã xác nhận booking đã tạo trên hệ thống khách sạn.')).toBeInTheDocument();
    expect((await screen.findAllByText('Đã xác nhận tạo')).length).toBeGreaterThan(0);
    const called = fetchMock.mock.calls.some(
      ([url, init]) => String(url) === '/api/bookings/b1/complete' && (init as RequestInit).method === 'POST',
    );
    expect(called).toBe(true);
  });

  it('disables the confirm button while the request is processing', async () => {
    let resolveComplete: () => void = () => {};
    const fetchMock = vi.fn(async (url: string | URL, init: RequestInit = {}) => {
      const method = (init.method ?? 'GET').toUpperCase();
      const key = `${method} ${String(url)}`;
      if (key === 'GET /api/auth/me') return jsonResponse(200, { user: RECEPTIONIST_USER });
      if (key === 'GET /api/notifications/unread-count') return jsonResponse(200, { count: 0 });
      if (key === 'GET /api/bookings/b1') return jsonResponse(200, { booking: NEW_BOOKING });
      if (key === 'POST /api/bookings/b1/complete') {
        return new Promise<Response>((resolve) => {
          resolveComplete = () => resolve(jsonResponse(200, { booking: COMPLETED_BOOKING }));
        });
      }
      return jsonResponse(404, { error: { code: 'NOT_FOUND', message: key } });
    });
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    renderApp('/app/booking/b1');

    await user.click(await screen.findByRole('button', { name: 'Xác nhận đã tạo' }));
    const dialog = await screen.findByRole('dialog');
    const confirmBtn = within(dialog).getByRole('button', { name: 'Xác nhận đã tạo' });
    await user.click(confirmBtn);

    // While the deferred request is in flight the button is disabled.
    expect(confirmBtn).toBeDisabled();
    resolveComplete();
  });

  it('handles an already-confirmed response with a clear message', async () => {
    installApiMock({
      'GET /api/auth/me': () => ({ status: 200, body: { user: RECEPTIONIST_USER } }),
      'GET /api/notifications/unread-count': () => ({ status: 200, body: { count: 0 } }),
      'GET /api/bookings/b1': () => ({ status: 200, body: { booking: NEW_BOOKING } }),
      'POST /api/bookings/b1/complete': () => ({
        status: 409,
        body: { error: { code: 'BOOKING_ALREADY_COMPLETED', message: 'Đơn đã được hoàn thành trước đó.' } },
      }),
    });

    const user = userEvent.setup();
    renderApp('/app/booking/b1');

    await user.click(await screen.findByRole('button', { name: 'Xác nhận đã tạo' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Xác nhận đã tạo' }));

    expect(
      await screen.findByText('Đơn này đã được xác nhận trước đó. Trạng thái đã được cập nhật.'),
    ).toBeInTheDocument();
  });
});

describe('BookingDetailPage — admin view', () => {
  it('shows who confirmed the booking and when', async () => {
    installApiMock({
      'GET /api/auth/me': () => ({ status: 200, body: { user: ADMIN_USER } }),
      'GET /api/notifications/unread-count': () => ({ status: 200, body: { count: 0 } }),
      'GET /api/bookings/new?page=1&pageSize=20': () => ({ status: 200, body: { bookings: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 } } }),
      'GET /api/bookings/b1': () => ({ status: 200, body: { booking: COMPLETED_BOOKING } }),
    });

    renderApp('/app/booking/b1');

    // Confirmed-by name is visible, and the admin meta labels completedAt.
    expect((await screen.findAllByText(/Lễ tân Một/)).length).toBeGreaterThan(0);
    expect(screen.getByText(/completedAt/)).toBeInTheDocument();
    expect(screen.getByText(/Ghi chú: Đã tạo trên hệ thống/)).toBeInTheDocument();
  });
});

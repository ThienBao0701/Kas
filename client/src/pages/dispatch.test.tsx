import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ADMIN_USER, installApiMock, renderApp } from '../test/utils';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const BRANCH = { id: 1, code: 'TRUONG_DINH_05', hotelName: 'Saigon Hotel & Ben Thanh', address: '05 Trương Định' };
const BRANCH2 = { id: 2, code: 'LY_TU_TRONG_260', hotelName: 'Luxury Elegance Hotel Ben Than', address: '260 Lý Tự Trọng' };

function detail(overrides: Record<string, unknown> = {}) {
  return {
    id: 'd1',
    status: 'DRAFT',
    sourcePlatform: 'BOOKING_COM',
    verificationStatus: 'NOT_SUBMITTED',
    businessType: 'DIRECT',
    businessTypeManuallyConfirmed: false,
    hotelName: 'Saigon Hotel & Ben Thanh Market',
    branch: BRANCH,
    branchId: 1,
    customerName: 'Thùy Chi Phan',
    phone: '+84 964 934 713',
    bookingCode: '6312474567',
    checkInDate: '2026-07-23',
    checkOutDate: '2026-07-25',
    checkInTime: null,
    checkOutTime: null,
    totalAmount: 3_078_000,
    currency: 'VND',
    paymentStatus: 'PAY_AFTER',
    specialRequest: null,
    rawText: 'raw',
    parserVersion: '4a.2.0',
    isLastMinute: false,
    rooms: [
      {
        id: 'r1',
        roomIndex: 1,
        roomType: 'Phòng Tiêu Chuẩn Giường Đôi',
        roomSubtotal: 1_539_000,
        taxAmount: null,
        feeAmount: null,
        nights: [{ id: 'n1', stayDate: '2026-07-23', amount: 648_000, currency: 'VND', manuallyCorrected: false, isEstimated: false }],
      },
    ],
    warnings: [],
    statusHistory: [],
    proofs: [],
    createdBy: null,
    sentBy: null,
    completedBy: null,
    reviewedBy: null,
    createdAt: '2026-07-20T00:00:00.000Z',
    updatedAt: '2026-07-20T00:00:00.000Z',
    sentAt: null,
    completedAt: null,
    completionNote: null,
    reviewedAt: null,
    ...overrides,
  };
}

const DEFAULT_EXTRACT = {
  booking: { id: 'd1', status: 'DRAFT' },
  suggestedBranch: BRANCH,
  branchConfidence: 100,
  branchConfident: true,
  requiresManualConfirmation: false,
  parserQuality: { score: 98, level: 'HIGH', requiresAdminReview: false, missingCriticalFields: [], warningCount: 0 },
  businessType: 'DIRECT',
  businessTypeConfidence: 90,
  businessTypeRequiresAdminConfirmation: false,
  businessTypeMatchedRules: ['retail-rate'],
  warnings: [],
};

function mockDispatch(
  extract: Record<string, unknown> = DEFAULT_EXTRACT,
  extra: Record<string, () => { status: number; body?: unknown }> = {},
) {
  return installApiMock({
    'GET /api/auth/me': () => ({ status: 200, body: { user: ADMIN_USER } }),
    'GET /api/notifications/unread-count': () => ({ status: 200, body: { count: 0 } }),
    'GET /api/branches': () => ({ status: 200, body: { branches: [BRANCH, BRANCH2] } }),
    'POST /api/bookings/extract': () => ({ status: 201, body: extract }),
    'GET /api/admin/bookings/d1': () => ({ status: 200, body: { booking: detail() } }),
    ...extra,
  });
}

async function extract(user: ReturnType<typeof userEvent.setup>) {
  const textarea = await screen.findByRole('textbox');
  await user.type(textarea, 'Booking.com raw text');
  await user.click(screen.getByRole('button', { name: 'Trích xuất thông tin' }));
}

describe('DispatchPage — data-quality / confidence display', () => {
  it('shows a HIGH completeness score and branch confidence, no review banner', async () => {
    mockDispatch();

    const user = userEvent.setup();
    renderApp('/app/dispatch');
    await extract(user);

    expect(await screen.findByText(/Độ hoàn thiện dữ liệu:/)).toBeInTheDocument();
    expect(screen.getByText('98%')).toBeInTheDocument();
    expect(screen.getByText(/Độ tin cậy chi nhánh:/)).toBeInTheDocument();
    expect(screen.getByText('100%')).toBeInTheDocument();
    expect(screen.queryByText('Admin cần kiểm tra lại booking này trước khi gửi.')).not.toBeInTheDocument();
  });

  it('shows the review banner when the extraction requires admin review', async () => {
    mockDispatch({
      ...DEFAULT_EXTRACT,
      branchConfidence: 80,
      branchConfident: false,
      requiresManualConfirmation: true,
      parserQuality: { score: 70, level: 'LOW', requiresAdminReview: true, missingCriticalFields: ['bookingCode'], warningCount: 1 },
    });

    const user = userEvent.setup();
    renderApp('/app/dispatch');
    await extract(user);

    expect(await screen.findByText('Admin cần kiểm tra lại booking này trước khi gửi.')).toBeInTheDocument();
    expect(screen.getByText('70%')).toBeInTheDocument();
    expect(screen.getByText('80%')).toBeInTheDocument();
  });
});

describe('DispatchPage — branch address field', () => {
  it('shows the selected branch address and updates it when the branch changes', async () => {
    mockDispatch();
    const user = userEvent.setup();
    renderApp('/app/dispatch');
    await extract(user);

    const addressField = await screen.findByLabelText('Địa chỉ khách sạn');
    expect(addressField).toHaveValue('05 Trương Định');
    expect(addressField).toHaveAttribute('readonly');
    expect(addressField).toHaveAttribute('placeholder', 'Chưa chọn chi nhánh');
    // The raw Booking.com property name is not shown as the address.
    expect(addressField).not.toHaveValue('Saigon Hotel & Ben Thanh Market');

    // Changing the branch dropdown updates the displayed address immediately.
    const branchSelect = screen.getByLabelText('Chọn chi nhánh gửi đến');
    await user.selectOptions(branchSelect, '2');
    expect(addressField).toHaveValue('260 Lý Tự Trọng');
  });

  it('shows an empty address with the placeholder when no branch is resolved', async () => {
    mockDispatch(
      { ...DEFAULT_EXTRACT, suggestedBranch: null, branchConfident: false, branchConfidence: 0 },
      { 'GET /api/admin/bookings/d1': () => ({ status: 200, body: { booking: detail({ branch: null, branchId: null }) } }) },
    );
    const user = userEvent.setup();
    renderApp('/app/dispatch');
    await extract(user);

    const addressField = await screen.findByLabelText('Địa chỉ khách sạn');
    expect(addressField).toHaveValue('');
    expect(addressField).toHaveAttribute('placeholder', 'Chưa chọn chi nhánh');
  });
});

describe('DispatchPage — business type', () => {
  /** The business-type read-out lives in a role="status" span (the "Loại đơn" chip). */
  function statusHas(text: RegExp): boolean {
    return screen.getAllByRole('status').some((el) => text.test(el.textContent ?? ''));
  }

  it('shows a confident DIRECT type with confidence, no confirmation prompt', async () => {
    mockDispatch();
    const user = userEvent.setup();
    renderApp('/app/dispatch');
    await extract(user);

    await screen.findByText(/Loại đơn:/);
    expect(statusHas(/Đơn thường/)).toBe(true);
    expect(screen.getByText(/Độ tin cậy loại đơn:/)).toBeInTheDocument();
    expect(screen.getByText('90%')).toBeInTheDocument();
    expect(screen.queryByText('Không thể tự xác định loại đơn. Admin vui lòng xác nhận.')).not.toBeInTheDocument();
  });

  it('shows the PARTNER type', async () => {
    mockDispatch({ ...DEFAULT_EXTRACT, businessType: 'PARTNER', businessTypeConfidence: 100, businessTypeMatchedRules: ['partner-rate'] });
    const user = userEvent.setup();
    renderApp('/app/dispatch');
    await extract(user);
    await screen.findByText(/Loại đơn:/);
    expect(statusHas(/Đơn đối tác/)).toBe(true);
  });

  it('prompts for confirmation on UNKNOWN and lets the Admin mark it a partner', async () => {
    const partnerBooking = detail({ businessType: 'PARTNER', businessTypeManuallyConfirmed: true });
    mockDispatch(
      { ...DEFAULT_EXTRACT, businessType: 'UNKNOWN', businessTypeConfidence: 0, businessTypeRequiresAdminConfirmation: true, businessTypeMatchedRules: [] },
      { 'POST /api/admin/bookings/d1/business-type': () => ({ status: 200, body: { booking: partnerBooking } }) },
    );
    const user = userEvent.setup();
    renderApp('/app/dispatch');
    await extract(user);

    expect(await screen.findByText('Không thể tự xác định loại đơn. Admin vui lòng xác nhận.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Đánh dấu là Đơn đối tác' }));

    await screen.findByText('Admin đã xác nhận');
    expect(statusHas(/Đơn đối tác/)).toBe(true);
  });
});

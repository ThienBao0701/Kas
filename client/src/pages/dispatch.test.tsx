import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ADMIN_USER, installApiMock, renderApp } from '../test/utils';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const BRANCH = { id: 1, code: 'TRUONG_DINH_05', hotelName: 'Saigon Hotel & Ben Thanh', address: '05 Trương Định' };

function detail(overrides: Record<string, unknown> = {}) {
  return {
    id: 'd1',
    status: 'DRAFT',
    sourcePlatform: 'BOOKING_COM',
    verificationStatus: 'NOT_SUBMITTED',
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

function mockDispatch(extract: Record<string, unknown>) {
  return installApiMock({
    'GET /api/auth/me': () => ({ status: 200, body: { user: ADMIN_USER } }),
    'GET /api/notifications/unread-count': () => ({ status: 200, body: { count: 0 } }),
    'GET /api/branches': () => ({ status: 200, body: { branches: [BRANCH] } }),
    'POST /api/bookings/extract': () => ({ status: 201, body: extract }),
    'GET /api/admin/bookings/d1': () => ({ status: 200, body: { booking: detail() } }),
  });
}

async function extract(user: ReturnType<typeof userEvent.setup>) {
  const textarea = await screen.findByRole('textbox');
  await user.type(textarea, 'Booking.com raw text');
  await user.click(screen.getByRole('button', { name: 'Trích xuất thông tin' }));
}

describe('DispatchPage — data-quality / confidence display', () => {
  it('shows a HIGH completeness score and branch confidence, no review banner', async () => {
    mockDispatch({
      booking: { id: 'd1', status: 'DRAFT' },
      suggestedBranch: BRANCH,
      branchConfidence: 100,
      branchConfident: true,
      requiresManualConfirmation: false,
      parserQuality: { score: 98, level: 'HIGH', requiresAdminReview: false, missingCriticalFields: [], warningCount: 0 },
      warnings: [],
    });

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
      booking: { id: 'd1', status: 'DRAFT' },
      suggestedBranch: BRANCH,
      branchConfidence: 80,
      branchConfident: false,
      requiresManualConfirmation: true,
      parserQuality: { score: 70, level: 'LOW', requiresAdminReview: true, missingCriticalFields: ['bookingCode'], warningCount: 1 },
      warnings: [],
    });

    const user = userEvent.setup();
    renderApp('/app/dispatch');
    await extract(user);

    expect(await screen.findByText('Admin cần kiểm tra lại booking này trước khi gửi.')).toBeInTheDocument();
    expect(screen.getByText('70%')).toBeInTheDocument();
    expect(screen.getByText('80%')).toBeInTheDocument();
  });
});

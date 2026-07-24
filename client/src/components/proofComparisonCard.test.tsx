import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { installApiMock, jsonResponse } from '../test/utils';
import { ProofComparisonCard } from './ProofComparisonCard';
import type { FieldComparison, OverallStatus } from '../api/compare';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const LATEST = 'GET /api/admin/bookings/b1/proofs/p1/comparisons/latest';

const FIELDS: FieldComparison[] = [
  { field: 'BOOKING_CODE', label: 'Mã Booking', importance: 'CRITICAL', result: 'MATCH', expected: '6039118394', detected: '6039118394', message: 'Mã Booking khớp.' },
  { field: 'CHECK_IN', label: 'Check-in', importance: 'CRITICAL', result: 'MISMATCH', expected: '24/07/2026', detected: '25/07/2026', message: 'Ngày trong ảnh không khớp.' },
  { field: 'ROOM_TYPE', label: 'Hạng phòng', importance: 'OPERATIONAL', result: 'WARNING', expected: 'SUPERIOR', detected: 'DELUXE', message: 'Hạng phòng trong ảnh chưa rõ, cần kiểm tra.' },
  { field: 'PAYMENT_STATUS', label: 'Thanh toán', importance: 'OPERATIONAL', result: 'NOT_FOUND', expected: 'PAY AFTER CHECK-IN', detected: null, message: 'Không nhận diện được hình thức thanh toán từ ảnh.' },
];

function comparison(overall: OverallStatus, fields: FieldComparison[] = FIELDS) {
  return {
    id: 'c1',
    bookingId: 'b1',
    proofId: 'p1',
    analysisId: 'a1',
    overallStatus: overall,
    comparisonVersion: 'proof-compare-v1',
    result: { overall, version: 'proof-compare-v1', summary: { matchCount: 1, mismatchCount: 1, warningCount: 1, notFoundCount: 1 }, fields },
    errorMessage: null,
    createdAt: '2026-07-24T06:00:00.000Z',
  };
}

function renderCard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ProofComparisonCard bookingId="b1" proofId="p1" />
    </QueryClientProvider>,
  );
}

describe('ProofComparisonCard — overall states', () => {
  it('MATCH shows the KHỚP banner', async () => {
    installApiMock({ [LATEST]: () => ({ status: 200, body: { comparison: comparison('MATCH', [FIELDS[0]!]) } }) });
    renderCard();
    expect(await screen.findByLabelText('Kết quả đối chiếu: KHỚP')).toBeInTheDocument();
  });

  it('WARNING shows the CẦN KIỂM TRA banner', async () => {
    installApiMock({ [LATEST]: () => ({ status: 200, body: { comparison: comparison('WARNING') } }) });
    renderCard();
    expect(await screen.findByLabelText('Kết quả đối chiếu: CẦN KIỂM TRA')).toBeInTheDocument();
  });

  it('MISMATCH shows the CÓ SAI KHÁC banner', async () => {
    installApiMock({ [LATEST]: () => ({ status: 200, body: { comparison: comparison('MISMATCH') } }) });
    renderCard();
    expect(await screen.findByLabelText('Kết quả đối chiếu: CÓ SAI KHÁC')).toBeInTheDocument();
  });

  it('no comparison → CHƯA CÓ KẾT QUẢ (unavailable)', async () => {
    installApiMock({ [LATEST]: () => ({ status: 200, body: { comparison: null } }) });
    renderCard();
    expect(await screen.findByLabelText('Kết quả đối chiếu: CHƯA CÓ KẾT QUẢ')).toBeInTheDocument();
  });
});

describe('ProofComparisonCard — field table', () => {
  it('renders the field table with expected + detected values and messages', async () => {
    installApiMock({ [LATEST]: () => ({ status: 200, body: { comparison: comparison('MISMATCH') } }) });
    renderCard();
    const table = await screen.findByRole('table');
    // Expected + detected values (booking code matches, so it appears in both cells).
    expect(within(table).getAllByText('6039118394').length).toBeGreaterThanOrEqual(2);
    expect(within(table).getByText('24/07/2026')).toBeInTheDocument(); // expected check-in
    expect(within(table).getByText('25/07/2026')).toBeInTheDocument(); // detected check-in
    // Critical mismatch message + warning message + not-found label.
    expect(screen.getByText('Ngày trong ảnh không khớp.')).toBeInTheDocument();
    expect(screen.getByText('Hạng phòng trong ảnh chưa rõ, cần kiểm tra.')).toBeInTheDocument();
    expect(screen.getByText('Không tìm thấy')).toBeInTheDocument();
  });

  it('always shows the advisory disclaimer', async () => {
    installApiMock({ [LATEST]: () => ({ status: 200, body: { comparison: comparison('MATCH', [FIELDS[0]!]) } }) });
    renderCard();
    expect(await screen.findByText(/Admin phải kiểm tra ảnh trước khi xác nhận/)).toBeInTheDocument();
  });
});

describe('ProofComparisonCard — loading, error, refresh', () => {
  it('shows a loading state', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {}))); // never resolves
    renderCard();
    expect(screen.getByText('Đang tải kết quả đối chiếu…')).toBeInTheDocument();
  });

  it('shows an API failure state', async () => {
    installApiMock({ [LATEST]: () => ({ status: 500, body: { error: { code: 'INTERNAL_ERROR', message: 'x' } } }) });
    renderCard();
    expect(await screen.findByText('Không thể tải kết quả đối chiếu.')).toBeInTheDocument();
  });

  it('refresh re-fetches the latest comparison (updates after re-analysis)', async () => {
    let overall: OverallStatus = 'MATCH';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(200, { comparison: comparison(overall, [FIELDS[0]!]) })),
    );
    const user = userEvent.setup();
    renderCard();
    expect(await screen.findByLabelText('Kết quả đối chiếu: KHỚP')).toBeInTheDocument();

    overall = 'MISMATCH';
    await user.click(screen.getByRole('button', { name: 'Làm mới đối chiếu' }));
    expect(await screen.findByLabelText('Kết quả đối chiếu: CÓ SAI KHÁC')).toBeInTheDocument();
  });
});

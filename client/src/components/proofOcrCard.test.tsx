import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { installApiMock } from '../test/utils';
import { ProofOcrCard } from './ProofOcrCard';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const LATEST = 'GET /api/admin/bookings/b1/proofs/p1/analyses/latest';
const ANALYZE = 'POST /api/admin/bookings/b1/proofs/p1/analyze';

function analysis(over: Record<string, unknown> = {}) {
  return {
    id: 'a1',
    proofId: 'p1',
    status: 'COMPLETED',
    provider: 'mock',
    analysisVersion: '1',
    extractedText: 'Booking ID: 6039118394',
    errorMessage: null,
    startedAt: '2026-07-24T06:00:00.000Z',
    completedAt: '2026-07-24T06:00:05.000Z',
    createdAt: '2026-07-24T06:00:00.000Z',
    fields: {
      bookingCode: { value: '6039118394', confidence: 96 },
      customerName: { value: 'Nguyen Van A', confidence: 83 },
      checkInDate: { value: '2026-07-24', confidence: 91 },
      checkOutDate: { value: '2026-07-28', confidence: 88 },
      nights: { value: 4, confidence: 80 },
      roomTypes: [{ value: 'Superior Double', quantity: 1, confidence: 78 }],
      roomQuantity: { value: 1, confidence: 80 },
      totalAmount: { value: 4_720_680, currency: 'VND', confidence: 94 },
      paymentStatus: { value: 'PAY_AFTER', confidence: 82 },
      note: { value: 'Late check-in around 22:00', confidence: 70 },
    },
    ...over,
  };
}

function renderCard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ProofOcrCard bookingId="b1" proofId="p1" />
    </QueryClientProvider>,
  );
}

describe('ProofOcrCard — states', () => {
  it('shows the disabled state when OCR is off', async () => {
    installApiMock({ [LATEST]: () => ({ status: 200, body: { analysis: analysis({ status: 'DISABLED', fields: null, extractedText: null }) } }) });
    renderCard();
    expect(await screen.findByText(/OCR đang tắt/)).toBeInTheDocument();
  });

  it('shows the pending state while analysing', async () => {
    installApiMock({ [LATEST]: () => ({ status: 200, body: { analysis: analysis({ status: 'PROCESSING', fields: null }) } }) });
    renderCard();
    expect(await screen.findByText('Đang phân tích ảnh…')).toBeInTheDocument();
  });

  it('shows the failed state with a manual-review message', async () => {
    installApiMock({ [LATEST]: () => ({ status: 200, body: { analysis: analysis({ status: 'FAILED', fields: null, errorMessage: 'x' }) } }) });
    renderCard();
    expect(await screen.findByText(/Không thể nhận diện ảnh/)).toBeInTheDocument();
  });

  it('shows the completed state with detected fields and confidence', async () => {
    installApiMock({ [LATEST]: () => ({ status: 200, body: { analysis: analysis() } }) });
    renderCard();
    expect(await screen.findByText('Đã nhận diện')).toBeInTheDocument();
    // Field values.
    expect(screen.getByText('6039118394')).toBeInTheDocument();
    expect(screen.getByText(/4\.720\.680/)).toBeInTheDocument();
    expect(screen.getByText('PAY AFTER CHECK-IN')).toBeInTheDocument();
    expect(screen.getByText('Superior Double')).toBeInTheDocument();
    // Per-field OCR confidence.
    expect(screen.getByText('Độ tin cậy OCR: 96%')).toBeInTheDocument();
  });

  it('shows a not-found state for fields OCR could not read', async () => {
    installApiMock({
      [LATEST]: () => ({ status: 200, body: { analysis: analysis({ fields: { ...analysis().fields, bookingCode: null } }) } }),
    });
    renderCard();
    await screen.findByText('Đã nhận diện');
    expect(screen.getAllByText('Không nhận diện được').length).toBeGreaterThan(0);
  });

  it('never shows a MATCH / MISMATCH / verdict label', async () => {
    installApiMock({ [LATEST]: () => ({ status: 200, body: { analysis: analysis() } }) });
    renderCard();
    await screen.findByText('Đã nhận diện');
    expect(screen.queryByText(/MATCH|MISMATCH|ĐÚNG|SAI|CÓ THỂ DUYỆT/i)).toBeNull();
  });

  it('always shows the advisory disclaimer', async () => {
    installApiMock({ [LATEST]: () => ({ status: 200, body: { analysis: analysis() } }) });
    renderCard();
    expect(await screen.findByText(/Admin vẫn phải tự kiểm tra ảnh trước khi xác nhận/)).toBeInTheDocument();
  });

  it('lets the admin trigger a re-analysis', async () => {
    const fetchMock = installApiMock({
      [LATEST]: () => ({ status: 200, body: { analysis: analysis() } }),
      [ANALYZE]: () => ({ status: 201, body: { analysis: analysis({ id: 'a2' }) } }),
    });
    const user = userEvent.setup();
    renderCard();
    await user.click(await screen.findByRole('button', { name: 'Phân tích lại ảnh' }));
    const called = fetchMock.mock.calls.some(
      ([u, i]) => String(u) === '/api/admin/bookings/b1/proofs/p1/analyze' && (i as RequestInit).method === 'POST',
    );
    expect(called).toBe(true);
  });
});

/**
 * The operational lifecycle buttons.
 *
 * Phase 5 built six transitions on the server and, until this commit, nothing
 * in the product could reach them: a booking dispatched to a branch could never
 * be marked received, so the operational statuses existed only in the database.
 *
 * Two behaviours matter beyond "the button posts". Cancel and no-show must ask
 * first — they are the two that cost the hotel money and neither can be undone
 * from this screen. And the buttons offered must follow the status, because
 * offering "check out" on a guest who never checked in invites a 409 the
 * operator cannot interpret.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LifecycleActions } from './LifecycleActions';
import { EMPTY_OPERATIONAL_BLOCKS, jsonResponse } from '../test/utils';
import type { BookingDetail, BookingStatus } from '../api/bookings';

const posted: { url: string; body: unknown }[] = [];

function booking(status: BookingStatus): BookingDetail {
  return {
    id: 'b1',
    status,
    sourcePlatform: 'AGODA',
    verificationStatus: 'NOT_SUBMITTED',
    businessType: 'PARTNER',
    businessTypeManuallyConfirmed: false,
    hotelName: 'Saigon Hotel',
    branch: null,
    branchId: 1,
    customerName: 'Nguyễn Văn A',
    phone: '0901234567',
    bookingCode: 'A-1',
    checkInDate: '2026-08-10',
    checkOutDate: '2026-08-11',
    checkInTime: null,
    checkOutTime: null,
    totalAmount: 1_000_000,
    currency: 'VND',
    paymentStatus: 'PAY_BEFORE',
    specialRequest: null,
    parserVersion: null,
    isLastMinute: false,
    rooms: [],
    warnings: [],
    statusHistory: [],
    proofs: [],
    createdBy: null,
    sentBy: null,
    completedBy: null,
    reviewedBy: null,
    createdAt: '2026-08-01T02:00:00.000Z',
    updatedAt: '2026-08-01T02:00:00.000Z',
    sentAt: '2026-08-01T02:00:00.000Z',
    completedAt: null,
    completionNote: null,
    reviewedAt: null,
    ...EMPTY_OPERATIONAL_BLOCKS,
  } as BookingDetail;
}

function mount(status: BookingStatus, respond: () => { status: number; body: unknown } = ok) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL, init: RequestInit = {}) => {
      if ((init.method ?? 'GET').toUpperCase() === 'POST') {
        posted.push({ url: String(url), body: init.body ? JSON.parse(String(init.body)) : null });
      }
      const r = respond();
      return jsonResponse(r.status, r.body);
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LifecycleActions booking={booking(status)} />
    </QueryClientProvider>,
  );
}

const ok = () => ({ status: 200, body: { bookingId: 'b1', oldStatus: 'NEW', newStatus: 'RECEIVED' } });

beforeEach(() => {
  posted.length = 0;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/* ================================================================== */
/* Which buttons appear                                                */
/* ================================================================== */
describe('the actions offered follow the status', () => {
  it('offers receive and cancel on a new booking', () => {
    mount('NEW');
    expect(screen.getByTestId('lifecycle-RECEIVE')).toBeInTheDocument();
    expect(screen.getByTestId('lifecycle-CANCEL')).toBeInTheDocument();
    expect(screen.queryByTestId('lifecycle-CHECK_OUT')).toBeNull();
  });

  it('offers check-in, no-show and cancel once received', () => {
    mount('RECEIVED');
    expect(screen.getByTestId('lifecycle-CHECK_IN')).toBeInTheDocument();
    expect(screen.getByTestId('lifecycle-NO_SHOW')).toBeInTheDocument();
    expect(screen.queryByTestId('lifecycle-RECEIVE')).toBeNull();
  });

  it('offers only check-out to a guest in the room', () => {
    mount('CHECKED_IN');
    expect(screen.getByTestId('lifecycle-CHECK_OUT')).toBeInTheDocument();
    expect(screen.queryByTestId('lifecycle-CANCEL')).toBeNull();
  });

  it('renders nothing at all in a terminal state', () => {
    // Cancelled is the end of the road; an empty action card would be noise.
    mount('CANCELLED');
    expect(screen.queryByTestId('lifecycle-actions')).toBeNull();
  });
});

/* ================================================================== */
/* Posting                                                             */
/* ================================================================== */
describe('performing a transition', () => {
  it('posts to the matching endpoint', async () => {
    mount('NEW');
    await userEvent.click(screen.getByTestId('lifecycle-RECEIVE'));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]!.url).toBe('/api/bookings/b1/receive');
  });

  it('posts the correct path for each non-destructive action', async () => {
    mount('CHECKED_IN');
    await userEvent.click(screen.getByTestId('lifecycle-CHECK_OUT'));
    await waitFor(() => expect(posted[0]!.url).toBe('/api/bookings/b1/check-out'));
  });

  it('surfaces a refused transition instead of pretending it worked', async () => {
    // The server owns the transition rules. A stale tab posting an action that
    // is no longer legal must show the conflict, not a success toast.
    mount('NEW', () => ({
      status: 409,
      body: { error: { code: 'CONFLICT', message: 'Không thể nhận đơn khi đơn đang ở trạng thái RECEIVED.' } },
    }));
    await userEvent.click(screen.getByTestId('lifecycle-RECEIVE'));
    expect(await screen.findByText(/Không thể nhận đơn/)).toBeInTheDocument();
  });
});

/* ================================================================== */
/* The two that cost money                                             */
/* ================================================================== */
describe('cancel and no-show ask first', () => {
  it('does not post when cancel is clicked — it opens a confirmation', async () => {
    mount('NEW');
    await userEvent.click(screen.getByTestId('lifecycle-CANCEL'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(posted).toHaveLength(0);
  });

  it('posts nothing at all if the confirmation is dismissed', async () => {
    mount('NEW');
    await userEvent.click(screen.getByTestId('lifecycle-CANCEL'));
    await userEvent.click(screen.getByRole('button', { name: 'Quay lại' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(posted).toHaveLength(0);
  });

  it('posts once confirmed, carrying the typed reason', async () => {
    mount('NEW');
    await userEvent.click(screen.getByTestId('lifecycle-CANCEL'));
    await userEvent.type(screen.getByRole('textbox'), 'Khách đổi lịch');
    await userEvent.click(screen.getByTestId('lifecycle-confirm'));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]!.url).toBe('/api/bookings/b1/cancel');
    expect(posted[0]!.body).toEqual({ reason: 'Khách đổi lịch' });
  });

  it('omits the reason rather than sending an empty string', async () => {
    mount('RECEIVED');
    await userEvent.click(screen.getByTestId('lifecycle-NO_SHOW'));
    await userEvent.click(screen.getByTestId('lifecycle-confirm'));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]!.body).toEqual({});
  });

  it('names the guest and the action in the confirmation', async () => {
    mount('NEW');
    await userEvent.click(screen.getByTestId('lifecycle-CANCEL'));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('A-1');
    expect(dialog).toHaveTextContent('Nguyễn Văn A');
    expect(dialog).toHaveTextContent('không thể hoàn tác');
  });
});

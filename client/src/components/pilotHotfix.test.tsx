/**
 * Phase 5.2 pilot hotfixes, as behaviour.
 *
 * These are the frictions the pilot found. Each one is a case where the screen
 * told a receptionist something the source never said, or buried something
 * they need on every booking:
 *
 *   PAY BEFORE CHECK-IN shown for an Agoda reservation whose mail says "CN";
 *   an empty phone field for a source that never sends phone numbers;
 *   nightly rates behind a disclosure that must be opened for every guest;
 *   developer-facing history on the screen reception works from.
 *
 * The most important assertions here are the negative ones — Booking.com must
 * be untouched, because it is the certified path the hotel already runs on.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { BookingDetailView } from './BookingDetailView';
import { EMPTY_OPERATIONAL_BLOCKS } from '../test/utils';
import type { BookingDetail, BookingSource } from '../api/bookings';

vi.mock('./ProofSection', () => ({ ProofSection: () => null }));

function booking(over: Partial<BookingDetail> = {}): BookingDetail {
  return {
    id: 'b1',
    status: 'NEW',
    sourcePlatform: 'BOOKING_COM',
    verificationStatus: 'NOT_SUBMITTED',
    businessType: 'DIRECT',
    businessTypeManuallyConfirmed: false,
    hotelName: 'Saigon Hotel',
    branch: { id: 1, code: 'TRUONG_DINH_05', hotelName: 'Saigon Hotel', address: '05 Trương Định' },
    branchId: 1,
    customerName: 'Nguyễn Văn A',
    phone: '0901234567',
    bookingCode: 'A-1',
    checkInDate: '2026-08-10',
    checkOutDate: '2026-08-12',
    checkInTime: null,
    checkOutTime: null,
    totalAmount: 1_000_000,
    currency: 'VND',
    paymentStatus: 'PAY_BEFORE',
    specialRequest: null,
    parserVersion: '5.0.0',
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
    adminPmsNote: null,
    reviewedPaymentMode: null,
    ...EMPTY_OPERATIONAL_BLOCKS,
    ...over,
  } as BookingDetail;
}

/** An OTA booking with its parsed payment wording, as dispatch stored it. */
function otaBooking(source: BookingSource, paymentType: string | null, over: Partial<BookingDetail> = {}) {
  return booking({
    sourcePlatform: source,
    phone: null,
    ota: { ...EMPTY_OPERATIONAL_BLOCKS.ota, sourcePlatform: source, paymentType },
    ...over,
  });
}

function mount(b: BookingDetail, isAdmin = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <BookingDetailView booking={b} isAdmin={isAdmin} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const ROOM = {
  id: 'r1',
  roomIndex: 1,
  roomType: 'Deluxe',
  roomSubtotal: 1_000_000,
  taxAmount: null,
  feeAmount: null,
  nights: [
    { id: 'n1', stayDate: '2026-08-10', amount: 500_000, currency: 'VND', manuallyCorrected: false, isEstimated: false },
    { id: 'n2', stayDate: '2026-08-11', amount: 500_000, currency: 'VND', manuallyCorrected: false, isEstimated: false },
  ],
};

/* ================================================================== */
/* H1 — payment wording per source                                     */
/* ================================================================== */
describe('H1 payment display', () => {
  it('keeps PAY BEFORE CHECK-IN for Booking.com', () => {
    mount(booking({ paymentStatus: 'PAY_BEFORE' }));
    expect(screen.getByText('PAY BEFORE CHECK-IN')).toBeInTheDocument();
  });

  it('keeps PAY AFTER CHECK-IN for Booking.com', () => {
    mount(booking({ paymentStatus: 'PAY_AFTER' }));
    expect(screen.getByText('PAY AFTER CHECK-IN')).toBeInTheDocument();
  });

  it('shows the Agoda wording exactly as the parser produced it', () => {
    mount(otaBooking('AGODA', 'CN'));
    expect(screen.getByText('CN')).toBeInTheDocument();
    // Never translated into the Booking.com vocabulary.
    expect(screen.queryByText('PAY BEFORE CHECK-IN')).toBeNull();
    expect(screen.queryByText('PAY AFTER CHECK-IN')).toBeNull();
  });

  it('shows a different Agoda wording verbatim too', () => {
    // Proves nothing is mapped: whatever the mail said is what appears.
    mount(otaBooking('AGODA', 'Pay at Hotel'));
    expect(screen.getByText('Pay at Hotel')).toBeInTheDocument();
  });

  it('shows no payment field for CTrip, which states none', () => {
    // The CTrip parser extracts no payment value. An invented one is exactly
    // the sort of thing a branch would act on.
    mount(otaBooking('CTRIP', null));
    expect(screen.queryByText('Thanh toán')).toBeNull();
    expect(screen.queryByText('PAY BEFORE CHECK-IN')).toBeNull();
  });

  it('shows no payment field for an Agoda mail that stated none', () => {
    mount(otaBooking('AGODA', null));
    expect(screen.queryByText('Thanh toán')).toBeNull();
  });
});

/* ================================================================== */
/* H2 — phone                                                          */
/* ================================================================== */
describe('H2 phone section', () => {
  it('hides the phone entirely for an OTA booking without one', () => {
    mount(otaBooking('AGODA', 'CN'));
    expect(screen.queryByText('Số điện thoại')).toBeNull();
    // No placeholder either — that would send someone looking for a number
    // that was never sent.
    expect(screen.queryByText('(Hiển thị số điện thoại)')).toBeNull();
  });

  it('shows the phone for an OTA booking that does have one', () => {
    mount(otaBooking('AGODA', 'CN', { phone: '0987654321' }));
    expect(screen.getByText('Số điện thoại')).toBeInTheDocument();
    expect(screen.getByText('0987654321')).toBeInTheDocument();
  });

  it('leaves Booking.com unchanged, placeholder and all', () => {
    mount(booking({ phone: null }));
    expect(screen.getByText('Số điện thoại')).toBeInTheDocument();
    expect(screen.getByText('(Hiển thị số điện thoại)')).toBeInTheDocument();
  });
});

/* ================================================================== */
/* H5 / H10 — nightly rates                                            */
/* ================================================================== */
describe('H5/H10 nightly rates', () => {
  it('shows every night immediately, with nothing to expand', () => {
    mount(booking({ rooms: [ROOM] }));
    const section = screen.getByTestId('rooms-section');
    // Scoped to the section: the check-in date also appears in the sticky
    // header, which is correct and not what this asserts.
    expect(within(section).getByText('10/08/2026')).toBeInTheDocument();
    expect(within(section).getByText('11/08/2026')).toBeInTheDocument();
    // No disclosure control anywhere in the section.
    expect(section.querySelector('[aria-expanded]')).toBeNull();
  });

  it('shows every room when there are several', () => {
    mount(booking({ rooms: [ROOM, { ...ROOM, id: 'r2', roomIndex: 2, roomType: 'Superior' }] }));
    expect(screen.getByText(/Deluxe/)).toBeInTheDocument();
    expect(screen.getByText(/Superior/)).toBeInTheDocument();
  });

  it('hides the section entirely when there are no rooms', () => {
    mount(booking({ rooms: [] }));
    expect(screen.queryByTestId('rooms-section')).toBeNull();
  });
});

/* ================================================================== */
/* H6 — lifecycle UI is gone                                           */
/* ================================================================== */
describe('H6 lifecycle controls', () => {
  it('offers no lifecycle action to a receptionist', () => {
    mount(booking({ status: 'NEW' }), false);
    for (const label of ['Nhận đơn', 'Khách nhận phòng', 'Khách trả phòng', 'Hoàn tất', 'Huỷ đơn', 'Khách không đến']) {
      expect(screen.queryByRole('button', { name: label }), label).toBeNull();
    }
    expect(screen.queryByTestId('lifecycle-actions')).toBeNull();
  });

  it('offers none to an admin either', () => {
    mount(booking({ status: 'RECEIVED' }), true);
    expect(screen.queryByTestId('lifecycle-actions')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Khách nhận phòng' })).toBeNull();
  });
});

/* ================================================================== */
/* H8 — reception sees only what it works from                         */
/* ================================================================== */
describe('H8 reception booking detail', () => {
  const rich = () =>
    booking({
      rooms: [ROOM],
      corrections: [
        {
          id: 'c1',
          field: 'checkOut',
          oldValue: '2026-08-11',
          newValue: '2026-08-12',
          appliedBy: { id: 1, fullName: 'Quản trị viên' },
          appliedAt: '2026-08-02T04:00:00.000Z',
        },
      ],
      timeline: [
        { at: '2026-08-01T02:00:00.000Z', type: 'STATUS_NEW', description: 'Điều phối', actor: null },
      ],
      operational: {
        ...EMPTY_OPERATIONAL_BLOCKS.operational,
        receivedAt: '2026-08-02T03:00:00.000Z',
        receivedBy: { id: 2, fullName: 'Lễ tân Một' },
      },
    });

  it('hides timeline, corrections and operational history from reception', () => {
    mount(rich(), false);
    expect(screen.queryByTestId('timeline-card')).toBeNull();
    expect(screen.queryByTestId('corrections-card')).toBeNull();
    expect(screen.queryByTestId('operational-card')).toBeNull();
  });

  it('still shows reception the booking it must act on', () => {
    mount(rich(), false);
    expect(screen.getByText('Thông tin chính')).toBeInTheDocument();
    expect(screen.getByTestId('rooms-section')).toBeInTheDocument();
    expect(screen.getByText(/Ghi chú tạo đơn/)).toBeInTheDocument();
  });

  it('keeps all of it for an admin', () => {
    mount(rich(), true);
    expect(screen.getByTestId('timeline-card')).toBeInTheDocument();
    expect(screen.getByTestId('corrections-card')).toBeInTheDocument();
    expect(screen.getByTestId('operational-card')).toBeInTheDocument();
  });

  it('never shows reception the admin dispatch block', () => {
    mount(rich(), false);
    expect(screen.queryByText(/Thông tin điều phối/)).toBeNull();
    expect(screen.queryByTestId('request-audit')).toBeNull();
  });
});

/* ================================================================== */
/* Booking.com is untouched                                            */
/* ================================================================== */
describe('Booking.com is unchanged by every hotfix', () => {
  it('renders the same four main fields it always did', () => {
    mount(booking({ rooms: [ROOM] }));
    for (const label of ['Tên khách', 'Số điện thoại', 'Mã Booking', 'Tổng tiền']) {
      expect(screen.getByText(label), label).toBeInTheDocument();
    }
    expect(screen.getByText('PAY BEFORE CHECK-IN')).toBeInTheDocument();
  });

  it('still generates its PMS note', () => {
    mount(booking({ rooms: [ROOM] }));
    expect(screen.getByText(/Ghi chú tạo đơn/)).toBeInTheDocument();
  });
});

/* ================================================================== */
/* 5.2b — the Admin PMS note and the reviewed payment                  */
/* ================================================================== */
describe('5.2b Admin PMS note', () => {
  it('shows the stored note verbatim, over the lines the Admin typed', () => {
    mount(otaBooking('AGODA', null, { adminPmsNote: 'Nguyen Van A\nCa sáng' }));
    const card = screen.getByTestId('admin-pms-note-card');
    expect(card).toHaveTextContent('Người tạo PMS');
    expect(card).toHaveTextContent('Nguyen Van A');
    expect(card).toHaveTextContent('Ca sáng');
    // The generated note is replaced, not shown alongside.
    expect(screen.queryByText(/Ghi chú tạo đơn/)).toBeNull();
  });

  it('preserves the line break rather than collapsing name and shift', () => {
    mount(otaBooking('AGODA', null, { adminPmsNote: 'Nguyen Van A\nCa sáng' }));
    const paragraph = screen.getByTestId('admin-pms-note-card').querySelector('p:last-of-type');
    expect(paragraph?.className).toContain('whitespace-pre-wrap');
  });

  it('keeps the generated note for Booking.com, which collects none', () => {
    // Its dispatch deliberately does not ask for a note; removing the note it
    // has today would take away the text reception copies for every booking.
    mount(booking({ rooms: [ROOM], adminPmsNote: null }));
    expect(screen.getByText(/Ghi chú tạo đơn/)).toBeInTheDocument();
    expect(screen.queryByTestId('admin-pms-note-card')).toBeNull();
  });
});

describe('5.2b reviewed payment', () => {
  it('shows the mode the Admin reviewed, not the mail wording', () => {
    mount(otaBooking('AGODA', 'Pay at Hotel', { reviewedPaymentMode: 'CN' }));
    expect(screen.getByText('CN')).toBeInTheDocument();
    expect(screen.queryByText('Pay at Hotel')).toBeNull();
  });

  it('shows the reviewed mode for CTrip, which used to show nothing', () => {
    mount(otaBooking('CTRIP', null, { reviewedPaymentMode: 'HOTEL_PAYMENT' }));
    expect(screen.getByText('THANH TOÁN KHÁCH SẠN')).toBeInTheDocument();
  });

  it('falls back to the mail wording for a booking dispatched before 5.2b', () => {
    mount(otaBooking('AGODA', 'CN', { reviewedPaymentMode: null }));
    expect(screen.getByText('CN')).toBeInTheDocument();
  });

  it('still shows nothing when neither exists', () => {
    mount(otaBooking('CTRIP', null, { reviewedPaymentMode: null }));
    expect(screen.queryByText('Thanh toán')).toBeNull();
  });

  it('leaves Booking.com on its own badge', () => {
    mount(booking({ paymentStatus: 'PAY_BEFORE', reviewedPaymentMode: null }));
    expect(screen.getByText('PAY BEFORE CHECK-IN')).toBeInTheDocument();
  });
});

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CalendarCheck2, ClipboardList, StickyNote } from 'lucide-react';
import {
  type BookingDetail,
  type OperationalRecord,
  type RequestAuditView,
  type RoomView,
} from '../api/bookings';
import { buildPmsNote } from '../lib/pmsNote';
import { formatAmountCopy, formatDate, formatDateTime, formatMoney } from '../lib/format';
import { Card } from './Card';
import { CopyButton, CopyField } from './CopyButton';
import { LastMinuteBadge, PaymentBadge, SourceBadge, WorkflowBadge } from './Badges';
import { Section } from './Section';
import { DeleteBookingButton } from './DeleteBookingButton';
import { ProofSection } from './ProofSection';
import { Toast } from './Toast';

const MISSING_PHONE = '(Hiển thị số điện thoại)';

/** How the reviewed payment mode reads to an operator. Never translated further. */
const PAYMENT_MODE_LABEL: Record<string, string> = {
  CN: 'CN',
  HOTEL_PAYMENT: 'THANH TOÁN KHÁCH SẠN',
};

/** Booking.com is the only source that reliably supplies a guest phone. */
function hasPhoneSection(booking: BookingDetail): boolean {
  if (booking.sourcePlatform === 'BOOKING_COM') return true;
  return (booking.phone ?? '').trim().length > 0;
}

/**
 * The payment field, per source.
 *
 * H1 — the PAY BEFORE / PAY AFTER CHECK-IN wording belongs to Booking.com,
 * whose `paymentStatus` genuinely means that. Applying it to an OTA booking
 * stated something the mail never said.
 *
 * Agoda supplies its own wording ("CN", "Pay at Hotel", …) which the parser
 * already captured and dispatch already stored; it is shown VERBATIM, never
 * mapped onto the Booking.com vocabulary.
 *
 * CTrip supplies nothing — its parser extracts no payment value at all — so
 * the field is absent rather than filled with a guess. An invented payment
 * term is the kind of error a branch would act on.
 */
function PaymentField({ booking }: { booking: BookingDetail }) {
  if (booking.sourcePlatform === 'BOOKING_COM') {
    return (
      <div className="rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2.5">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Thanh toán</p>
        <div className="mt-1">
          <PaymentBadge status={booking.paymentStatus} />
        </div>
      </div>
    );
  }

  // The reviewed mode wins: it is what the Admin accepted and what the branch
  // was told. The mail's own wording is the fallback for bookings dispatched
  // before the reviewed value was persisted.
  const reviewed = (booking.reviewedPaymentMode ?? '').trim();
  const stated = (reviewed.length > 0 ? PAYMENT_MODE_LABEL[reviewed] ?? reviewed : booking.ota.paymentType ?? '').trim();
  if (stated.length === 0) return null;
  return <ReadField label="Thanh toán" value={stated} />;
}

/** A compact read-only labelled value (no copy button). */
function ReadField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2.5">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-0.5 break-words text-sm text-slate-900">{value}</p>
    </div>
  );
}

/**
 * The full operational detail — shared by the standalone detail page and the
 * receptionist master-detail panel. Copy controls are deliberately minimal:
 * four main fields, one nightly-price copy per room row, and the PMS note.
 * When `onCompleted` is provided the parent owns the success toast (pass
 * `suppressInternalToast`) so it survives the panel switching.
 *
 * A receptionist sees FIVE things and nothing else: the summary, the main
 * information, the PMS note, the nightly rates and the proof upload (plus an
 * extraction warning when the parser flagged one, which is a thing to act on
 * rather than a record to read). Everything a colleague might find interesting
 * but nobody acts on — what the OTA said, the edit history, the activity log —
 * is gone from this file entirely, not hidden behind a role check.
 */
export function BookingDetailView({
  booking: b,
  isAdmin,
  onCompleted,
  suppressInternalToast = false,
}: {
  booking: BookingDetail;
  isAdmin: boolean;
  onCompleted?: (message?: string) => void;
  suppressInternalToast?: boolean;
}) {
  const queryClient = useQueryClient();
  const [toast, setToast] = useState<string | null>(null);
  const showPhone = hasPhoneSection(b);

  function refetchAll() {
    void queryClient.invalidateQueries({ queryKey: ['booking', b.id] });
    void queryClient.invalidateQueries({ queryKey: ['bookings'] });
    void queryClient.invalidateQueries({ queryKey: ['notifications'] });
  }

  // After a proof action (submit / approve / reject) refresh data and surface a
  // toast. The parent owns the toast in the master-detail inbox so it survives
  // the panel switching to the next booking.
  function handleProofChanged(message: string) {
    refetchAll();
    if (suppressInternalToast) onCompleted?.(message);
    else setToast(message);
  }

  return (
    <div className="space-y-5">
      {/*
        Sticky summary. On a long detail page the operator scrolls into the
        nightly rates or the timeline and loses which guest they are looking at
        — and on a phone that is most of the page. The identity and the status
        stay in view; nothing else is pinned, so the sticky strip cannot grow
        tall enough to eat a small screen.
      */}
      <Card
        className={`sticky top-0 z-10 p-5 ${b.isLastMinute ? 'border-red-200 bg-red-50/95' : 'bg-white/95'} backdrop-blur`}
        data-testid="booking-sticky-header"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {/*
              ONE workflow chip. Four at once left a receptionist working out
              which of them meant "what do I do with this"; there is only ever
              one answer. The Admin keeps the source and business-type detail
              further down the page, where it is an audit concern rather than
              something to act on.
            */}
            <div className="flex flex-wrap items-center gap-2">
              {b.isLastMinute ? <LastMinuteBadge withSubtitle /> : null}
              <WorkflowBadge status={b.verificationStatus} />
              {isAdmin ? <SourceBadge source={b.sourcePlatform} /> : null}
            </div>
            <h1 className="mt-2 truncate text-xl font-semibold text-slate-900">
              {b.customerName ?? 'Khách chưa rõ'}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-700">
              <span className="inline-flex items-center gap-1.5 font-medium">
                <CalendarCheck2 className="h-4 w-4 text-brand-600" aria-hidden="true" />
                Nhận phòng: <span className="font-semibold text-slate-900">{formatDate(b.checkInDate)}</span>
              </span>
              <span className="font-mono text-slate-500">{b.bookingCode ?? '—'}</span>
            </div>
          </div>
        </div>
      </Card>

      {/* Main copyable fields (only the four operational essentials) */}
      <Card className="p-5">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700">
          <ClipboardList className="h-4 w-4 text-brand-600" aria-hidden="true" />
          Thông tin chính
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <CopyField label="Tên khách" value={b.customerName} />
          {/*
            H2 — Agoda and CTrip rarely supply a guest phone. Showing an empty
            field or a placeholder invites a receptionist to hunt for a number
            that was never sent, so for an OTA booking the field is absent
            entirely. Booking.com keeps its placeholder: there the number is
            expected and its absence is worth noticing.
          */}
          {showPhone ? (
            <CopyField
              label="Số điện thoại"
              value={b.phone ?? MISSING_PHONE}
              copyValue={b.phone ?? MISSING_PHONE}
              mono
            />
          ) : null}
          <CopyField label="Mã Booking" value={b.bookingCode} mono />
          <CopyField label="Tổng tiền" value={formatMoney(b.totalAmount, b.currency)} copyValue={formatAmountCopy(b.totalAmount)} />
        </div>

        {/* Supporting read-only fields (no copy buttons) */}
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {/*
            Branch is ADMIN-only. A receptionist is standing in the hotel the
            booking was sent to, so naming it tells them something they used to
            get here. An Admin dispatches across eight branches and does need to
            see which one received it. Branch FILTERING and permissions are
            untouched — only this line went.
          */}
          {isAdmin ? <ReadField label="Chi nhánh" value={b.branch?.address ?? '—'} /> : null}
          <PaymentField booking={b} />
          <ReadField label="Check-in" value={formatDate(b.checkInDate)} />
          <ReadField label="Check-out" value={formatDate(b.checkOutDate)} />
        </div>
        {b.specialRequest ? (
          <div className="mt-3">
            <ReadField label="Ghi chú / Yêu cầu đặc biệt" value={b.specialRequest} />
          </div>
        ) : null}
      </Card>

      <PmsNoteCard booking={b} />

      {/*
        H5/H10 — rooms and nightly rates are never collapsed. A receptionist
        types these figures into the PMS; hiding them behind a disclosure adds
        a click to every booking and invites transcribing from memory. Absent
        entirely when there are no rooms, rather than an empty container.
      */}
      {b.rooms.length > 0 ? (
        <Card className="p-5" data-testid="rooms-section">
          <p className="mb-3 text-sm font-semibold text-slate-700">
            Phòng &amp; giá từng đêm ({b.rooms.length})
          </p>
          <div className="space-y-3">
            {b.rooms.map((room) => (
              <RoomCard key={room.id} room={room} />
            ))}
          </div>
        </Card>
      ) : null}

      {/* Warnings (never for a missing phone — that is not a blocking condition) */}
      {b.warnings.length > 0 ? (
        <Card className="border-amber-200 bg-amber-50/50 p-5">
          <p className="mb-2 text-sm font-semibold text-amber-800">Cảnh báo trích xuất</p>
          <ul className="list-inside list-disc space-y-1 text-sm text-amber-700">
            {b.warnings.map((w, i) => (
              <li key={`${w.code}-${i}`}>{w.message}</li>
            ))}
          </ul>
        </Card>
      ) : null}

      {/*
        What actually happened during the stay. ADMIN-only, and the last of the
        record-keeping cards: the edit history and the activity log that used to
        sit beside it were removed in 5.2d for both roles, because nobody in the
        pilot reads a booking's history off the booking. The backend audit is
        untouched and still records everything.
      */}
      {isAdmin ? <OperationalCard record={b.operational} /> : null}

      {/* Proof-of-creation workflow (upload / review / verdict) */}
      <ProofSection booking={b} isAdmin={isAdmin} onChanged={handleProofChanged} />

      {/* Admin-only meta */}
      {isAdmin ? (
        <Card className="p-5">
          <p className="mb-2 text-sm font-semibold text-slate-700">Thông tin điều phối (Admin)</p>
          <div className="grid gap-2 text-sm text-slate-600 sm:grid-cols-2">
            <span>Gửi lúc (sentAt): {formatDateTime(b.sentAt)} {b.sentBy ? `· ${b.sentBy.fullName}` : ''}</span>
            <span>Xác nhận lúc (completedAt): {formatDateTime(b.completedAt)} {b.completedBy ? `· ${b.completedBy.fullName}` : ''}</span>
            <span>Tạo lúc: {formatDateTime(b.createdAt)}</span>
            <span>Phiên bản trích xuất: {b.parserVersion ?? '—'}</span>
          </div>
          {b.requestAudit ? <RequestAuditBlock audit={b.requestAudit} /> : null}
          {b.rawText ? (
            <details className="mt-3">
              <summary className="cursor-pointer text-sm font-medium text-brand-600">Xem nội dung Booking.com gốc</summary>
              <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-xs text-slate-600">{b.rawText}</pre>
            </details>
          ) : null}
        </Card>
      ) : null}

      {isAdmin ? (
        <div className="flex justify-end">
          <DeleteBookingButton bookingId={b.id} guestName={b.customerName} isAdmin={isAdmin} />
        </div>
      ) : null}

      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  );
}

/**
 * The real stay, as it happened.
 *
 * Hidden until the first operational event exists, so a booking that has only
 * been dispatched does not display a column of empty promises.
 */
function OperationalCard({ record }: { record: OperationalRecord }) {
  const rows = [
    { label: 'Đã nhận đơn', at: record.receivedAt, by: record.receivedBy },
    { label: 'Khách nhận phòng thực tế', at: record.actualCheckInAt, by: record.checkedInBy },
    { label: 'Khách trả phòng thực tế', at: record.actualCheckOutAt, by: record.checkedOutBy },
    { label: 'Đã huỷ', at: record.cancelledAt, by: record.cancelledBy },
  ].filter((r) => r.at !== null);
  if (rows.length === 0) return null;
  return (
    <Section id="operational" title="Diễn biến thực tế" count={rows.length} testId="operational-card">
      <div className="grid gap-3 sm:grid-cols-2">
        {rows.map((r) => (
          <ReadField
            key={r.label}
            label={r.label}
            value={`${formatDateTime(r.at)}${r.by ? ` · ${r.by.fullName}` : ''}`}
          />
        ))}
      </div>
      {record.cancellationReason ? (
        <div className="mt-3">
          <ReadField label="Lý do huỷ" value={record.cancellationReason} />
        </div>
      ) : null}
    </Section>
  );
}

/**
 * Request provenance, inside the Admin card. Never rendered for a receptionist
 * — the server does not send it, so there is nothing to hide in the client.
 */
function RequestAuditBlock({ audit }: { audit: RequestAuditView }) {
  return (
    <div className="mt-3 border-t border-slate-100 pt-3" data-testid="request-audit">
      <div className="grid gap-2 text-sm text-slate-600 sm:grid-cols-2">
        <span>Parser commit: <span className="font-mono text-xs">{audit.parserCommit ?? '—'}</span></span>
        <span>Build ID: <span className="font-mono text-xs">{audit.reviewBuildId ?? '—'}</span></span>
      </div>
      {audit.requests.length > 0 ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-sm font-medium text-brand-600">
            Nguồn yêu cầu ({audit.requests.length})
          </summary>
          <ul className="mt-2 space-y-2 text-xs text-slate-600">
            {audit.requests.map((r) => (
              <li key={r.id} className="rounded-lg bg-slate-50 p-2 font-mono" data-testid="request-audit-row">
                <div>Request: {r.id}</div>
                <div>Correlation: {r.correlationId ?? '—'}</div>
                <div>Route: {r.route ?? '—'}</div>
                <div>IP: {r.ipAddress ?? '—'}</div>
                <div className="break-all">UA: {r.userAgent ?? '—'}</div>
                <div>Session: {r.sessionId ?? '—'}</div>
                <div>{formatDateTime(r.occurredAt)}</div>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

/**
 * THE PMS NOTE. One card, one meaning, on every screen.
 *
 * There used to be two cards fighting over the same heading: the note, and a
 * line naming whoever created the reservation. The name is gone — what a
 * receptionist transfers into the hotel system is this text.
 *
 * WHERE THE TEXT COMES FROM, and why it differs by source:
 *
 *   Agoda / CTrip — the note is STORED. It was generated once, at dispatch,
 *   from the review the Admin approved, and it is shown back exactly as stored.
 *   It is never rebuilt here, and it could not be: its second line carries the
 *   price the GUEST booked at, which is not a column on the booking. A screen
 *   that re-derived this note would have to invent that number, and a
 *   receptionist pastes it into the PMS as fact.
 *
 *   Booking.com — no note is stored, and none ever was. Its note is generated
 *   from the booking's own fields by a builder that has been operational since
 *   before the OTA path existed. That is left exactly as it is.
 *
 * An OTA booking dispatched before the note was stored has neither, and says
 * so. It used to fall through to the Booking.com builder, which printed "PAY
 * BEFORE CHECK-IN" on an Agoda reservation — wording that source never uses.
 *
 * Rendered in a `pre` so uppercase, spacing and line breaks survive intact:
 * the note is a string contract with the hotel system, not prose.
 */
function PmsNoteCard({ booking }: { booking: BookingDetail }) {
  const stored = booking.adminPmsNote?.trim();
  const generated = booking.sourcePlatform === 'BOOKING_COM' ? buildPmsNote(booking) : null;
  const text = stored && stored.length > 0 ? stored : generated?.ok ? generated.text ?? null : null;
  const error = text
    ? null
    : generated?.error ?? 'Đơn này được gửi trước khi hệ thống lưu ghi chú PMS.';

  return (
    <Card className="p-5" data-testid="pms-note-card">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <StickyNote className="h-4 w-4 text-brand-600" aria-hidden="true" />
          PMS NOTE
        </div>
        {/*
          Copied whole rather than retyped — retyping is where a digit goes
          missing, and every figure on this note is one a guest is charged for.
        */}
        {text ? (
          <CopyButton
            value={text}
            label="Sao chép PMS Note"
            text="Sao chép"
            className="border-brand-200 bg-brand-50 text-brand-700 hover:bg-brand-100"
          />
        ) : null}
      </div>
      {text ? (
        <pre
          data-testid="pms-note-text"
          className="whitespace-pre-wrap break-words rounded-xl bg-slate-50 px-3 py-3 font-mono text-sm text-slate-800"
        >
          {text}
        </pre>
      ) : (
        <p className="rounded-xl bg-amber-50 px-3 py-2.5 text-sm text-amber-800">{error}</p>
      )}
    </Card>
  );
}

function RoomCard({ room }: { room: RoomView }) {
  const nights = room.nights.length;
  return (
    <Card className="p-5">
      <div className="mb-3">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
          Phòng {room.roomIndex} · {nights} đêm
        </p>
        <p className="text-base font-semibold text-slate-900">{room.roomType ?? '(chưa rõ loại phòng)'}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs font-medium uppercase tracking-wide text-slate-400">
              <th className="py-1.5 pr-4">Đêm</th>
              <th className="py-1.5 pr-4">Giá</th>
              <th className="py-1.5 pr-4" />
            </tr>
          </thead>
          <tbody>
            {room.nights.map((n) => {
              const missing = n.amount === null;
              return (
                <tr key={n.id} className="border-t border-slate-100">
                  <td className="py-1.5 pr-4 text-slate-700">{formatDate(n.stayDate)}</td>
                  <td className="py-1.5 pr-4 text-slate-900">
                    {missing ? <span className="text-amber-600">Chưa xác định</span> : formatMoney(n.amount, n.currency)}
                    {n.manuallyCorrected ? <span className="ml-2 text-xs text-slate-400">(sửa tay)</span> : null}
                  </td>
                  <td className="py-1.5 pr-4">
                    <CopyButton
                      value={formatAmountCopy(n.amount)}
                      text="Sao chép giá"
                      label={`Sao chép giá đêm ${formatDate(n.stayDate)}`}
                      disabled={missing}
                      disabledReason="Chưa có giá để sao chép"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {room.roomSubtotal != null ? (
        <div className="mt-3 text-sm text-slate-600">
          Tạm tính: <strong className="text-slate-900">{formatMoney(room.roomSubtotal)}</strong>
        </div>
      ) : null}
    </Card>
  );
}

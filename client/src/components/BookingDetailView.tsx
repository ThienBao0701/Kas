import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CalendarCheck2, ClipboardList, StickyNote } from 'lucide-react';
import {
  type BookingDetail,
  type CorrectionEntry,
  type OperationalRecord,
  type OtaMetadata,
  type RequestAuditView,
  type RoomView,
  type TimelineEvent,
} from '../api/bookings';
import { buildPmsNote } from '../lib/pmsNote';
import { formatAmountCopy, formatDate, formatDateTime, formatMoney } from '../lib/format';
import { Card } from './Card';
import { CopyButton, CopyField } from './CopyButton';
import { BusinessTypeBadge, LastMinuteBadge, PaymentBadge, SourceBadge, StatusBadge, VerificationBadge } from './Badges';
import { Section } from './Section';
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
 * four main fields, one nightly-price copy per room row, and the generated
 * "Ghi chú tạo đơn". When `onCompleted` is provided the parent owns the success
 * toast (pass `suppressInternalToast`) so it survives the panel switching.
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
            <div className="flex flex-wrap items-center gap-2">
              {b.isLastMinute ? <LastMinuteBadge withSubtitle /> : null}
              <StatusBadge status={b.status} />
              <VerificationBadge status={b.verificationStatus} />
              <SourceBadge source={b.sourcePlatform} />
              <BusinessTypeBadge type={b.businessType} />
            </div>
            <h1 className="mt-2 truncate text-xl font-semibold text-slate-900">
              {b.customerName ?? 'Khách chưa rõ'}
            </h1>
            <p className="text-sm text-slate-500">{b.branch ? b.branch.address : b.hotelName ?? '—'}</p>
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
          <ReadField label="Chi nhánh" value={b.branch?.address ?? '—'} />
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

      {/* Generated PMS note */}
      {/*
        Who created the reservation in the hotel's PMS.

        For an OTA booking this is the note the Admin TYPED at dispatch, shown
        verbatim and never generated — a receptionist who finds something wrong
        needs a person to ask, and a machine-written line answers a different
        question. Booking.com keeps its generated note: its dispatch does not
        collect one, and removing the note it has today would take away the text
        reception copies for every reservation.
      */}
      {b.adminPmsNote ? <AdminPmsNoteCard note={b.adminPmsNote} /> : <PmsNoteCard booking={b} />}

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

      {/* What the OTA said. Empty for a Booking.com booking, which stores none. */}
      <OtaMetadataCard ota={b.ota} />

      {/*
        H8 — operational history, corrections and the timeline are ADMIN tools.
        A receptionist acts on the reservation in front of them; the record of
        how it got there is an audit concern and only adds noise to the screen
        they work from. The server already withholds request provenance from
        them; this withholds the rest of the developer-facing record.
      */}
      {isAdmin ? (
        <>
          <OperationalCard record={b.operational} />
          <CorrectionsCard corrections={b.corrections} />
          <TimelineCard events={b.timeline} />
        </>
      ) : null}

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

      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  );
}

/**
 * Shown in the OTA card. Payment is deliberately ABSENT: it has its own field
 * in the main information block, and repeating it there would show the same
 * value twice on one screen.
 */
const OTA_FIELDS: { key: keyof OtaMetadata; label: string }[] = [
  { key: 'otaBookingStatus', label: 'Trạng thái trên OTA' },
  { key: 'ratePlanName', label: 'Gói giá' },
  { key: 'cancellationPolicy', label: 'Chính sách huỷ' },
  { key: 'benefitsIncluded', label: 'Ưu đãi kèm theo' },
  { key: 'countryOfResidence', label: 'Quốc gia cư trú' },
  { key: 'websiteLanguage', label: 'Ngôn ngữ đặt phòng' },
  { key: 'sourcePropertyId', label: 'Property ID (chỉ để đối chiếu)' },
];

/**
 * What the OTA said, verbatim.
 *
 * Rendered only when something was actually stored — a Booking.com booking has
 * none of these columns filled, and eight "—" rows would suggest data was lost
 * rather than never sent. Property ID is labelled as reference-only because it
 * never participates in branch resolution.
 */
function OtaMetadataCard({ ota }: { ota: OtaMetadata }) {
  const present = OTA_FIELDS.filter((f) => ota[f.key] !== null && ota[f.key] !== '');
  if (present.length === 0) return null;
  return (
    <Section id="ota" title="Thông tin từ OTA" count={present.length} testId="ota-metadata-card">
      <div className="grid gap-3 sm:grid-cols-2">
        {present.map((f) => (
          <ReadField key={f.key} label={f.label} value={String(ota[f.key])} />
        ))}
      </div>
    </Section>
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
 * Every applied amendment, oldest first.
 *
 * No reason column is shown because none is stored; the request that made the
 * change is the provenance, and that is Admin-only.
 */
function CorrectionsCard({ corrections }: { corrections: CorrectionEntry[] }) {
  if (corrections.length === 0) return null;
  return (
    <Section
      id="corrections"
      title="Lịch sử chỉnh sửa"
      count={corrections.length}
      testId="corrections-card"
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[32rem] text-left text-sm">
          <thead>
            <tr className="text-xs uppercase tracking-wide text-slate-400">
              <th className="pb-2 pr-3 font-medium">Trường</th>
              <th className="pb-2 pr-3 font-medium">Giá trị cũ</th>
              <th className="pb-2 pr-3 font-medium">Giá trị mới</th>
              <th className="pb-2 font-medium">Thời điểm</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {corrections.map((c) => (
              <tr key={c.id} data-testid="correction-row">
                <td className="py-2 pr-3 font-medium text-slate-700">{c.field}</td>
                <td className="py-2 pr-3 text-slate-500 line-through">{c.oldValue ?? '—'}</td>
                <td className="py-2 pr-3 font-medium text-slate-900">{c.newValue ?? '—'}</td>
                <td className="py-2 text-slate-500">
                  {formatDateTime(c.appliedAt)}
                  {c.appliedBy ? ` · ${c.appliedBy.fullName}` : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

/** How many timeline events render before the operator asks for more. */
const TIMELINE_CHUNK = 20;

/**
 * Status changes, proof reviews and amendments merged into one ordered story.
 *
 * Rendered incrementally. A booking amended a dozen times accumulates a long
 * tail of events that nobody reads, and mounting all of them costs the same
 * whether they are looked at or not. The order is never disturbed — the first
 * chunk is the oldest events, so "show more" extends the story forward rather
 * than reshuffling it.
 */
function TimelineCard({ events }: { events: TimelineEvent[] }) {
  const [limit, setLimit] = useState(TIMELINE_CHUNK);
  if (events.length === 0) return null;
  const shown = events.slice(0, limit);
  const remaining = events.length - shown.length;

  return (
    <Section id="timeline" title="Nhật ký" count={events.length} testId="timeline-card">
      <ol className="space-y-3">
        {shown.map((e, i) => (
          <li key={`${e.at}-${e.type}-${i}`} className="flex gap-3" data-testid="timeline-event">
            <div className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-600" aria-hidden="true" />
            <div className="min-w-0">
              <p className="break-words text-sm text-slate-900">{e.description}</p>
              <p className="text-xs text-slate-500">
                {formatDateTime(e.at)}
                {e.actor ? ` · ${e.actor.fullName}` : ''}
              </p>
            </div>
          </li>
        ))}
      </ol>
      {remaining > 0 ? (
        <button
          type="button"
          onClick={() => setLimit((n) => n + TIMELINE_CHUNK)}
          className="mt-3 min-h-[2.75rem] rounded-xl border border-slate-300 px-4 text-sm font-medium text-slate-600 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
          data-testid="timeline-show-more"
        >
          Xem thêm {remaining} sự kiện
        </button>
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

/** The "Ghi chú tạo đơn" card: a generated, ready-to-paste note with one copy button. */
/**
 * The Admin's PMS creator note, exactly as typed.
 *
 * Rendered with `whitespace-pre-wrap` because operators write it over two
 * lines — a name and a shift — and collapsing that into one would lose the
 * distinction they deliberately made.
 */
function AdminPmsNoteCard({ note }: { note: string }) {
  return (
    <Card className="p-5" data-testid="admin-pms-note-card">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700">
        <StickyNote className="h-4 w-4 text-brand-600" aria-hidden="true" />
        Người tạo PMS
      </div>
      <p className="whitespace-pre-wrap break-words text-sm text-slate-900">{note}</p>
    </Card>
  );
}

function PmsNoteCard({ booking }: { booking: BookingDetail }) {
  const result = buildPmsNote(booking);
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <StickyNote className="h-4 w-4 text-brand-600" aria-hidden="true" />
          Ghi chú tạo đơn
        </div>
        {result.ok && result.text ? (
          <CopyButton
            value={result.text}
            label="Sao chép ghi chú"
            text="Sao chép ghi chú"
            className="border-brand-200 bg-brand-50 text-brand-700 hover:bg-brand-100"
          />
        ) : null}
      </div>
      {result.ok && result.text ? (
        <pre className="whitespace-pre-wrap rounded-xl bg-slate-50 px-3 py-3 font-mono text-sm text-slate-800">
          {result.text}
        </pre>
      ) : (
        <p className="rounded-xl bg-amber-50 px-3 py-2.5 text-sm text-amber-800">{result.error}</p>
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

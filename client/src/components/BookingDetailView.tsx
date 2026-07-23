import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarCheck2, CheckCircle2, ClipboardList, StickyNote } from 'lucide-react';
import { bookingsApi, type BookingDetail, type RoomView } from '../api/bookings';
import { ApiError, toUserMessage } from '../api/errors';
import { buildPmsNote } from '../lib/pmsNote';
import { formatAmountCopy, formatDate, formatDateTime, formatMoney, paymentLabel } from '../lib/format';
import { Card } from './Card';
import { Button } from './Button';
import { Modal } from './Modal';
import { ErrorAlert } from './ErrorAlert';
import { CopyButton, CopyField } from './CopyButton';
import { LastMinuteBadge, StatusBadge } from './Badges';
import { Toast } from './Toast';

const MISSING_PHONE = '(Hiển thị số điện thoại)';

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
  onCompleted?: () => void;
  suppressInternalToast?: boolean;
}) {
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [note, setNote] = useState('');
  const [toast, setToast] = useState<string | null>(null);

  const complete = useMutation({
    mutationFn: () => bookingsApi.complete(b.id, note.trim() || undefined),
    onSuccess: () => {
      setConfirmOpen(false);
      if (!suppressInternalToast) setToast('Đã xác nhận booking đã tạo trên hệ thống khách sạn.');
      refetchAll();
      onCompleted?.();
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'BOOKING_ALREADY_COMPLETED') {
        setConfirmOpen(false);
        refetchAll();
      }
    },
  });

  function refetchAll() {
    void queryClient.invalidateQueries({ queryKey: ['booking', b.id] });
    void queryClient.invalidateQueries({ queryKey: ['bookings'] });
    void queryClient.invalidateQueries({ queryKey: ['notifications'] });
  }

  const alreadyCompleted =
    complete.error instanceof ApiError && complete.error.code === 'BOOKING_ALREADY_COMPLETED';

  return (
    <div className="space-y-5">
      {/* Top summary */}
      <Card className={`p-5 ${b.isLastMinute ? 'border-red-200 bg-red-50/40' : ''}`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              {b.isLastMinute ? <LastMinuteBadge withSubtitle /> : null}
              <StatusBadge status={b.status} />
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
          <CopyField label="Số điện thoại" value={b.phone ?? MISSING_PHONE} copyValue={b.phone ?? MISSING_PHONE} mono />
          <CopyField label="Mã Booking" value={b.bookingCode} mono />
          <CopyField label="Tổng tiền" value={formatMoney(b.totalAmount, b.currency)} copyValue={formatAmountCopy(b.totalAmount)} />
        </div>

        {/* Supporting read-only fields (no copy buttons) */}
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <ReadField label="Chi nhánh" value={b.branch?.address ?? '—'} />
          <ReadField label="Thanh toán" value={paymentLabel(b.paymentStatus)} />
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
      <PmsNoteCard booking={b} />

      {/* Rooms */}
      <div className="space-y-3">
        {b.rooms.map((room) => (
          <RoomCard key={room.id} room={room} />
        ))}
      </div>

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

      {/* Confirmation */}
      {b.status === 'NEW' ? (
        <Card className="border-brand-200 bg-brand-50/40 p-5">
          <p className="text-sm font-medium text-slate-700">Xác nhận đã tạo</p>
          <p className="mt-1 text-sm text-slate-600">
            Sau khi đã tạo booking trên hệ thống khách sạn, hãy xác nhận tại đây.
          </p>
          {complete.isError && !alreadyCompleted ? (
            <div className="mt-3">
              <ErrorAlert>{toUserMessage(complete.error)}</ErrorAlert>
            </div>
          ) : null}
          {alreadyCompleted ? (
            <div className="mt-3">
              <ErrorAlert>Đơn này đã được xác nhận trước đó. Trạng thái đã được cập nhật.</ErrorAlert>
            </div>
          ) : null}
          <div className="mt-4">
            <Button onClick={() => setConfirmOpen(true)}>
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              Xác nhận đã tạo
            </Button>
          </div>
        </Card>
      ) : b.status === 'COMPLETED' ? (
        <Card className="border-green-200 bg-green-50/50 p-5">
          <div className="flex items-center gap-2 text-green-700">
            <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
            <span className="text-sm font-semibold">Đã xác nhận tạo</span>
          </div>
          <p className="mt-2 text-sm text-slate-600">
            {b.completedBy ? `Bởi ${b.completedBy.fullName} · ` : ''}
            {formatDateTime(b.completedAt)}
          </p>
          {b.completionNote ? <p className="mt-1 text-sm text-slate-500">Ghi chú: {b.completionNote}</p> : null}
          {/*
            Future milestone (Admin proof comparison): a modular "Ảnh lễ tân gửi"
            section will render here beside the confirmation details. Left as a
            structural slot only — no upload UI in this frontend-only phase.
          */}
        </Card>
      ) : null}

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
          {b.rawText ? (
            <details className="mt-3">
              <summary className="cursor-pointer text-sm font-medium text-brand-600">Xem nội dung Booking.com gốc</summary>
              <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-xs text-slate-600">{b.rawText}</pre>
            </details>
          ) : null}
        </Card>
      ) : null}

      <Modal
        open={confirmOpen}
        title="Xác nhận đã tạo"
        onClose={() => setConfirmOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmOpen(false)}>
              Hủy
            </Button>
            <Button onClick={() => complete.mutate()} loading={complete.isPending} disabled={complete.isPending}>
              Xác nhận đã tạo
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">
          Bạn xác nhận booking này đã được tạo thành công trên hệ thống khách sạn?
        </p>
        <dl className="mt-4 space-y-1.5 rounded-xl bg-slate-50 px-3 py-3 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-slate-500">Tên khách</dt>
            <dd className="font-medium text-slate-900">{b.customerName ?? '—'}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-slate-500">Mã Booking</dt>
            <dd className="font-mono font-medium text-slate-900">{b.bookingCode ?? '—'}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-slate-500">Chi nhánh</dt>
            <dd className="text-right font-medium text-slate-900">{b.branch?.address ?? '—'}</dd>
          </div>
        </dl>
        <label className="mt-4 block text-sm font-medium text-slate-600">
          Ghi chú (không bắt buộc)
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
            placeholder="Ví dụ: đã tạo trên hệ thống, mã nội bộ…"
          />
        </label>
      </Modal>

      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  );
}

/** The "Ghi chú tạo đơn" card: a generated, ready-to-paste note with one copy button. */
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

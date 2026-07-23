import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ClipboardList } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { bookingsApi, type BookingDetail } from '../api/bookings';
import { ApiError, toUserMessage } from '../api/errors';
import { buildCopyAll, copyMoney, copyPhone, roomBlock, roomNightsText } from '../lib/copyText';
import { formatDate, formatDateTime, formatMoney, formatViWeekdayDate, nightCount, paymentLabel } from '../lib/format';
import { Card } from './Card';
import { Button } from './Button';
import { Modal } from './Modal';
import { ErrorAlert } from './ErrorAlert';
import { CopyButton, CopyField } from './CopyButton';
import { LastMinuteBadge, StatusBadge } from './Badges';
import { useToast } from './Toast';

/**
 * The shared, copy-optimised booking detail. Used both by the standalone detail
 * route and by the receptionist master-detail inbox, so the confirmation flow
 * lives in one place.
 */
export function BookingDetailView({ booking: b, onConfirmed }: { booking: BookingDetail; onConfirmed?: () => void }) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [note, setNote] = useState('');

  const refetchAll = () => {
    void queryClient.invalidateQueries({ queryKey: ['booking', b.id] });
    void queryClient.invalidateQueries({ queryKey: ['bookings'] });
    void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const complete = useMutation({
    mutationFn: () => bookingsApi.complete(b.id, note.trim() || undefined),
    onSuccess: () => {
      setConfirmOpen(false);
      toast('Đã xác nhận tạo thành công.', 'success');
      refetchAll();
      onConfirmed?.();
    },
    onError: (err) => {
      // Someone else may have confirmed it first — refresh to show who/when.
      if (err instanceof ApiError && (err.code === 'BOOKING_ALREADY_COMPLETED' || err.code === 'CONFLICT')) {
        setConfirmOpen(false);
        toast('Đơn đã được xác nhận trước đó. Đang cập nhật…', 'info');
        refetchAll();
      }
    },
  });

  const nights = nightCount(b.checkInDate, b.checkOutDate);

  return (
    <div className="space-y-5">
      {/* Header + COPY ALL */}
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              {b.isLastMinute ? <LastMinuteBadge /> : null}
              <StatusBadge status={b.status} />
            </div>
            <h2 className="mt-2 text-xl font-semibold text-slate-900">{b.customerName ?? 'Khách chưa rõ'}</h2>
            <p className="text-sm text-slate-500">
              {b.hotelName ?? '—'}
              {b.branch ? ` · ${b.branch.address}` : ''}
            </p>
          </div>
          <CopyButton
            value={buildCopyAll(b)}
            label="Sao chép toàn bộ"
            className="border-brand-300 bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-700"
          />
        </div>
      </Card>

      {/* Individual copyable fields */}
      <Card className="p-5">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700">
          <ClipboardList className="h-4 w-4 text-brand-600" aria-hidden="true" />
          Thông tin để sao chép
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <CopyField label="Chi nhánh" value={b.branch ? b.branch.address : null} />
          <CopyField label="Tên khách" value={b.customerName} />
          <CopyField label="Số điện thoại" value={copyPhone(b.phone)} mono />
          <CopyField label="Mã Booking" value={b.bookingCode} mono />
          <CopyField label="Check-in" value={formatViWeekdayDate(b.checkInDate)} copyValue={formatViWeekdayDate(b.checkInDate)} />
          <CopyField label="Check-out" value={formatViWeekdayDate(b.checkOutDate)} copyValue={formatViWeekdayDate(b.checkOutDate)} />
          <CopyField label="Số đêm" value={nights > 0 ? `${nights} đêm` : '—'} copyValue={String(nights)} />
          <CopyField label="Tổng tiền" value={copyMoney(b.totalAmount)} copyValue={b.totalAmount != null ? String(b.totalAmount) : ''} />
          <CopyField label="Thanh toán" value={paymentLabel(b.paymentStatus)} copyValue={paymentLabel(b.paymentStatus)} />
        </div>
        {b.specialRequest ? (
          <div className="mt-3">
            <CopyField label="Yêu cầu đặc biệt" value={b.specialRequest} />
          </div>
        ) : null}
      </Card>

      {/* Rooms with per-room copy controls */}
      <div className="space-y-3">
        {b.rooms.map((room, i) => (
          <Card key={room.id} className="p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Phòng {room.roomIndex}</p>
                <p className="text-base font-semibold text-slate-900">{room.roomType ?? '(chưa rõ loại phòng)'}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {room.roomType ? <CopyButton value={room.roomType} label={`Sao chép hạng phòng ${room.roomIndex}`} /> : null}
                <CopyButton value={roomNightsText(room)} label={`Sao chép giá đêm phòng ${room.roomIndex}`} />
                <CopyButton
                  value={roomBlock(room, i + 1)}
                  label={`Sao chép toàn bộ phòng ${room.roomIndex}`}
                  className="border-brand-200 bg-brand-50 text-brand-700 hover:bg-brand-100"
                />
              </div>
            </div>
            <table className="w-full text-sm">
              <tbody>
                {room.nights.map((n) => (
                  <tr key={n.id} className="border-t border-slate-100">
                    <td className="py-1.5 pr-4 text-slate-700">{formatDate(n.stayDate)}</td>
                    <td className="py-1.5 pr-4 text-slate-900">
                      {n.amount === null ? <span className="text-amber-600">Chưa xác định</span> : formatMoney(n.amount, n.currency)}
                      {n.manuallyCorrected ? <span className="ml-2 text-xs text-slate-400">(sửa tay)</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-slate-600">
              <span>
                Tạm tính: <strong className="text-slate-900">{formatMoney(room.roomSubtotal)}</strong>
              </span>
              {room.roomSubtotal != null ? <CopyButton value={copyMoney(room.roomSubtotal)} label={`Sao chép tạm tính phòng ${room.roomIndex}`} /> : null}
              {room.taxAmount != null ? <span>Thuế: {formatMoney(room.taxAmount)}</span> : null}
              {room.feeAmount != null ? <span>Phí: {formatMoney(room.feeAmount)}</span> : null}
            </div>
          </Card>
        ))}
      </div>

      {/* Warnings */}
      {b.warnings.length > 0 ? (
        <Card className="p-5">
          <p className="mb-2 text-sm font-semibold text-amber-700">Cảnh báo trích xuất</p>
          <ul className="list-inside list-disc space-y-1 text-sm text-slate-600">
            {b.warnings.map((w, i) => (
              <li key={`${w.code}-${i}`}>{w.message}</li>
            ))}
          </ul>
        </Card>
      ) : null}

      {/* Confirmation */}
      {b.status === 'NEW' ? (
        <Card className="sticky bottom-4 border-brand-200 bg-brand-50/50 p-5 shadow-sm">
          <p className="text-sm text-slate-600">Xác nhận booking đã được tạo thành công trên hệ thống khách sạn.</p>
          {complete.isError && !(complete.error instanceof ApiError && complete.error.code === 'BOOKING_ALREADY_COMPLETED') ? (
            <div className="mt-3">
              <ErrorAlert>{toUserMessage(complete.error)}</ErrorAlert>
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
        <Card className="border-green-200 bg-green-50/60 p-5">
          <div className="flex items-center gap-2 text-green-700">
            <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
            <span className="text-sm font-semibold">Đã xác nhận tạo</span>
          </div>
          <p className="mt-2 text-sm text-slate-600">
            {b.completedBy ? `Người xác nhận: ${b.completedBy.fullName}` : ''} · {formatDateTime(b.completedAt)}
          </p>
          {b.completionNote ? <p className="mt-1 text-sm text-slate-500">Ghi chú: {b.completionNote}</p> : null}
        </Card>
      ) : null}

      {/* Admin monitoring meta */}
      {isAdmin ? (
        <Card className="p-5">
          <p className="mb-2 text-sm font-semibold text-slate-700">Theo dõi (Admin)</p>
          <div className="grid gap-2 text-sm text-slate-600 sm:grid-cols-2">
            <span>Chi nhánh: {b.branch?.address ?? '—'}</span>
            <span>Trạng thái: {b.status === 'NEW' ? 'Chờ chi nhánh tạo' : b.status === 'COMPLETED' ? 'Đã xác nhận tạo' : b.status}</span>
            <span>Gửi lúc: {formatDateTime(b.sentAt)}</span>
            <span>Người gửi: {b.sentBy?.fullName ?? '—'}</span>
            <span>Xác nhận lúc: {formatDateTime(b.completedAt)}</span>
            <span>Người xác nhận: {b.completedBy?.fullName ?? '—'}</span>
          </div>
          {b.rawText ? (
            <details className="mt-3">
              <summary className="cursor-pointer text-sm font-medium text-brand-600">Xem nội dung Booking.com gốc</summary>
              <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-xs text-slate-600">{b.rawText}</pre>
            </details>
          ) : null}
        </Card>
      ) : null}

      {/* Confirmation modal */}
      <Modal
        open={confirmOpen}
        title="Xác nhận đã tạo"
        onClose={() => setConfirmOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmOpen(false)} disabled={complete.isPending}>
              Hủy
            </Button>
            <Button onClick={() => complete.mutate()} loading={complete.isPending} disabled={complete.isPending}>
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              Xác nhận đã tạo
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-700">Bạn xác nhận booking này đã được tạo thành công trên hệ thống khách sạn?</p>
        <dl className="mt-3 space-y-1 rounded-xl bg-slate-50 px-3 py-2.5 text-sm">
          <div className="flex justify-between gap-2"><dt className="text-slate-500">Khách</dt><dd className="font-medium text-slate-800">{b.customerName ?? '—'}</dd></div>
          <div className="flex justify-between gap-2"><dt className="text-slate-500">Mã Booking</dt><dd className="font-mono text-slate-800">{b.bookingCode ?? '—'}</dd></div>
          <div className="flex justify-between gap-2"><dt className="text-slate-500">Chi nhánh</dt><dd className="text-slate-800">{b.branch?.address ?? '—'}</dd></div>
        </dl>
        <label className="mt-4 block text-sm font-medium text-slate-600">
          Ghi chú (không bắt buộc)
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
            placeholder="Ví dụ: đã tạo trên hệ thống khách sạn, mã nội bộ…"
          />
        </label>
      </Modal>
    </div>
  );
}

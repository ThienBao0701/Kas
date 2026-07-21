import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarCheck2, CheckCircle2, ClipboardList } from 'lucide-react';
import { bookingsApi, type BookingDetail, type RoomView } from '../api/bookings';
import { ApiError, toUserMessage } from '../api/errors';
import {
  buildFullCopy,
  buildNightlyLines,
  buildRoomBlock,
  copyMoney,
  paymentCopyLabel,
} from '../lib/bookingCopy';
import { formatDate, formatDateTime, formatMoney, paymentLabel } from '../lib/format';
import { Card } from './Card';
import { Button } from './Button';
import { Modal } from './Modal';
import { ErrorAlert } from './ErrorAlert';
import { CopyButton, CopyField } from './CopyButton';
import { LastMinuteBadge, StatusBadge } from './Badges';
import { Toast } from './Toast';

/** The full operational detail, copy tools and confirmation — shared by the
 *  standalone detail page and the receptionist master-detail panel. */
export function BookingDetailView({
  booking: b,
  isAdmin,
  onCompleted,
}: {
  booking: BookingDetail;
  isAdmin: boolean;
  onCompleted?: () => void;
}) {
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [note, setNote] = useState('');
  const [toast, setToast] = useState<string | null>(null);

  const complete = useMutation({
    mutationFn: () => bookingsApi.complete(b.id, note.trim() || undefined),
    onSuccess: () => {
      setConfirmOpen(false);
      setToast('Đã xác nhận booking đã tạo trên hệ thống khách sạn.');
      refetchAll();
      onCompleted?.();
    },
    onError: (err) => {
      // Already confirmed elsewhere: close the dialog and refresh to the truth.
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
      {/* Header */}
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
            <p className="text-sm text-slate-500">
              {b.branch ? b.branch.address : b.hotelName ?? '—'}
            </p>
            <p className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-slate-700">
              <CalendarCheck2 className="h-4 w-4 text-brand-600" aria-hidden="true" />
              Nhận phòng: <span className="font-semibold text-slate-900">{formatDate(b.checkInDate)}</span>
              {b.sentAt ? <span className="text-slate-400">· gửi {formatDateTime(b.sentAt)}</span> : null}
            </p>
          </div>
          <CopyButton
            value={buildFullCopy(b)}
            label="Sao chép toàn bộ"
            className="border-brand-200 bg-brand-50 px-3 py-2 text-sm text-brand-700 hover:bg-brand-100"
          />
        </div>
      </Card>

      {/* Core copyable fields */}
      <Card className="p-5">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700">
          <ClipboardList className="h-4 w-4 text-brand-600" aria-hidden="true" />
          Thông tin để sao chép
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <CopyField label="Chi nhánh" value={b.branch?.address} />
          <CopyField label="Tên khách" value={b.customerName} />
          <CopyField label="Số điện thoại" value={b.phone ?? '(Hiển thị số điện thoại)'} copyValue={b.phone ?? '(Hiển thị số điện thoại)'} mono />
          <CopyField label="Mã Booking" value={b.bookingCode} mono />
          <CopyField label="Check-in" value={formatDate(b.checkInDate)} copyValue={b.checkInDate ?? ''} />
          <CopyField label="Check-out" value={formatDate(b.checkOutDate)} copyValue={b.checkOutDate ?? ''} />
          <CopyField label="Tổng tiền" value={formatMoney(b.totalAmount, b.currency)} copyValue={copyMoney(b.totalAmount)} />
          <CopyField label={paymentCopyLabel(b.paymentStatus)} value={paymentLabel(b.paymentStatus)} copyValue={paymentCopyLabel(b.paymentStatus)} />
        </div>
        <div className="mt-3">
          <CopyField label="Ghi chú / Yêu cầu đặc biệt" value={b.specialRequest ?? 'Không có'} copyValue={b.specialRequest ?? 'Không có'} />
        </div>
      </Card>

      {/* Rooms */}
      <div className="space-y-3">
        {b.rooms.map((room) => (
          <RoomCard key={room.id} room={room} />
        ))}
      </div>

      {/* Warnings */}
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

function RoomCard({ room }: { room: RoomView }) {
  const nightlyBlock = buildNightlyLines(room).join('\n');
  return (
    <Card className="p-5">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Phòng {room.roomIndex}</p>
          <p className="text-base font-semibold text-slate-900">{room.roomType ?? '(chưa rõ loại phòng)'}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <CopyButton value={room.roomType ?? 'Chưa xác định'} label={`Sao chép hạng phòng ${room.roomIndex}`} />
          {room.roomSubtotal != null ? (
            <CopyButton value={copyMoney(room.roomSubtotal)} label={`Sao chép tạm tính phòng ${room.roomIndex}`} />
          ) : null}
          <CopyButton value={nightlyBlock} label={`Sao chép giá từng đêm phòng ${room.roomIndex}`} />
          <CopyButton
            value={buildRoomBlock(room)}
            label={`Sao chép toàn bộ phòng ${room.roomIndex}`}
            className="border-brand-200 bg-brand-50 text-brand-700 hover:bg-brand-100"
          />
        </div>
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
            {room.nights.map((n) => (
              <tr key={n.id} className="border-t border-slate-100">
                <td className="py-1.5 pr-4 text-slate-700">{formatDate(n.stayDate)}</td>
                <td className="py-1.5 pr-4 text-slate-900">
                  {formatMoney(n.amount, n.currency)}
                  {n.amount === null ? <span className="ml-2 text-xs font-medium text-amber-600">Chưa xác định</span> : null}
                  {n.manuallyCorrected ? <span className="ml-2 text-xs text-slate-400">(sửa tay)</span> : null}
                </td>
                <td className="py-1.5 pr-4">
                  <CopyButton
                    value={`* Đêm ${formatDate(n.stayDate)}: ${copyMoney(n.amount)}`}
                    label={`Sao chép đêm ${formatDate(n.stayDate)}`}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap gap-4 text-sm text-slate-600">
        <span>Tạm tính: <strong className="text-slate-900">{formatMoney(room.roomSubtotal)}</strong></span>
        {room.taxAmount != null ? <span>Thuế: {formatMoney(room.taxAmount)}</span> : null}
        {room.feeAmount != null ? <span>Phí: {formatMoney(room.feeAmount)}</span> : null}
      </div>
    </Card>
  );
}

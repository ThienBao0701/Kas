import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, ClipboardList } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { bookingsApi, type BookingDetail, type RoomView } from '../api/bookings';
import { toUserMessage } from '../api/errors';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { Modal } from '../components/Modal';
import { ErrorAlert } from '../components/ErrorAlert';
import { CopyButton, CopyField } from '../components/CopyButton';
import { LastMinuteBadge, StatusBadge } from '../components/Badges';
import { InlineSpinner } from '../components/PageState';
import { formatDate, formatDateTime, formatMoney, nightCount, paymentLabel } from '../lib/format';

function roomToText(room: RoomView): string {
  const lines = [`Phòng ${room.roomIndex}: ${room.roomType ?? '(chưa rõ loại phòng)'}`];
  for (const n of room.nights) {
    lines.push(`  ${formatDate(n.stayDate)}: ${formatMoney(n.amount, n.currency)}`);
  }
  if (room.roomSubtotal != null) lines.push(`  Tạm tính: ${formatMoney(room.roomSubtotal)}`);
  if (room.taxAmount != null) lines.push(`  Thuế: ${formatMoney(room.taxAmount)}`);
  if (room.feeAmount != null) lines.push(`  Phí: ${formatMoney(room.feeAmount)}`);
  return lines.join('\n');
}

function bookingToText(b: BookingDetail): string {
  const lines = [
    `Khách sạn: ${b.hotelName ?? '—'}`,
    `Chi nhánh: ${b.branch ? `${b.branch.address} — ${b.branch.hotelName}` : '—'}`,
    `Mã đặt phòng: ${b.bookingCode ?? '—'}`,
    `Khách: ${b.customerName ?? '—'}`,
    `Điện thoại: ${b.phone ?? '—'}`,
    `Nhận phòng: ${formatDate(b.checkInDate)}${b.checkInTime ? ` ${b.checkInTime}` : ''}`,
    `Trả phòng: ${formatDate(b.checkOutDate)}${b.checkOutTime ? ` ${b.checkOutTime}` : ''}`,
    `Thanh toán: ${paymentLabel(b.paymentStatus)}`,
    `Tổng tiền: ${formatMoney(b.totalAmount, b.currency)}`,
  ];
  if (b.specialRequest) lines.push(`Ghi chú: ${b.specialRequest}`);
  lines.push('', ...b.rooms.map(roomToText));
  return lines.join('\n');
}

export function BookingDetailPage() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [note, setNote] = useState('');

  const query = useQuery({
    queryKey: ['booking', id],
    queryFn: () => bookingsApi.detail(id),
    enabled: id.length > 0,
  });

  const complete = useMutation({
    mutationFn: () => bookingsApi.complete(id, note.trim() || undefined),
    onSuccess: () => {
      setConfirmOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['booking', id] });
      void queryClient.invalidateQueries({ queryKey: ['bookings'] });
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  if (query.isLoading) return <InlineSpinner />;
  if (query.isError) {
    return (
      <div className="space-y-4">
        <BackLink />
        <ErrorAlert>{toUserMessage(query.error)}</ErrorAlert>
      </div>
    );
  }

  const b = query.data!.booking;
  const isAdmin = user?.role === 'ADMIN';
  const nights = nightCount(b.checkInDate, b.checkOutDate);

  return (
    <div className="space-y-5">
      <BackLink />

      {/* Header */}
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              {b.isLastMinute ? <LastMinuteBadge /> : null}
              <StatusBadge status={b.status} />
            </div>
            <h1 className="mt-2 text-xl font-semibold text-slate-900">{b.customerName ?? 'Khách chưa rõ'}</h1>
            <p className="text-sm text-slate-500">{b.hotelName ?? '—'}{b.branch ? ` · ${b.branch.address}` : ''}</p>
          </div>
          <CopyButton
            value={bookingToText(b)}
            label="Sao chép toàn bộ đơn"
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
          <CopyField label="Tên khách" value={b.customerName} />
          <CopyField label="Số điện thoại" value={b.phone} mono />
          <CopyField label="Mã đặt phòng" value={b.bookingCode} mono />
          <CopyField label="Thanh toán" value={paymentLabel(b.paymentStatus)} copyValue={paymentLabel(b.paymentStatus)} />
          <CopyField label="Nhận phòng" value={`${formatDate(b.checkInDate)}${b.checkInTime ? ` · ${b.checkInTime}` : ''}`} copyValue={formatDate(b.checkInDate)} />
          <CopyField label="Trả phòng" value={`${formatDate(b.checkOutDate)}${b.checkOutTime ? ` · ${b.checkOutTime}` : ''}`} copyValue={formatDate(b.checkOutDate)} />
          <CopyField label="Số đêm" value={nights > 0 ? `${nights} đêm` : '—'} copyValue={String(nights)} />
          <CopyField label="Tổng tiền" value={formatMoney(b.totalAmount, b.currency)} copyValue={b.totalAmount != null ? String(b.totalAmount) : ''} />
        </div>
        {b.specialRequest ? (
          <div className="mt-3">
            <CopyField label="Ghi chú / Yêu cầu đặc biệt" value={b.specialRequest} />
          </div>
        ) : null}
      </Card>

      {/* Rooms */}
      <div className="space-y-3">
        {b.rooms.map((room) => (
          <Card key={room.id} className="p-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Phòng {room.roomIndex}</p>
                <p className="text-base font-semibold text-slate-900">{room.roomType ?? '(chưa rõ loại phòng)'}</p>
              </div>
              <CopyButton value={roomToText(room)} label={`Sao chép phòng ${room.roomIndex}`} />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs font-medium uppercase tracking-wide text-slate-400">
                    <th className="py-1.5 pr-4">Đêm</th>
                    <th className="py-1.5 pr-4">Giá</th>
                  </tr>
                </thead>
                <tbody>
                  {room.nights.map((n) => (
                    <tr key={n.id} className="border-t border-slate-100">
                      <td className="py-1.5 pr-4 text-slate-700">{formatDate(n.stayDate)}</td>
                      <td className="py-1.5 pr-4 text-slate-900">
                        {formatMoney(n.amount, n.currency)}
                        {n.amount === null ? <span className="ml-2 text-xs text-amber-600">Chưa xác định</span> : null}
                        {n.manuallyCorrected ? <span className="ml-2 text-xs text-slate-400">(sửa tay)</span> : null}
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

      {/* Confirmation section */}
      {b.status === 'NEW' ? (
        <Card className="border-brand-200 bg-brand-50/40 p-5">
          <p className="text-sm text-slate-600">
            Sau khi đã tạo đặt phòng này trên hệ thống khách sạn, hãy xác nhận để đơn được đánh dấu hoàn thành.
          </p>
          {complete.isError ? (
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
        <Card className="border-green-200 bg-green-50/50 p-5">
          <div className="flex items-center gap-2 text-green-700">
            <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
            <span className="text-sm font-semibold">Đã xác nhận tạo</span>
          </div>
          <p className="mt-2 text-sm text-slate-600">
            {b.completedBy ? `Bởi ${b.completedBy.fullName}` : ''} · {formatDateTime(b.completedAt)}
          </p>
          {b.completionNote ? <p className="mt-1 text-sm text-slate-500">Ghi chú: {b.completionNote}</p> : null}
        </Card>
      ) : null}

      {/* Admin-only meta */}
      {isAdmin ? (
        <Card className="p-5">
          <p className="mb-2 text-sm font-semibold text-slate-700">Thông tin điều phối (Admin)</p>
          <div className="grid gap-2 text-sm text-slate-600 sm:grid-cols-2">
            <span>Gửi: {formatDateTime(b.sentAt)} {b.sentBy ? `· ${b.sentBy.fullName}` : ''}</span>
            <span>Tạo lúc: {formatDateTime(b.createdAt)}</span>
            <span>Phiên bản trích xuất: {b.parserVersion ?? '—'}</span>
            <span>Trạng thái thanh toán: {paymentLabel(b.paymentStatus)}</span>
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
              Huỷ
            </Button>
            <Button onClick={() => complete.mutate()} loading={complete.isPending}>
              Xác nhận
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">Bạn xác nhận booking này đã được tạo thành công trên hệ thống khách sạn?</p>
        <label className="mt-4 block text-sm font-medium text-slate-600">
          Ghi chú (không bắt buộc)
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
            placeholder="Ví dụ: đã tạo trên PMS, mã nội bộ…"
          />
        </label>
      </Modal>
    </div>
  );

  function BackLink() {
    return (
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-700"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Quay lại
      </button>
    );
  }
}

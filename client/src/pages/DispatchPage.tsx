import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { FilePlus2, Send, Sparkles } from 'lucide-react';
import { bookingsApi, branchesApi, type BookingDetail, type BookingEdit, type WarningView } from '../api/bookings';
import { ApiError, toUserMessage } from '../api/errors';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { ErrorAlert } from '../components/ErrorAlert';
import { PageHeader } from '../components/PageState';
import { formatMoney } from '../lib/format';

interface NightDraft {
  stayDate: string;
  amount: string;
}
interface RoomDraft {
  roomIndex: number;
  roomType: string;
  nights: NightDraft[];
}
interface FormState {
  hotelName: string;
  customerName: string;
  phone: string;
  bookingCode: string;
  checkInDate: string;
  checkOutDate: string;
  totalAmount: string;
  paymentStatus: 'PAY_BEFORE' | 'PAY_AFTER';
  specialRequest: string;
  rooms: RoomDraft[];
}

function stayDatesBetween(checkIn: string, checkOut: string): string[] {
  if (!checkIn || !checkOut) return [];
  const start = new Date(`${checkIn}T00:00:00Z`).getTime();
  const end = new Date(`${checkOut}T00:00:00Z`).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return [];
  const out: string[] = [];
  for (let t = start; t < end; t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

function toForm(b: BookingDetail): FormState {
  return {
    hotelName: b.hotelName ?? '',
    customerName: b.customerName ?? '',
    phone: b.phone ?? '',
    bookingCode: b.bookingCode ?? '',
    checkInDate: b.checkInDate ?? '',
    checkOutDate: b.checkOutDate ?? '',
    totalAmount: b.totalAmount != null ? String(b.totalAmount) : '',
    paymentStatus: b.paymentStatus,
    specialRequest: b.specialRequest ?? '',
    rooms: b.rooms.map((r) => ({
      roomIndex: r.roomIndex,
      roomType: r.roomType ?? '',
      nights: r.nights.map((n) => ({ stayDate: n.stayDate ?? '', amount: n.amount != null ? String(n.amount) : '' })),
    })),
  };
}

function parseAmount(s: string): number | null {
  const digits = s.replace(/[^\d]/g, '');
  return digits.length > 0 ? Number(digits) : null;
}

function buildEdit(form: FormState, branchId: number | undefined): BookingEdit {
  return {
    hotelName: form.hotelName || null,
    branchId: branchId ?? null,
    customerName: form.customerName,
    phone: form.phone || null,
    bookingCode: form.bookingCode,
    checkInDate: form.checkInDate || null,
    checkOutDate: form.checkOutDate || null,
    totalAmount: parseAmount(form.totalAmount),
    paymentStatus: form.paymentStatus,
    specialRequest: form.specialRequest || null,
    rooms: form.rooms.map((r) => ({
      roomIndex: r.roomIndex,
      roomType: r.roomType || null,
      roomSubtotal: r.nights.every((n) => parseAmount(n.amount) !== null)
        ? r.nights.reduce((acc, n) => acc + (parseAmount(n.amount) ?? 0), 0)
        : null,
      nights: r.nights.map((n) => ({ stayDate: n.stayDate, amount: parseAmount(n.amount) })),
    })),
  };
}

const inputClass =
  'w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600';

export function DispatchPage() {
  const navigate = useNavigate();
  const [rawText, setRawText] = useState('');
  const [draftId, setDraftId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [branchId, setBranchId] = useState<number | undefined>(undefined);
  const [warnings, setWarnings] = useState<WarningView[]>([]);
  const [pendingWarnings, setPendingWarnings] = useState<WarningView[] | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [saveNote, setSaveNote] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const branches = useQuery({ queryKey: ['branches'], queryFn: () => branchesApi.list(), staleTime: 5 * 60_000 });

  const extractMut = useMutation({
    mutationFn: (text: string) => bookingsApi.extract(text),
    onSuccess: (res) => {
      setDraftId(res.booking.id);
      setBranchId(res.branchConfident && res.suggestedBranch ? res.suggestedBranch.id : undefined);
    },
  });

  const detailQuery = useQuery({
    queryKey: ['admin-booking', draftId],
    queryFn: () => bookingsApi.adminDetail(draftId!),
    enabled: !!draftId,
  });

  useEffect(() => {
    if (detailQuery.data) {
      const b = detailQuery.data.booking;
      setForm(toForm(b));
      setWarnings(b.warnings);
      if (b.branchId) setBranchId(b.branchId);
    }
  }, [detailQuery.data]);

  const saveMut = useMutation({
    mutationFn: () => bookingsApi.update(draftId!, buildEdit(form!, branchId)),
    onSuccess: (res) => {
      setForm(toForm(res.booking));
      setWarnings(res.booking.warnings);
      setSaveNote('Đã lưu thay đổi.');
      setTimeout(() => setSaveNote(null), 2000);
    },
  });

  const updateForm = (patch: Partial<FormState>) => setForm((f) => (f ? { ...f, ...patch } : f));

  // Regenerate each room's night rows when the stay range changes.
  const onDateChange = (field: 'checkInDate' | 'checkOutDate', value: string) => {
    setForm((f) => {
      if (!f) return f;
      const next = { ...f, [field]: value };
      const dates = stayDatesBetween(next.checkInDate, next.checkOutDate);
      if (dates.length > 0) {
        next.rooms = f.rooms.map((r) => {
          const byDate = new Map(r.nights.map((n) => [n.stayDate, n.amount]));
          return { ...r, nights: dates.map((d) => ({ stayDate: d, amount: byDate.get(d) ?? '' })) };
        });
      }
      return next;
    });
  };

  async function doSend(ackCodes: string[]) {
    if (!draftId || branchId === undefined || !form) return;
    setSending(true);
    setSendError(null);
    try {
      await bookingsApi.update(draftId, buildEdit(form, branchId));
      await bookingsApi.send(draftId, branchId, ackCodes);
      navigate(`/app/booking/${draftId}`);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'WARNINGS_NOT_ACKNOWLEDGED') {
        const details = err.details as { warnings?: WarningView[] } | undefined;
        setPendingWarnings(details?.warnings ?? []);
      } else if (err instanceof ApiError && err.code === 'DUPLICATE_BOOKING') {
        const d = err.details as { existingBookingId?: string; existingStatus?: string } | undefined;
        setSendError(`Đơn trùng đã tồn tại (${d?.existingStatus ?? ''}). Không thể gửi lại.`);
      } else {
        setSendError(toUserMessage(err));
      }
    } finally {
      setSending(false);
    }
  }

  const selectedBranch = useMemo(
    () => branches.data?.branches.find((b) => b.id === branchId),
    [branches.data, branchId],
  );

  // --- Stage 1: paste + extract ---
  if (!draftId) {
    return (
      <div>
        <PageHeader title="Nhập đơn Booking.com" description="Dán nội dung đặt phòng từ Booking.com để trích xuất thông tin." />
        <Card className="p-5">
          {extractMut.isError ? (
            <div className="mb-3">
              <ErrorAlert>{toUserMessage(extractMut.error)}</ErrorAlert>
            </div>
          ) : null}
          <label className="mb-1 block text-sm font-medium text-slate-600">Nội dung Booking.com</label>
          <textarea
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            rows={14}
            placeholder="Dán toàn bộ nội dung (Ctrl+A, Ctrl+C) từ trang chi tiết đặt phòng Booking.com…"
            className={`${inputClass} font-mono`}
          />
          <div className="mt-4">
            <Button
              onClick={() => extractMut.mutate(rawText)}
              disabled={rawText.trim().length === 0}
              loading={extractMut.isPending}
            >
              <Sparkles className="h-4 w-4" aria-hidden="true" />
              Trích xuất thông tin
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  // --- Stage 2: review / edit / send ---
  if (!form || detailQuery.isLoading) {
    return <PageHeader title="Nhập đơn Booking.com" description="Đang tải thông tin đã trích xuất…" />;
  }

  const canSend = branchId !== undefined && form.customerName.trim() !== '' && form.bookingCode.trim() !== '';

  return (
    <div className="space-y-5">
      <PageHeader
        title="Kiểm tra & gửi"
        description="Chỉnh sửa thông tin đã trích xuất, chọn chi nhánh rồi gửi."
        actions={
          <Button
            variant="ghost"
            onClick={() => {
              setDraftId(null);
              setForm(null);
              setRawText('');
            }}
          >
            <FilePlus2 className="h-4 w-4" aria-hidden="true" />
            Đơn khác
          </Button>
        }
      />

      {warnings.length > 0 ? (
        <Card className="border-amber-200 bg-amber-50/50 p-4">
          <p className="mb-1 text-sm font-semibold text-amber-800">Cảnh báo trích xuất</p>
          <ul className="list-inside list-disc space-y-0.5 text-sm text-amber-700">
            {warnings.map((w, i) => (
              <li key={`${w.code}-${i}`}>{w.message}</li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card className="p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Khách sạn"><input className={inputClass} value={form.hotelName} onChange={(e) => updateForm({ hotelName: e.target.value })} /></Field>
          <Field label="Mã đặt phòng"><input className={inputClass} value={form.bookingCode} onChange={(e) => updateForm({ bookingCode: e.target.value })} /></Field>
          <Field label="Tên khách"><input className={inputClass} value={form.customerName} onChange={(e) => updateForm({ customerName: e.target.value })} /></Field>
          <Field label="Số điện thoại"><input className={inputClass} value={form.phone} onChange={(e) => updateForm({ phone: e.target.value })} /></Field>
          <Field label="Nhận phòng"><input type="date" className={inputClass} value={form.checkInDate} onChange={(e) => onDateChange('checkInDate', e.target.value)} /></Field>
          <Field label="Trả phòng"><input type="date" className={inputClass} value={form.checkOutDate} onChange={(e) => onDateChange('checkOutDate', e.target.value)} /></Field>
          <Field label="Tổng tiền (VND)"><input inputMode="numeric" className={inputClass} value={form.totalAmount} onChange={(e) => updateForm({ totalAmount: e.target.value })} /></Field>
          <Field label="Thanh toán">
            <select className={inputClass} value={form.paymentStatus} onChange={(e) => updateForm({ paymentStatus: e.target.value as FormState['paymentStatus'] })}>
              <option value="PAY_AFTER">Thanh toán tại khách sạn</option>
              <option value="PAY_BEFORE">Đã thanh toán</option>
            </select>
          </Field>
        </div>
        <div className="mt-4">
          <Field label="Ghi chú / Yêu cầu đặc biệt">
            <textarea className={inputClass} rows={2} value={form.specialRequest} onChange={(e) => updateForm({ specialRequest: e.target.value })} />
          </Field>
        </div>
      </Card>

      {/* Rooms */}
      {form.rooms.map((room, ri) => (
        <Card key={room.roomIndex} className="p-5">
          <div className="mb-3">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Phòng {room.roomIndex}</p>
            <input
              className={`${inputClass} mt-1`}
              value={room.roomType}
              placeholder="Loại phòng"
              onChange={(e) => {
                const rooms = [...form.rooms];
                rooms[ri] = { ...room, roomType: e.target.value };
                updateForm({ rooms });
              }}
            />
          </div>
          <div className="space-y-2">
            {room.nights.map((night, ni) => (
              <div key={night.stayDate} className="flex items-center gap-3">
                <span className="w-28 text-sm text-slate-500">{night.stayDate}</span>
                <input
                  inputMode="numeric"
                  className={`${inputClass} max-w-xs`}
                  value={night.amount}
                  placeholder="Giá đêm (để trống nếu chưa rõ)"
                  onChange={(e) => {
                    const rooms = [...form.rooms];
                    const nights = [...room.nights];
                    nights[ni] = { ...night, amount: e.target.value };
                    rooms[ri] = { ...room, nights };
                    updateForm({ rooms });
                  }}
                />
              </div>
            ))}
          </div>
        </Card>
      ))}

      {/* Branch + send */}
      <Card className="p-5">
        <Field label="Chọn chi nhánh gửi đến">
          <select
            className={inputClass}
            value={branchId ?? ''}
            onChange={(e) => setBranchId(e.target.value ? Number(e.target.value) : undefined)}
          >
            <option value="">— Chọn chi nhánh —</option>
            {branches.data?.branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.address} — {b.hotelName}
              </option>
            ))}
          </select>
        </Field>

        {selectedBranch ? (
          <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600">
            Xem trước: gửi <strong>{form.customerName || 'khách'}</strong> ({form.bookingCode || 'chưa có mã'}) đến{' '}
            <strong>{selectedBranch.hotelName}</strong>, tổng {formatMoney(parseAmount(form.totalAmount))}.
          </p>
        ) : null}

        {sendError ? (
          <div className="mt-3">
            <ErrorAlert>{sendError}</ErrorAlert>
          </div>
        ) : null}
        {saveMut.isError ? (
          <div className="mt-3">
            <ErrorAlert>{toUserMessage(saveMut.error)}</ErrorAlert>
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={() => saveMut.mutate()} loading={saveMut.isPending}>
            Lưu thay đổi
          </Button>
          <Button onClick={() => doSend([])} disabled={!canSend} loading={sending}>
            <Send className="h-4 w-4" aria-hidden="true" />
            Gửi xuống chi nhánh
          </Button>
          {saveNote ? <span className="text-sm text-green-600">{saveNote}</span> : null}
        </div>
      </Card>

      {/* Warning acknowledgement dialog */}
      {pendingWarnings ? (
        <Card className="border-amber-300 bg-amber-50 p-5">
          <p className="text-sm font-semibold text-amber-800">Cần xác nhận trước khi gửi</p>
          <ul className="mt-2 list-inside list-disc space-y-0.5 text-sm text-amber-700">
            {pendingWarnings.map((w, i) => (
              <li key={`${w.code}-${i}`}>{w.message}</li>
            ))}
          </ul>
          <div className="mt-4 flex gap-2">
            <Button variant="secondary" onClick={() => setPendingWarnings(null)}>
              Quay lại chỉnh sửa
            </Button>
            <Button
              loading={sending}
              onClick={() => {
                const codes = pendingWarnings.map((w) => w.code);
                setPendingWarnings(null);
                void doSend(codes);
              }}
            >
              Xác nhận & gửi
            </Button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-600">{label}</span>
      {children}
    </label>
  );
}

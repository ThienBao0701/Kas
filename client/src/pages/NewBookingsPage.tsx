import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Inbox, RefreshCw, WifiOff } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { bookingsApi, branchesApi, type NewListItem } from '../api/bookings';
import { Card } from '../components/Card';
import { EmptyState } from '../components/EmptyState';
import { LastMinuteBadge, StatusBadge } from '../components/Badges';
import { Pagination } from '../components/Pagination';
import { PageHeader, QueryState, InlineSpinner } from '../components/PageState';
import { BookingDetailView } from '../components/BookingDetailView';
import { ErrorAlert } from '../components/ErrorAlert';
import { formatDate, formatDateTime, paymentLabel } from '../lib/format';
import { toUserMessage } from '../api/errors';

const POLL_MS = 20_000;

function clockTime(ms: number): string {
  if (!ms) return '—';
  const d = new Date(ms);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function NewBookingsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [branchId, setBranchId] = useState<number | undefined>(() => {
    const raw = searchParams.get('branchId');
    return raw && isAdmin ? Number(raw) : undefined;
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const branches = useQuery({
    queryKey: ['branches'],
    queryFn: () => branchesApi.list(),
    enabled: isAdmin,
    staleTime: 5 * 60_000,
  });

  const query = useQuery({
    queryKey: ['bookings', 'new', { branchId, page }],
    queryFn: () => bookingsApi.listNew({ branchId, page, pageSize: 20 }),
    refetchInterval: POLL_MS,
  });

  const bookings = query.data?.bookings ?? [];

  // Auto-select the first booking for the receptionist master-detail; keep the
  // user's selection across polling refreshes (selection is independent state).
  useEffect(() => {
    if (isAdmin || selectedId !== null) return;
    const first = query.data?.bookings[0];
    if (first) setSelectedId(first.id);
  }, [isAdmin, selectedId, query.data]);

  // Data survives a failed background refresh; only flag the connection.
  const connectionLost = query.errorUpdatedAt > query.dataUpdatedAt && !!query.data;
  const noDataError = query.isError && !query.data;

  const refreshInfo = (
    <div className="flex items-center gap-3 text-xs text-slate-500">
      <span>Dữ liệu tự động cập nhật mỗi 20 giây.</span>
      <span>Cập nhật lúc {clockTime(query.dataUpdatedAt)}</span>
      <button
        type="button"
        onClick={() => void query.refetch()}
        disabled={query.isFetching}
        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
      >
        <RefreshCw className={`h-3.5 w-3.5 ${query.isFetching ? 'animate-spin' : ''}`} aria-hidden="true" />
        Làm mới
      </button>
    </div>
  );

  const branchFilter = isAdmin ? (
    <select
      value={branchId ?? ''}
      onChange={(e) => {
        setBranchId(e.target.value ? Number(e.target.value) : undefined);
        setPage(1);
      }}
      aria-label="Lọc theo chi nhánh"
      className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
    >
      <option value="">Tất cả chi nhánh</option>
      {branches.data?.branches.map((b) => (
        <option key={b.id} value={b.id}>
          {b.address} — {b.hotelName}
        </option>
      ))}
    </select>
  ) : null;

  return (
    <div>
      <PageHeader
        title={isAdmin ? 'Chờ chi nhánh tạo' : 'Đơn mới'}
        description={
          isAdmin
            ? 'Đơn đã gửi xuống chi nhánh, đang chờ lễ tân xác nhận đã tạo.'
            : 'Đơn được gửi đến chi nhánh của bạn. Mở đơn, sao chép và xác nhận sau khi đã tạo trên hệ thống khách sạn.'
        }
        actions={
          <div className="flex flex-col items-end gap-2">
            {branchFilter}
            {refreshInfo}
          </div>
        }
      />

      {connectionLost ? (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
          <WifiOff className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
          <span>Mất kết nối tạm thời — đang hiển thị dữ liệu gần nhất. Sẽ tự thử lại.</span>
          <button type="button" onClick={() => void query.refetch()} className="ml-auto font-medium underline">
            Thử lại
          </button>
        </div>
      ) : null}

      {noDataError ? (
        <ErrorAlert>{toUserMessage(query.error)}</ErrorAlert>
      ) : isAdmin ? (
        <AdminTable
          bookings={bookings}
          isLoading={query.isLoading}
          pagination={query.data?.pagination}
          onPage={setPage}
          onOpen={(id) => navigate(`/app/booking/${id}`)}
        />
      ) : (
        <QueryState isLoading={query.isLoading} isError={false}>
          {bookings.length === 0 ? (
            <EmptyState icon={<Inbox className="h-6 w-6" aria-hidden="true" />} title="Chưa có đơn nào" message="Chưa có đơn mới được gửi đến." />
          ) : (
            <div className="grid gap-4 lg:grid-cols-[minmax(320px,380px)_1fr]">
              <div className="space-y-2">
                {bookings.map((b) => (
                  <InboxRow key={b.id} booking={b} selected={b.id === selectedId} onSelect={() => setSelectedId(b.id)} />
                ))}
                {query.data ? <Pagination meta={query.data.pagination} onChange={setPage} /> : null}
              </div>
              <div>
                {selectedId ? <SelectedBooking id={selectedId} onConfirmed={() => void query.refetch()} /> : (
                  <Card className="p-8 text-center text-sm text-slate-400">Chọn một đơn để xem chi tiết.</Card>
                )}
              </div>
            </div>
          )}
        </QueryState>
      )}
    </div>
  );
}

function SelectedBooking({ id, onConfirmed }: { id: string; onConfirmed: () => void }) {
  const query = useQuery({ queryKey: ['booking', id], queryFn: () => bookingsApi.detail(id) });
  if (query.isLoading) return <InlineSpinner />;
  if (query.isError) return <ErrorAlert>{toUserMessage(query.error)}</ErrorAlert>;
  return <BookingDetailView booking={query.data!.booking} onConfirmed={onConfirmed} />;
}

function InboxRow({ booking: b, selected, onSelect }: { booking: NewListItem; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`block w-full rounded-2xl border p-3 text-left transition-colors ${
        selected
          ? 'border-brand-400 bg-brand-50'
          : b.isLastMinute
            ? 'border-red-200 bg-red-50/60 hover:bg-red-50'
            : 'border-slate-200 bg-white hover:bg-slate-50'
      }`}
    >
      {b.isLastMinute ? <div className="mb-1"><LastMinuteBadge /></div> : null}
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate font-medium text-slate-900">{b.customerName ?? '—'}</span>
        <span className="font-mono text-xs text-slate-500">{b.bookingCode ?? '—'}</span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
        <span>Nhận phòng: {formatDate(b.checkInDate)}</span>
        <span>{paymentLabel(b.paymentStatus)}</span>
      </div>
      <p className="mt-1 text-xs text-slate-400">Gửi: {formatDateTime(b.sentAt)}</p>
    </button>
  );
}

function AdminTable({
  bookings,
  isLoading,
  pagination,
  onPage,
  onOpen,
}: {
  bookings: NewListItem[];
  isLoading: boolean;
  pagination?: { page: number; pageSize: number; total: number; totalPages: number };
  onPage: (p: number) => void;
  onOpen: (id: string) => void;
}) {
  if (isLoading && bookings.length === 0) return <InlineSpinner />;
  if (bookings.length === 0) {
    return <EmptyState icon={<Inbox className="h-6 w-6" aria-hidden="true" />} title="Chưa có đơn nào" message="Chưa có đơn đang chờ chi nhánh tạo." />;
  }
  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <th className="px-4 py-3">Mã đặt phòng</th>
              <th className="px-4 py-3">Khách</th>
              <th className="px-4 py-3">Chi nhánh</th>
              <th className="px-4 py-3">Nhận phòng</th>
              <th className="px-4 py-3">Trạng thái</th>
              <th className="px-4 py-3">Thời gian gửi</th>
            </tr>
          </thead>
          <tbody>
            {bookings.map((b) => (
              <tr key={b.id} onClick={() => onOpen(b.id)} className="cursor-pointer border-b border-slate-100 last:border-b-0 hover:bg-slate-50">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    {b.isLastMinute ? <LastMinuteBadge /> : null}
                    <span className="font-mono text-slate-900">{b.bookingCode ?? '—'}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-slate-800">{b.customerName ?? '—'}</td>
                <td className="px-4 py-3 text-slate-600">{b.branch?.hotelName ?? '—'}</td>
                <td className="px-4 py-3 text-slate-600">{formatDate(b.checkInDate)}</td>
                <td className="px-4 py-3"><StatusBadge status={b.status} /></td>
                <td className="px-4 py-3 text-slate-500">{formatDateTime(b.sentAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pagination ? <div className="border-t border-slate-100 px-3"><Pagination meta={pagination} onChange={onPage} /></div> : null}
    </Card>
  );
}

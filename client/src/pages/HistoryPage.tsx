import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { History, Search } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { bookingsApi, branchesApi } from '../api/bookings';
import { Card } from '../components/Card';
import { EmptyState } from '../components/EmptyState';
import { LastMinuteBadge, StatusBadge } from '../components/Badges';
import { Pagination } from '../components/Pagination';
import { PageHeader, QueryState } from '../components/PageState';
import { formatDate, formatDateTime } from '../lib/format';

interface Filters {
  search: string;
  status: string;
  paymentStatus: string;
  isLastMinute: boolean;
  sentFrom: string;
  sentTo: string;
  branchId: string;
}

const EMPTY: Filters = {
  search: '',
  status: '',
  paymentStatus: '',
  isLastMinute: false,
  sentFrom: '',
  sentTo: '',
  branchId: '',
};

const selectClass =
  'rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600';

export function HistoryPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [draft, setDraft] = useState<Filters>(EMPTY);
  const [applied, setApplied] = useState<Filters>(EMPTY);

  const branches = useQuery({
    queryKey: ['branches'],
    queryFn: () => branchesApi.list(),
    enabled: isAdmin,
    staleTime: 5 * 60_000,
  });

  const query = useQuery({
    queryKey: ['bookings', 'history', { applied, page }],
    queryFn: () =>
      bookingsApi.history({
        search: applied.search || undefined,
        status: applied.status || undefined,
        paymentStatus: applied.paymentStatus || undefined,
        isLastMinute: applied.isLastMinute ? 'true' : undefined,
        sentFrom: applied.sentFrom || undefined,
        sentTo: applied.sentTo || undefined,
        branchId: isAdmin && applied.branchId ? Number(applied.branchId) : undefined,
        page,
        pageSize: 20,
      }),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setApplied(draft);
    setPage(1);
  };
  const reset = () => {
    setDraft(EMPTY);
    setApplied(EMPTY);
    setPage(1);
  };

  const bookings = query.data?.bookings ?? [];

  return (
    <div>
      <PageHeader title="Lịch sử" description="Tra cứu toàn bộ đơn đã điều phối." />

      <Card className="mb-4 p-4">
        <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
          <div className="min-w-[16rem] flex-1">
            <label className="mb-1 block text-xs font-medium text-slate-500">Tìm kiếm</label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" aria-hidden="true" />
              <input
                value={draft.search}
                onChange={(e) => setDraft({ ...draft, search: e.target.value })}
                placeholder="Mã đặt phòng, tên khách, số điện thoại"
                className="w-full rounded-xl border border-slate-300 py-2 pl-9 pr-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Trạng thái</label>
            <select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })} className={selectClass}>
              <option value="">Tất cả</option>
              <option value="NEW">Chờ xác nhận</option>
              <option value="COMPLETED">Đã xác nhận</option>
              <option value="DRAFT">Nháp</option>
              <option value="READY">Sẵn sàng</option>
              <option value="ARCHIVED">Lưu trữ</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Thanh toán</label>
            <select value={draft.paymentStatus} onChange={(e) => setDraft({ ...draft, paymentStatus: e.target.value })} className={selectClass}>
              <option value="">Tất cả</option>
              <option value="PAY_BEFORE">Đã thanh toán</option>
              <option value="PAY_AFTER">Tại khách sạn</option>
            </select>
          </div>

          {isAdmin ? (
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">Chi nhánh</label>
              <select value={draft.branchId} onChange={(e) => setDraft({ ...draft, branchId: e.target.value })} className={selectClass}>
                <option value="">Tất cả</option>
                {branches.data?.branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.address}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Gửi từ</label>
            <input type="date" value={draft.sentFrom} onChange={(e) => setDraft({ ...draft, sentFrom: e.target.value })} className={selectClass} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Gửi đến</label>
            <input type="date" value={draft.sentTo} onChange={(e) => setDraft({ ...draft, sentTo: e.target.value })} className={selectClass} />
          </div>

          <label className="flex items-center gap-2 pb-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={draft.isLastMinute}
              onChange={(e) => setDraft({ ...draft, isLastMinute: e.target.checked })}
              className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-600"
            />
            Last minute
          </label>

          <div className="flex gap-2">
            <button type="submit" className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
              Lọc
            </button>
            <button type="button" onClick={reset} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">
              Xoá lọc
            </button>
          </div>
        </form>
      </Card>

      <QueryState isLoading={query.isLoading} isError={query.isError} error={query.error}>
        {bookings.length === 0 ? (
          <EmptyState
            icon={<History className="h-6 w-6" aria-hidden="true" />}
            title="Không có kết quả"
            message="Không tìm thấy đơn nào khớp bộ lọc."
          />
        ) : (
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
                    <th className="px-4 py-3">Gửi</th>
                    <th className="px-4 py-3">Xác nhận</th>
                  </tr>
                </thead>
                <tbody>
                  {bookings.map((b) => (
                    <tr
                      key={b.id}
                      onClick={() => navigate(`/app/booking/${b.id}`)}
                      className="cursor-pointer border-b border-slate-100 last:border-b-0 hover:bg-slate-50"
                    >
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
                      <td className="px-4 py-3 text-slate-500">
                        {b.completedAt ? (
                          <span>
                            {formatDateTime(b.completedAt)}
                            {b.completedBy ? <span className="block text-xs text-slate-400">{b.completedBy.fullName}</span> : null}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {query.data ? (
              <div className="border-t border-slate-100 px-3">
                <Pagination meta={query.data.pagination} onChange={setPage} />
              </div>
            ) : null}
          </Card>
        )}
      </QueryState>
    </div>
  );
}

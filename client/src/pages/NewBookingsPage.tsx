import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Inbox } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { bookingsApi, branchesApi } from '../api/bookings';
import { Card } from '../components/Card';
import { EmptyState } from '../components/EmptyState';
import { LastMinuteBadge, StatusBadge } from '../components/Badges';
import { Pagination } from '../components/Pagination';
import { PageHeader, QueryState } from '../components/PageState';
import { formatDate, formatDateTime } from '../lib/format';

const POLL_MS = 20_000;

export function NewBookingsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [branchId, setBranchId] = useState<number | undefined>(undefined);

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

  return (
    <div>
      <PageHeader
        title={isAdmin ? 'Chờ xác nhận' : 'Đơn mới'}
        description={
          isAdmin
            ? 'Đơn đã gửi xuống chi nhánh, đang chờ lễ tân xác nhận đã tạo.'
            : 'Đơn được gửi đến chi nhánh của bạn. Mở đơn, sao chép và tạo trên hệ thống khách sạn.'
        }
        actions={
          isAdmin ? (
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
          ) : null
        }
      />

      <QueryState isLoading={query.isLoading} isError={query.isError} error={query.error}>
        {bookings.length === 0 ? (
          <EmptyState
            icon={<Inbox className="h-6 w-6" aria-hidden="true" />}
            title="Chưa có đơn nào"
            message="Chưa có đơn mới được gửi đến."
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
                    <th className="px-4 py-3">Thời gian gửi</th>
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
                      <td className="px-4 py-3">
                        <StatusBadge status={b.status} />
                      </td>
                      <td className="px-4 py-3 text-slate-500">{formatDateTime(b.sentAt)}</td>
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

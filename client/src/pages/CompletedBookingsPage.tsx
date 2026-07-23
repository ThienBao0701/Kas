import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2 } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { bookingsApi, branchesApi } from '../api/bookings';
import { Card } from '../components/Card';
import { EmptyState } from '../components/EmptyState';
import { LastMinuteBadge } from '../components/Badges';
import { Pagination } from '../components/Pagination';
import { PageHeader, QueryState } from '../components/PageState';
import { formatDate, formatDateTime, formatMoney } from '../lib/format';

export function CompletedBookingsPage() {
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
    queryKey: ['bookings', 'completed', { branchId, page }],
    queryFn: () => bookingsApi.listCompleted({ branchId, page, pageSize: 20 }),
  });

  const bookings = query.data?.bookings ?? [];

  return (
    <div>
      <PageHeader
        title="Đã xác nhận tạo"
        description="Các đơn lễ tân đã xác nhận tạo thành công trên hệ thống khách sạn."
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
            icon={<CheckCircle2 className="h-6 w-6" aria-hidden="true" />}
            title="Chưa có đơn hoàn thành"
            message="Các đơn đã xác nhận sẽ xuất hiện tại đây."
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
                    <th className="px-4 py-3">Tổng tiền</th>
                    <th className="px-4 py-3">Người xác nhận</th>
                    <th className="px-4 py-3">Thời gian xác nhận</th>
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
                      <td className="px-4 py-3 text-slate-800">{formatMoney(b.totalAmount, b.currency)}</td>
                      <td className="px-4 py-3 text-slate-600">{b.completedBy?.fullName ?? '—'}</td>
                      <td className="px-4 py-3 text-slate-500">{formatDateTime(b.completedAt)}</td>
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

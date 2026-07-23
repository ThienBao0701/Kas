import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { CalendarClock, CheckCircle2, Clock, Flame } from 'lucide-react';
import { dashboardApi } from '../api/bookings';
import { Card } from '../components/Card';
import { StatCard } from '../components/StatCard';
import { PageHeader, QueryState } from '../components/PageState';

const POLL_MS = 30_000;

/**
 * Admin dashboard. Numbers come from the single backend summary endpoint
 * (`GET /api/admin/dashboard/summary`, computed in the property timezone), and
 * the UI links each count through to the matching filtered list.
 */
export function DashboardPage() {
  const query = useQuery({
    queryKey: ['dashboard', 'summary'],
    queryFn: () => dashboardApi.summary(),
    refetchInterval: POLL_MS,
  });

  const totals = query.data?.totals;
  const branches = [...(query.data?.branches ?? [])].sort(
    (a, b) =>
      b.lastMinute - a.lastMinute ||
      b.waiting - a.waiting ||
      a.branch.address.localeCompare(b.branch.address),
  );

  return (
    <div>
      <PageHeader title="Tổng quan" description="Tình hình điều phối hôm nay (giờ Việt Nam)." />

      <QueryState isLoading={query.isLoading} isError={query.isError} error={query.error}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Link to="/app/waiting" className="focus-visible:outline-none">
            <StatCard label="Chờ chi nhánh tạo" value={totals?.waiting ?? 0} icon={Clock} tone="amber" />
          </Link>
          <Link to="/app/completed" className="focus-visible:outline-none">
            <StatCard label="Đã xác nhận hôm nay" value={totals?.confirmedToday ?? 0} icon={CheckCircle2} tone="green" />
          </Link>
          <StatCard label="LAST MINUTE" value={totals?.lastMinute ?? 0} icon={Flame} tone="red" />
          <StatCard label="Tổng đơn gửi hôm nay" value={totals?.sentToday ?? 0} icon={CalendarClock} />
        </div>

        <div className="mt-6">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Theo chi nhánh</h2>
          {branches.length === 0 ? (
            <p className="text-sm text-slate-400">Chưa có chi nhánh nào.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {branches.map(({ branch, waiting, confirmedToday, lastMinute }) => (
                <Card key={branch.id} className={`p-4 ${lastMinute > 0 ? 'border-red-200' : ''}`}>
                  <p className="text-sm font-semibold text-slate-900">{branch.address}</p>
                  <p className="truncate text-xs text-slate-500">{branch.hotelName}</p>
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                    <Link
                      to={`/app/waiting?branchId=${branch.id}`}
                      className="text-amber-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                    >
                      <strong>{waiting}</strong> chờ tạo
                    </Link>
                    <Link
                      to={`/app/completed?branchId=${branch.id}`}
                      className="text-green-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600"
                    >
                      <strong>{confirmedToday}</strong> đã xác nhận
                    </Link>
                    {lastMinute > 0 ? (
                      <Link
                        to={`/app/waiting?branchId=${branch.id}`}
                        className="font-semibold text-red-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                      >
                        <strong>{lastMinute}</strong> LAST MINUTE
                      </Link>
                    ) : null}
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      </QueryState>
    </div>
  );
}

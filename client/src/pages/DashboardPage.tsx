import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock, CheckCircle2, Clock, Flame } from 'lucide-react';
import { dashboardApi } from '../api/bookings';
import { Card } from '../components/Card';
import { StatCard } from '../components/StatCard';
import { PageHeader, QueryState } from '../components/PageState';

const POLL_MS = 30_000;

export function DashboardPage() {
  const navigate = useNavigate();

  const query = useQuery({
    queryKey: ['dashboard', 'summary'],
    queryFn: () => dashboardApi.summary(),
    refetchInterval: POLL_MS,
  });

  const totals = query.data?.totals;
  const branches = query.data?.branches ?? [];

  return (
    <div>
      <PageHeader title="Tổng quan" description="Tình hình điều phối hôm nay (giờ Việt Nam)." />

      <QueryState isLoading={query.isLoading} isError={query.isError} error={query.error}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Chờ chi nhánh tạo" value={totals?.waiting ?? 0} icon={Clock} tone="amber" />
          <StatCard label="Đã xác nhận hôm nay" value={totals?.confirmedToday ?? 0} icon={CheckCircle2} tone="green" />
          <StatCard label="LAST MINUTE" value={totals?.lastMinute ?? 0} icon={Flame} tone="red" />
          <StatCard label="Tổng đơn gửi hôm nay" value={totals?.sentToday ?? 0} icon={CalendarClock} />
        </div>

        <div className="mt-6">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Theo chi nhánh</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {branches.map(({ branch, waiting, confirmedToday, lastMinute }) => (
              <button
                key={branch.id}
                type="button"
                onClick={() => navigate(`/app/waiting?branchId=${branch.id}`)}
                className="text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 rounded-2xl"
              >
                <Card className="p-4 transition-shadow hover:shadow-md">
                  <p className="text-sm font-semibold text-slate-900">{branch.address}</p>
                  <p className="truncate text-xs text-slate-500">{branch.hotelName}</p>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-lg bg-amber-50 py-2">
                      <p className="text-lg font-semibold text-amber-700">{waiting}</p>
                      <p className="text-[0.7rem] text-amber-700">Chờ tạo</p>
                    </div>
                    <div className="rounded-lg bg-green-50 py-2">
                      <p className="text-lg font-semibold text-green-700">{confirmedToday}</p>
                      <p className="text-[0.7rem] text-green-700">Đã xác nhận</p>
                    </div>
                    <div className="rounded-lg bg-red-50 py-2">
                      <p className="text-lg font-semibold text-red-600">{lastMinute}</p>
                      <p className="text-[0.7rem] text-red-600">Last minute</p>
                    </div>
                  </div>
                </Card>
              </button>
            ))}
          </div>
        </div>
      </QueryState>
    </div>
  );
}

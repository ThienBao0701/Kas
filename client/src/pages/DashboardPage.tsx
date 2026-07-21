import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { CalendarClock, CheckCircle2, Clock, Flame } from 'lucide-react';
import { bookingsApi, branchesApi } from '../api/bookings';
import { Card } from '../components/Card';
import { StatCard } from '../components/StatCard';
import { PageHeader, QueryState } from '../components/PageState';
import { hcmToday } from '../lib/format';

export function DashboardPage() {
  const today = hcmToday();

  const waiting = useQuery({
    queryKey: ['bookings', 'new', { branchId: undefined, page: 1, dash: true }],
    queryFn: () => bookingsApi.listNew({ pageSize: 100 }),
    refetchInterval: 30_000,
  });
  const confirmedToday = useQuery({
    queryKey: ['dash', 'confirmedToday', today],
    queryFn: () => bookingsApi.history({ status: 'COMPLETED', completedFrom: today, completedTo: today, pageSize: 100 }),
    refetchInterval: 30_000,
  });
  const dispatchedToday = useQuery({
    queryKey: ['dash', 'dispatchedToday', today],
    queryFn: () => bookingsApi.history({ sentFrom: today, sentTo: today, pageSize: 1 }),
    refetchInterval: 30_000,
  });
  const branches = useQuery({ queryKey: ['branches'], queryFn: () => branchesApi.list(), staleTime: 5 * 60_000 });

  const waitingRows = waiting.data?.bookings ?? [];
  const waitingTotal = waiting.data?.pagination.total ?? 0;
  const lastMinuteCount = waitingRows.filter((b) => b.isLastMinute).length;
  const confirmedRows = confirmedToday.data?.bookings ?? [];
  const confirmedTotal = confirmedToday.data?.pagination.total ?? 0;
  const totalToday = dispatchedToday.data?.pagination.total ?? 0;

  const waitingByBranch = new Map<number, number>();
  const lastMinuteByBranch = new Map<number, number>();
  for (const b of waitingRows) {
    if (!b.branch) continue;
    waitingByBranch.set(b.branch.id, (waitingByBranch.get(b.branch.id) ?? 0) + 1);
    if (b.isLastMinute) lastMinuteByBranch.set(b.branch.id, (lastMinuteByBranch.get(b.branch.id) ?? 0) + 1);
  }
  const completedByBranch = new Map<number, number>();
  for (const b of confirmedRows) if (b.branch) completedByBranch.set(b.branch.id, (completedByBranch.get(b.branch.id) ?? 0) + 1);

  const summary = (branches.data?.branches ?? [])
    .map((b) => ({
      branch: b,
      waiting: waitingByBranch.get(b.id) ?? 0,
      completed: completedByBranch.get(b.id) ?? 0,
      lastMinute: lastMinuteByBranch.get(b.id) ?? 0,
    }))
    .sort(
      (a, b) =>
        b.lastMinute - a.lastMinute ||
        b.waiting - a.waiting ||
        a.branch.address.localeCompare(b.branch.address),
    );

  return (
    <div>
      <PageHeader title="Tổng quan" description="Tình hình điều phối hôm nay." />

      <QueryState isLoading={waiting.isLoading} isError={waiting.isError} error={waiting.error}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Link to="/app/waiting" className="focus-visible:outline-none">
            <StatCard label="Chờ chi nhánh tạo" value={waitingTotal} icon={Clock} tone="amber" />
          </Link>
          <Link to="/app/completed" className="focus-visible:outline-none">
            <StatCard label="Đã xác nhận hôm nay" value={confirmedTotal} icon={CheckCircle2} tone="green" />
          </Link>
          <StatCard label="LAST MINUTE" value={lastMinuteCount} icon={Flame} tone="red" />
          <StatCard label="Tổng đơn gửi hôm nay" value={totalToday} icon={CalendarClock} />
        </div>

        <div className="mt-6">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Theo chi nhánh</h2>
          {summary.length === 0 ? (
            <p className="text-sm text-slate-400">Chưa có chi nhánh nào.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {summary.map(({ branch, waiting: w, completed, lastMinute }) => (
                <Card
                  key={branch.id}
                  className={`p-4 ${lastMinute > 0 ? 'border-red-200' : ''}`}
                >
                  <p className="text-sm font-semibold text-slate-900">{branch.address}</p>
                  <p className="truncate text-xs text-slate-500">{branch.hotelName}</p>
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                    <Link
                      to={`/app/waiting?branchId=${branch.id}`}
                      className="text-amber-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                    >
                      <strong>{w}</strong> chờ tạo
                    </Link>
                    <Link
                      to={`/app/completed?branchId=${branch.id}`}
                      className="text-green-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600"
                    >
                      <strong>{completed}</strong> đã xác nhận
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

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { CalendarClock, CheckCircle2, Clock, Flame, Wrench } from 'lucide-react';
import { dashboardApi } from '../api/bookings';
import { Card } from '../components/Card';
import { StatCard } from '../components/StatCard';
import { PageHeader, QueryState } from '../components/PageState';

const POLL_MS = 30_000;

/**
 * Today in the property's timezone, as YYYY-MM-DD.
 *
 * Asia/Ho_Chi_Minh, not the browser's zone: the server decides the day boundary
 * in Vietnam time, and a machine set to another zone must not open the dashboard
 * on a date the server would call yesterday.
 */
function todayInHcm(): string {
  return new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * Admin dashboard. Numbers come from the single backend summary endpoint
 * (`GET /api/admin/dashboard/summary`, computed in the property timezone), and
 * the UI links each count through to the matching filtered list.
 */
export function DashboardPage() {
  /*
    THE SELECTED DAY IS SENT TO THE SERVER, not applied to a loaded payload.

    Every figure on this page is a `count(*)` the database runs for that date, so
    picking the 9th shows the 9th — a client-side filter over a "today" response
    could only ever show today with rows hidden.
  */
  const [date, setDate] = useState(todayInHcm);
  const isToday = date === todayInHcm();

  const query = useQuery({
    queryKey: ['dashboard', 'summary', date],
    queryFn: () => dashboardApi.summary({ date }),
    // Only today's view is live. Polling a fixed past date re-fetches numbers
    // that cannot change.
    refetchInterval: isToday ? POLL_MS : false,
  });

  const totals = query.data?.totals;
  const issues = query.data?.issues;
  const branches = [...(query.data?.branches ?? [])].sort(
    (a, b) =>
      b.lastMinute - a.lastMinute ||
      b.waiting - a.waiting ||
      a.branch.address.localeCompare(b.branch.address),
  );

  return (
    <div>
      <PageHeader
        title="Tổng quan"
        description="Tình hình điều phối theo ngày (giờ Việt Nam)."
        actions={
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <span className="whitespace-nowrap">Ngày xem</span>
            <input
              type="date"
              value={date}
              max={todayInHcm()}
              onChange={(e) => setDate(e.target.value || todayInHcm())}
              aria-label="Ngày xem"
              data-testid="dashboard-date"
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
            />
            {!isToday ? (
              <button
                type="button"
                onClick={() => setDate(todayInHcm())}
                className="rounded-lg px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
              >
                Hôm nay
              </button>
            ) : null}
          </label>
        }
      />

      <QueryState
        isLoading={query.isLoading}
        isError={query.isError}
        error={query.error}
        onRetry={() => void query.refetch()}
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Link to="/app/waiting" className="focus-visible:outline-none">
            <StatCard label="Chờ chi nhánh tạo" value={totals?.waiting ?? 0} icon={Clock} tone="amber" />
          </Link>
          <Link to="/app/completed" className="focus-visible:outline-none">
            <StatCard label="Đã xác nhận" value={totals?.confirmedToday ?? 0} icon={CheckCircle2} tone="green" />
          </Link>
          <StatCard label="LAST MINUTE" value={totals?.lastMinute ?? 0} icon={Flame} tone="red" />
          <StatCard label="Tổng đơn gửi" value={totals?.sentToday ?? 0} icon={CalendarClock} />

          {/*
            Issues REPORTED on the selected day. Date-scoped like every other
            figure here; the sidebar badge still carries the running open total,
            so the backlog signal is not lost from the application.
          */}
          <Link
            to="/app/issues"
            className="focus-visible:outline-none"
            aria-label={`Sự cố trong ngày: ${issues?.reported ?? 0}`}
          >
            <Card className={`flex items-center gap-4 p-5 ${(issues?.stillOpen ?? 0) > 0 ? 'border-red-200' : ''}`}>
              <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-600">
                <Wrench className="h-5 w-5" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <p className="text-2xl font-semibold text-slate-900">{issues?.reported ?? 0}</p>
                <p className="truncate text-sm text-slate-500">Sự cố trong ngày</p>
                <p className="truncate text-xs text-slate-400">{issues?.stillOpen ?? 0} chưa xử lý</p>
              </div>
            </Card>
          </Link>
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

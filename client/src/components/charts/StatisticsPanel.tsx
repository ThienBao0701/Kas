import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { dashboardApi, type BookingStatistics } from '../../api/bookings';
import { formatMoney, hcmToday } from '../../lib/format';
import { Card } from '../Card';
import { QueryState } from '../PageState';
import { BarChart, DonutChart, UnavailableMetric, type ChartDatum } from './Charts';

/** The ranges an operator actually asks for, as offsets from today. */
const RANGES = [
  { id: '7', label: '7 ngày', days: 7 },
  { id: '30', label: '30 ngày', days: 30 },
  { id: '90', label: '90 ngày', days: 90 },
] as const;

type RangeId = (typeof RANGES)[number]['id'];

function isoDaysAgo(days: number, today = hcmToday()): string {
  const d = new Date(`${today}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - (days - 1));
  return d.toISOString().slice(0, 10);
}

const money = (value: number) => formatMoney(value, 'VND');
const percent = (value: number) => `${value.toFixed(1)}%`;
const count = (value: number) => String(value);

/**
 * The statistics dashboard.
 *
 * Every number here comes from `GET /admin/dashboard/statistics`, which was
 * built in 7b and had no consumer until now. Nothing is recomputed client-side:
 * if a figure is not in the response it is not on the screen.
 *
 * Occupancy, RevPAR and ADR arrive as `{ value: null, reason }` and are drawn
 * as explicit "unavailable" panels carrying the server's own reason. They are
 * deliberately shown rather than hidden — an operator who cannot find occupancy
 * assumes the page is broken, whereas one who reads "room inventory not
 * configured" knows exactly what is missing and why.
 */
export function StatisticsPanel({ branchId }: { branchId?: number }) {
  const [rangeId, setRangeId] = useState<RangeId>('30');
  const days = RANGES.find((r) => r.id === rangeId)!.days;
  const from = isoDaysAgo(days);
  const to = hcmToday();

  const query = useQuery({
    queryKey: ['dashboard', 'statistics', { from, to, branchId }],
    queryFn: () => dashboardApi.statistics({ from, to, branchId }),
    staleTime: 60_000,
  });

  return (
    <section className="mt-8" aria-labelledby="stats-heading">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 id="stats-heading" className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Thống kê vận hành
        </h2>
        <div role="group" aria-label="Khoảng thời gian" className="flex gap-1">
          {RANGES.map((r) => (
            <button
              key={r.id}
              type="button"
              aria-pressed={rangeId === r.id}
              onClick={() => setRangeId(r.id)}
              className={`min-h-[2.25rem] rounded-lg px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 ${
                rangeId === r.id
                  ? 'bg-brand-600 text-white'
                  : 'border border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <QueryState isLoading={query.isLoading} isError={query.isError} error={query.error}>
        {query.data ? <StatisticsCharts stats={query.data} /> : null}
      </QueryState>
    </section>
  );
}

function StatisticsCharts({ stats }: { stats: BookingStatistics }) {
  const otaData = useMemo<ChartDatum[]>(
    () => stats.byOta.map((r) => ({ key: r.key, label: r.label, value: r.revenue })),
    [stats.byOta],
  );
  const branchData = useMemo<ChartDatum[]>(
    () => stats.byBranch.map((r) => ({ key: r.key, label: r.label, value: r.revenue })),
    [stats.byBranch],
  );
  const sourceCounts = useMemo<ChartDatum[]>(
    () => stats.byOta.map((r) => ({ key: r.key, label: r.label, value: r.bookings })),
    [stats.byOta],
  );
  const failureRates = useMemo<ChartDatum[]>(
    () =>
      [
        { key: 'cancel', label: 'Tỷ lệ huỷ', value: stats.cancellationRate },
        { key: 'noshow', label: 'Tỷ lệ khách không đến', value: stats.noShowRate },
      ].filter((r): r is ChartDatum => r.value !== null),
    [stats.cancellationRate, stats.noShowRate],
  );

  return (
    <div className="space-y-4">
      {/* Headline figures that are genuinely computable. */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Figure label="Doanh thu" value={money(stats.revenue)} testId="stat-revenue" />
        <Figure label="Số đơn tính doanh thu" value={String(stats.bookingCount)} testId="stat-bookings" />
        <Figure label="Tổng số đêm" value={String(stats.stayNights)} testId="stat-nights" />
        <Figure
          label="Doanh thu / đêm lưu trú"
          value={stats.averageRevenuePerStayNight === null ? '—' : money(stats.averageRevenuePerStayNight)}
          testId="stat-per-night"
        />
      </div>

      {/*
        The three the system will not compute. Shown, with the server's reason,
        rather than quietly omitted.
      */}
      <div className="grid gap-4 sm:grid-cols-3">
        <UnavailableMetric title="Công suất phòng" reason={stats.occupancy.reason} testId="stat-occupancy" />
        <UnavailableMetric title="RevPAR" reason={stats.revPar.reason} testId="stat-revpar" />
        <UnavailableMetric title="ADR" reason={stats.adr.reason} testId="stat-adr" />
      </div>

      {/*
        There is no time-series chart here, deliberately. The statistics
        endpoint returns TOTALS for the range, not a per-day breakdown, so a
        line chart would have to invent the shape of the curve between two
        endpoints. Drawing revenue as a rising or falling line the data never
        described is exactly the kind of confident fiction the null metrics
        above exist to avoid. A daily series needs a server change.
      */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <DonutChart title="Doanh thu theo nguồn" data={otaData} format={money} testId="chart-ota" />
        </Card>
        <Card className="p-5">
          <BarChart title="Doanh thu theo chi nhánh" data={branchData} format={money} testId="chart-branch" />
        </Card>
        <Card className="p-5">
          <BarChart title="Số đơn theo nguồn" data={sourceCounts} format={count} testId="chart-sources" />
        </Card>
        <Card className="p-5">
          <BarChart
            title="Tỷ lệ huỷ và khách không đến"
            data={failureRates}
            format={percent}
            testId="chart-rates"
          />
        </Card>
        <Card className="p-5">
          <BarChart
            title="Số đêm lưu trú trung bình"
            data={
              stats.averageStayNights === null
                ? []
                : [{ key: 'avg', label: 'Trung bình mỗi đơn', value: stats.averageStayNights }]
            }
            format={(v) => `${v} đêm`}
            testId="chart-avg-stay"
          />
        </Card>
      </div>
    </div>
  );
}

function Figure({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <Card className="p-5" data-testid={testId}>
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-1 break-words text-xl font-semibold text-slate-900">{value}</p>
    </Card>
  );
}

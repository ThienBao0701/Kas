/**
 * "Cần tạo lại" accountability, for the Admin.
 *
 * WHAT IT ANSWERS
 *
 * Which branch, which shift and which receptionist produced the orders that
 * later had to be created again — over a period the Admin chooses. It is an
 * AUDIT view: it counts and it lists, and it does not score anyone or rank
 * people against a threshold. Whether twelve is a lot is a judgement for whoever
 * reads it.
 *
 * WHY THE ORIGINAL CREATOR SURVIVES HERE
 *
 * Each row is one immutable creation ATTEMPT, so attempt 1 remains the original
 * creator for ever and a re-creation adds a row beside it rather than replacing
 * anything. Withdrawing and re-sending the order does not erase who first
 * created it, which is exactly what this view exists to preserve.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, RotateCcw } from 'lucide-react';
import {
  recreationReportPdfUrl,
  reportsApi,
  type RecreationRow,
} from '../api/reports';
import type { ShiftType } from '../api/shifts';
import { Card } from './Card';
import { Button } from './Button';
import { DateRangeField, type DateRangeValue } from './DateRangeField';
import { EmptyState } from './EmptyState';
import { QueryState } from './PageState';
import { formatDateTime, hcmToday } from '../lib/format';

/** The last 30 days, which is what an end-of-month review actually asks for. */
function defaultRange(): DateRangeValue {
  const today = hcmToday();
  const from = new Date(Date.parse(`${today}T00:00:00.000Z`) - 29 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  return { from, to: today };
}

const SHIFTS: { value: ShiftType; label: string }[] = [
  { value: 'A', label: 'Ca A' },
  { value: 'B', label: 'Ca B' },
  { value: 'C', label: 'Ca C' },
  { value: 'A4', label: 'Ca A4' },
  { value: 'C4', label: 'Ca C4' },
];

const SOURCES = [
  { value: 'BOOKING_COM', label: 'Booking.com' },
  { value: 'AGODA', label: 'Agoda' },
  { value: 'CTRIP', label: 'CTrip' },
];

export function RecreationAccountability({ branchId }: { branchId?: number }) {
  const [range, setRange] = useState<DateRangeValue>(defaultRange);
  const [shiftType, setShiftType] = useState<ShiftType | ''>('');
  const [source, setSource] = useState('');
  const [open, setOpen] = useState(false);

  // An incomplete range is never sent: the server refuses it, and asking would
  // replace the panel with an error the operator did not cause.
  const ready = range.from !== '' && range.to !== '';
  const filter = {
    from: range.from,
    to: range.to,
    branchId,
    // Narrowing is optional, and an unset filter is omitted rather than sent
    // empty — the server treats a missing key as "every one of them".
    shiftType: shiftType || undefined,
    source: source || undefined,
  };

  const report = useQuery({
    queryKey: ['recreation-report', filter],
    queryFn: () => reportsApi.recreations(filter),
    enabled: open && ready,
  });

  return (
    <Card className="mb-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <RotateCcw className="h-4 w-4 text-slate-500" aria-hidden="true" />
          <h2 className="text-sm font-semibold text-slate-800">Thống kê đơn cần tạo lại</h2>
        </div>
        <Button variant="secondary" onClick={() => setOpen((v) => !v)} data-testid="recreation-toggle">
          {open ? 'Ẩn thống kê' : 'Xem thống kê'}
        </Button>
      </div>

      {open ? (
        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <DateRangeField
              legend="Khoảng thời gian"
              value={range}
              onChange={setRange}
              testId="recreation-range"
            />
            <label className="text-sm font-medium text-slate-600">
              Ca làm việc
              <select
                value={shiftType}
                aria-label="Ca làm việc"
                onChange={(e) => setShiftType(e.target.value as ShiftType | '')}
                className="mt-1 block rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
              >
                <option value="">Tất cả ca</option>
                {SHIFTS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm font-medium text-slate-600">
              Nguồn
              <select
                value={source}
                aria-label="Nguồn"
                onChange={(e) => setSource(e.target.value)}
                className="mt-1 block rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
              >
                <option value="">Tất cả nguồn</option>
                {SOURCES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <Button
              variant="secondary"
              disabled={!ready}
              data-testid="recreation-export"
              onClick={() => window.open(recreationReportPdfUrl(filter), '_blank', 'noopener')}
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              Xuất PDF
            </Button>
          </div>

          <QueryState isLoading={report.isLoading} isError={report.isError} error={report.error}>
            {report.data && report.data.totals.total === 0 ? (
              <EmptyState
                icon={<RotateCcw className="h-6 w-6" aria-hidden="true" />}
                title="Không có đơn cần tạo lại"
                message="Không có đơn nào bị từ chối trong khoảng thời gian này."
              />
            ) : report.data ? (
              <>
                <p className="text-sm text-slate-700" data-testid="recreation-total">
                  Tổng số đơn cần tạo lại: <strong>{report.data.totals.total}</strong>
                </p>

                <div className="grid gap-3 sm:grid-cols-3">
                  <TotalsCard title="Theo chi nhánh" totals={report.data.totals.byBranch} />
                  <TotalsCard title="Theo ca làm việc" totals={report.data.totals.byShift} />
                  <TotalsCard title="Theo lễ tân" totals={report.data.totals.byReceptionist} />
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                        <th className="px-3 py-2">Chi nhánh</th>
                        <th className="px-3 py-2">Mã đơn</th>
                        <th className="px-3 py-2">Nguồn</th>
                        <th className="px-3 py-2">Ngày tạo đơn</th>
                        <th className="px-3 py-2">Lễ tân</th>
                        <th className="px-3 py-2">Ca</th>
                        <th className="px-3 py-2">Lần tạo</th>
                        <th className="px-3 py-2">Bị từ chối</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.data.rows.map((row) => (
                        <RecreationTableRow key={row.proofId} row={row} />
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : null}
          </QueryState>
        </div>
      ) : null}
    </Card>
  );
}

function TotalsCard({ title, totals }: { title: string; totals: Record<string, number> }) {
  // Biggest first, ties broken by label so two renders never disagree.
  const entries = Object.entries(totals).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'vi'));
  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
      {entries.length === 0 ? (
        <p className="text-sm text-slate-500">Không có dữ liệu.</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {entries.map(([label, count]) => (
            <li key={label} className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 truncate text-slate-700">{label}</span>
              <span className="font-semibold text-slate-900">{count}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RecreationTableRow({ row }: { row: RecreationRow }) {
  return (
    <tr className="border-b border-slate-100 align-top last:border-b-0">
      <td className="px-3 py-2 text-slate-600">{row.branch?.address ?? '—'}</td>
      <td className="px-3 py-2 font-medium text-slate-800">{row.bookingCode}</td>
      <td className="px-3 py-2 text-slate-600">{row.source ?? '—'}</td>
      <td className="px-3 py-2 text-slate-500">{formatDateTime(row.bookingCreatedAt)}</td>
      <td className="px-3 py-2 text-slate-800">{row.receptionistName}</td>
      <td className="px-3 py-2 text-slate-600">{row.shiftLabel}</td>
      <td className="px-3 py-2 text-slate-600">{row.attemptNumber}</td>
      <td className="px-3 py-2 text-slate-500">{row.reviewedAt ? formatDateTime(row.reviewedAt) : '—'}</td>
    </tr>
  );
}

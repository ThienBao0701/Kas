import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { History, Search } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { bookingsApi, branchesApi, type BookingStatus } from '../api/bookings';
import { Card } from '../components/Card';
import { EmptyState } from '../components/EmptyState';
import { BusinessTypeBadge, LastMinuteBadge, SourceBadge } from '../components/Badges';
import { FilterChips, MultiSelect, type ActiveFilter } from '../components/FilterChips';
import { RoomSummary } from '../components/RoomSummary';
import { Pagination } from '../components/Pagination';
import { PageHeader, QueryState } from '../components/PageState';
import { SkeletonList } from '../components/Skeleton';
import { useDebounced } from '../hooks/useDebounced';
import { usePersistentState } from '../hooks/usePersistentState';
import { formatDate, formatDateTime, formatMoney, statusLabel } from '../lib/format';

/** Whole VND (or "Chưa xác định" when the booking-level total is unknown). */
function totalDisplay(amount: number | null, currency: string): string {
  return amount != null ? formatMoney(amount, currency) : 'Chưa xác định';
}

/*
  Only what the Admin can actually set.

  Source, verification, the five extra date axes and the sort controls are gone
  from this screen, and these filters are local state with no URL or storage
  hydration — so keeping fields nothing can populate would be state that is
  always empty and parameters that are always undefined. The API still accepts
  every one of them; this page simply stops sending them.
*/
interface Filters {
  search: string;
  status: BookingStatus[];
  paymentStatus: string;
  isLastMinute: boolean;
  /** The single "Từ ngày / Đến ngày" range, on the dispatch date. */
  sentFrom: string;
  sentTo: string;
  branchId: string;
}

const EMPTY: Filters = {
  search: '',
  status: [],
  paymentStatus: '',
  isLastMinute: false,
  sentFrom: '',
  sentTo: '',
  branchId: '',
};

/*
  THE FOUR STAY OUTCOMES, and nothing else.

  History answers "what happened to this reservation", so it lists the states a
  completed stay can end in. The dispatch states (NEW, RECEIVED, COMPLETED,
  ARCHIVED) are live-queue concepts with their own screens, and offering them
  here invited an Admin to filter history by a state history is not about.

  NOTHING WAS REMOVED FROM THE SYSTEM. Every BookingStatus value still exists,
  is still written, and is still filterable through the API — this is the Admin
  History filter UI narrowing, not a workflow change.
*/
const STATUS_OPTIONS: { value: BookingStatus; label: string }[] = (
  ['CHECKED_IN', 'CHECKED_OUT', 'CANCELLED', 'NO_SHOW'] as BookingStatus[]
).map((s) => ({ value: s, label: statusLabel(s) }));

/*
  ONE DATE RANGE, on the dispatch date.

  `sentFrom`/`sentTo` are reused rather than a new meaning invented: they are
  what the list is already sorted by (`sentAt desc` is the API default), so
  "from/to" narrows the same axis the operator is already reading down the page.
  The other six date fields filtered axes that were never sorted or displayed,
  which is how you get an empty result and no idea why.
*/

const controlClass =
  'min-h-[2.75rem] rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600';

/**
 * The operational search.
 *
 * 7a extended the server query into ten sort keys, six date ranges and (now)
 * multi-valued status / source / verification filters; the page in front of it
 * still sent eleven parameters behind a "Lọc" button. This exposes the rest.
 *
 * Filtering is live: the search box is debounced and every other control
 * applies on change, so there is no submit step and no state where the table
 * silently disagrees with the controls above it. Active filters are always
 * visible as chips, because the failure this page invites is an operator
 * concluding a booking does not exist when it is merely filtered out.
 */
export function HistoryPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [storedFilters, setFilters] = usePersistentState<Filters>('kas.history.filters', EMPTY);

  /*
    These filters persist in localStorage, so an Admin can arrive carrying a
    status this screen no longer offers — "NEW", say, chosen before the list was
    narrowed to the four stay outcomes. Left alone it would filter the table to
    something the UI cannot show as selected or explain, which reads as history
    having lost rows. Anything no longer offered is dropped on read.
  */
  const filters = useMemo<Filters>(
    () => ({
      ...storedFilters,
      status: (storedFilters.status ?? []).filter((s) =>
        STATUS_OPTIONS.some((o) => o.value === s),
      ),
    }),
    [storedFilters],
  );

  // Only the free-text box waits. The rest are discrete choices — a click is
  // already a deliberate act and does not need settling.
  const debouncedSearch = useDebounced(filters.search, 300);

  const branches = useQuery({
    queryKey: ['branches'],
    queryFn: () => branchesApi.list(),
    enabled: isAdmin,
    staleTime: 5 * 60_000,
  });

  const params = useMemo(
    () => ({
      search: debouncedSearch.trim() || undefined,
      status: filters.status.length > 0 ? filters.status.join(',') : undefined,
      paymentStatus: filters.paymentStatus || undefined,
      isLastMinute: filters.isLastMinute ? 'true' : undefined,
      sentFrom: filters.sentFrom || undefined,
      sentTo: filters.sentTo || undefined,
      branchId: isAdmin && filters.branchId ? Number(filters.branchId) : undefined,
      // `sort`/`order` are deliberately never sent: the API's own default is
      // newest dispatch first, which is the ordering this page has always shown.
    }),
    [debouncedSearch, filters, isAdmin],
  );

  const query = useQuery({
    queryKey: ['bookings', 'history', { params, page }],
    queryFn: () => bookingsApi.history({ ...params, page, pageSize: 20 }),
    // Keeps the previous results on screen while the next query resolves, so
    // typing does not flash an empty table between keystrokes.
    placeholderData: keepPreviousData,
  });

  /** Every filter in force, as a removable chip. */
  const chips = useMemo<ActiveFilter[]>(() => {
    const out: ActiveFilter[] = [];
    if (filters.search.trim()) out.push({ id: 'search', label: `Từ khoá: ${filters.search.trim()}` });
    for (const s of filters.status) out.push({ id: `status:${s}`, label: `Trạng thái: ${statusLabel(s)}` });
    if (filters.paymentStatus) {
      out.push({
        id: 'paymentStatus',
        label: `Thanh toán: ${filters.paymentStatus === 'PAY_BEFORE' ? 'Đã thanh toán' : 'Tại khách sạn'}`,
      });
    }
    if (filters.isLastMinute) out.push({ id: 'isLastMinute', label: 'Last minute' });
    if (isAdmin && filters.branchId) {
      const branch = branches.data?.branches.find((b) => String(b.id) === filters.branchId);
      out.push({ id: 'branchId', label: `Chi nhánh: ${branch?.address ?? filters.branchId}` });
    }
    if (filters.sentFrom) out.push({ id: 'sentFrom', label: `Từ ngày: ${filters.sentFrom}` });
    if (filters.sentTo) out.push({ id: 'sentTo', label: `Đến ngày: ${filters.sentTo}` });
    return out;
  }, [filters, isAdmin, branches.data]);

  function update(patch: Partial<Filters>) {
    setFilters({ ...filters, ...patch });
    setPage(1);
  }

  function removeChip(id: string) {
    const [kind, value] = id.split(':');
    if (kind === 'status') return update({ status: filters.status.filter((s) => s !== value) });
    if (id === 'isLastMinute') return update({ isLastMinute: false });
    // Every remaining chip maps to a string field, cleared by emptying it.
    return update({ [id]: '' } as Partial<Filters>);
  }

  const bookings = query.data?.bookings ?? [];

  return (
    <div>
      <PageHeader title="Lịch sử" description="Tra cứu toàn bộ đơn đã điều phối." />

      <Card className="mb-4 p-4">
        {/*
          Not a submitting form — every control applies as it changes. It stays
          a <form> for the landmark and its label, and swallows Enter so the
          browser's implicit submission cannot reload the page.
        */}
        <form onSubmit={(e) => e.preventDefault()} aria-label="Bộ lọc lịch sử" className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[16rem] flex-1">
              <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="history-search">
                Tìm kiếm
              </label>
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-slate-400"
                  aria-hidden="true"
                />
                <input
                  id="history-search"
                  type="search"
                  value={filters.search}
                  onChange={(e) => update({ search: e.target.value })}
                  placeholder="Mã đặt phòng, tên khách, số điện thoại, khách sạn"
                  className={`w-full pl-9 ${controlClass}`}
                />
              </div>
            </div>

            {isAdmin ? (
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="history-branch">
                  Chi nhánh
                </label>
                <select
                  id="history-branch"
                  aria-label="Chi nhánh"
                  value={filters.branchId}
                  onChange={(e) => update({ branchId: e.target.value })}
                  className={controlClass}
                >
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
              <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="history-payment">
                Thanh toán
              </label>
              <select
                id="history-payment"
                aria-label="Thanh toán"
                value={filters.paymentStatus}
                onChange={(e) => update({ paymentStatus: e.target.value })}
                className={controlClass}
              >
                <option value="">Tất cả</option>
                <option value="PAY_BEFORE">Đã thanh toán</option>
                <option value="PAY_AFTER">Tại khách sạn</option>
              </select>
            </div>

            {/*
              No sorting controls. The API keeps its default — newest dispatch
              first — which is preserved by simply never sending `sort`/`order`.
            */}

            <label className="flex min-h-[2.75rem] items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={filters.isLastMinute}
                onChange={(e) => update({ isLastMinute: e.target.checked })}
                className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-600"
              />
              Last minute
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <MultiSelect
              legend="Trạng thái"
              options={STATUS_OPTIONS}
              selected={filters.status}
              onChange={(status) => update({ status })}
              testId="filter-status"
            />
          </div>

          {/* One range, always visible — not folded into a details panel. */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="history-sentFrom">
                Từ ngày
              </label>
              <input
                id="history-sentFrom"
                type="date"
                value={filters.sentFrom}
                onChange={(e) => update({ sentFrom: e.target.value })}
                className={`w-full ${controlClass}`}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="history-sentTo">
                Đến ngày
              </label>
              <input
                id="history-sentTo"
                type="date"
                value={filters.sentTo}
                onChange={(e) => update({ sentTo: e.target.value })}
                className={`w-full ${controlClass}`}
              />
            </div>
          </div>
        </form>
      </Card>

      {chips.length > 0 ? (
        <div className="mb-4">
          <FilterChips filters={chips} onRemove={removeChip} onClearAll={() => update(EMPTY)} />
        </div>
      ) : null}

      {query.isLoading ? (
        <SkeletonList rows={6} />
      ) : (
        <QueryState
          isLoading={false}
          isError={query.isError}
          error={query.error}
          onRetry={() => void query.refetch()}
        >
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
                      <th scope="col" className="px-4 py-3">Mã Booking</th>
                      <th scope="col" className="px-4 py-3">Khách</th>
                      <th scope="col" className="px-4 py-3">Chi nhánh</th>
                      <th scope="col" className="px-4 py-3">Nhận phòng</th>
                      <th scope="col" className="px-4 py-3">Hạng phòng (SL)</th>
                      <th scope="col" className="px-4 py-3">Giá tổng</th>
                      <th scope="col" className="px-4 py-3">Nguồn</th>
                      <th scope="col" className="px-4 py-3">Thời gian gửi</th>
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
                          <div className="flex flex-wrap items-center gap-2">
                            {b.isLastMinute ? <LastMinuteBadge /> : null}
                            <span className="font-mono text-slate-900">{b.bookingCode ?? '—'}</span>
                            <BusinessTypeBadge type={b.businessType} />
                          </div>
                        </td>
                        <td className="px-4 py-3 text-slate-800">{b.customerName ?? '—'}</td>
                        <td className="px-4 py-3 text-slate-600">{b.branch?.address ?? '—'}</td>
                        <td className="px-4 py-3 text-slate-600">{formatDate(b.checkInDate)}</td>
                        <td className="px-4 py-3 text-slate-700"><RoomSummary summary={b.roomSummary} /></td>
                        <td className="px-4 py-3 font-bold text-slate-900">{totalDisplay(b.totalAmount, b.currency)}</td>
                        <td className="px-4 py-3"><SourceBadge source={b.sourcePlatform} /></td>
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
      )}
    </div>
  );
}

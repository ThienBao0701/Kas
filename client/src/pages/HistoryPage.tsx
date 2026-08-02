import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { History, Search } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import {
  bookingsApi,
  branchesApi,
  SOURCE_LABEL,
  type BookingSource,
  type BookingStatus,
  type VerificationStatus,
} from '../api/bookings';
import { Card } from '../components/Card';
import { EmptyState } from '../components/EmptyState';
import { BusinessTypeBadge, LastMinuteBadge, StatusBadge } from '../components/Badges';
import { FilterChips, MultiSelect, type ActiveFilter } from '../components/FilterChips';
import { RoomSummary } from '../components/RoomSummary';
import { Pagination } from '../components/Pagination';
import { PageHeader, QueryState } from '../components/PageState';
import { SkeletonList } from '../components/Skeleton';
import { useDebounced } from '../hooks/useDebounced';
import { usePersistentState } from '../hooks/usePersistentState';
import { formatDate, formatDateTime, formatMoney, statusLabel, verificationLabel } from '../lib/format';

/** Whole VND (or "Chưa xác định" when the booking-level total is unknown). */
function totalDisplay(amount: number | null, currency: string): string {
  return amount != null ? formatMoney(amount, currency) : 'Chưa xác định';
}

interface Filters {
  search: string;
  status: BookingStatus[];
  source: BookingSource[];
  verificationStatus: VerificationStatus[];
  paymentStatus: string;
  isLastMinute: boolean;
  sentFrom: string;
  sentTo: string;
  checkInFrom: string;
  checkInTo: string;
  checkOutFrom: string;
  checkOutTo: string;
  completedFrom: string;
  completedTo: string;
  branchId: string;
  sort: string;
  order: string;
}

const EMPTY: Filters = {
  search: '',
  status: [],
  source: [],
  verificationStatus: [],
  paymentStatus: '',
  isLastMinute: false,
  sentFrom: '',
  sentTo: '',
  checkInFrom: '',
  checkInTo: '',
  checkOutFrom: '',
  checkOutTo: '',
  completedFrom: '',
  completedTo: '',
  branchId: '',
  sort: '',
  order: '',
};

const STATUS_OPTIONS: { value: BookingStatus; label: string }[] = (
  ['NEW', 'RECEIVED', 'CHECKED_IN', 'CHECKED_OUT', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'ARCHIVED'] as BookingStatus[]
).map((s) => ({ value: s, label: statusLabel(s) }));

const SOURCE_OPTIONS: { value: BookingSource; label: string }[] = (
  ['BOOKING_COM', 'AGODA', 'CTRIP'] as BookingSource[]
).map((s) => ({ value: s, label: SOURCE_LABEL[s] }));

const VERIFICATION_OPTIONS: { value: VerificationStatus; label: string }[] = (
  ['NOT_SUBMITTED', 'PENDING_REVIEW', 'APPROVED', 'REJECTED'] as VerificationStatus[]
).map((s) => ({ value: s, label: verificationLabel(s) }));

const SORT_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Ngày gửi (mặc định)' },
  { value: 'checkInDate', label: 'Ngày nhận phòng' },
  { value: 'checkOutDate', label: 'Ngày trả phòng' },
  { value: 'completedAt', label: 'Ngày xác nhận' },
  { value: 'createdAt', label: 'Ngày tạo' },
  { value: 'updatedAt', label: 'Cập nhật gần nhất' },
  { value: 'customerName', label: 'Tên khách' },
  { value: 'totalAmount', label: 'Giá tổng' },
  { value: 'status', label: 'Trạng thái đơn' },
  { value: 'sourcePlatform', label: 'Nguồn' },
];

const DATE_FIELDS: { key: keyof Filters; label: string }[] = [
  { key: 'sentFrom', label: 'Gửi từ' },
  { key: 'sentTo', label: 'Gửi đến' },
  { key: 'checkInFrom', label: 'Nhận phòng từ' },
  { key: 'checkInTo', label: 'Nhận phòng đến' },
  { key: 'checkOutFrom', label: 'Trả phòng từ' },
  { key: 'checkOutTo', label: 'Trả phòng đến' },
  { key: 'completedFrom', label: 'Xác nhận từ' },
  { key: 'completedTo', label: 'Xác nhận đến' },
];

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
  const [filters, setFilters] = usePersistentState<Filters>('kas.history.filters', EMPTY);

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
      source: filters.source.length > 0 ? filters.source.join(',') : undefined,
      verificationStatus:
        filters.verificationStatus.length > 0 ? filters.verificationStatus.join(',') : undefined,
      paymentStatus: filters.paymentStatus || undefined,
      isLastMinute: filters.isLastMinute ? 'true' : undefined,
      sentFrom: filters.sentFrom || undefined,
      sentTo: filters.sentTo || undefined,
      checkInFrom: filters.checkInFrom || undefined,
      checkInTo: filters.checkInTo || undefined,
      checkOutFrom: filters.checkOutFrom || undefined,
      checkOutTo: filters.checkOutTo || undefined,
      completedFrom: filters.completedFrom || undefined,
      completedTo: filters.completedTo || undefined,
      branchId: isAdmin && filters.branchId ? Number(filters.branchId) : undefined,
      sort: filters.sort || undefined,
      order: filters.order || undefined,
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
    for (const s of filters.source) out.push({ id: `source:${s}`, label: `Nguồn: ${SOURCE_LABEL[s]}` });
    for (const s of filters.verificationStatus) {
      out.push({ id: `verification:${s}`, label: `Kiểm tra: ${verificationLabel(s)}` });
    }
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
    for (const { key, label } of DATE_FIELDS) {
      const value = filters[key];
      if (typeof value === 'string' && value) out.push({ id: key, label: `${label}: ${value}` });
    }
    return out;
  }, [filters, isAdmin, branches.data]);

  function update(patch: Partial<Filters>) {
    setFilters({ ...filters, ...patch });
    setPage(1);
  }

  function removeChip(id: string) {
    const [kind, value] = id.split(':');
    if (kind === 'status') return update({ status: filters.status.filter((s) => s !== value) });
    if (kind === 'source') return update({ source: filters.source.filter((s) => s !== value) });
    if (kind === 'verification') {
      return update({ verificationStatus: filters.verificationStatus.filter((s) => s !== value) });
    }
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

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="history-sort">
                Sắp xếp
              </label>
              <select
                id="history-sort"
                value={filters.sort}
                onChange={(e) => update({ sort: e.target.value })}
                className={controlClass}
              >
                {SORT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="history-order">
                Thứ tự
              </label>
              <select
                id="history-order"
                value={filters.order}
                onChange={(e) => update({ order: e.target.value })}
                className={controlClass}
              >
                <option value="">Giảm dần</option>
                <option value="asc">Tăng dần</option>
              </select>
            </div>

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
            <MultiSelect
              legend="Nguồn"
              options={SOURCE_OPTIONS}
              selected={filters.source}
              onChange={(source) => update({ source })}
              testId="filter-source"
            />
            <MultiSelect
              legend="Kiểm tra"
              options={VERIFICATION_OPTIONS}
              selected={filters.verificationStatus}
              onChange={(verificationStatus) => update({ verificationStatus })}
              testId="filter-verification"
            />
          </div>

          <details className="rounded-xl border border-slate-200 p-3">
            <summary className="cursor-pointer text-sm font-medium text-slate-600">Lọc theo ngày</summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {DATE_FIELDS.map(({ key, label }) => (
                <div key={key}>
                  <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor={`history-${key}`}>
                    {label}
                  </label>
                  <input
                    id={`history-${key}`}
                    type="date"
                    value={String(filters[key] ?? '')}
                    onChange={(e) => update({ [key]: e.target.value } as Partial<Filters>)}
                    className={`w-full ${controlClass}`}
                  />
                </div>
              ))}
            </div>
          </details>
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
                      <th scope="col" className="px-4 py-3">Trạng thái</th>
                      <th scope="col" className="px-4 py-3">Gửi (sentAt)</th>
                      <th scope="col" className="px-4 py-3">Xác nhận (completedAt)</th>
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
      )}
    </div>
  );
}

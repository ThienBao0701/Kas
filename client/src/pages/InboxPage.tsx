import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Inbox } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { bookingsApi, branchesApi, type HistoryListItem } from '../api/bookings';
import { Card } from '../components/Card';
import { EmptyState } from '../components/EmptyState';
import { Pagination } from '../components/Pagination';
import { PageHeader, QueryState } from '../components/PageState';
import { SkeletonList } from '../components/Skeleton';
import { BusinessTypeBadge, LastMinuteBadge, SourceBadge, StatusBadge, VerificationBadge } from '../components/Badges';
import { RoomSummary } from '../components/RoomSummary';
import { usePersistentState } from '../hooks/usePersistentState';
import { formatDate, formatMoney, hcmToday } from '../lib/format';

/**
 * The operational inbox.
 *
 * Every tab is a saved query against `GET /bookings/history` — the 7a search.
 * There is no inbox endpoint and there should not be one: a tab is a filter,
 * and giving each its own route would mean sixteen server handlers that drift
 * apart the first time the definition of "waiting" changes.
 *
 * The OTA tab is the reason the history endpoint learned comma-separated
 * values. "OTA" means Agoda OR CTrip, which a single-valued `source` cannot
 * express, and merging two paginated responses in the browser would report a
 * wrong total and a meaningless second page.
 */

interface TabDef {
  id: string;
  label: string;
  /** Extra query parameters. Merged over the shared branch/pagination params. */
  params: Record<string, string>;
}

function tabs(today: string, tomorrow: string): TabDef[] {
  return [
    // Arrivals first: these are the two an operator opens the page for.
    { id: 'today', label: 'Hôm nay', params: { checkInFrom: today, checkInTo: today } },
    { id: 'tomorrow', label: 'Ngày mai', params: { checkInFrom: tomorrow, checkInTo: tomorrow } },
    { id: 'last-minute', label: 'Last minute', params: { isLastMinute: 'true' } },

    // The operational lifecycle, in the order a booking travels through it.
    { id: 'waiting', label: 'Chờ chi nhánh tạo', params: { status: 'NEW' } },
    { id: 'received', label: 'Đã nhận đơn', params: { status: 'RECEIVED' } },
    { id: 'checked-in', label: 'Đã nhận phòng', params: { status: 'CHECKED_IN' } },
    { id: 'checked-out', label: 'Đã trả phòng', params: { status: 'CHECKED_OUT' } },
    { id: 'completed', label: 'Hoàn tất', params: { status: 'COMPLETED' } },
    { id: 'cancelled', label: 'Đã huỷ', params: { status: 'CANCELLED' } },
    { id: 'no-show', label: 'Khách không đến', params: { status: 'NO_SHOW' } },

    // Proof verification, which runs alongside the lifecycle rather than in it.
    { id: 'pending-review', label: 'Chờ kiểm tra', params: { verificationStatus: 'PENDING_REVIEW' } },
    { id: 'rejected', label: 'Cần tạo lại', params: { verificationStatus: 'REJECTED' } },

    // Source. "OTA" is the multi-value case: Agoda OR CTrip.
    { id: 'ota', label: 'OTA', params: { source: 'AGODA,CTRIP' } },
    { id: 'booking-com', label: 'Booking.com', params: { source: 'BOOKING_COM' } },
    { id: 'agoda', label: 'Agoda', params: { source: 'AGODA' } },
    { id: 'ctrip', label: 'CTrip', params: { source: 'CTRIP' } },
  ];
}

function isoTomorrow(today: string): string {
  const d = new Date(`${today}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

const PAGE_SIZE = 25;

export function InboxPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const navigate = useNavigate();

  const today = hcmToday();
  const allTabs = useMemo(() => tabs(today, isoTomorrow(today)), [today]);

  // The chosen tab and branch survive a reload: an operator who opens a booking
  // and comes back should land where they left, not back on "Hôm nay".
  const [tabId, setTabId] = usePersistentState('kas.inbox.tab', allTabs[0]!.id);
  const [branchId, setBranchId] = usePersistentState('kas.inbox.branch', '');
  const [page, setPage] = useState(1);

  // A tab id from an older build (or a hand-edited storage value) must not
  // leave the page blank.
  const active = allTabs.find((t) => t.id === tabId) ?? allTabs[0]!;

  const branches = useQuery({
    queryKey: ['branches'],
    queryFn: () => branchesApi.list(),
    enabled: isAdmin,
    staleTime: 5 * 60_000,
  });

  const query = useQuery({
    queryKey: ['bookings', 'inbox', { tab: active.id, branchId, page }],
    queryFn: () =>
      bookingsApi.history({
        ...active.params,
        branchId: isAdmin && branchId ? Number(branchId) : undefined,
        page,
        pageSize: PAGE_SIZE,
      }),
    // Keeps the previous page on screen while the next one loads, so paging
    // does not flash an empty table.
    placeholderData: keepPreviousData,
  });

  const bookings = query.data?.bookings ?? [];

  function selectTab(id: string) {
    setTabId(id);
    setPage(1);
  }

  return (
    <div>
      <PageHeader title="Hộp thư vận hành" description="Mọi đơn, nhóm theo tình trạng thực tế." />

      {/* Tabs. Horizontally scrollable so sixteen of them survive a phone. */}
      <div
        role="tablist"
        aria-label="Nhóm đơn"
        className="mb-4 flex gap-1.5 overflow-x-auto pb-1"
      >
        {allTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={tab.id === active.id}
            onClick={() => selectTab(tab.id)}
            data-testid={`inbox-tab-${tab.id}`}
            className={`min-h-[2.5rem] shrink-0 whitespace-nowrap rounded-full px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 ${
              tab.id === active.id
                ? 'bg-brand-600 text-white'
                : 'border border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {isAdmin ? (
        <div className="mb-4">
          <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="inbox-branch">
            Chi nhánh
          </label>
          <select
            id="inbox-branch"
            value={branchId}
            onChange={(e) => {
              setBranchId(e.target.value);
              setPage(1);
            }}
            className="min-h-[2.75rem] rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
          >
            <option value="">Tất cả chi nhánh</option>
            {branches.data?.branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.address}
              </option>
            ))}
          </select>
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
              icon={<Inbox className="h-6 w-6" aria-hidden="true" />}
              title="Không có đơn nào"
              message={`Không có đơn nào trong nhóm "${active.label}".`}
            />
          ) : (
            <Card className="overflow-hidden">
              {/* A table on a wide screen, stacked cards on a narrow one. */}
              <ul className="divide-y divide-slate-100 md:hidden">
                {bookings.map((b) => (
                  <li key={b.id}>
                    <button
                      type="button"
                      onClick={() => navigate(`/app/booking/${b.id}`)}
                      className="w-full px-4 py-3 text-left hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-600"
                    >
                      <BookingRowSummary booking={b} />
                    </button>
                  </li>
                ))}
              </ul>

              <div className="hidden overflow-x-auto md:block">
                <table className="w-full text-sm">
                  <caption className="sr-only">{`Danh sách đơn: ${active.label}`}</caption>
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                      <th scope="col" className="px-4 py-3">Mã Booking</th>
                      <th scope="col" className="px-4 py-3">Khách</th>
                      <th scope="col" className="px-4 py-3">Chi nhánh</th>
                      <th scope="col" className="px-4 py-3">Nhận phòng</th>
                      <th scope="col" className="px-4 py-3">Hạng phòng (SL)</th>
                      <th scope="col" className="px-4 py-3">Giá tổng</th>
                      <th scope="col" className="px-4 py-3">Trạng thái</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bookings.map((b) => (
                      <tr
                        key={b.id}
                        onClick={() => navigate(`/app/booking/${b.id}`)}
                        className="cursor-pointer border-b border-slate-100 last:border-b-0 hover:bg-slate-50"
                        data-testid="inbox-row"
                      >
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap items-center gap-2">
                            {b.isLastMinute ? <LastMinuteBadge /> : null}
                            {/*
                              A keyboard user tabs to this link; the row click is
                              a mouse convenience layered on top, never the only
                              way in.
                            */}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                navigate(`/app/booking/${b.id}`);
                              }}
                              className="rounded font-mono text-slate-900 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
                            >
                              {b.bookingCode ?? '—'}
                            </button>
                            <SourceBadge source={b.sourcePlatform} />
                          </div>
                        </td>
                        <td className="px-4 py-3 text-slate-800">{b.customerName ?? '—'}</td>
                        <td className="px-4 py-3 text-slate-600">{b.branch?.address ?? '—'}</td>
                        <td className="px-4 py-3 text-slate-600">{formatDate(b.checkInDate)}</td>
                        <td className="px-4 py-3 text-slate-700">
                          <RoomSummary summary={b.roomSummary} />
                        </td>
                        <td className="px-4 py-3 font-bold text-slate-900">
                          {b.totalAmount != null ? formatMoney(b.totalAmount, b.currency) : 'Chưa xác định'}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            <StatusBadge status={b.status} />
                            <VerificationBadge status={b.verificationStatus} />
                          </div>
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

/** The same booking, stacked for a narrow screen. */
function BookingRowSummary({ booking: b }: { booking: HistoryListItem }) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        {b.isLastMinute ? <LastMinuteBadge /> : null}
        <StatusBadge status={b.status} />
        <SourceBadge source={b.sourcePlatform} />
        <BusinessTypeBadge type={b.businessType} />
      </div>
      <p className="mt-1.5 font-medium text-slate-900">{b.customerName ?? '—'}</p>
      <p className="font-mono text-xs text-slate-500">{b.bookingCode ?? '—'}</p>
      <p className="mt-1 text-sm text-slate-600">
        {formatDate(b.checkInDate)} · {b.branch?.address ?? '—'}
      </p>
      <p className="text-sm font-semibold text-slate-900">
        {b.totalAmount != null ? formatMoney(b.totalAmount, b.currency) : 'Chưa xác định'}
      </p>
    </>
  );
}

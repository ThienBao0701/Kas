import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw, RotateCcw, ScanSearch } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import {
  bookingsApi,
  branchesApi,
  REVIEW_REASON_LABEL,
  type BookingDetail,
  type NewListItem,
} from '../api/bookings';
import { toUserMessage } from '../api/errors';
import { Card } from '../components/Card';
import { EmptyState } from '../components/EmptyState';
import { ErrorAlert } from '../components/ErrorAlert';
import { ConnectionWarning } from '../components/ConnectionWarning';
import { SkeletonList } from '../components/Skeleton';
import { LastMinuteBadge, SourceBadge } from '../components/Badges';
import { InlineSpinner, PageHeader } from '../components/PageState';
import { BookingDetailView } from '../components/BookingDetailView';
import { Toast } from '../components/Toast';
import { useCut } from '../hooks/useCut';
import { formatDate, formatDateTime } from '../lib/format';

const POLL_MS = 20_000;

type Variant = 'pending-review' | 'rejected';

const COPY: Record<Variant, { adminTitle: string; recTitle: string; description: string; empty: string; icon: typeof ScanSearch }> = {
  'pending-review': {
    adminTitle: 'Chờ kiểm tra',
    recTitle: 'Chờ Admin kiểm tra',
    description: 'Đơn đã có ảnh chứng minh, đang chờ Admin đối chiếu và xác nhận.',
    empty: 'Không có đơn nào đang chờ kiểm tra.',
    icon: ScanSearch,
  },
  rejected: {
    adminTitle: 'Cần tạo lại',
    recTitle: 'Cần tạo lại',
    description: 'Đơn bị Admin từ chối, cần chi nhánh kiểm tra và tạo lại rồi gửi ảnh mới.',
    empty: 'Không có đơn nào cần tạo lại.',
    icon: RotateCcw,
  },
};

export function PendingReviewPage() {
  return <VerificationInbox variant="pending-review" />;
}
export function RejectedPage() {
  return <VerificationInbox variant="rejected" />;
}

function VerificationInbox({ variant }: { variant: Variant }) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const copy = COPY[variant];
  const Icon = copy.icon;

  const [searchParams] = useSearchParams();
  const [branchId, setBranchId] = useState<number | undefined>(() => {
    const p = searchParams.get('branchId');
    return p ? Number(p) : undefined;
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const lastIndexRef = useRef(0);

  const branches = useQuery({
    queryKey: ['branches'],
    queryFn: () => branchesApi.list(),
    staleTime: 5 * 60_000,
    enabled: isAdmin,
  });

  const listFn = variant === 'pending-review' ? bookingsApi.listPendingReview : bookingsApi.listRejected;
  const list = useQuery({
    queryKey: ['bookings', variant, { branchId }],
    queryFn: () => listFn({ branchId, pageSize: 100 }),
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: true,
  });

  const bookings = useMemo(() => list.data?.bookings ?? [], [list.data]);

  useEffect(() => {
    if (bookings.length === 0) {
      if (selectedId !== null) setSelectedId(null);
      return;
    }
    const idx = bookings.findIndex((b) => b.id === selectedId);
    if (idx >= 0) {
      lastIndexRef.current = idx;
      return;
    }
    const nextIdx = Math.min(lastIndexRef.current, bookings.length - 1);
    lastIndexRef.current = nextIdx;
    setSelectedId(bookings[nextIdx]!.id);
  }, [bookings, selectedId]);

  const staleWarning = list.failureReason != null && list.data != null;

  if (list.isError && !list.data) {
    return (
      <div>
        <PageHeader title={isAdmin ? copy.adminTitle : copy.recTitle} description={copy.description} />
        <ErrorAlert>{toUserMessage(list.error)}</ErrorAlert>
        <div className="mt-3">
          <button
            type="button"
            onClick={() => void list.refetch()}
            className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            Thử lại
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={isAdmin ? copy.adminTitle : copy.recTitle}
        description={copy.description}
        actions={
          <div className="flex items-center gap-2">
            {isAdmin ? (
              <select
                value={branchId ?? ''}
                onChange={(e) => setBranchId(e.target.value ? Number(e.target.value) : undefined)}
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
            ) : null}
            <button
              type="button"
              onClick={() => void list.refetch()}
              aria-label="Làm mới danh sách"
              className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
            >
              <RefreshCw className={`h-4 w-4 ${list.isFetching ? 'animate-spin' : ''}`} aria-hidden="true" />
              Làm mới
            </button>
          </div>
        }
      />

      {staleWarning ? (
        <div className="mb-3">
          <ConnectionWarning onRetry={() => void list.refetch()} />
        </div>
      ) : null}

      {list.isLoading ? (
        <SkeletonList rows={6} />
      ) : bookings.length === 0 ? (
        <EmptyState icon={<Icon className="h-6 w-6" aria-hidden="true" />} title="Không có đơn nào" message={copy.empty} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[38%_1fr] lg:items-start">
          <Card className="overflow-hidden lg:sticky lg:top-4">
            <ul className="max-h-[calc(100vh-12rem)] divide-y divide-slate-100 overflow-y-auto" aria-label="Danh sách đơn">
              {bookings.map((b) => (
                <li key={b.id}>
                  <Row
                    booking={b}
                    variant={variant}
                    selected={b.id === selectedId}
                    onSelect={() => {
                      setSelectedId(b.id);
                      lastIndexRef.current = bookings.findIndex((x) => x.id === b.id);
                    }}
                  />
                </li>
              ))}
            </ul>
          </Card>

          <div>{selectedId ? <SelectedPanel id={selectedId} isAdmin={isAdmin} onChanged={setToast} /> : null}</div>
        </div>
      )}

      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  );
}

function Row({
  booking: b,
  variant,
  selected,
  onSelect,
}: {
  booking: NewListItem;
  variant: Variant;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? 'true' : undefined}
      className={`block w-full px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-600 ${
        selected ? 'bg-brand-50' : 'hover:bg-slate-50'
      } ${b.isLastMinute ? 'border-l-4 border-l-red-500' : 'border-l-4 border-l-transparent'}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-medium text-slate-900">{b.customerName ?? 'Khách chưa rõ'}</span>
        {b.isLastMinute ? <LastMinuteBadge /> : null}
      </div>
      <div className="mt-0.5 flex items-center justify-between gap-2 text-xs">
        <span className="font-mono text-slate-500">{b.bookingCode ?? '—'}</span>
        <SourceBadge source={b.sourcePlatform} />
      </div>
      <div className="mt-1 flex items-center justify-between gap-2 text-xs text-slate-500">
        <span>Nhận phòng: {formatDate(b.checkInDate)}</span>
        {b.branch ? <span className="truncate">{b.branch.address}</span> : null}
      </div>
      {variant === 'pending-review' && b.submittedAt ? (
        <p className="mt-1 text-xs text-amber-600">Gửi ảnh {formatDateTime(b.submittedAt)} · lần {b.latestAttemptNumber}</p>
      ) : null}
      {variant === 'rejected' && b.latestRejectionReason ? (
        <p className="mt-1 text-xs text-red-600">Lý do: {REVIEW_REASON_LABEL[b.latestRejectionReason]}</p>
      ) : null}
    </button>
  );
}

function SelectedPanel({ id, isAdmin, onChanged }: { id: string; isAdmin: boolean; onChanged: (m: string) => void }) {
  const query = useQuery({
    queryKey: ['booking', id],
    queryFn: () => bookingsApi.detail(id),
    enabled: id.length > 0,
  });

  if (query.isLoading) return <InlineSpinner />;
  if (query.isError) return <ErrorAlert>{toUserMessage(query.error)}</ErrorAlert>;
  if (!query.data) return null;
  const booking = query.data.booking;
  return (
    <VerificationBookingBody
      booking={booking}
      isAdmin={isAdmin}
      serverNow={query.data.serverNow ?? null}
      onChanged={onChanged}
    />
  );
}

/**
 * Separate component so the CẮT hook runs unconditionally, above the query's
 * early returns.
 *
 * "Cần tạo lại" is the same creation work as a fresh dispatch — the receptionist
 * recreates the reservation — so it carries the same duplicate risk and the same
 * claim. "Chờ kiểm tra" carries neither: the work is already done and there is
 * nothing left to take, so the CẮT controls are absent there and the fields keep
 * their ordinary copy buttons.
 */
function VerificationBookingBody({
  booking,
  isAdmin,
  serverNow,
  onChanged,
}: {
  booking: BookingDetail;
  isAdmin: boolean;
  serverNow: string | null;
  onChanged: (m: string) => void;
}) {
  const cut = useCut(booking.id, booking.cutFields, booking);
  const claimable = !isAdmin && booking.verificationStatus === 'REJECTED';
  return (
    <BookingDetailView
      booking={booking}
      isAdmin={isAdmin}
      onCompleted={(m) => onChanged(m ?? 'Đã cập nhật đơn.')}
      suppressInternalToast
      serverNow={serverNow}
      {...(claimable ? { cut } : {})}
    />
  );
}

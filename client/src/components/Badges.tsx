import { Flame } from 'lucide-react';
import type { BookingSource, BookingStatus, BusinessType, VerificationStatus } from '../api/bookings';
import { SOURCE_LABEL } from '../api/bookings';
import { statusLabel, verificationLabel } from '../lib/format';

/**
 * Business-type badge. PARTNER shows a prominent "ĐƠN ĐỐI TÁC" chip and UNKNOWN a
 * "CHƯA XÁC ĐỊNH LOẠI ĐƠN" chip; an ordinary DIRECT booking shows nothing (no
 * badge needed for the common case).
 */
export function BusinessTypeBadge({ type }: { type: BusinessType }) {
  if (type === 'DIRECT') return null;
  const styles =
    type === 'PARTNER'
      ? 'bg-orange-100 text-orange-800 ring-1 ring-inset ring-orange-200'
      : 'bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200';
  const label = type === 'PARTNER' ? 'ĐƠN ĐỐI TÁC' : 'CHƯA XÁC ĐỊNH LOẠI ĐƠN';
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${styles}`}>
      {label}
    </span>
  );
}

const STATUS_STYLES: Record<BookingStatus, string> = {
  DRAFT: 'bg-slate-100 text-slate-600',
  READY: 'bg-blue-100 text-blue-700',
  NEW: 'bg-amber-100 text-amber-800',
  COMPLETED: 'bg-green-100 text-green-700',
  ARCHIVED: 'bg-slate-100 text-slate-500',
};

export function StatusBadge({ status }: { status: BookingStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}>
      {statusLabel(status)}
    </span>
  );
}

const VERIFICATION_STYLES: Record<VerificationStatus, string> = {
  NOT_SUBMITTED: 'bg-slate-100 text-slate-600',
  PENDING_REVIEW: 'bg-amber-100 text-amber-800',
  APPROVED: 'bg-green-100 text-green-700',
  REJECTED: 'bg-red-100 text-red-700',
};

export function VerificationBadge({ status }: { status: VerificationStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${VERIFICATION_STYLES[status]}`}>
      {verificationLabel(status)}
    </span>
  );
}

const SOURCE_STYLES: Record<BookingSource, string> = {
  BOOKING_COM: 'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200',
  AGODA: 'bg-fuchsia-50 text-fuchsia-700 ring-1 ring-inset ring-fuchsia-200',
};

/** A small chip naming the source platform a booking was imported from. */
export function SourceBadge({ source }: { source: BookingSource }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${SOURCE_STYLES[source]}`}>
      {SOURCE_LABEL[source]}
    </span>
  );
}

/**
 * The 🔥 LAST MINUTE indicator for check-in-today bookings.
 * `withSubtitle` adds the "Nhận phòng hôm nay" line used on the detail/list header.
 */
export function LastMinuteBadge({ withSubtitle = false }: { withSubtitle?: boolean }) {
  if (withSubtitle) {
    return (
      <span className="inline-flex flex-col rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-red-700">
        <span className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wide">
          <Flame className="h-3.5 w-3.5" aria-hidden="true" />
          Last minute
        </span>
        <span className="text-[0.7rem] font-medium text-red-600">Nhận phòng hôm nay</span>
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide text-red-700"
      title="Nhận phòng hôm nay"
    >
      <Flame className="h-3.5 w-3.5" aria-hidden="true" />
      Last minute
    </span>
  );
}

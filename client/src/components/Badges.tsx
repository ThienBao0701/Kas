import { Flame } from 'lucide-react';
import type { BookingStatus } from '../api/bookings';
import { statusLabel } from '../lib/format';

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

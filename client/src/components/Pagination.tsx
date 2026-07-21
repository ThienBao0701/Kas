import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { Pagination as PaginationMeta } from '../api/bookings';

interface PaginationProps {
  meta: PaginationMeta;
  onChange: (page: number) => void;
}

/** Simple page stepper shown only when there is more than one page. */
export function Pagination({ meta, onChange }: PaginationProps) {
  if (meta.total === 0) return null;
  const from = (meta.page - 1) * meta.pageSize + 1;
  const to = Math.min(meta.page * meta.pageSize, meta.total);

  return (
    <div className="flex items-center justify-between px-1 py-2 text-sm text-slate-500">
      <span>
        {from}–{to} trên {meta.total}
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={meta.page <= 1}
          onClick={() => onChange(meta.page - 1)}
          aria-label="Trang trước"
          className="inline-flex items-center rounded-lg border border-slate-200 p-1.5 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </button>
        <span className="px-2">
          {meta.page}/{meta.totalPages}
        </span>
        <button
          type="button"
          disabled={meta.page >= meta.totalPages}
          onClick={() => onChange(meta.page + 1)}
          aria-label="Trang sau"
          className="inline-flex items-center rounded-lg border border-slate-200 p-1.5 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

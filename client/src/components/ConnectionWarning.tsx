import { WifiOff } from 'lucide-react';

/**
 * Shown when a background refresh fails but we still have the last good data on
 * screen. It never blanks the data — it only warns that it may be stale and
 * offers a manual retry.
 */
export function ConnectionWarning({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800"
    >
      <span className="flex items-center gap-2">
        <WifiOff className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
        Không thể kết nối đến máy chủ. Dữ liệu đang hiển thị có thể chưa được cập nhật.
      </span>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-lg border border-amber-300 bg-white px-3 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
      >
        Thử lại
      </button>
    </div>
  );
}

import { useEffect } from 'react';
import { CheckCircle2, X } from 'lucide-react';

/**
 * A lightweight success toast. Rendered near the action that triggered it and
 * auto-dismissed; `message = null` renders nothing. Uses role="status" so
 * screen readers announce the confirmation without stealing focus.
 */
export function Toast({
  message,
  onDone,
  durationMs = 3000,
}: {
  message: string | null;
  onDone: () => void;
  durationMs?: number;
}) {
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(onDone, durationMs);
    return () => clearTimeout(t);
  }, [message, durationMs, onDone]);

  if (!message) return null;

  return (
    <div className="fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
      <div
        role="status"
        className="flex items-center gap-2 rounded-xl border border-green-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-800 shadow-lg"
      >
        <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-green-600" aria-hidden="true" />
        <span>{message}</span>
        <button
          type="button"
          onClick={onDone}
          aria-label="Đóng thông báo"
          className="ml-1 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

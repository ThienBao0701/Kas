import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck, Flame } from 'lucide-react';
import { notificationsApi, type NotificationItem } from '../api/notifications';
import { toUserMessage } from '../api/errors';
import { relativeTime } from '../lib/format';

const POLL_MS = 20_000;

function isLastMinute(n: NotificationItem): boolean {
  return n.title.toUpperCase().includes('LAST MINUTE');
}

/** Fire a subtle browser notification only if permission is already granted. */
function maybeBrowserNotify(count: number): void {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  try {
    new Notification('Kas — Có cập nhật mới', {
      body: `Bạn có ${count} thông báo chưa đọc.`,
      tag: 'kas-unread',
    });
  } catch {
    // ignore — notifications are best-effort
  }
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const prevCount = useRef<number | null>(null);

  const unread = useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: () => notificationsApi.unreadCount(),
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: true,
  });

  const list = useQuery({
    queryKey: ['notifications', 'list'],
    queryFn: () => notificationsApi.list(1, 15),
    enabled: open,
  });

  const count = unread.data?.count ?? 0;

  // Subtle browser notification when the unread count rises (permission granted only).
  useEffect(() => {
    if (prevCount.current !== null && count > prevCount.current) maybeBrowserNotify(count);
    prevCount.current = count;
  }, [count]);

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['notifications'] });
  const markOne = useMutation({ mutationFn: (id: string) => notificationsApi.markRead(id), onSuccess: invalidate });
  const markAll = useMutation({ mutationFn: () => notificationsApi.markAllRead(), onSuccess: invalidate });

  const onItem = (n: NotificationItem) => {
    if (!n.read) markOne.mutate(n.id);
    setOpen(false);
    if (n.bookingId) navigate(`/app/booking/${n.bookingId}`);
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Thông báo${count > 0 ? ` (${count} chưa đọc)` : ''}`}
        className="relative rounded-lg p-2 text-slate-600 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
      >
        <Bell className="h-5 w-5" aria-hidden="true" />
        {count > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 inline-flex min-w-[1.15rem] items-center justify-center rounded-full bg-red-600 px-1 text-[0.65rem] font-bold leading-none text-white">
            {count > 99 ? '99+' : count}
          </span>
        ) : null}
      </button>

      {open ? (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="absolute right-0 z-40 mt-2 w-80 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <p className="text-sm font-semibold text-slate-800">Thông báo</p>
              <button
                type="button"
                onClick={() => markAll.mutate()}
                disabled={count === 0 || markAll.isPending}
                className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700 disabled:opacity-40"
              >
                <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" />
                Đọc tất cả
              </button>
            </div>
            <div className="max-h-96 overflow-y-auto">
              {list.isLoading ? (
                <p className="px-4 py-6 text-center text-sm text-slate-400">Đang tải…</p>
              ) : list.isError ? (
                <div className="px-4 py-6 text-center text-sm text-red-600">
                  {toUserMessage(list.error)}
                  <button type="button" onClick={() => void list.refetch()} className="mt-2 block w-full text-brand-600 underline">
                    Thử lại
                  </button>
                </div>
              ) : (list.data?.notifications.length ?? 0) === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-slate-400">Chưa có thông báo.</p>
              ) : (
                list.data!.notifications.map((n) => {
                  const lastMin = isLastMinute(n);
                  return (
                    <button
                      key={n.id}
                      type="button"
                      onClick={() => onItem(n)}
                      className={`block w-full border-b border-slate-100 px-4 py-3 text-left last:border-b-0 hover:bg-slate-50 ${
                        n.read ? '' : lastMin ? 'bg-red-50/70' : 'bg-brand-50/50'
                      } ${lastMin ? 'border-l-4 border-l-red-400' : ''}`}
                    >
                      <p className={`flex items-center gap-1.5 text-sm font-semibold ${lastMin ? 'text-red-700' : 'text-slate-800'}`}>
                        {lastMin ? <Flame className="h-3.5 w-3.5" aria-hidden="true" /> : n.read ? null : <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-brand-600" />}
                        {n.title}
                      </p>
                      <p className="mt-0.5 whitespace-pre-line text-sm text-slate-600">{n.body}</p>
                      <p className="mt-1 text-xs text-slate-400">{relativeTime(n.createdAt)}</p>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

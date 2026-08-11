/**
 * "Nhắc nhở" — one screen, two audiences.
 *
 * An Admin writes to ONE named receptionist and sees what they have sent, with
 * whether it was read. A receptionist sees only their own inbox; the filtering
 * is done in the database by `recipientUserId`, so this component never has to
 * be trusted to hide anything.
 *
 * Deliberately separate from the notification bell: that stream is
 * system-generated booking events, and mixing Admin prose into it would distort
 * the unread badge reception uses to spot new work.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Check, Send } from 'lucide-react';
import { remindersApi, REMINDER_POLL_MS, type ReminderView } from '../api/reminders';
import { adminUsersApi } from '../api/adminUsers';
import { toUserMessage } from '../api/errors';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { ErrorAlert } from '../components/ErrorAlert';
import { SkeletonList } from '../components/Skeleton';
import { PageHeader } from '../components/PageState';
import { Toast } from '../components/Toast';
import { formatDateTime } from '../lib/format';
import { useAuth } from '../auth/AuthProvider';

/** Admin: pick one receptionist, write, send. */
function ComposeReminder({ onSent }: { onSent: () => void }) {
  const queryClient = useQueryClient();
  const [recipientId, setRecipientId] = useState<string>('');
  const [body, setBody] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const users = useQuery({
    queryKey: ['admin-users'],
    queryFn: () => adminUsersApi.list(),
    staleTime: 5 * 60_000,
  });

  // Only ACTIVE receptionists. A disabled account would take the message and
  // never show it to anyone, while the Admin believed it was delivered.
  const receptionists = (users.data?.users ?? []).filter(
    (u) => u.role === 'RECEPTIONIST' && u.active,
  );

  const send = useMutation({
    mutationFn: () => remindersApi.create(Number(recipientId), body.trim()),
    onSuccess: () => {
      setBody('');
      setRecipientId('');
      setFormError(null);
      void queryClient.invalidateQueries({ queryKey: ['reminders'] });
      onSent();
    },
    onError: (e) => setFormError(toUserMessage(e)),
  });

  return (
    <Card className="p-5">
      <p className="mb-3 text-sm font-semibold text-slate-700">Gửi nhắc nhở</p>
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-sm text-slate-600" htmlFor="reminder-recipient">
            Người nhận
          </label>
          <select
            id="reminder-recipient"
            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
            value={recipientId}
            disabled={send.isPending}
            onChange={(e) => setRecipientId(e.target.value)}
          >
            <option value="">— Chọn lễ tân —</option>
            {receptionists.map((u) => (
              <option key={u.id} value={u.id}>
                {u.fullName} ({u.username})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm text-slate-600" htmlFor="reminder-body">
            Nội dung
          </label>
          <textarea
            id="reminder-body"
            data-testid="reminder-body"
            className="min-h-[96px] w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
            value={body}
            disabled={send.isPending}
            onChange={(e) => {
              setBody(e.target.value);
              if (formError) setFormError(null);
            }}
          />
        </div>
        {formError ? <ErrorAlert>{formError}</ErrorAlert> : null}
        <Button
          disabled={send.isPending}
          data-testid="reminder-send"
          onClick={() => {
            if (recipientId === '') {
              setFormError('Vui lòng chọn lễ tân nhận nhắc nhở.');
              return;
            }
            if (body.trim().length === 0) {
              setFormError('Vui lòng nhập nội dung nhắc nhở.');
              return;
            }
            send.mutate();
          }}
        >
          <Send className="h-4 w-4" aria-hidden="true" />
          {send.isPending ? 'Đang gửi…' : 'Gửi'}
        </Button>
      </div>
    </Card>
  );
}

function ReminderRow({ reminder: r, canRead }: { reminder: ReminderView; canRead: boolean }) {
  const queryClient = useQueryClient();
  const markRead = useMutation({
    mutationFn: () => remindersApi.markRead(r.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['reminders'] });
      void queryClient.invalidateQueries({ queryKey: ['reminders', 'unread-count'] });
    },
  });

  return (
    <li
      data-testid="reminder-item"
      className={`px-4 py-3 ${r.read ? '' : 'bg-amber-50/60'}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={`whitespace-pre-wrap break-words text-sm ${r.read ? 'text-slate-700' : 'font-medium text-slate-900'}`}>
            {r.body}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            {r.sender ? `Từ ${r.sender.fullName} · ` : ''}
            {r.recipient ? `Gửi ${r.recipient.fullName} · ` : ''}
            {formatDateTime(r.createdAt)}
          </p>
        </div>
        {r.read ? (
          <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
            <Check className="h-3.5 w-3.5" aria-hidden="true" />
            Đã đọc
          </span>
        ) : canRead ? (
          <Button
            variant="secondary"
            onClick={() => markRead.mutate()}
            disabled={markRead.isPending}
            data-testid={`reminder-read-${r.id}`}
          >
            Đánh dấu đã đọc
          </Button>
        ) : (
          <span className="whitespace-nowrap rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
            Chưa đọc
          </span>
        )}
      </div>
    </li>
  );
}

export function RemindersPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const [toast, setToast] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ['reminders'],
    queryFn: () => remindersApi.list(),
    refetchInterval: isAdmin ? false : REMINDER_POLL_MS,
  });

  const reminders = list.data?.reminders ?? [];
  const unread = reminders.filter((r) => !r.read).length;

  return (
    <div className="space-y-4">
      <PageHeader
        title={unread > 0 && !isAdmin ? `Nhắc nhở (${unread})` : 'Nhắc nhở'}
        description={
          isAdmin
            ? 'Gửi nhắc nhở riêng cho một lễ tân và xem họ đã đọc chưa.'
            : 'Nhắc nhở Admin gửi riêng cho bạn.'
        }
      />

      {isAdmin ? <ComposeReminder onSent={() => setToast('Đã gửi nhắc nhở.')} /> : null}

      {list.isLoading ? (
        <SkeletonList rows={3} />
      ) : list.isError ? (
        <ErrorAlert>{toUserMessage(list.error)}</ErrorAlert>
      ) : reminders.length === 0 ? (
        <EmptyState
          icon={<Bell className="h-6 w-6" aria-hidden="true" />}
          title="Chưa có nhắc nhở"
          message={isAdmin ? 'Nhắc nhở bạn gửi sẽ hiện ở đây.' : 'Khi Admin gửi nhắc nhở, nó sẽ hiện ở đây.'}
        />
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-slate-100" data-testid="reminder-list">
            {reminders.map((r) => (
              <ReminderRow key={r.id} reminder={r} canRead={!isAdmin} />
            ))}
          </ul>
        </Card>
      )}

      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  );
}

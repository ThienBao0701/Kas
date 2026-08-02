import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  LIFECYCLE_DESTRUCTIVE,
  LIFECYCLE_LABEL,
  LIFECYCLE_NEXT,
  bookingsApi,
  type BookingDetail,
  type LifecycleAction,
} from '../api/bookings';
import { toUserMessage } from '../api/errors';
import { statusLabel } from '../lib/format';
import { Button } from './Button';
import { Card } from './Card';
import { ErrorAlert } from './ErrorAlert';
import { Modal } from './Modal';

/**
 * The operational lifecycle, as buttons.
 *
 * Phase 5 built these six transitions on the server and nothing could reach
 * them: a booking dispatched to a branch could never be marked received, and
 * the operational statuses were unreachable in practice. This is the control
 * surface for them.
 *
 * Which buttons appear comes from `LIFECYCLE_NEXT`, a mirror of the server's
 * transition map. That mirror decides only what is DRAWN — the server
 * re-validates every transition, so a stale tab posting an action that is no
 * longer legal gets a 409 and the list refreshes, rather than writing.
 *
 * Cancel and no-show ask first. They are the two that cost the hotel money and
 * neither can be undone through this UI.
 */
export function LifecycleActions({
  booking,
  onChanged,
}: {
  booking: BookingDetail;
  onChanged?: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState<LifecycleAction | null>(null);
  const [reason, setReason] = useState('');

  const mutation = useMutation({
    mutationFn: ({ action, note }: { action: LifecycleAction; note?: string }) =>
      bookingsApi.lifecycle(booking.id, action, note),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['booking', booking.id] });
      void queryClient.invalidateQueries({ queryKey: ['bookings'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      setConfirming(null);
      setReason('');
      onChanged?.(`Đã chuyển sang: ${statusLabel(result.newStatus)}`);
    },
  });

  const actions = LIFECYCLE_NEXT[booking.status] ?? [];
  if (actions.length === 0 && !mutation.isError) return null;

  function run(action: LifecycleAction) {
    if (LIFECYCLE_DESTRUCTIVE.includes(action)) {
      setConfirming(action);
      return;
    }
    mutation.mutate({ action });
  }

  return (
    <Card className="p-5" data-testid="lifecycle-actions">
      <p className="mb-3 text-sm font-semibold text-slate-700">Thao tác vận hành</p>

      {mutation.isError ? (
        <div className="mb-3">
          <ErrorAlert>{toUserMessage(mutation.error)}</ErrorAlert>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {actions.map((action) => (
          <Button
            key={action}
            variant={LIFECYCLE_DESTRUCTIVE.includes(action) ? 'secondary' : 'primary'}
            // Only the button being submitted shows a spinner, but every button
            // is disabled — a double transition is not recoverable.
            loading={mutation.isPending && mutation.variables?.action === action}
            disabled={mutation.isPending}
            onClick={() => run(action)}
            data-testid={`lifecycle-${action}`}
          >
            {LIFECYCLE_LABEL[action]}
          </Button>
        ))}
      </div>

      <Modal
        open={confirming !== null}
        title={confirming ? LIFECYCLE_LABEL[confirming] : ''}
        onClose={() => {
          setConfirming(null);
          setReason('');
        }}
        footer={
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setConfirming(null);
                setReason('');
              }}
            >
              Quay lại
            </Button>
            <Button
              variant="danger"
              loading={mutation.isPending}
              onClick={() => confirming && mutation.mutate({ action: confirming, note: reason || undefined })}
              data-testid="lifecycle-confirm"
            >
              Xác nhận
            </Button>
          </div>
        }
      >
        <p className="text-sm text-slate-600">
          Đơn <span className="font-mono">{booking.bookingCode ?? '—'}</span> của khách{' '}
          <span className="font-medium">{booking.customerName ?? 'chưa rõ'}</span> sẽ được đánh dấu{' '}
          <span className="font-medium">{confirming ? LIFECYCLE_LABEL[confirming] : ''}</span>. Thao tác này
          không thể hoàn tác tại đây.
        </p>
        <label className="mt-4 block">
          <span className="mb-1 block text-xs font-medium text-slate-500">Lý do (không bắt buộc)</span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            maxLength={500}
            className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
          />
        </label>
      </Modal>
    </Card>
  );
}

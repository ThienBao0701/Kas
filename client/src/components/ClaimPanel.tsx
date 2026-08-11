/**
 * The CUT panel — where a receptionist takes ownership of a dispatched order.
 *
 * WHAT THIS IS FOR: every receptionist at a branch sees the same queue, so two
 * of them can create the same reservation in the hotel system. CUT is the lock
 * that prevents it. The countdown beside it is a deadline on holding the lock,
 * not the protection itself — the server refuses a late or foreign submission
 * regardless of what this panel shows.
 *
 * "Sao chép PMS Note" is untouched and still lives in the booking detail below:
 * copying is how the receptionist actually creates the reservation, and CUT is
 * a separate question about who is allowed to. The two are not alternatives.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Scissors, Lock, CheckCircle2 } from 'lucide-react';
import { bookingsApi, type ClaimFields } from '../api/bookings';
import { toUserMessage } from '../api/errors';
import { Card } from './Card';
import { Button } from './Button';
import { ErrorAlert } from './ErrorAlert';
import { ClaimCountdown } from './ClaimCountdown';
import { useAuth } from '../auth/AuthProvider';
import { claimStateOf, DUPLICATE_WARNING } from '../lib/claim';

export function ClaimPanel({
  booking,
  bookingId,
  onChanged,
}: {
  booking: ClaimFields;
  bookingId: string;
  onChanged?: () => void;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const state = claimStateOf(booking, user?.id);

  const claim = useMutation({
    mutationFn: () => bookingsApi.claim(bookingId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['booking', bookingId] });
      void queryClient.invalidateQueries({ queryKey: ['bookings'] });
      onChanged?.();
    },
  });

  // An Admin has no creation work to own; showing them CUT would invite them to
  // hide an order from the branch that has to act on it.
  if (user?.role !== 'RECEPTIONIST') return null;

  if (state === 'MINE') {
    return (
      <Card className="border-emerald-200 bg-emerald-50/40 p-5" data-testid="claim-panel">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="inline-flex items-center gap-2 text-sm font-semibold text-emerald-800">
            <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
            Bạn đã nhận đơn này
          </p>
          <ClaimCountdown
            expiresAt={booking.claimExpiresAt!}
            onExpired={() => {
              // Re-read from the server rather than mutating local state: the
              // server decides whether this lapsed, and a refetch is how the
              // order leaves the queue.
              void queryClient.invalidateQueries({ queryKey: ['booking', bookingId] });
              void queryClient.invalidateQueries({ queryKey: ['bookings'] });
            }}
          />
        </div>
        <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2.5 text-sm font-medium text-amber-900 ring-1 ring-inset ring-amber-200">
          {DUPLICATE_WARNING}
        </p>
      </Card>
    );
  }

  if (state === 'OTHERS') {
    return (
      <Card className="border-slate-200 bg-slate-50 p-5" data-testid="claim-panel">
        <p className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
          <Lock className="h-5 w-5" aria-hidden="true" />
          {booking.claimedBy?.fullName
            ? `${booking.claimedBy.fullName} đang xử lý đơn này`
            : 'Lễ tân khác đang xử lý đơn này'}
        </p>
        <p className="mt-1 text-sm text-slate-600">
          Bạn không thể nhận hoặc gửi ảnh cho đơn này. Nếu quá 3 phút mà chưa xong, Admin sẽ gửi lại
          đơn.
        </p>
      </Card>
    );
  }

  // UNCLAIMED or EXPIRED — both are takeable. An expired claim is released by
  // the server's condition, so CUT works here without waiting for an Admin.
  return (
    <Card className="p-5" data-testid="claim-panel">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-800">Nhận đơn để tạo trên hệ thống</p>
          <p className="mt-0.5 text-sm text-slate-600">
            Bấm CUT để nhận đơn. Bạn có 3 phút để tạo đơn và gửi ảnh cho Admin.
          </p>
        </div>
        <Button onClick={() => claim.mutate()} disabled={claim.isPending} data-testid="claim-cut">
          <Scissors className="h-4 w-4" aria-hidden="true" />
          {claim.isPending ? 'Đang nhận…' : 'CUT'}
        </Button>
      </div>
      {state === 'EXPIRED' ? (
        <p className="mt-2 text-xs text-slate-500">
          Lượt nhận trước đã hết thời gian. Bạn có thể nhận lại đơn này.
        </p>
      ) : null}
      {claim.isError ? (
        <div className="mt-3">
          <ErrorAlert>{toUserMessage(claim.error)}</ErrorAlert>
        </div>
      ) : null}
    </Card>
  );
}

/**
 * Reception shift check-in, and the indicator that says which shift is running.
 *
 * WHY IT LIVES IN THE SHELL AND NOT ON A PAGE
 *
 * A shift is not a property of one screen: the receptionist is on it whichever
 * page they are looking at, and the check-in has to survive a refresh, a second
 * tab and a reopened laptop. So the current shift is fetched from the server on
 * every load rather than held in React state, and the whole authenticated shell
 * renders the same answer.
 *
 * WHEN THE PANEL APPEARS
 *
 * Exactly twice: when there is no open session at all, and when the server says
 * `promptDue` — i.e. the shift's nominal end plus the ten-minute grace has
 * passed. Never in between. The decision is the server's; this component only
 * renders it, so the rule cannot drift between here and the API.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock3 } from 'lucide-react';
import { shiftsApi, type ShiftType } from '../api/shifts';
import { useAuth } from '../auth/AuthProvider';
import {
  SHIFT_OPTIONS_KEY,
  SHIFT_SESSION_KEY,
  useIsReception,
  useShiftSession,
} from '../hooks/useShiftSession';
import { Button } from './Button';
import { Input } from './Input';
import { Modal } from './Modal';
import { ErrorAlert } from './ErrorAlert';

/** "CA A4 · 06:00 – 18:00 · Nguyễn Văn A" for the application header. */
export function ShiftIndicator() {
  const isReception = useIsReception();
  const { data } = useShiftSession();
  if (!isReception) return null;

  const session = data?.session ?? null;
  if (!session) return null;

  return (
    <div
      data-testid="shift-indicator"
      className="hidden items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 sm:flex"
    >
      <Clock3 className="h-3.5 w-3.5 text-brand-600" aria-hidden="true" />
      <span className="font-semibold text-slate-800">{session.shiftName.toUpperCase()}</span>
      <span className="text-slate-400">·</span>
      <span>{session.shiftWindow}</span>
      <span className="text-slate-400">·</span>
      <span className="max-w-[12rem] truncate">{session.receptionistName}</span>
    </div>
  );
}

/**
 * Renders the check-in prompt when one is due.
 *
 * TWO CASES, DELIBERATELY TREATED DIFFERENTLY:
 *
 *   NO SESSION AT ALL — the receptionist has just started work and the
 *   application does not know who they are. The dialog is NOT dismissible:
 *   without a session the server refuses to record who created an order, so
 *   closing it would only move the refusal to the moment they submit their work.
 *
 *   THE SHIFT RAN OUT — they may be in the middle of an order. Trapping them
 *   behind a modal would interrupt work already underway, so this one CAN be
 *   closed, and a banner stays on screen until they check in. Dismissing it
 *   sticks, which is what stops the sixty-second poll from re-opening the dialog
 *   over and over; the banner is the reminder instead.
 */
export function ShiftGate() {
  const isReception = useIsReception();
  const { data, isSuccess } = useShiftSession();
  const session = data?.session ?? null;
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);

  /**
   * ONLY on a SUCCESSFUL answer.
   *
   * `isSuccess` rather than `!isLoading`, because those differ in the case that
   * matters: a failed request also stops loading, and treating that as "no
   * shift" would throw an undismissable dialog over the whole application every
   * time the network hiccupped. Staying quiet is safe — the server still refuses
   * an unattributed submission, with a message that says what to do.
   */
  const needsCheckIn = isReception && isSuccess && (session === null || session.promptDue);
  if (!needsCheckIn) return null;

  // Keyed by session id, so checking in and later running out prompts again.
  const dismissed = session !== null && dismissedFor === session.id;
  if (dismissed) return <ShiftExpiredBanner onOpen={() => setDismissedFor(null)} />;

  return (
    <ShiftCheckInDialog
      renewing={session !== null}
      onDismiss={session === null ? undefined : () => setDismissedFor(session.id)}
    />
  );
}

/** The quiet reminder that replaces a dismissed handover prompt. */
function ShiftExpiredBanner({ onOpen }: { onOpen: () => void }) {
  return (
    <div
      data-testid="shift-expired-banner"
      className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900 sm:px-6"
    >
      <span className="flex items-center gap-2">
        <Clock3 className="h-4 w-4" aria-hidden="true" />
        Ca làm việc đã kết thúc. Vui lòng chọn ca mới để tiếp tục tạo đơn.
      </span>
      <Button variant="secondary" onClick={onOpen} data-testid="shift-reopen">
        Chọn ca làm việc
      </Button>
    </div>
  );
}

function ShiftCheckInDialog({
  renewing,
  onDismiss,
}: {
  renewing: boolean;
  /** Absent when there is no session at all — that dialog cannot be closed. */
  onDismiss?: () => void;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [shiftType, setShiftType] = useState<ShiftType | ''>('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const options = useQuery({ queryKey: SHIFT_OPTIONS_KEY, queryFn: () => shiftsApi.options() });

  const checkIn = useMutation({
    mutationFn: () => shiftsApi.checkIn({ shiftType: shiftType as ShiftType, receptionistName: name.trim() }),
    onSuccess: async () => {
      setError(null);
      await queryClient.invalidateQueries({ queryKey: SHIFT_SESSION_KEY });
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : 'Không bắt đầu được ca làm việc.'),
  });

  // Both are required, and a name of only spaces is not a name.
  const ready = shiftType !== '' && name.trim().length > 0;

  const now = new Date();
  const clock = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  return (
    <Modal
      open
      title={renewing ? 'Ca làm việc đã kết thúc' : 'Chọn ca làm việc'}
      // Closable only on a handover — see the ShiftGate comment.
      onClose={() => onDismiss?.()}
      footer={
        <>
          {onDismiss ? (
            <Button variant="secondary" onClick={onDismiss} data-testid="shift-later">
              Để sau
            </Button>
          ) : null}
          <Button
            onClick={() => checkIn.mutate()}
            disabled={!ready}
            loading={checkIn.isPending}
            data-testid="shift-confirm"
          >
            Xác nhận
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600">
          <div>
            <span className="text-slate-500">Chi nhánh:</span>{' '}
            <span className="font-medium text-slate-800">{user?.branch?.address ?? '—'}</span>
          </div>
          <div>
            <span className="text-slate-500">Hiện tại:</span>{' '}
            <span className="font-medium text-slate-800">{clock}</span>
          </div>
        </div>

        {renewing ? (
          <p className="text-sm text-slate-600">
            Ca trước đã hết giờ. Vui lòng chọn ca mới để tiếp tục tạo đơn.
          </p>
        ) : null}

        <fieldset className="space-y-2" data-testid="shift-options">
          <legend className="text-sm font-medium text-slate-700">Ca làm việc</legend>
          {/*
            Every shift is listed and the receptionist picks. The clock is NOT
            used to preselect one: Ca A and Ca A4 both start at 06:00, so at the
            moment of check-in the time cannot tell them apart, and a wrong
            default would be accepted without anyone noticing.
          */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {(options.data?.shifts ?? []).map((shift) => {
              const active = shiftType === shift.code;
              return (
                <button
                  key={shift.code}
                  type="button"
                  onClick={() => setShiftType(shift.code)}
                  aria-pressed={active}
                  data-testid={`shift-option-${shift.code}`}
                  className={`rounded-xl border px-3 py-2 text-left text-sm transition-colors ${
                    active
                      ? 'border-brand-600 bg-brand-50 text-brand-700'
                      : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <span className="block font-semibold">{shift.name}</span>
                  <span className="block text-xs text-slate-500">
                    {shift.startLocalTime} – {shift.endLocalTime}
                  </span>
                </button>
              );
            })}
          </div>
        </fieldset>

        <Input
          label="Họ và tên lễ tân"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ví dụ: Nguyễn Văn A"
          maxLength={200}
          data-testid="shift-name"
        />

        {error ? <ErrorAlert>{error}</ErrorAlert> : null}
      </div>
    </Modal>
  );
}

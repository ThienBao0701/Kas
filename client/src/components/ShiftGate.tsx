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
import { Clock3, Repeat2 } from 'lucide-react';
import { shiftsApi, type ShiftSession, type ShiftType } from '../api/shifts';
import { useAuth } from '../auth/AuthProvider';
import {
  HANDOVER_NOTES_KEY,
  SHIFT_OPTIONS_KEY,
  SHIFT_SESSION_KEY,
  useIsReception,
  useShiftSession,
} from '../hooks/useShiftSession';
import { Button } from './Button';
import { Input } from './Input';
import { Modal } from './Modal';
import { ErrorAlert } from './ErrorAlert';
import { hcmTimeOfDay } from '../lib/format';

/**
 * "CA A4 · 06:00 – 18:00 · Nguyễn Văn A", and the "Đổi ca" action beside it.
 *
 * WHY THE BUTTON IS NOT INSIDE THE INDICATOR CHIP
 *
 * The chip is `hidden sm:flex` — it is context, and on a phone the topbar has no
 * room for it. "Đổi ca" is an ACTION, and a receptionist leaving early on a
 * phone needs it exactly as much as one at a desk does. So the chip keeps its
 * breakpoint and the button has none.
 *
 * Only a receptionist WITH an open shift sees it: Technical and Admin do not
 * work shifts, and there is nothing to hand over before checking in.
 */
export function ShiftIndicator() {
  const isReception = useIsReception();
  const { data } = useShiftSession();
  const [handoverOpen, setHandoverOpen] = useState(false);
  if (!isReception) return null;

  const session = data?.session ?? null;
  if (!session) return null;

  return (
    <>
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
      <button
        type="button"
        onClick={() => setHandoverOpen(true)}
        data-testid="shift-handover-open"
        className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
      >
        <Repeat2 className="h-3.5 w-3.5" aria-hidden="true" />
        Đổi ca
      </button>
      {handoverOpen ? (
        <ShiftHandoverDialog session={session} onClose={() => setHandoverOpen(false)} />
      ) : null}
    </>
  );
}

/**
 * The shift a handover would normally go to.
 *
 * A SUGGESTION AND NOTHING MORE. It preselects nothing and blocks nothing: Ca A
 * and Ca A4 both start at 06:00 and Ca C and Ca C4 both end at 06:00, so the
 * rota genuinely cannot be derived, and a receptionist covering an unusual
 * pattern must be able to pick what is actually happening. It exists to save the
 * common case a click, not to decide the uncommon one.
 */
const SUGGESTED_NEXT: Record<ShiftType, ShiftType> = {
  A: 'B',
  B: 'C',
  C: 'A',
  A4: 'C4',
  C4: 'A4',
};

/**
 * "Đổi ca" — the outgoing receptionist hands over early.
 *
 * A SEPARATE DIALOG FROM CHECK-IN, deliberately. Check-in asks two questions and
 * is answered by every receptionist at the start of every shift; a handover asks
 * four and happens rarely. Putting the handover's fields into the check-in
 * dialog would make the daily case carry the rare case's questions.
 *
 * THE TIME IS NOT SENT. It is displayed so the operator can see what they are
 * confirming, and the server stamps the real instant — see `handoverService`.
 */
function ShiftHandoverDialog({
  session,
  onClose,
}: {
  session: ShiftSession;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const [incomingName, setIncomingName] = useState('');
  const [incomingShiftType, setIncomingShiftType] = useState<ShiftType>(
    SUGGESTED_NEXT[session.shiftType],
  );
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const options = useQuery({ queryKey: SHIFT_OPTIONS_KEY, queryFn: () => shiftsApi.options() });

  const handover = useMutation({
    mutationFn: () =>
      shiftsApi.handover({
        reason: reason.trim(),
        incomingName: incomingName.trim(),
        incomingShiftType,
        // Only sent when the receptionist actually wrote something — an empty
        // handover note is not a handover note.
        note: note.trim() ? { content: note.trim() } : undefined,
      }),
    onSuccess: async () => {
      setError(null);
      await queryClient.invalidateQueries({ queryKey: SHIFT_SESSION_KEY });
      await queryClient.invalidateQueries({ queryKey: HANDOVER_NOTES_KEY });
      onClose();
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : 'Không đổi được ca làm việc.'),
  });

  // Both are required, and neither may be only spaces — the same rule the server
  // applies, so the button state and the API agree.
  const ready = reason.trim().length > 0 && incomingName.trim().length > 0;

  return (
    <Modal
      open
      title="Đổi ca"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} data-testid="handover-cancel">
            Hủy
          </Button>
          <Button
            onClick={() => handover.mutate()}
            disabled={!ready}
            loading={handover.isPending}
            data-testid="handover-confirm"
          >
            Xác nhận đổi ca
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600">
          <div>
            <span className="text-slate-500">Ca hiện tại:</span>{' '}
            <span className="font-medium text-slate-800">
              {session.shiftName} · {session.shiftWindow}
            </span>
          </div>
          <div>
            <span className="text-slate-500">Người bàn giao:</span>{' '}
            <span className="font-medium text-slate-800">{session.receptionistName}</span>
          </div>
          <div>
            <span className="text-slate-500">Thời điểm đổi:</span>{' '}
            <span className="font-medium text-slate-800" data-testid="handover-clock">
              {hcmTimeOfDay()}
            </span>{' '}
            <span className="text-xs text-slate-400">(hệ thống ghi nhận giờ chính xác)</span>
          </div>
        </div>

        <label className="block text-sm font-medium text-slate-700">
          Lý do đổi ca
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            maxLength={1000}
            placeholder="Ví dụ: Có việc cá nhân"
            data-testid="handover-reason"
            className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
          />
        </label>

        <Input
          label="Người nhận ca"
          value={incomingName}
          onChange={(e) => setIncomingName(e.target.value)}
          placeholder="Ví dụ: Nguyễn Văn B"
          maxLength={200}
          data-testid="handover-incoming-name"
        />

        <fieldset className="space-y-2" data-testid="handover-shift-options">
          <legend className="text-sm font-medium text-slate-700">Ca nhận</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {(options.data?.shifts ?? []).map((shift) => {
              const active = incomingShiftType === shift.code;
              return (
                <button
                  key={shift.code}
                  type="button"
                  onClick={() => setIncomingShiftType(shift.code)}
                  aria-pressed={active}
                  data-testid={`handover-shift-${shift.code}`}
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
          <p className="text-xs text-slate-500">
            Ca nhận giữ nguyên giờ kết thúc theo lịch, kể cả khi bắt đầu sớm.
          </p>
        </fieldset>

        <label className="block text-sm font-medium text-slate-700">
          Nội dung bàn giao <span className="font-normal text-slate-400">(không bắt buộc)</span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            maxLength={5000}
            placeholder="Việc còn tồn cần ca sau theo dõi…"
            data-testid="handover-note"
            className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
          />
        </label>

        {error ? <ErrorAlert>{error}</ErrorAlert> : null}
      </div>
    </Modal>
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

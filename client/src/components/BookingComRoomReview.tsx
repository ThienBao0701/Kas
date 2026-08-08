/**
 * The Admin's room-class and PMS-note review for a BOOKING.COM reservation.
 *
 * Two things the Booking.com flow had no surface for, and both are about the
 * same fact: the note a receptionist pastes is generated from the booking's
 * stored room-class snapshot, and until now nobody could see that snapshot or
 * correct it before the booking left.
 *
 * WHAT IS AND IS NOT REIMPLEMENTED HERE:
 *
 *   The dropdown lists the branch's OWN active room classes, read from the
 *   existing room-mapping API. There is no second catalogue in the frontend.
 *
 *   A selection is written by the server (`setRoomClass`), which validates it
 *   against the booking's branch and ACTIVE mapping version and stores it as
 *   MANUAL. Nothing is decided locally — what comes back is the snapshot the
 *   note will really be built from.
 *
 *   The note is produced by `buildPmsNote`, the SAME Booking.com builder
 *   reception uses. There is no second generator and no Agoda-style format
 *   anywhere near this file: an Agoda note is a different layout produced on
 *   the server, and a Booking.com booking must never print one.
 *
 * The OTA room name is displayed exactly as Booking.com stated it and is never
 * replaced by the internal code — they are different fields answering different
 * questions ("what did the platform sell?" vs "what is it called in our PMS?").
 */
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ClipboardList, Copy, StickyNote } from 'lucide-react';
import { bookingsApi, type BookingDetail } from '../api/bookings';
import { roomMappingApi } from '../api/roomMapping';
import { toUserMessage } from '../api/errors';
import { UNMAPPED_ROOM_MESSAGE, everyRoomHasPmsCode } from '../lib/bookingComRoomClass';
import { buildPmsNote } from '../lib/pmsNote';
import { copyText } from '../lib/copy';
import { Card } from './Card';
import { Button } from './Button';
import { ErrorAlert } from './ErrorAlert';

const inputClass =
  'w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600';

export interface BookingComRoomReviewProps {
  /** The saved booking, with the Admin's unsaved edits merged in for preview. */
  booking: BookingDetail;
  /** The branch the booking is SAVED against — what the server will validate. */
  branchId: number | undefined;
  /** The Admin picked a different branch and has not saved it yet. */
  branchDirty?: boolean;
  /** Called with the server's stored snapshot after a successful selection. */
  onRoomClassChanged: (roomIndex: number, roomClassId: string, pmsCode: string, displayName: string) => void;
}

export function BookingComRoomReview({
  booking,
  branchId,
  branchDirty = false,
  onRoomClassChanged,
}: BookingComRoomReviewProps) {
  /**
   * The branch's active room classes — the existing source of truth, keyed by
   * branch so switching branch re-fetches rather than reusing the old list.
   */
  const mapping = useQuery({
    queryKey: ['room-mapping', branchId],
    queryFn: () => roomMappingApi.get(branchId!),
    enabled: branchId !== undefined,
    staleTime: 5 * 60_000,
  });

  const options = (mapping.data?.active?.roomClasses ?? []).filter((c) => c.active);

  const [pendingIndex, setPendingIndex] = useState<number | null>(null);
  const setRoomClass = useMutation({
    mutationFn: (vars: { roomIndex: number; roomClassId: string }) =>
      bookingsApi.setRoomClass(booking.id, vars.roomIndex, vars.roomClassId),
    onSuccess: (res) => {
      const r = res.room;
      onRoomClassChanged(r.roomIndex, r.roomClassId, r.pmsCode, r.displayName);
    },
    onSettled: () => setPendingIndex(null),
  });

  return (
    <>
      <Card className="p-5" data-testid="bcom-room-classes">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700">
          <ClipboardList className="h-4 w-4 text-brand-600" aria-hidden="true" />
          Hạng phòng
        </div>

        {branchId === undefined ? (
          <p className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600">
            Vui lòng chọn chi nhánh để xem danh sách mã nội bộ.
          </p>
        ) : null}

        {/*
          The codes belong to the branch the booking is SAVED against, which is
          also what the server validates a selection with. Offering the newly
          picked branch's codes before the change is saved would produce a
          refusal the Admin could not explain, so it says what to do instead.
        */}
        {branchDirty ? (
          <p
            className="mb-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
            data-testid="bcom-branch-dirty"
          >
            Bạn vừa đổi chi nhánh. Vui lòng bấm “Lưu thay đổi” để cập nhật danh sách mã nội bộ theo
            chi nhánh mới.
          </p>
        ) : null}

        {branchId !== undefined && mapping.isError ? (
          <ErrorAlert>{toUserMessage(mapping.error)}</ErrorAlert>
        ) : null}

        {branchId !== undefined && !mapping.isLoading && !mapping.isError && options.length === 0 ? (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Chi nhánh này chưa có cấu hình hạng phòng đang áp dụng. Vui lòng cấu hình trong mục
            “Khách sạn &amp; chi nhánh” trước khi gửi đơn.
          </p>
        ) : null}

        <ul className="space-y-2" aria-label="Danh sách hạng phòng">
          {booking.rooms.map((room) => (
            <li key={room.roomIndex} className="rounded-xl border border-slate-200 p-3">
              <div className="grid gap-2 sm:grid-cols-[6rem_1fr_12rem] sm:items-end">
                <label className="block text-xs font-medium text-slate-500">
                  Số lượng
                  <input
                    readOnly
                    aria-label={`Số lượng phòng dòng ${room.roomIndex}`}
                    className={`${inputClass} mt-1 bg-slate-50`}
                    value={1}
                  />
                </label>

                {/*
                  The name Booking.com printed, verbatim — "(0)" and all. It is
                  edited in the room card above; here it is shown as the thing
                  the internal code is being chosen FOR.
                */}
                <label className="block text-xs font-medium text-slate-500">
                  Tên hạng phòng trên Booking.com
                  <input
                    readOnly
                    aria-label={`Tên hạng phòng dòng ${room.roomIndex}`}
                    className={`${inputClass} mt-1 bg-slate-50`}
                    value={room.roomType ?? ''}
                  />
                </label>

                <label className="block text-xs font-medium text-slate-500">
                  Mã nội bộ
                  <select
                    aria-label={`Mã nội bộ dòng ${room.roomIndex}`}
                    className={`${inputClass} mt-1`}
                    disabled={
                      branchId === undefined ||
                      branchDirty ||
                      options.length === 0 ||
                      pendingIndex === room.roomIndex
                    }
                    value={room.roomClassId ?? ''}
                    onChange={(e) => {
                      if (!e.target.value) return; // never un-set back to nothing
                      setPendingIndex(room.roomIndex);
                      setRoomClass.mutate({ roomIndex: room.roomIndex, roomClassId: e.target.value });
                    }}
                  >
                    <option value="">— Chưa chọn —</option>
                    {options.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.pmsCode} — {c.displayName}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {/*
                An auto-detected code is shown as detected rather than silently
                accepted: the Admin is being asked to confirm it, not to notice
                its absence.
              */}
              {room.roomClassPmsCode ? (
                <p className="mt-2 text-xs text-slate-500" data-testid={`bcom-room-${room.roomIndex}-status`}>
                  Mã đang dùng: <strong className="text-slate-700">{room.roomClassPmsCode}</strong>
                  {room.roomClassStatus === 'MANUAL' ? ' · đã chọn thủ công' : null}
                  {room.roomClassStatus === 'RESOLVED' ? ' · hệ thống tự nhận diện' : null}
                </p>
              ) : (
                <p className="mt-2 text-xs text-red-700" data-testid={`bcom-room-${room.roomIndex}-status`}>
                  Chưa gán mã hạng phòng nội bộ cho chi nhánh này.
                </p>
              )}
            </li>
          ))}
          {booking.rooms.length === 0 ? (
            <li className="py-3 text-center text-sm text-slate-400">Chưa có dòng phòng nào.</li>
          ) : null}
        </ul>

        {setRoomClass.isError ? (
          <div className="mt-3">
            <ErrorAlert>{toUserMessage(setRoomClass.error)}</ErrorAlert>
          </div>
        ) : null}

        {!everyRoomHasPmsCode(booking.rooms) ? (
          <p className="mt-3 text-sm text-red-700" data-testid="bcom-room-blocking">
            {UNMAPPED_ROOM_MESSAGE}
          </p>
        ) : null}
      </Card>

      <PmsNoteCard booking={booking} />
    </>
  );
}

/**
 * The Booking.com note, from the Booking.com builder.
 *
 * Editable so an Admin can correct wording before copying, and regenerated
 * whenever the booking behind it changes — including when the internal room
 * code changes, which is the whole point of the selector above. A hand edit
 * survives until the generated text itself changes, at which point the fresh
 * note wins: silently keeping a stale edit over a corrected note is how a
 * wrong room code would reach the hotel system.
 */
function PmsNoteCard({ booking }: { booking: BookingDetail }) {
  const generated = buildPmsNote(booking);
  const generatedText = generated.ok ? generated.text ?? '' : '';

  const [edit, setEdit] = useState<string | null>(null);
  const [editedFrom, setEditedFrom] = useState<string>(generatedText);
  const [copyState, setCopyState] = useState<'idle' | 'ok' | 'fail'>('idle');

  // Drop the edit when the generated note moves on beneath it.
  if (edit !== null && editedFrom !== generatedText) {
    setEdit(null);
    setEditedFrom(generatedText);
  }

  const text = edit ?? generatedText;

  const onCopy = async () => {
    if (!text.trim()) return;
    const ok = await copyText(text);
    setCopyState(ok ? 'ok' : 'fail');
    window.setTimeout(() => setCopyState('idle'), 2500);
  };

  return (
    <Card className="p-5" data-testid="bcom-pms-note-card">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <StickyNote className="h-4 w-4 text-brand-600" aria-hidden="true" />
          Ghi chú PMS
        </div>
        <div className="flex items-center gap-2">
          {copyState === 'ok' ? <span className="text-xs text-green-700">Đã sao chép.</span> : null}
          {copyState === 'fail' ? (
            <span className="text-xs text-red-700">Không sao chép được. Vui lòng chọn và sao chép thủ công.</span>
          ) : null}
          <Button variant="secondary" onClick={onCopy} disabled={!text.trim()}>
            <Copy className="h-4 w-4" aria-hidden="true" />
            Sao chép note
          </Button>
        </div>
      </div>

      {generated.ok ? (
        <textarea
          data-testid="bcom-pms-note"
          aria-label="Ghi chú PMS"
          rows={3}
          value={text}
          onChange={(e) => {
            setEdit(e.target.value);
            setEditedFrom(generatedText);
          }}
          className={`${inputClass} whitespace-pre-wrap font-mono`}
        />
      ) : (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {generated.error}
        </p>
      )}
    </Card>
  );
}

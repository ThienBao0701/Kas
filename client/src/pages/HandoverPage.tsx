/**
 * "BÀN GIAO CA" — what the shift going off duty tells the shift coming on.
 *
 * DELIBERATELY THE SIMPLEST SCREEN IN THE APPLICATION. It is read at the start
 * of a shift, by somebody who has just walked in, and written at the end of one,
 * by somebody who wants to go home. Anything that makes either of those take
 * longer than a minute will simply stop being used, and a handover nobody writes
 * is worse than no handover feature at all.
 *
 * So: one list of what the last shifts said, and one box to say something. No
 * threads, no replies, no editing.
 *
 * THE CONTEXT IS SHOWN, NOT PRE-FILLED. "Việc đang tồn" sits beside the box as
 * live data — open incidents, orders still to create — so the receptionist does
 * not retype what the application already knows. It is never copied INTO the
 * note: an incident resolved an hour later would otherwise be frozen into the
 * text, sending the next shift to chase something already done.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardList, Download, RefreshCw, Wrench } from 'lucide-react';
import { shiftsApi, type HandoverNote } from '../api/shifts';
import { toUserMessage } from '../api/errors';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { ErrorAlert } from '../components/ErrorAlert';
import { PageHeader, QueryState } from '../components/PageState';
import { Modal } from '../components/Modal';
import { DateRangeField, type DateRangeValue } from '../components/DateRangeField';
import { handoverReportPdfUrl } from '../api/reports';
import { Toast } from '../components/Toast';
import { HANDOVER_NOTES_KEY, useIsReception, useShiftSession } from '../hooks/useShiftSession';
import { formatDateTime, hcmToday } from '../lib/format';

const POLL_MS = 60_000;

export function HandoverPage() {
  const isReception = useIsReception();
  const [toast, setToast] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);

  const notes = useQuery({
    queryKey: HANDOVER_NOTES_KEY,
    queryFn: () => shiftsApi.handoverNotes(),
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: true,
  });

  return (
    <div>
      <PageHeader
        title="Bàn giao ca"
        description={
          isReception
            ? 'Ghi lại việc còn tồn cho ca sau, và xem ca trước đã bàn giao những gì.'
            : 'Lịch sử bàn giao ca của các chi nhánh.'
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {/*
              The Admin's export. Not offered to reception: the report spans
              every branch, and a receptionist's view of this page is their own
              branch's recent notes.
            */}
            {!isReception ? (
              <Button variant="secondary" onClick={() => setExportOpen(true)}>
                <Download className="h-4 w-4" aria-hidden="true" />
                Xuất báo cáo
              </Button>
            ) : null}
            <button
              type="button"
              onClick={() => void notes.refetch()}
              aria-label="Làm mới"
              className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
            >
              <RefreshCw className={`h-4 w-4 ${notes.isFetching ? 'animate-spin' : ''}`} aria-hidden="true" />
              Làm mới
            </button>
          </div>
        }
      />

      {/* Admin monitors; only a receptionist on a shift can write one. */}
      {isReception ? <NewNoteForm onCreated={() => setToast('Đã lưu bàn giao ca.')} /> : null}

      <QueryState isLoading={notes.isLoading} isError={notes.isError} error={notes.error}>
        {(notes.data?.notes ?? []).length === 0 ? (
          <EmptyState
            icon={<ClipboardList className="h-6 w-6" aria-hidden="true" />}
            title="Chưa có bàn giao nào"
            message="Ca trước chưa để lại ghi chú bàn giao."
          />
        ) : (
          <ul className="space-y-3" aria-label="Danh sách bàn giao ca">
            {(notes.data?.notes ?? []).map((note) => (
              <li key={note.id}>
                <NoteCard note={note} />
              </li>
            ))}
          </ul>
        )}
      </QueryState>

      {exportOpen ? <HandoverExportModal onClose={() => setExportOpen(false)} /> : null}
      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  );
}

/**
 * "Xuất báo cáo" for the shift-change audit.
 *
 * Opens the PDF endpoint in a new tab rather than fetching it: the request
 * carries the session cookie, the browser handles the download, and the file
 * never has to be turned into a blob URL the page must then revoke. The same
 * shape every other export in this application uses.
 */
function HandoverExportModal({ onClose }: { onClose: () => void }) {
  const today = hcmToday();
  const [range, setRange] = useState<DateRangeValue>({ from: today, to: today });
  const ready = range.from !== '' && range.to !== '';

  return (
    <Modal
      open
      title="Xuất báo cáo bàn giao ca"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Hủy
          </Button>
          <Button
            disabled={!ready}
            data-testid="handover-export-confirm"
            onClick={() => {
              window.open(handoverReportPdfUrl({ from: range.from, to: range.to }), '_blank', 'noopener');
              onClose();
            }}
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            Tải PDF
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <DateRangeField
          legend="Khoảng thời gian"
          value={range}
          onChange={setRange}
          max={today}
          testId="handover-report-range"
        />
        <p className="text-sm text-slate-600">
          Báo cáo gồm các lượt đổi ca và nội dung bàn giao của tất cả chi nhánh.
        </p>
      </div>
    </Modal>
  );
}

function NoteCard({ note }: { note: HandoverNote }) {
  return (
    <Card className="p-4" data-testid="handover-note-card">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-lg bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
          {note.outgoingShiftName}
        </span>
        <span className="font-medium text-slate-900">{note.outgoingName}</span>
        {note.incomingName ? (
          <span className="text-sm text-slate-500">→ {note.incomingName}</span>
        ) : null}
        {note.priority === 'HIGH' ? (
          <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-700">
            Ưu tiên
          </span>
        ) : null}
        <span className="ml-auto text-xs text-slate-400">{formatDateTime(note.createdAt)}</span>
      </div>
      <p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-700">{note.content}</p>
      {note.branch ? (
        <p className="mt-1 text-xs text-slate-400">{note.branch.address}</p>
      ) : null}
    </Card>
  );
}

/**
 * The write box, with the live context beside it.
 *
 * A shift is required — "bàn giao ca" means handing over FROM a shift — so the
 * form says so rather than failing on submit, and the shift gate is already on
 * screen telling the receptionist what to do about it.
 */
function NewNoteForm({ onCreated }: { onCreated: () => void }) {
  const queryClient = useQueryClient();
  const { data: shift } = useShiftSession();
  const session = shift?.session ?? null;
  const [content, setContent] = useState('');
  const [priority, setPriority] = useState<'NORMAL' | 'HIGH'>('NORMAL');
  const [incomingName, setIncomingName] = useState('');

  const context = useQuery({
    queryKey: ['reception', 'handover-context'],
    queryFn: () => shiftsApi.handoverContext(),
    enabled: session !== null,
  });

  const create = useMutation({
    mutationFn: () =>
      shiftsApi.createHandoverNote({
        content: content.trim(),
        priority,
        incomingName: incomingName.trim() || undefined,
      }),
    onSuccess: async () => {
      setContent('');
      setIncomingName('');
      setPriority('NORMAL');
      await queryClient.invalidateQueries({ queryKey: HANDOVER_NOTES_KEY });
      onCreated();
    },
  });

  if (!session) {
    return (
      <Card className="mb-4 p-4">
        <p className="text-sm text-slate-600">
          Vui lòng chọn ca làm việc trước khi ghi bàn giao ca.
        </p>
      </Card>
    );
  }

  const pending = context.data?.pending;
  const ready = content.trim().length > 0;

  return (
    <Card className="mb-4 p-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="space-y-3">
          <div className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600">
            <span className="text-slate-500">Ca bàn giao:</span>{' '}
            <span className="font-medium text-slate-800">
              {session.shiftName} · {session.shiftWindow}
            </span>
            {' · '}
            <span className="font-medium text-slate-800">{session.receptionistName}</span>
          </div>

          <label className="block text-sm font-medium text-slate-600">
            Nội dung bàn giao
            <textarea
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
              rows={4}
              maxLength={5000}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Ví dụ: Phòng 101 đang chờ kỹ thuật. Khách 302 cần gọi lại trước 18:00."
              data-testid="handover-note-content"
            />
          </label>

          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm font-medium text-slate-600">
              Người nhận ca <span className="font-normal text-slate-400">(không bắt buộc)</span>
              <input
                className="mt-1 block rounded-xl border border-slate-300 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
                value={incomingName}
                maxLength={200}
                onChange={(e) => setIncomingName(e.target.value)}
                placeholder="Ví dụ: Nguyễn Văn B"
                data-testid="handover-note-incoming"
              />
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={priority === 'HIGH'}
                onChange={(e) => setPriority(e.target.checked ? 'HIGH' : 'NORMAL')}
                data-testid="handover-note-priority"
              />
              Ưu tiên đọc trước
            </label>
            <Button
              onClick={() => create.mutate()}
              disabled={!ready}
              loading={create.isPending}
              data-testid="handover-note-submit"
            >
              Lưu bàn giao
            </Button>
          </div>

          {create.isError ? <ErrorAlert>{toUserMessage(create.error)}</ErrorAlert> : null}
        </div>

        {/* Live, never copied into the note. */}
        <aside className="rounded-xl border border-slate-200 p-3" data-testid="handover-context">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Việc đang tồn
          </h3>
          {pending ? (
            <div className="space-y-2 text-sm">
              <ul className="space-y-1 text-slate-600">
                <li>Đơn chưa tạo: <strong>{pending.bookings.awaitingCreation}</strong></li>
                <li>Chờ Admin kiểm tra: <strong>{pending.bookings.awaitingReview}</strong></li>
                <li>Cần tạo lại: <strong>{pending.bookings.needsRecreation}</strong></li>
              </ul>
              <div>
                <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-slate-500">
                  <Wrench className="h-3.5 w-3.5" aria-hidden="true" />
                  Sự cố chưa xong ({pending.openIssues.length})
                </p>
                {pending.openIssues.length === 0 ? (
                  <p className="text-xs text-slate-400">Không có sự cố nào.</p>
                ) : (
                  <ul className="space-y-0.5 text-xs text-slate-600">
                    {pending.openIssues.slice(0, 8).map((issue) => (
                      <li key={issue.id} className="truncate">
                        {issue.location}
                        {issue.needsRework ? (
                          <span className="ml-1 text-rose-600">· cần xử lý lại</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ) : (
            <p className="text-xs text-slate-400">Đang tải…</p>
          )}
        </aside>
      </div>
    </Card>
  );
}

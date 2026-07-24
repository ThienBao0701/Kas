import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ImageUp, Plus, RefreshCw, Wrench, X } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import {
  ISSUE_CATEGORIES,
  ISSUE_CATEGORY_LABEL,
  ISSUE_STATUS_LABEL,
  issuesApi,
  type Issue,
  type IssueCategory,
  type IssueStatus,
} from '../api/issues';
import { toUserMessage } from '../api/errors';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { Modal } from '../components/Modal';
import { EmptyState } from '../components/EmptyState';
import { ErrorAlert } from '../components/ErrorAlert';
import { PageHeader, QueryState } from '../components/PageState';
import { Toast } from '../components/Toast';
import { formatDateTime } from '../lib/format';

const POLL_MS = 20_000;
const ACCEPTED = 'image/png,image/jpeg,image/webp';
const MAX_BYTES = 10 * 1024 * 1024;

const STATUS_STYLES: Record<IssueStatus, string> = {
  NEW: 'bg-amber-100 text-amber-800',
  IN_PROGRESS: 'bg-blue-100 text-blue-700',
  RESOLVED: 'bg-green-100 text-green-700',
};

function IssueStatusBadge({ status }: { status: IssueStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}>
      {ISSUE_STATUS_LABEL[status]}
    </span>
  );
}

export function IssuesPage() {
  const { user } = useAuth();
  return user?.role === 'ADMIN' ? <AdminIssues /> : <ReceptionistIssues />;
}

/* -------------------------------------------------------------------------- */
/* Receptionist — report + own-branch list                                    */
/* -------------------------------------------------------------------------- */

function ReceptionistIssues() {
  const [formOpen, setFormOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ['issues', { mine: true }],
    queryFn: () => issuesApi.list({ pageSize: 100 }),
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: true,
  });
  const issues = list.data?.issues ?? [];

  return (
    <div>
      <PageHeader
        title="Báo cáo sự cố"
        description="Báo ngay cho Admin các sự cố tại phòng (hỏng cửa, máy lạnh không lạnh, nghẹt bồn cầu…)."
        actions={
          <Button onClick={() => setFormOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Báo cáo mới
          </Button>
        }
      />

      <QueryState isLoading={list.isLoading} isError={list.isError} error={list.error}>
        {issues.length === 0 ? (
          <EmptyState
            icon={<Wrench className="h-6 w-6" aria-hidden="true" />}
            title="Chưa có báo cáo nào"
            message="Nhấn “Báo cáo mới” để gửi sự cố cho Admin."
          />
        ) : (
          <ul className="space-y-3" aria-label="Danh sách sự cố">
            {issues.map((issue) => (
              <li key={issue.id}>
                <Card className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-slate-900">{ISSUE_CATEGORY_LABEL[issue.category]}</span>
                        {issue.roomNumber ? <span className="text-sm text-slate-500">Phòng {issue.roomNumber}</span> : null}
                        <IssueStatusBadge status={issue.status} />
                      </div>
                      <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-700">{issue.description}</p>
                    </div>
                    <span className="shrink-0 text-xs text-slate-400">{formatDateTime(issue.createdAt)}</span>
                  </div>
                  {issue.photoUrl ? <IssueThumb url={issue.photoUrl} /> : null}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </QueryState>

      {formOpen ? <NewIssueModal onClose={() => setFormOpen(false)} onCreated={() => setToast('Đã gửi báo cáo sự cố cho Admin.')} /> : null}
      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  );
}

function NewIssueModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState<IssueCategory>('AIR_CONDITIONER');
  const [roomNumber, setRoomNumber] = useState('');
  const [description, setDescription] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => issuesApi.create({ category, roomNumber, description, photo: file ?? undefined }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['issues'] });
      clearFile();
      onClose();
      onCreated();
    },
  });

  function clearFile() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setFile(null);
    if (inputRef.current) inputRef.current.value = '';
  }

  function onPick(picked: File | undefined) {
    setLocalError(null);
    if (!picked) return;
    if (!ACCEPTED.split(',').includes(picked.type)) {
      setLocalError('Chỉ chấp nhận ảnh PNG, JPEG hoặc WebP.');
      return;
    }
    if (picked.size > MAX_BYTES) {
      setLocalError('Ảnh vượt quá 10 MB.');
      return;
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(picked);
    setPreviewUrl(URL.createObjectURL(picked));
  }

  const inputClass =
    'w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600';

  return (
    <Modal
      open
      title="Báo cáo sự cố mới"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Hủy</Button>
          <Button onClick={() => create.mutate()} loading={create.isPending} disabled={description.trim().length === 0}>
            Gửi báo cáo
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <label className="block text-sm font-medium text-slate-600">
          Số phòng (không bắt buộc)
          <input className={`${inputClass} mt-1`} value={roomNumber} onChange={(e) => setRoomNumber(e.target.value)} placeholder="Ví dụ: 301" />
        </label>

        <label className="block text-sm font-medium text-slate-600">
          Loại sự cố
          <select className={`${inputClass} mt-1`} value={category} onChange={(e) => setCategory(e.target.value as IssueCategory)}>
            {ISSUE_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </label>

        <label className="block text-sm font-medium text-slate-600">
          Mô tả
          <textarea
            className={`${inputClass} mt-1`}
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={2000}
            placeholder="Mô tả sự cố…"
          />
        </label>

        <div>
          <span className="mb-1 block text-sm font-medium text-slate-600">Ảnh (không bắt buộc)</span>
          <input ref={inputRef} type="file" accept={ACCEPTED} className="sr-only" onChange={(e) => onPick(e.target.files?.[0] ?? undefined)} />
          {previewUrl ? (
            <div className="flex items-start gap-3">
              <img src={previewUrl} alt="Ảnh sẽ gửi" className="h-24 w-24 rounded-xl border border-slate-200 object-cover" />
              <button type="button" onClick={clearFile} className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-red-600">
                <X className="h-3.5 w-3.5" aria-hidden="true" /> Chọn ảnh khác
              </button>
            </div>
          ) : (
            <Button variant="secondary" onClick={() => inputRef.current?.click()}>
              <ImageUp className="h-4 w-4" aria-hidden="true" />
              Chọn ảnh
            </Button>
          )}
        </div>

        {localError ? <ErrorAlert>{localError}</ErrorAlert> : null}
        {create.isError ? <ErrorAlert>{toUserMessage(create.error)}</ErrorAlert> : null}
      </div>
    </Modal>
  );
}

function IssueThumb({ url }: { url: string }) {
  const [zoom, setZoom] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setZoom(true)}
        className="mt-3 block overflow-hidden rounded-xl border border-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
      >
        <img src={url} alt="Ảnh sự cố" className="h-20 w-20 object-cover" />
      </button>
      {zoom ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" role="dialog" aria-modal="true" onClick={() => setZoom(false)}>
          <img src={url} alt="Ảnh sự cố phóng to" className="max-h-full max-w-full rounded-lg object-contain" onClick={(e) => e.stopPropagation()} />
        </div>
      ) : null}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Admin — all branches, accept / resolve                                     */
/* -------------------------------------------------------------------------- */

function AdminIssues() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<IssueStatus | ''>('');
  const [toast, setToast] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ['issues', { admin: true, status: statusFilter }],
    queryFn: () => issuesApi.list({ status: statusFilter || undefined, pageSize: 100 }),
    refetchInterval: POLL_MS,
  });
  const issues = list.data?.issues ?? [];

  const accept = useMutation({
    mutationFn: (id: string) => issuesApi.accept(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['issues'] });
      setToast('Đã tiếp nhận sự cố.');
    },
  });
  const resolve = useMutation({
    mutationFn: (id: string) => issuesApi.resolve(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['issues'] });
      setToast('Đã đánh dấu sự cố đã xử lý.');
    },
  });
  const busyId = accept.isPending ? accept.variables : resolve.isPending ? resolve.variables : undefined;

  return (
    <div>
      <PageHeader
        title="Sự cố khách sạn"
        description="Các sự cố lễ tân báo về từ mọi chi nhánh."
        actions={
          <div className="flex items-center gap-2">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as IssueStatus | '')}
              aria-label="Lọc theo trạng thái"
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
            >
              <option value="">Tất cả trạng thái</option>
              <option value="NEW">Mới</option>
              <option value="IN_PROGRESS">Đang xử lý</option>
              <option value="RESOLVED">Đã xử lý</option>
            </select>
            <button
              type="button"
              onClick={() => void list.refetch()}
              aria-label="Làm mới"
              className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
            >
              <RefreshCw className={`h-4 w-4 ${list.isFetching ? 'animate-spin' : ''}`} aria-hidden="true" />
              Làm mới
            </button>
          </div>
        }
      />

      <QueryState isLoading={list.isLoading} isError={list.isError} error={list.error}>
        {issues.length === 0 ? (
          <EmptyState
            icon={<Wrench className="h-6 w-6" aria-hidden="true" />}
            title="Chưa có sự cố"
            message="Không có sự cố nào được báo cáo."
          />
        ) : (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-3">Chi nhánh</th>
                    <th className="px-4 py-3">Phòng</th>
                    <th className="px-4 py-3">Loại</th>
                    <th className="px-4 py-3">Mô tả</th>
                    <th className="px-4 py-3">Người báo</th>
                    <th className="px-4 py-3">Thời gian</th>
                    <th className="px-4 py-3">Trạng thái</th>
                    <th className="px-4 py-3">Hành động</th>
                  </tr>
                </thead>
                <tbody>
                  {issues.map((issue) => (
                    <IssueRow
                      key={issue.id}
                      issue={issue}
                      busy={busyId === issue.id}
                      onAccept={() => accept.mutate(issue.id)}
                      onResolve={() => resolve.mutate(issue.id)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </QueryState>

      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  );
}

function IssueRow({
  issue,
  busy,
  onAccept,
  onResolve,
}: {
  issue: Issue;
  busy: boolean;
  onAccept: () => void;
  onResolve: () => void;
}) {
  return (
    <tr className="border-b border-slate-100 last:border-b-0 align-top">
      <td className="px-4 py-3 text-slate-600">{issue.branch?.address ?? '—'}</td>
      <td className="px-4 py-3 text-slate-600">{issue.roomNumber ?? '—'}</td>
      <td className="px-4 py-3 text-slate-800">{ISSUE_CATEGORY_LABEL[issue.category]}</td>
      <td className="px-4 py-3 max-w-[22rem]">
        <p className="whitespace-pre-wrap break-words text-slate-700">{issue.description}</p>
        {issue.photoUrl ? <IssueThumb url={issue.photoUrl} /> : null}
      </td>
      <td className="px-4 py-3 text-slate-600">{issue.reportedBy?.fullName ?? '—'}</td>
      <td className="px-4 py-3 text-slate-500">{formatDateTime(issue.createdAt)}</td>
      <td className="px-4 py-3"><IssueStatusBadge status={issue.status} /></td>
      <td className="px-4 py-3">
        <div className="flex flex-wrap gap-2">
          {issue.status === 'NEW' ? (
            <Button variant="secondary" onClick={onAccept} loading={busy} disabled={busy}>
              Tiếp nhận
            </Button>
          ) : null}
          {issue.status !== 'RESOLVED' ? (
            <Button onClick={onResolve} loading={busy} disabled={busy}>
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              Đã xử lý
            </Button>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

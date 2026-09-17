import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, ImageUp, Plus, RefreshCw, Wrench, X } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import {
  AREA_FIELDS,
  ISSUE_AREAS,
  ISSUE_AREA_LABEL,
  ISSUE_AREA_SUBTYPES,
  ISSUE_CATEGORIES,
  issuesApi,
  requiresLocationDetail,
  type Issue,
  type IssueAreaCategory,
  type IssueAreaSubtype,
  type IssueCategory,
  type IssueStatus,
  issueCategoryLabel,
} from '../api/issues';
import { toUserMessage } from '../api/errors';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { Modal } from '../components/Modal';
import { EmptyState } from '../components/EmptyState';
import { ErrorAlert } from '../components/ErrorAlert';
import { PageHeader, QueryState } from '../components/PageState';
import { Toast } from '../components/Toast';
import { DateRangeField, type DateRangeValue } from '../components/DateRangeField';
import { IssueStatusBadge, IssueThumb, IssueWorkTrail } from '../components/IssueViews';
import { formatDateTime, hcmToday } from '../lib/format';
import { useIssueSummary } from '../hooks/useIssueSummary';
import type { BranchIssueSummary } from '../api/issues';

const POLL_MS = 20_000;
const ACCEPTED = 'image/png,image/jpeg,image/webp';
const MAX_BYTES = 10 * 1024 * 1024;

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
        description="Báo ngay cho bộ phận kỹ thuật các sự cố tại phòng và các khu vực của khách sạn."
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
            message="Nhấn “Báo cáo mới” để gửi sự cố cho bộ phận kỹ thuật."
          />
        ) : (
          <ul className="space-y-3" aria-label="Danh sách sự cố">
            {issues.map((issue) => (
              <li key={issue.id}>
                <Card className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-slate-900">{issue.locationLabel}</span>
                        {issue.category ? (
                          <span className="text-sm text-slate-500">{issueCategoryLabel(issue)}</span>
                        ) : null}
                        <IssueStatusBadge status={issue.status} />
                      </div>
                      <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-700">
                        {issue.description}
                      </p>
                      <IssueWorkTrail issue={issue} />
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

      {formOpen ? (
        <NewIssueModal
          onClose={() => setFormOpen(false)}
          onCreated={() => setToast('Đã gửi báo cáo sự cố cho bộ phận kỹ thuật.')}
        />
      ) : null}
      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  );
}

/**
 * The report form, which CHANGES WITH THE AREA.
 *
 * "Sự cố" is asked first, and it decides what else is asked: a room number for a
 * room, a floor for a hallway or a staircase, a fixture for the lobby. Fields
 * that do not apply are not rendered at all rather than disabled — a greyed-out
 * "Số phòng" on a rooftop report is a question the receptionist still has to
 * read and dismiss.
 *
 * `AREA_FIELDS` is the same table the server validates against, so what the form
 * asks for and what the API accepts cannot disagree. The server is still the
 * authority: it re-checks every rule, and refuses a request that skipped the
 * form entirely.
 */
function NewIssueModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [areaCategory, setAreaCategory] = useState<IssueAreaCategory>('ROOM');
  const [category, setCategory] = useState<IssueCategory>('AIR_CONDITIONER');
  const [areaSubtype, setAreaSubtype] = useState<IssueAreaSubtype | ''>('');
  const [roomNumber, setRoomNumber] = useState('');
  const [floorNumber, setFloorNumber] = useState('');
  const [locationDetail, setLocationDetail] = useState('');
  const [description, setDescription] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const fields = AREA_FIELDS[areaCategory];
  const detailRequired = requiresLocationDetail(areaCategory, areaSubtype);

  const create = useMutation({
    mutationFn: () =>
      issuesApi.create({
        areaCategory,
        description,
        category: fields.category ? category : undefined,
        roomNumber: fields.roomNumber ? roomNumber : undefined,
        floorNumber: fields.floorNumber ? floorNumber : undefined,
        areaSubtype: fields.areaSubtype && areaSubtype ? areaSubtype : undefined,
        locationDetail: locationDetail || undefined,
        photo: file ?? undefined,
      }),
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

  /**
   * The description is ALWAYS required, and trimmed before it counts — "   " is
   * not a description. The other requirements follow the area.
   */
  const ready =
    description.trim().length > 0 &&
    (!fields.roomNumber || roomNumber.trim().length > 0) &&
    (!fields.floorNumber || floorNumber.trim().length > 0) &&
    (!fields.areaSubtype || areaSubtype !== '') &&
    (!detailRequired || locationDetail.trim().length > 0);

  const inputClass =
    'w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600';

  return (
    <Modal
      open
      title="Báo cáo sự cố mới"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Hủy
          </Button>
          <Button onClick={() => create.mutate()} loading={create.isPending} disabled={!ready}>
            Gửi báo cáo
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <label className="block text-sm font-medium text-slate-600">
          Sự cố
          <select
            className={`${inputClass} mt-1`}
            value={areaCategory}
            aria-label="Sự cố"
            onChange={(e) => {
              setAreaCategory(e.target.value as IssueAreaCategory);
              // Clear what the new area does not ask for, so a value typed under
              // a previous choice cannot be submitted invisibly.
              setAreaSubtype('');
              setRoomNumber('');
              setFloorNumber('');
              setLocationDetail('');
            }}
          >
            {ISSUE_AREAS.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
        </label>

        {fields.roomNumber ? (
          <label className="block text-sm font-medium text-slate-600">
            Số phòng
            <input
              className={`${inputClass} mt-1`}
              value={roomNumber}
              onChange={(e) => setRoomNumber(e.target.value)}
              placeholder="Ví dụ: 301"
              maxLength={50}
            />
          </label>
        ) : null}

        {fields.floorNumber ? (
          <label className="block text-sm font-medium text-slate-600">
            Số tầng
            <input
              className={`${inputClass} mt-1`}
              value={floorNumber}
              onChange={(e) => setFloorNumber(e.target.value)}
              placeholder="Ví dụ: 3"
              maxLength={50}
            />
          </label>
        ) : null}

        {fields.areaSubtype ? (
          <label className="block text-sm font-medium text-slate-600">
            Loại sự cố
            <select
              className={`${inputClass} mt-1`}
              value={areaSubtype}
              aria-label="Loại sự cố"
              onChange={(e) => setAreaSubtype(e.target.value as IssueAreaSubtype | '')}
            >
              <option value="">— Chọn —</option>
              {ISSUE_AREA_SUBTYPES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {fields.category ? (
          <label className="block text-sm font-medium text-slate-600">
            Loại sự cố
            <select
              className={`${inputClass} mt-1`}
              value={category}
              aria-label="Loại sự cố"
              onChange={(e) => setCategory(e.target.value as IssueCategory)}
            >
              {ISSUE_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {/*
          Shown for every area, but only REQUIRED where the area alone cannot say
          where to go: "Các Khu Vực Còn Lại", and "Khác" in the lobby.
        */}
        <label className="block text-sm font-medium text-slate-600">
          Vị trí cụ thể{' '}
          {detailRequired ? null : <span className="font-normal text-slate-400">(không bắt buộc)</span>}
          <input
            className={`${inputClass} mt-1`}
            value={locationDetail}
            onChange={(e) => setLocationDetail(e.target.value)}
            placeholder="Ví dụ: hồ bơi tầng thượng, kho tầng hầm…"
            maxLength={500}
          />
        </label>

        <label className="block text-sm font-medium text-slate-600">
          Mô tả sự cố
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
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPTED}
            className="sr-only"
            onChange={(e) => onPick(e.target.files?.[0] ?? undefined)}
          />
          {previewUrl ? (
            <div className="flex items-start gap-3">
              <img
                src={previewUrl}
                alt="Ảnh sẽ gửi"
                className="h-24 w-24 rounded-xl border border-slate-200 object-cover"
              />
              <button
                type="button"
                onClick={clearFile}
                className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-red-600"
              >
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

/* -------------------------------------------------------------------------- */
/* Admin — monitoring across all branches. READ ONLY.                         */
/* -------------------------------------------------------------------------- */

/**
 * WHY THERE ARE NO ACTION BUTTONS HERE ANY MORE.
 *
 * An Admin used to press "Tiếp nhận" and "Đã xử lý" on this page, which recorded
 * an administrator as the person who did maintenance work. Now Bộ phận kỹ thuật
 * does the work and the Admin monitors it — so this screen shows status, who is
 * on it and when, and offers an export. The API refuses an Admin transition
 * outright; removing the buttons is the UI agreeing with that rule, not the rule
 * itself.
 */
function AdminIssues() {
  const [statusFilter, setStatusFilter] = useState<IssueStatus | ''>('');
  const [branchFilter, setBranchFilter] = useState<number | null>(null);
  const [exportOpen, setExportOpen] = useState(false);

  const summary = useIssueSummary();
  const branches = summary.data?.summary.byBranch ?? [];
  const activeBranch = branches.find((b) => b.branchId === branchFilter) ?? null;

  const list = useQuery({
    queryKey: ['issues', { admin: true, status: statusFilter, branchId: branchFilter }],
    queryFn: () =>
      issuesApi.list({
        status: statusFilter || undefined,
        branchId: branchFilter ?? undefined,
        pageSize: 100,
      }),
    refetchInterval: POLL_MS,
  });
  const issues = list.data?.issues ?? [];

  return (
    <div>
      <PageHeader
        title="Sự cố khách sạn"
        description="Theo dõi sự cố từ mọi chi nhánh. Bộ phận kỹ thuật là nơi tiếp nhận và xử lý."
        actions={
          <div className="flex items-center gap-2">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as IssueStatus | '')}
              aria-label="Lọc theo trạng thái"
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
            >
              <option value="">Tất cả trạng thái</option>
              <option value="NEW">Sự cố khách sạn</option>
              <option value="IN_PROGRESS">Đang sửa</option>
              <option value="COMPLETED">Đã hoàn thành</option>
            </select>
            <Button variant="secondary" onClick={() => setExportOpen(true)}>
              <Download className="h-4 w-4" aria-hidden="true" />
              Xuất báo cáo
            </Button>
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

      <BranchIssueCards
        branches={branches}
        activeBranchId={branchFilter}
        onSelect={(id) => setBranchFilter((cur) => (cur === id ? null : id))}
      />

      {activeBranch ? (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-brand-200 bg-brand-50 px-3 py-2 text-sm">
          <span className="font-medium text-brand-800">Đang lọc theo chi nhánh: {activeBranch.address}</span>
          <button
            type="button"
            onClick={() => setBranchFilter(null)}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-xs font-medium text-brand-700 hover:bg-brand-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
            Bỏ lọc chi nhánh
          </button>
        </div>
      ) : null}

      <QueryState isLoading={list.isLoading} isError={list.isError} error={list.error}>
        {issues.length === 0 ? (
          <EmptyState
            icon={<Wrench className="h-6 w-6" aria-hidden="true" />}
            title="Chưa có sự cố"
            message={
              activeBranch ? `Không có sự cố cho chi nhánh ${activeBranch.address}.` : 'Không có sự cố nào được báo cáo.'
            }
          />
        ) : (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-3">Chi nhánh</th>
                    <th className="px-4 py-3">Khu vực</th>
                    <th className="px-4 py-3">Phòng/Tầng</th>
                    <th className="px-4 py-3">Loại sự cố</th>
                    <th className="px-4 py-3">Mô tả</th>
                    <th className="px-4 py-3">Người báo</th>
                    <th className="px-4 py-3">Người sửa</th>
                    <th className="px-4 py-3">SĐT</th>
                    <th className="px-4 py-3">Thời gian báo</th>
                    <th className="px-4 py-3">Tiếp nhận</th>
                    <th className="px-4 py-3">Hoàn thành</th>
                    <th className="px-4 py-3">Trạng thái</th>
                  </tr>
                </thead>
                <tbody>
                  {issues.map((issue) => (
                    <IssueMonitorRow key={issue.id} issue={issue} />
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </QueryState>

      {exportOpen ? <IncidentExportModal onClose={() => setExportOpen(false)} branchId={branchFilter} /> : null}
    </div>
  );
}

/** The per-branch unresolved-issue summary cards at the top of the Admin page. */
function BranchIssueCards({
  branches,
  activeBranchId,
  onSelect,
}: {
  branches: BranchIssueSummary[];
  activeBranchId: number | null;
  onSelect: (branchId: number) => void;
}) {
  if (branches.length === 0) return null;
  return (
    <div className="mb-4">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Sự cố theo chi nhánh</h2>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {branches.map((b) => {
          const active = b.branchId === activeBranchId;
          const hasOpen = b.totalUnresolved > 0;
          return (
            <button
              key={b.branchId}
              type="button"
              onClick={() => onSelect(b.branchId)}
              aria-pressed={active}
              aria-label={`${b.totalUnresolved} sự cố chưa xử lý tại ${b.address}${active ? ' (đang lọc)' : ''}`}
              className={`rounded-xl border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 ${
                active
                  ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-500'
                  : hasOpen
                    ? 'border-red-200 bg-white hover:border-red-300'
                    : 'border-slate-200 bg-white hover:border-slate-300'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0 truncate text-sm font-semibold text-slate-800">{b.address}</span>
                <span
                  className={`inline-flex min-w-[1.5rem] items-center justify-center rounded-full px-1.5 py-0.5 text-xs font-bold leading-none ${
                    hasOpen ? 'bg-red-600 text-white' : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {b.totalUnresolved}
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                Mới: {b.newCount} · Đang sửa: {b.inProgressCount}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function IssueMonitorRow({ issue }: { issue: Issue }) {
  return (
    <tr className="border-b border-slate-100 align-top last:border-b-0">
      <td className="px-4 py-3 text-slate-600">{issue.branch?.address ?? '—'}</td>
      <td className="px-4 py-3 text-slate-600">
        {issue.areaCategory ? ISSUE_AREA_LABEL[issue.areaCategory] : '—'}
      </td>
      <td className="px-4 py-3 text-slate-600">{issue.roomNumber ?? issue.floorNumber ?? '—'}</td>
      <td className="px-4 py-3 text-slate-800">{issueCategoryLabel(issue)}</td>
      <td className="max-w-[20rem] px-4 py-3">
        <p className="whitespace-pre-wrap break-words text-slate-700">{issue.description}</p>
        {issue.photoUrl ? <IssueThumb url={issue.photoUrl} /> : null}
      </td>
      <td className="px-4 py-3 text-slate-600">{issue.reportedByName ?? '—'}</td>
      <td className="px-4 py-3 text-slate-600">{issue.technicianName ?? '—'}</td>
      <td className="px-4 py-3 text-slate-600">{issue.technicianPhone ?? '—'}</td>
      <td className="px-4 py-3 text-slate-500">{formatDateTime(issue.createdAt)}</td>
      <td className="px-4 py-3 text-slate-500">{issue.acceptedAt ? formatDateTime(issue.acceptedAt) : '—'}</td>
      <td className="px-4 py-3 text-slate-500">{issue.completedAt ? formatDateTime(issue.completedAt) : '—'}</td>
      <td className="px-4 py-3">
        <IssueStatusBadge status={issue.status} />
      </td>
    </tr>
  );
}

/**
 * The incident export.
 *
 * Opens the PDF endpoint in a new tab rather than fetching it into memory: the
 * request carries the session cookie, the browser handles the download, and the
 * file never has to be turned into a blob URL the page must then revoke.
 */
function IncidentExportModal({ onClose, branchId }: { onClose: () => void; branchId: number | null }) {
  const today = hcmToday();
  const [range, setRange] = useState<DateRangeValue>({ from: today, to: today });

  const ready = range.from !== '' && range.to !== '';

  function download() {
    const params = new URLSearchParams({ from: range.from, to: range.to });
    if (branchId != null) params.set('branchId', String(branchId));
    window.open(`/api/admin/reports/incidents.pdf?${params.toString()}`, '_blank', 'noopener');
    onClose();
  }

  return (
    <Modal
      open
      title="Xuất báo cáo sự cố"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Hủy
          </Button>
          <Button onClick={download} disabled={!ready} data-testid="incident-export-confirm">
            <Download className="h-4 w-4" aria-hidden="true" />
            Tải PDF
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <DateRangeField legend="Khoảng thời gian" value={range} onChange={setRange} testId="incident-report-range" />
        <p className="text-sm text-slate-600">
          {branchId == null
            ? 'Báo cáo gồm tất cả chi nhánh.'
            : 'Báo cáo chỉ gồm chi nhánh đang lọc. Bỏ lọc để xuất tất cả.'}
        </p>
      </div>
    </Modal>
  );
}

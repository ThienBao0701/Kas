/**
 * Chứng từ — the detail / review screen.
 *
 * Grouped the way the work is done: branch, guest, card, the three upload
 * slots, the reason, the status, then the audit trail.
 *
 * THE CARD NUMBER IS MASKED UNTIL EXPLICITLY REVEALED. "Hiện số thẻ" calls a
 * POST endpoint that decrypts server-side and records who looked; the returned
 * value lives in component state only — never localStorage, never sessionStorage,
 * never a URL — and is dropped again by "Ẩn số thẻ" or by leaving the page.
 */
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Eye, EyeOff, Paperclip, Trash2, Upload } from 'lucide-react';
import {
  ATTACHMENT_CATEGORY_LABEL,
  CHARGE_AUDIT_LABEL,
  CHARGE_STATUSES,
  CHARGE_STATUS_LABEL,
  attachmentUrl,
  chargeDocumentsApi,
  type ChargeAttachmentCategory,
  type ChargeAttachmentView,
  type ChargeStatus,
} from '../api/chargeDocuments';
import { toUserMessage } from '../api/errors';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { ErrorAlert } from '../components/ErrorAlert';
import { PageHeader } from '../components/PageState';
import { formatDate, formatDateTime, formatMoney } from '../lib/format';
import { StatusChip } from './ChargeDocumentsPage';

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2.5">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <div className="mt-0.5 break-words text-sm text-slate-900">{value}</div>
    </div>
  );
}

/** One upload slot: its files, an add control, and per-file removal. */
function AttachmentSection({
  category,
  attachments,
  onUpload,
  onRemove,
  busy,
}: {
  category: ChargeAttachmentCategory;
  attachments: ChargeAttachmentView[];
  onUpload: (files: File[]) => void;
  onRemove: (id: string) => void;
  busy: boolean;
}) {
  const accept =
    category === 'CHARGE_DOCUMENT' ? 'image/png,image/jpeg,image/webp,application/pdf' : 'image/png,image/jpeg,image/webp';
  const inputId = `upload-${category}`;

  return (
    <Card className="p-5" data-testid={`attachments-${category}`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <Paperclip className="h-4 w-4 text-brand-600" aria-hidden="true" />
          {ATTACHMENT_CATEGORY_LABEL[category]}
        </div>
        <label
          htmlFor={inputId}
          className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          <Upload className="h-4 w-4" aria-hidden="true" />
          {category === 'CHARGE_DOCUMENT' ? 'Thêm tệp' : 'Thêm ảnh'}
          <input
            id={inputId}
            type="file"
            className="sr-only"
            multiple
            accept={accept}
            disabled={busy}
            aria-label={`Tải lên ${ATTACHMENT_CATEGORY_LABEL[category]}`}
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              if (files.length > 0) onUpload(files);
              e.target.value = '';
            }}
          />
        </label>
      </div>

      {attachments.length === 0 ? (
        <p className="text-sm text-slate-400">Chưa có tệp nào.</p>
      ) : (
        <ul className="space-y-2">
          {attachments.map((a) => (
            <li
              key={a.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50/60 p-2"
            >
              <div className="min-w-0">
                {/* Authenticated fetch — there is no public URL for these. */}
                <a
                  href={attachmentUrl(a.id)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm font-medium text-brand-700 hover:underline"
                >
                  {a.originalFileName}
                </a>
                <p className="text-xs text-slate-500">
                  {formatDateTime(a.uploadedAt)}
                  {a.uploadedBy ? ` · ${a.uploadedBy.fullName}` : ''} · {a.mimeType}
                </p>
              </div>
              <button
                type="button"
                aria-label={`Xoá ${a.originalFileName}`}
                className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-red-600"
                onClick={() => onRemove(a.id)}
                disabled={busy}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                Xoá
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function ChargeDocumentDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [revealed, setRevealed] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const detail = useQuery({
    queryKey: ['charge-document', id],
    queryFn: () => chargeDocumentsApi.detail(id),
    enabled: !!id,
  });
  const audit = useQuery({
    queryKey: ['charge-document-audit', id],
    queryFn: () => chargeDocumentsApi.audit(id),
    enabled: !!id,
  });

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['charge-document', id] });
    void queryClient.invalidateQueries({ queryKey: ['charge-document-audit', id] });
    void queryClient.invalidateQueries({ queryKey: ['charge-documents'] });
  }

  const reveal = useMutation({
    mutationFn: () => chargeDocumentsApi.revealCard(id),
    onSuccess: (res) => {
      setRevealed(res.cardNumber);
      // The reveal is audited server-side; refresh so the trail shows it.
      void queryClient.invalidateQueries({ queryKey: ['charge-document-audit', id] });
    },
    onError: (err) => setActionError(toUserMessage(err)),
  });

  const setStatus = useMutation({
    mutationFn: (status: ChargeStatus) => chargeDocumentsApi.update(id, { status }),
    onSuccess: refresh,
    onError: (err) => setActionError(toUserMessage(err)),
  });

  const upload = useMutation({
    mutationFn: (vars: { category: ChargeAttachmentCategory; files: File[] }) =>
      chargeDocumentsApi.uploadAttachments(id, vars.category, vars.files),
    onSuccess: refresh,
    onError: (err) => setActionError(toUserMessage(err)),
  });

  const removeAttachment = useMutation({
    mutationFn: (attachmentId: string) => chargeDocumentsApi.removeAttachment(attachmentId),
    onSuccess: refresh,
    onError: (err) => setActionError(toUserMessage(err)),
  });

  if (detail.isLoading) return <PageHeader title="Chứng từ" description="Đang tải…" />;
  if (detail.isError) return <ErrorAlert>{toUserMessage(detail.error)}</ErrorAlert>;

  const doc = detail.data!.document;
  const byCategory = (c: ChargeAttachmentCategory) => doc.attachments.filter((a) => a.category === c);
  const busy = upload.isPending || removeAttachment.isPending;

  return (
    <div className="space-y-5">
      <PageHeader
        title={doc.guestName}
        description={`Mã đặt phòng ${doc.bookingCode}`}
        actions={
          <Button variant="secondary" onClick={() => navigate('/app/charge-documents')}>
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Danh sách
          </Button>
        }
      />

      {actionError ? <ErrorAlert>{actionError}</ErrorAlert> : null}

      <Card className="p-5">
        <p className="mb-3 text-sm font-semibold text-slate-700">Thông tin chi nhánh &amp; khách</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Row label="Chi nhánh" value={`Chi nhánh ${doc.branch.branchNumber} — ${doc.branch.address}`} />
          <Row label="Tên khách" value={doc.guestName} />
          <Row label="Mã đặt phòng" value={<span className="font-mono">{doc.bookingCode}</span>} />
          <Row label="Số tiền" value={<strong>{formatMoney(doc.amount)}</strong>} />
          <Row label="Ngày check-in" value={formatDate(doc.checkIn)} />
          <Row label="Ngày check-out" value={formatDate(doc.checkOut)} />
        </div>
      </Card>

      <Card className="p-5">
        <p className="mb-3 text-sm font-semibold text-slate-700">Thông tin thẻ</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2.5">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Số thẻ</p>
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <span className="font-mono text-sm text-slate-900" data-testid="card-number">
                {revealed ?? doc.cardMasked}
              </span>
              {revealed ? (
                <Button variant="secondary" onClick={() => setRevealed(null)}>
                  <EyeOff className="h-4 w-4" aria-hidden="true" />
                  Ẩn số thẻ
                </Button>
              ) : (
                <Button variant="secondary" onClick={() => reveal.mutate()} loading={reveal.isPending}>
                  <Eye className="h-4 w-4" aria-hidden="true" />
                  Hiện số thẻ
                </Button>
              )}
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Mỗi lần hiện số thẻ đều được ghi lại trong lịch sử thao tác.
            </p>
          </div>
          <Row label="Date expire" value={doc.cardExpiry} />
        </div>
      </Card>

      <AttachmentSection
        category="GUEST_IMAGE"
        attachments={byCategory('GUEST_IMAGE')}
        onUpload={(files) => upload.mutate({ category: 'GUEST_IMAGE', files })}
        onRemove={(attachmentId) => removeAttachment.mutate(attachmentId)}
        busy={busy}
      />
      <AttachmentSection
        category="CHARGE_DOCUMENT"
        attachments={byCategory('CHARGE_DOCUMENT')}
        onUpload={(files) => upload.mutate({ category: 'CHARGE_DOCUMENT', files })}
        onRemove={(attachmentId) => removeAttachment.mutate(attachmentId)}
        busy={busy}
      />
      <AttachmentSection
        category="CARD_IMAGE"
        attachments={byCategory('CARD_IMAGE')}
        onUpload={(files) => upload.mutate({ category: 'CARD_IMAGE', files })}
        onRemove={(attachmentId) => removeAttachment.mutate(attachmentId)}
        busy={busy}
      />

      <Card className="p-5">
        <p className="mb-2 text-sm font-semibold text-slate-700">Lý do charge</p>
        <p className="whitespace-pre-wrap rounded-xl bg-slate-50 px-3 py-3 text-sm text-slate-800">
          {doc.reason}
        </p>
      </Card>

      <Card className="p-5">
        <p className="mb-3 text-sm font-semibold text-slate-700">Trạng thái</p>
        <div className="flex flex-wrap items-center gap-3">
          <StatusChip status={doc.status} />
          <select
            aria-label="Đổi trạng thái"
            className="rounded-xl border border-slate-300 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
            value={doc.status}
            disabled={setStatus.isPending}
            onChange={(e) => setStatus.mutate(e.target.value as ChargeStatus)}
          >
            {CHARGE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {CHARGE_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
          <span className="text-sm text-slate-600">
            Ngày charge: <strong>{doc.chargedAt ? formatDateTime(doc.chargedAt) : '—'}</strong>
          </span>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Ngày charge chỉ được ghi khi trạng thái là “Đã bị charge”, và đây là mốc thời gian báo cáo
          tháng sử dụng.
        </p>
      </Card>

      <Card className="p-5">
        <p className="mb-3 text-sm font-semibold text-slate-700">Lịch sử thao tác</p>
        <ul className="space-y-2" data-testid="charge-audit">
          {(audit.data?.events ?? []).map((e) => (
            <li key={e.id} className="rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-slate-800">{CHARGE_AUDIT_LABEL[e.action]}</span>
                {e.field ? <span className="text-xs text-slate-500">({e.field})</span> : null}
                <span className="text-xs text-slate-500">{formatDateTime(e.createdAt)}</span>
                {e.actor ? <span className="text-xs text-slate-500">· {e.actor.fullName}</span> : null}
              </div>
              {e.oldValue || e.newValue ? (
                <p className="mt-0.5 text-xs text-slate-600">
                  {e.oldValue ?? '—'} → {e.newValue ?? '—'}
                </p>
              ) : null}
            </li>
          ))}
          {(audit.data?.events ?? []).length === 0 ? (
            <li className="text-sm text-slate-400">Chưa có thao tác nào.</li>
          ) : null}
        </ul>
      </Card>
    </div>
  );
}

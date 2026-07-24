import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  ThumbsDown,
  ThumbsUp,
  X,
} from 'lucide-react';
import {
  bookingsApi,
  REVIEW_REASONS,
  REVIEW_REASON_LABEL,
  type BookingDetail,
  type ProofReviewReason,
  type ProofView,
} from '../api/bookings';
import { ApiError, toUserMessage } from '../api/errors';
import { formatDate, formatDateTime, formatFileSize, formatMoney } from '../lib/format';
import { Card } from './Card';
import { Button } from './Button';
import { Modal } from './Modal';
import { ErrorAlert } from './ErrorAlert';
import { PaymentBadge } from './Badges';
import { ImageUploadDropzone } from './ImageUploadDropzone';

/**
 * The proof-of-creation workflow surface. What it renders depends on the
 * booking's verificationStatus and the viewer's role:
 *  - receptionist, NOT_SUBMITTED / REJECTED → upload a screenshot ("Gửi Admin kiểm tra")
 *  - receptionist, PENDING_REVIEW           → waiting state + their submitted image
 *  - admin, PENDING_REVIEW                  → LEFT (booking) / RIGHT (image) review + verdict
 *  - APPROVED (COMPLETED)                   → confirmed state + proof history
 * `onChanged` lets the parent own the success toast and query invalidation.
 */
export function ProofSection({
  booking: b,
  isAdmin,
  onChanged,
}: {
  booking: BookingDetail;
  isAdmin: boolean;
  onChanged?: (message: string) => void;
}) {
  const vs = b.verificationStatus;
  const proofs = b.proofs ?? [];
  const latest = proofs.length > 0 ? proofs[proofs.length - 1]! : null;

  if (vs === 'APPROVED' || b.status === 'COMPLETED') {
    return <ApprovedCard booking={b} />;
  }

  if (isAdmin) {
    if (vs === 'PENDING_REVIEW' && latest) {
      return <AdminReviewCard booking={b} proof={latest} onChanged={onChanged} />;
    }
    return <AdminWaitingCard booking={b} />;
  }

  // Receptionist
  if (vs === 'PENDING_REVIEW') {
    return <ReceptionistPendingCard booking={b} proof={latest} />;
  }
  // NOT_SUBMITTED or REJECTED → upload (resubmit after a rejection).
  return <UploadCard booking={b} onChanged={onChanged} />;
}

/* -------------------------------------------------------------------------- */
/* Upload (receptionist)                                                       */
/* -------------------------------------------------------------------------- */

function UploadCard({ booking: b, onChanged }: { booking: BookingDetail; onChanged?: (m: string) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState('');
  const rejected = b.verificationStatus === 'REJECTED';
  const lastRejection = [...b.proofs].reverse().find((p) => p.status === 'REJECTED');

  const submit = useMutation({
    mutationFn: () => bookingsApi.submitProof(b.id, file!, note),
    onSuccess: () => {
      // Only clear on success; a failure keeps the image so the user can retry.
      setFile(null);
      setNote('');
      onChanged?.('Đã gửi ảnh cho Admin kiểm tra.');
    },
  });

  return (
    <Card className={`p-5 ${rejected ? 'border-red-200 bg-red-50/40' : 'border-brand-200 bg-brand-50/40'}`}>
      {rejected && lastRejection ? (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3 py-3">
          <div className="flex items-center gap-2 text-red-700">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            <span className="text-sm font-semibold">Admin yêu cầu tạo lại</span>
          </div>
          <p className="mt-1 text-sm text-red-700">
            Lý do: <strong>{lastRejection.reviewReasonCode ? REVIEW_REASON_LABEL[lastRejection.reviewReasonCode] : '—'}</strong>
            {lastRejection.reviewNote ? ` — ${lastRejection.reviewNote}` : ''}
          </p>
          <p className="mt-1 text-xs text-red-600">
            Vui lòng kiểm tra lại, tạo đúng trên hệ thống khách sạn rồi chụp và gửi lại ảnh mới.
          </p>
        </div>
      ) : (
        <>
          <p className="text-sm font-medium text-slate-700">Xác nhận đã tạo — gửi ảnh cho Admin kiểm tra</p>
          <p className="mt-1 text-sm text-slate-600">
            Sau khi đã tạo đặt phòng trên hệ thống khách sạn, hãy tải lên ảnh chụp màn hình để Admin kiểm tra.
          </p>
        </>
      )}

      <div className="mt-4">
        <ImageUploadDropzone value={file} onChange={setFile} disabled={submit.isPending} />
      </div>

      {submit.isError ? <div className="mt-3"><ErrorAlert>{toUserMessage(submit.error)}</ErrorAlert></div> : null}

      <label className="mt-4 block text-sm font-medium text-slate-600">
        Ghi chú cho Admin (không bắt buộc)
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          maxLength={1000}
          className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
          placeholder="Ví dụ: đã tạo trên hệ thống, mã nội bộ…"
        />
      </label>

      <div className="mt-4">
        <Button onClick={() => submit.mutate()} disabled={!file || submit.isPending} loading={submit.isPending}>
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
          {submit.isPending ? 'Đang gửi ảnh...' : 'Gửi Admin kiểm tra'}
        </Button>
      </div>

      {b.proofs.length > 0 ? <ProofHistory proofs={b.proofs} className="mt-5" /> : null}
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Receptionist: pending                                                       */
/* -------------------------------------------------------------------------- */

function ReceptionistPendingCard({ booking: b, proof }: { booking: BookingDetail; proof: ProofView | null }) {
  return (
    <Card className="border-amber-200 bg-amber-50/50 p-5">
      <div className="flex items-center gap-2 text-amber-800">
        <Clock3 className="h-5 w-5" aria-hidden="true" />
        <span className="text-sm font-semibold">Đang chờ Admin kiểm tra</span>
      </div>
      <p className="mt-1 text-sm text-slate-600">
        Bạn đã gửi ảnh (lần {proof?.attemptNumber ?? b.proofs.length}). Vui lòng đợi Admin xác nhận. Bạn sẽ nhận được
        thông báo khi có kết quả.
      </p>
      {proof ? <ProofThumb proof={proof} className="mt-4 w-40" /> : null}
      {b.proofs.length > 1 ? <ProofHistory proofs={b.proofs} className="mt-5" /> : null}
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Admin: waiting for the branch                                               */
/* -------------------------------------------------------------------------- */

function AdminWaitingCard({ booking: b }: { booking: BookingDetail }) {
  const rejected = b.verificationStatus === 'REJECTED';
  const lastRejection = [...b.proofs].reverse().find((p) => p.status === 'REJECTED');
  return (
    <Card className={`p-5 ${rejected ? 'border-red-200 bg-red-50/40' : ''}`}>
      <div className="flex items-center gap-2 text-slate-700">
        <Clock3 className="h-5 w-5 text-slate-400" aria-hidden="true" />
        <span className="text-sm font-semibold">
          {rejected ? 'Đã yêu cầu chi nhánh tạo lại' : 'Chờ chi nhánh tạo và gửi ảnh'}
        </span>
      </div>
      {rejected && lastRejection ? (
        <p className="mt-1 text-sm text-red-700">
          Lý do đã gửi: <strong>{lastRejection.reviewReasonCode ? REVIEW_REASON_LABEL[lastRejection.reviewReasonCode] : '—'}</strong>
          {lastRejection.reviewNote ? ` — ${lastRejection.reviewNote}` : ''}
        </p>
      ) : (
        <p className="mt-1 text-sm text-slate-600">Chi nhánh chưa gửi ảnh chứng minh. Không có gì để kiểm tra lúc này.</p>
      )}
      {b.proofs.length > 0 ? <ProofHistory proofs={b.proofs} className="mt-5" /> : null}
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Admin: review (LEFT booking / RIGHT image)                                  */
/* -------------------------------------------------------------------------- */

function AdminReviewCard({
  booking: b,
  proof,
  onChanged,
}: {
  booking: BookingDetail;
  proof: ProofView;
  onChanged?: (m: string) => void;
}) {
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reasonCode, setReasonCode] = useState<ProofReviewReason>('WRONG_BOOKING_CODE');
  const [reviewNote, setReviewNote] = useState('');
  const [zoom, setZoom] = useState(false);

  const approve = useMutation({
    mutationFn: () => bookingsApi.approveProof(b.id, proof.id),
    onSuccess: () => onChanged?.('Đã xác nhận đúng. Đơn đã hoàn thành.'),
    onError: (err) => {
      if (err instanceof ApiError && (err.code === 'PROOF_ALREADY_REVIEWED' || err.code === 'BOOKING_ALREADY_COMPLETED')) {
        onChanged?.('Đơn đã được xử lý trước đó.');
      }
    },
  });
  const reject = useMutation({
    mutationFn: () => bookingsApi.rejectProof(b.id, proof.id, reasonCode, reviewNote.trim() || undefined),
    onSuccess: () => {
      setRejectOpen(false);
      onChanged?.('Đã gửi yêu cầu tạo lại cho chi nhánh.');
    },
  });

  return (
    <Card className="border-brand-200 p-5">
      <p className="mb-3 text-sm font-semibold text-slate-700">Kiểm tra ảnh chứng minh (lần {proof.attemptNumber})</p>

      {/* Desktop: side-by-side comparison. Mobile: stacked. */}
      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        {/* LEFT: what the booking should contain */}
        <div className="rounded-xl border border-slate-200 p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Thông tin đơn gốc</p>
          <dl className="space-y-1.5 text-sm">
            <CompareRow label="Tên khách" value={b.customerName ?? '—'} />
            <CompareRow label="Mã Booking" value={b.bookingCode ?? '—'} mono />
            <CompareRow label="Nhận phòng" value={formatDate(b.checkInDate)} />
            <CompareRow label="Trả phòng" value={formatDate(b.checkOutDate)} />
            <CompareRow label="Số phòng" value={String(b.rooms.length)} />
            <CompareRow label="Hạng phòng" value={b.rooms.map((r) => r.roomType ?? '—').join(', ') || '—'} />
            <CompareRow label="Tổng tiền" value={formatMoney(b.totalAmount, b.currency)} />
            <CompareRow label="Thanh toán" value={<PaymentBadge status={b.paymentStatus} />} />
          </dl>
        </div>

        {/* RIGHT: the receptionist's screenshot */}
        <div className="rounded-xl border border-slate-200 p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Ảnh lễ tân gửi</p>
          <button
            type="button"
            onClick={() => setZoom(true)}
            className="block w-full overflow-hidden rounded-lg border border-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
          >
            <img src={proof.imageUrl} alt={`Ảnh chứng minh lần ${proof.attemptNumber}`} className="max-h-[28rem] w-full object-contain bg-slate-50" />
          </button>
          <p className="mt-2 text-xs text-slate-500">
            {proof.originalFileName} · {formatFileSize(proof.fileSize)} · gửi {formatDateTime(proof.submittedAt)}
            {proof.submittedBy ? ` · ${proof.submittedBy.fullName}` : ''}
          </p>
          {proof.submissionNote ? (
            <p className="mt-1 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">Ghi chú: {proof.submissionNote}</p>
          ) : null}
        </div>
      </div>

      {approve.isError && !(approve.error instanceof ApiError && approve.error.code === 'PROOF_ALREADY_REVIEWED') ? (
        <div className="mt-3"><ErrorAlert>{toUserMessage(approve.error)}</ErrorAlert></div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={() => approve.mutate()} loading={approve.isPending}>
          <ThumbsUp className="h-4 w-4" aria-hidden="true" />
          Đúng — xác nhận
        </Button>
        <Button variant="danger" onClick={() => setRejectOpen(true)}>
          <ThumbsDown className="h-4 w-4" aria-hidden="true" />
          Sai — yêu cầu tạo lại
        </Button>
      </div>

      {b.proofs.length > 1 ? <ProofHistory proofs={b.proofs} className="mt-5" /> : null}

      <Modal
        open={rejectOpen}
        title="Yêu cầu tạo lại"
        onClose={() => setRejectOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRejectOpen(false)}>Hủy</Button>
            <Button variant="danger" onClick={() => reject.mutate()} loading={reject.isPending}>
              Gửi yêu cầu tạo lại
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">Chọn lý do để chi nhánh biết cần sửa gì:</p>
        <label className="mt-3 block text-sm font-medium text-slate-600">
          Lý do
          <select
            value={reasonCode}
            onChange={(e) => setReasonCode(e.target.value as ProofReviewReason)}
            className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
          >
            {REVIEW_REASONS.map((r) => (
              <option key={r.code} value={r.code}>{r.label}</option>
            ))}
          </select>
        </label>
        <label className="mt-3 block text-sm font-medium text-slate-600">
          Ghi chú thêm (không bắt buộc)
          <textarea
            value={reviewNote}
            onChange={(e) => setReviewNote(e.target.value)}
            rows={3}
            maxLength={1000}
            className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
            placeholder="Mô tả cụ thể chỗ sai để lễ tân sửa nhanh…"
          />
        </label>
        {reject.isError ? <div className="mt-3"><ErrorAlert>{toUserMessage(reject.error)}</ErrorAlert></div> : null}
      </Modal>

      {zoom ? <ImageLightbox url={proof.imageUrl} onClose={() => setZoom(false)} /> : null}
    </Card>
  );
}

function CompareRow({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-slate-500">{label}</dt>
      <dd className={`text-right font-medium text-slate-900 ${mono ? 'font-mono' : ''}`}>{value}</dd>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Approved                                                                    */
/* -------------------------------------------------------------------------- */

function ApprovedCard({ booking: b }: { booking: BookingDetail }) {
  return (
    <Card className="border-green-200 bg-green-50/50 p-5">
      <div className="flex items-center gap-2 text-green-700">
        <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
        <span className="text-sm font-semibold">Đã xác nhận đúng</span>
      </div>
      <p className="mt-2 text-sm text-slate-600">
        {b.reviewedBy ? `Admin ${b.reviewedBy.fullName} đã duyệt · ` : ''}
        {formatDateTime(b.reviewedAt ?? b.completedAt)}
      </p>
      {b.proofs.length > 0 ? <ProofHistory proofs={b.proofs} className="mt-4" /> : null}
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Shared proof pieces                                                         */
/* -------------------------------------------------------------------------- */

function ProofThumb({ proof, className = '' }: { proof: ProofView; className?: string }) {
  const [zoom, setZoom] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setZoom(true)}
        className={`block overflow-hidden rounded-xl border border-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 ${className}`}
      >
        <img src={proof.imageUrl} alt={`Ảnh chứng minh lần ${proof.attemptNumber}`} className="aspect-square w-full object-cover" />
      </button>
      {zoom ? <ImageLightbox url={proof.imageUrl} onClose={() => setZoom(false)} /> : null}
    </>
  );
}

const PROOF_STATUS_META: Record<ProofView['status'], { label: string; className: string }> = {
  PENDING_REVIEW: { label: 'Chờ kiểm tra', className: 'bg-amber-100 text-amber-800' },
  APPROVED: { label: 'Đúng', className: 'bg-green-100 text-green-700' },
  REJECTED: { label: 'Cần tạo lại', className: 'bg-red-100 text-red-700' },
};

function ProofHistory({ proofs, className = '' }: { proofs: ProofView[]; className?: string }) {
  return (
    <div className={className}>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
        Lịch sử ảnh đã gửi ({proofs.length})
      </p>
      <ul className="space-y-2">
        {[...proofs]
          .sort((a, b) => b.attemptNumber - a.attemptNumber)
          .map((p) => {
            const meta = PROOF_STATUS_META[p.status];
            return (
              <li key={p.id} className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50/60 p-2">
                <ProofThumb proof={p} className="h-14 w-14 shrink-0" />
                <div className="min-w-0 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-800">Lần {p.attemptNumber}</span>
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${meta.className}`}>
                      {meta.label}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500">Gửi {formatDateTime(p.submittedAt)}</p>
                  {p.status === 'REJECTED' && p.reviewReasonCode ? (
                    <p className="text-xs text-red-600">
                      {REVIEW_REASON_LABEL[p.reviewReasonCode]}
                      {p.reviewNote ? ` — ${p.reviewNote}` : ''}
                    </p>
                  ) : null}
                </div>
              </li>
            );
          })}
      </ul>
    </div>
  );
}

function ImageLightbox({ url, onClose }: { url: string; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Xem ảnh phóng to"
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Đóng"
        className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
      >
        <X className="h-5 w-5" aria-hidden="true" />
      </button>
      <img src={url} alt="Ảnh chứng minh phóng to" className="max-h-full max-w-full rounded-lg object-contain" onClick={(e) => e.stopPropagation()} />
    </div>
  );
}

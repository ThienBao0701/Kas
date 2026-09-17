/**
 * The pieces of an incident that three different screens all have to render the
 * same way: Reception's own list, the Technical queues and the Admin monitor.
 *
 * They live here rather than being copied into each page because the status
 * names, the colours and the "where is it" line are the shared vocabulary of the
 * workflow — three copies would drift, and an incident reading "Đang sửa" on one
 * screen and "Đang xử lý" on another is a support call.
 */
import { useState } from 'react';
import { ISSUE_STATUS_LABEL, type Issue, type IssueStatus } from '../api/issues';
import { formatDateTime } from '../lib/format';

const STATUS_STYLES: Record<IssueStatus, string> = {
  NEW: 'bg-amber-100 text-amber-800',
  IN_PROGRESS: 'bg-blue-100 text-blue-700',
  COMPLETED: 'bg-green-100 text-green-700',
};

export function IssueStatusBadge({ status }: { status: IssueStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}
    >
      {ISSUE_STATUS_LABEL[status]}
    </span>
  );
}

export function IssueThumb({ url }: { url: string }) {
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
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setZoom(false)}
        >
          <img
            src={url}
            alt="Ảnh sự cố phóng to"
            className="max-h-full max-w-full rounded-lg object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      ) : null}
    </>
  );
}

/**
 * Who worked the incident and when — the audit trail, rendered identically for
 * Technical and for Admin. Shows nothing at all while the incident is still NEW,
 * because there is nothing true to say yet.
 */
export function IssueWorkTrail({ issue }: { issue: Issue }) {
  if (issue.status === 'NEW') return null;
  return (
    <dl className="mt-2 grid gap-x-4 gap-y-1 text-xs text-slate-600 sm:grid-cols-2">
      {issue.technicianName ? (
        <div>
          <dt className="inline text-slate-500">Người sửa: </dt>
          <dd className="inline font-medium text-slate-800">{issue.technicianName}</dd>
        </div>
      ) : null}
      {issue.technicianPhone ? (
        <div>
          <dt className="inline text-slate-500">SĐT: </dt>
          <dd className="inline font-medium text-slate-800">{issue.technicianPhone}</dd>
        </div>
      ) : null}
      {issue.acceptedAt ? (
        <div>
          <dt className="inline text-slate-500">Tiếp nhận: </dt>
          <dd className="inline">{formatDateTime(issue.acceptedAt)}</dd>
        </div>
      ) : null}
      {issue.completedAt ? (
        <div>
          <dt className="inline text-slate-500">Hoàn thành: </dt>
          <dd className="inline">{formatDateTime(issue.completedAt)}</dd>
        </div>
      ) : null}
    </dl>
  );
}

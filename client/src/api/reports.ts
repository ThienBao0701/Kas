import { api } from './client';
import type { ShiftType } from './shifts';

/** One re-creation: a creation attempt the Admin rejected. */
export interface RecreationRow {
  proofId: string;
  bookingId: string;
  attemptNumber: number;
  bookingCode: string;
  customerName: string | null;
  source: string | null;
  branch: { id: number; code: string; hotelName: string; address: string } | null;
  /** The order's own creation instant — never rewritten by a redispatch. */
  bookingCreatedAt: string;
  checkInDate: string | null;
  submittedAt: string;
  /** Who created it, from the shift they were checked in to. */
  receptionistName: string;
  shiftType: ShiftType | null;
  shiftLabel: string;
  shiftSessionId: string | null;
  shiftStartedAt: string | null;
  reviewedAt: string | null;
  reviewedBy: { id: number; fullName: string } | null;
  reasonCode: string | null;
  reviewNote: string | null;
  currentStatus: string;
  currentVerificationStatus: string;
  withdrawn: boolean;
}

export interface RecreationReport {
  range: { from: string; to: string };
  rows: RecreationRow[];
  totals: {
    total: number;
    byBranch: Record<string, number>;
    byShift: Record<string, number>;
    byReceptionist: Record<string, number>;
  };
}

export interface RecreationFilter {
  from: string;
  to: string;
  branchId?: number;
  shiftType?: ShiftType;
  receptionistUserId?: number;
  source?: string;
}

function query(params: Record<string, string | number | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

/**
 * The PDF endpoints are not fetched — they are opened.
 *
 * `window.open` on a same-origin URL sends the session cookie and hands the file
 * to the browser's own download machinery. Fetching the bytes into a blob would
 * mean holding a whole report in memory and remembering to revoke the object URL
 * afterwards, for no gain.
 */
export function recreationReportPdfUrl(filter: RecreationFilter): string {
  return `/api/admin/reports/recreations.pdf${query({ ...filter })}`;
}

export function incidentReportPdfUrl(params: { from: string; to: string; branchId?: number }): string {
  return `/api/admin/reports/incidents.pdf${query(params)}`;
}

export const reportsApi = {
  recreations: (filter: RecreationFilter) =>
    api.get<RecreationReport>(`/admin/reports/recreations${query({ ...filter })}`),
};

/**
 * "KAS – BÁO CÁO SỰ CỐ KHÁCH SẠN" as a PDF.
 *
 * WHAT IS DELIBERATELY NOT IN IT
 *
 * Nothing about an account beyond a display name: no username, no role, no id,
 * no password state. The technician's phone IS included — it is operational
 * contact information the report exists to carry, and the Admin who can run this
 * report can already see it on screen.
 */
import type { IssueStatus } from '@prisma/client';
import { describeLocation, ISSUE_AREA_LABELS } from '../issue/issueArea';
import { ISSUE_CATEGORY_LABELS, type IssueDetail } from '../issue/issueService';
import { hcmDateTime, periodLabel, rankedTotals } from './format';
import {
  addPageNumbers,
  createReportDocument,
  drawTable,
  drawTotals,
  finishDocument,
  sectionTitle,
  type Column,
} from './pdf';

export const INCIDENT_REPORT_TITLE = 'KAS – BÁO CÁO SỰ CỐ KHÁCH SẠN';

export const ISSUE_STATUS_LABELS: Record<IssueStatus, string> = {
  NEW: 'Sự cố khách sạn',
  IN_PROGRESS: 'Đang sửa',
  COMPLETED: 'Đã hoàn thành',
};

/** Sums to 777pt — the usable width of A4 landscape at a 32pt margin. */
const COLUMNS: Column<IssueDetail>[] = [
  { header: 'Chi nhánh', width: 74, value: (i) => i.branch?.code ?? '—' },
  { header: 'Khu vực', width: 78, value: (i) => (i.areaCategory ? ISSUE_AREA_LABELS[i.areaCategory] : '—') },
  { header: 'Phòng / Tầng', width: 88, value: (i) => describeLocation(i) },
  { header: 'Loại sự cố', width: 66, value: (i) => (i.category ? ISSUE_CATEGORY_LABELS[i.category] : '—') },
  { header: 'Mô tả', width: 118, value: (i) => i.description },
  { header: 'Người báo', width: 72, value: (i) => i.reportedByNameSnapshot ?? i.reportedBy?.fullName ?? '—' },
  { header: 'Thời gian báo', width: 72, value: (i) => hcmDateTime(i.createdAt) },
  { header: 'Người sửa', width: 70, value: (i) => i.technicianName ?? '—' },
  { header: 'SĐT', width: 58, value: (i) => i.technicianPhone ?? '—' },
  { header: 'Tiếp nhận', width: 72, value: (i) => hcmDateTime(i.acceptedAt) },
  { header: 'Hoàn thành', width: 72, value: (i) => hcmDateTime(i.completedAt) },
  { header: 'Trạng thái', width: 66, value: (i) => ISSUE_STATUS_LABELS[i.status] },
];

export interface IncidentReportInput {
  from: string;
  to: string;
  scope: string;
  issues: IssueDetail[];
  generatedAt: Date;
}

export async function buildIncidentReportPdf(input: IncidentReportInput): Promise<Buffer> {
  const doc = createReportDocument({
    title: INCIDENT_REPORT_TITLE,
    period: periodLabel(input.from, input.to),
    generatedAt: hcmDateTime(input.generatedAt),
    scope: input.scope,
  });

  if (input.issues.length === 0) {
    doc.text('Không có sự cố nào trong kỳ báo cáo này.');
    addPageNumbers(doc);
    return finishDocument(doc);
  }

  drawTable(doc, COLUMNS, input.issues);

  const byBranch = new Map<string, number>();
  const byStatus = new Map<string, number>();
  const byArea = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string): void => void m.set(k, (m.get(k) ?? 0) + 1);
  for (const issue of input.issues) {
    bump(byBranch, issue.branch ? `${issue.branch.code} — ${issue.branch.address}` : 'Không rõ');
    bump(byStatus, ISSUE_STATUS_LABELS[issue.status]);
    bump(byArea, issue.areaCategory ? ISSUE_AREA_LABELS[issue.areaCategory] : 'Không rõ');
  }

  doc.moveDown(0.8);
  sectionTitle(doc, 'TỔNG HỢP');
  doc.text(`Tổng số sự cố: ${input.issues.length}`);

  drawTotals(doc, 'Theo chi nhánh', rankedTotals(byBranch));
  drawTotals(doc, 'Theo trạng thái', rankedTotals(byStatus));
  drawTotals(doc, 'Theo khu vực', rankedTotals(byArea));

  addPageNumbers(doc);
  return finishDocument(doc);
}

export function incidentReportFileName(from: string, to: string): string {
  return `KAS-bao-cao-su-co-${from}-${to}.pdf`;
}

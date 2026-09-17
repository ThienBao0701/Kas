/**
 * "KAS – BÁO CÁO ĐƠN CẦN TẠO LẠI" as a PDF.
 *
 * Renders the report object it is handed and computes nothing, so a total here
 * cannot disagree with the same total on screen — the same rule the XLSX charge
 * export follows.
 */
import { REVIEW_REASON_LABELS } from '../booking/proof';
import {
  branchLabelOf,
  receptionistOf,
  shiftLabelOf,
  type RecreationReport,
  type RecreationRow,
} from '../booking/recreationReport';
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

export const RECREATION_REPORT_TITLE = 'KAS – BÁO CÁO ĐƠN CẦN TẠO LẠI';

/** A4 landscape usable width is 778pt at a 32pt margin; these sum to 777. */
const COLUMNS: Column<RecreationRow>[] = [
  { header: 'Chi nhánh', width: 96, value: (r) => (r.booking.branch ? r.booking.branch.code : '—') },
  { header: 'Khách sạn', width: 96, value: (r) => (r.booking.branch ? r.booking.branch.address : '—') },
  { header: 'Mã đơn', width: 78, value: (r) => r.booking.bookingCode },
  { header: 'Nguồn', width: 58, value: (r) => r.booking.sourcePlatform ?? '—' },
  { header: 'Ngày tạo đơn', width: 82, value: (r) => hcmDateTime(r.booking.createdAt) },
  { header: 'Lễ tân', width: 96, value: (r) => receptionistOf(r) },
  { header: 'Ca', width: 44, value: (r) => shiftLabelOf(r) },
  { header: 'Lần tạo', width: 40, value: (r) => String(r.attemptNumber) },
  { header: 'Bị từ chối lúc', width: 82, value: (r) => hcmDateTime(r.reviewedAt) },
  { header: 'Lý do', width: 105, value: (r) => reasonText(r) },
];

function reasonText(row: RecreationRow): string {
  const code = row.reviewReasonCode ? REVIEW_REASON_LABELS[row.reviewReasonCode] : null;
  // The free-text note is the part a manager actually reads, so it is not
  // dropped when a code is present — both are printed.
  return [code, row.reviewNote].filter(Boolean).join(' — ') || '—';
}

export async function buildRecreationReportPdf(
  report: RecreationReport,
  scope: string,
  generatedAt: Date,
): Promise<Buffer> {
  const doc = createReportDocument({
    title: RECREATION_REPORT_TITLE,
    period: periodLabel(report.range.from, report.range.to),
    generatedAt: hcmDateTime(generatedAt),
    scope,
  });

  if (report.rows.length === 0) {
    // Said explicitly. A report that is silently blank reads as a broken export.
    doc.text('Không có đơn nào cần tạo lại trong kỳ báo cáo này.');
    addPageNumbers(doc);
    return finishDocument(doc);
  }

  drawTable(doc, COLUMNS, report.rows);

  doc.moveDown(0.8);
  sectionTitle(doc, 'TỔNG HỢP');
  doc.text(`Tổng số đơn cần tạo lại: ${report.totals.total}`);

  drawTotals(doc, 'Theo chi nhánh', rankedTotals(report.totals.byBranch));
  drawTotals(doc, 'Theo ca làm việc', rankedTotals(report.totals.byShift));
  drawTotals(doc, 'Theo lễ tân', rankedTotals(report.totals.byReceptionist));

  addPageNumbers(doc);
  return finishDocument(doc);
}

/** Exported for the route and for the tests that assert the header. */
export function recreationReportFileName(from: string, to: string): string {
  return `KAS-don-can-tao-lai-${from}-${to}.pdf`;
}

/** Re-exported so callers need not reach into the booking module for a label. */
export { branchLabelOf };

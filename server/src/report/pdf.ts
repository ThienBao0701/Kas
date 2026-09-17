/**
 * PDF reports, in Vietnamese.
 *
 * WHY A FONT IS SHIPPED WITH THE APPLICATION
 *
 * PDF's built-in fonts (Helvetica and friends) are WinAnsi-encoded: they have no
 * glyph for ạ, ệ, ữ, ố or đ. Rendering a Vietnamese report with them does not
 * fail — it silently produces missing or stripped diacritics, which is exactly
 * the failure mode that makes a report untrustworthy. So the document embeds a
 * real Unicode font, subsetted into the file, and every string in every report
 * goes through it.
 *
 * Be Vietnam Pro is used because it is a Vietnamese-designed typeface under the
 * SIL Open Font License (`fonts/OFL.txt`), which permits redistribution and
 * embedding. Its coverage of the full Vietnamese alphabet was verified glyph by
 * glyph, not assumed.
 *
 * WHY THE FILES ARE RESOLVED FROM `__dirname`
 *
 * In development this module runs from `src/report`; in production it runs from
 * `dist/report`, and `scripts/copyAssets.mjs` mirrors the fonts across during
 * the build. Resolving relative to the module keeps both correct without a
 * process-wide base path that a service runner could set differently.
 *
 * WHY IT BUILDS A BUFFER
 *
 * Same convention as the XLSX charge report (`charge/chargeReportExport.ts`): a
 * function returns bytes, the route decides the headers. Nothing here reads the
 * database, and nothing here computes a total — a report is rendered from data
 * a caller already has, so a number in the PDF cannot disagree with the number
 * on the screen it was printed from.
 */
import PDFDocument from 'pdfkit';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FONT_DIR = join(__dirname, 'fonts');

export const FONT_REGULAR = 'VN';
export const FONT_BOLD = 'VN-Bold';

/**
 * Read once per process. A report endpoint is rare but not unique, and re-reading
 * 260 KB of font from disk on every request would be pure waste.
 */
let cachedFonts: { regular: Buffer; bold: Buffer } | null = null;

function fonts(): { regular: Buffer; bold: Buffer } {
  if (!cachedFonts) {
    cachedFonts = {
      regular: readFileSync(join(FONT_DIR, 'BeVietnamPro-Regular.ttf')),
      bold: readFileSync(join(FONT_DIR, 'BeVietnamPro-SemiBold.ttf')),
    };
  }
  return cachedFonts;
}

export type PdfDoc = PDFKit.PDFDocument;

export interface ReportHeader {
  /** e.g. "KAS – BÁO CÁO ĐƠN CẦN TẠO LẠI". */
  title: string;
  /** "01/09/2026 – 30/09/2026". */
  period: string;
  /** When the report was produced, already formatted in Asia/Ho_Chi_Minh. */
  generatedAt: string;
  /** "Tất cả chi nhánh" or one branch's name. */
  scope: string;
}

export interface Column<T> {
  header: string;
  width: number;
  value: (row: T) => string;
}

/**
 * Landscape A4 by default: the incident and accountability tables are wide, and
 * portrait would force either a microscopic type size or wrapped columns.
 */
export function createReportDocument(header: ReportHeader, landscape = true): PdfDoc {
  const doc = new PDFDocument({
    size: 'A4',
    layout: landscape ? 'landscape' : 'portrait',
    margin: 32,
    // Required by `addPageNumbers`: without it the pages are flushed as they are
    // written and cannot be revisited to stamp "Trang 2/7", because the total is
    // only known at the end.
    bufferPages: true,
    // Written into the PDF's own metadata so a file found later still says what
    // it is.
    info: { Title: header.title, Author: 'KAS' },
  });

  const { regular, bold } = fonts();
  doc.registerFont(FONT_REGULAR, regular);
  doc.registerFont(FONT_BOLD, bold);

  doc.font(FONT_BOLD).fontSize(15).text(header.title);
  doc.moveDown(0.3);
  doc.font(FONT_REGULAR).fontSize(9);
  doc.text(`Kỳ báo cáo: ${header.period}`);
  doc.text(`Phạm vi: ${header.scope}`);
  doc.text(`Xuất lúc: ${header.generatedAt}`);
  doc.moveDown(0.6);

  return doc;
}

/** Collects the stream into one Buffer, the way the XLSX export returns one. */
export function finishDocument(doc: PdfDoc): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

export function sectionTitle(doc: PdfDoc, text: string): void {
  doc.moveDown(0.5);
  doc.font(FONT_BOLD).fontSize(11).text(text);
  doc.moveDown(0.2);
  doc.font(FONT_REGULAR).fontSize(8);
}

const ROW_PADDING = 4;
const HEADER_FILL = '#E8EEF4';
const ROW_STRIPE = '#F6F8FA';

function rowHeight(doc: PdfDoc, columns: Column<unknown>[], cells: string[]): number {
  let tallest = 0;
  cells.forEach((text, i) => {
    const width = columns[i]!.width - ROW_PADDING * 2;
    tallest = Math.max(tallest, doc.heightOfString(text || '—', { width }));
  });
  return tallest + ROW_PADDING * 2;
}

/**
 * Draws a table, repeating the header row on every page.
 *
 * Rows are measured before they are drawn so a long description wraps inside its
 * cell instead of overrunning the next column — a report that silently truncates
 * the one free-text field it carries is worse than no report.
 */
export function drawTable<T>(doc: PdfDoc, columns: Column<T>[], rows: T[]): void {
  const cols = columns as Column<unknown>[];
  const startX = doc.page.margins.left;

  const drawHeader = (): void => {
    const cells = columns.map((c) => c.header);
    const h = rowHeight(doc, cols, cells);
    doc.rect(startX, doc.y, cols.reduce((s, c) => s + c.width, 0), h).fill(HEADER_FILL);
    let x = startX;
    const top = doc.y;
    doc.fillColor('#000').font(FONT_BOLD).fontSize(8);
    cells.forEach((text, i) => {
      doc.text(text, x + ROW_PADDING, top + ROW_PADDING, { width: cols[i]!.width - ROW_PADDING * 2 });
      x += cols[i]!.width;
    });
    doc.y = top + h;
    doc.font(FONT_REGULAR).fontSize(8);
  };

  drawHeader();

  rows.forEach((row, index) => {
    const cells = columns.map((c) => c.value(row) || '—');
    const h = rowHeight(doc, cols, cells);

    // A row that would cross the bottom margin starts a new page, with the
    // header repeated — otherwise page 2 onwards is a grid of unlabelled cells.
    if (doc.y + h > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
      drawHeader();
    }

    const top = doc.y;
    if (index % 2 === 1) {
      doc.rect(startX, top, cols.reduce((s, c) => s + c.width, 0), h).fill(ROW_STRIPE);
      doc.fillColor('#000');
    }
    let x = startX;
    cells.forEach((text, i) => {
      doc.text(text, x + ROW_PADDING, top + ROW_PADDING, { width: cols[i]!.width - ROW_PADDING * 2 });
      x += cols[i]!.width;
    });
    doc.y = top + h;
  });
}

/** "Tổng cộng: 12" style lines under a table. */
export function drawTotals(doc: PdfDoc, title: string, entries: [string, number][]): void {
  sectionTitle(doc, title);
  if (entries.length === 0) {
    doc.font(FONT_REGULAR).fontSize(8).text('Không có dữ liệu.');
    return;
  }
  doc.font(FONT_REGULAR).fontSize(8);
  for (const [label, count] of entries) {
    doc.text(`${label}: ${count}`);
  }
}

/**
 * Page numbers, added after the content so the total is known.
 *
 * `bufferedPageRange` is read rather than assumed, and the footer is written
 * inside the bottom margin so it cannot collide with a table row.
 */
export function addPageNumbers(doc: PdfDoc): void {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    doc
      .font(FONT_REGULAR)
      .fontSize(7)
      .fillColor('#555')
      .text(
        `Trang ${i - range.start + 1}/${range.count}`,
        doc.page.margins.left,
        doc.page.height - doc.page.margins.bottom + 8,
        { width: doc.page.width - doc.page.margins.left - doc.page.margins.right, align: 'right' },
      );
  }
  doc.fillColor('#000');
}

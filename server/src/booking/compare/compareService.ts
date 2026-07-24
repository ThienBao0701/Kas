/**
 * Runs and stores immutable proof-vs-booking comparisons. Advisory only:
 *  - It never approves/rejects a proof and never changes booking/proof status.
 *  - Each run is immutable; re-analysis (a new COMPLETED OCR analysis) yields a
 *    new comparison. Earlier runs are preserved.
 *  - At most one comparison per (analysis, comparisonVersion) — duplicates are
 *    refused. A comparison failure never affects the proof.
 */
import type { BookingProofComparison } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { ApiError } from '../../lib/errors';
import { loadBookingDetail } from '../bookingRepo';
import type { ProofExtractedData } from '../ocr/types';
import type { ComparisonResult } from './types';
import { COMPARISON_VERSION, buildComparisonResult } from './engine';
import { deriveDetected, deriveExpected } from './derive';

const GENERIC_COMPARE_ERROR = 'Không thể đối chiếu. Vui lòng kiểm tra thủ công.';

export interface ComparisonView {
  id: string;
  bookingId: string;
  proofId: string;
  analysisId: string;
  overallStatus: BookingProofComparison['overallStatus'];
  comparisonVersion: string;
  result: ComparisonResult | null;
  errorMessage: string | null;
  createdAt: string;
}

export function serializeComparison(row: BookingProofComparison): ComparisonView {
  let result: ComparisonResult | null = null;
  try {
    result = JSON.parse(row.resultJson) as ComparisonResult;
  } catch {
    result = null;
  }
  return {
    id: row.id,
    bookingId: row.bookingId,
    proofId: row.proofId,
    analysisId: row.analysisId,
    overallStatus: row.overallStatus,
    comparisonVersion: row.comparisonVersion,
    result,
    errorMessage: row.errorMessage ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Confirms the proof exists and belongs to the booking (admin read/compare). */
async function assertProofInBooking(bookingId: string, proofId: string): Promise<void> {
  const proof = await prisma.bookingCreationProof.findUnique({ where: { id: proofId }, select: { bookingId: true } });
  if (!proof || proof.bookingId !== bookingId) throw ApiError.notFound('Không tìm thấy ảnh.');
}

interface RunOptions {
  createdByUserId?: number | null;
  /** When false (auto path) an existing run for the analysis is a no-op, not a 409. */
  throwOnDuplicate?: boolean;
}

/**
 * Builds and stores one comparison for a COMPLETED analysis. Enforces the single
 * run per (analysis, version). Never throws for a build error — that is stored as
 * an UNAVAILABLE row with a sanitised message.
 */
export async function runComparisonForAnalysis(analysisId: string, opts: RunOptions = {}): Promise<BookingProofComparison> {
  const analysis = await prisma.bookingProofAnalysis.findUnique({
    where: { id: analysisId },
    select: { id: true, proofId: true, status: true, extractedDataJson: true, extractedText: true, proof: { select: { bookingId: true } } },
  });
  if (!analysis) throw ApiError.notFound('Không tìm thấy kết quả OCR.');
  if (analysis.status !== 'COMPLETED' || !analysis.extractedDataJson) {
    throw ApiError.conflict('Chưa có kết quả OCR hoàn tất để đối chiếu.', { analysisId });
  }

  const existing = await prisma.bookingProofComparison.findUnique({
    where: { analysisId_comparisonVersion: { analysisId, comparisonVersion: COMPARISON_VERSION } },
  });
  if (existing) {
    if (opts.throwOnDuplicate) throw ApiError.conflict('Đã có kết quả đối chiếu cho lần phân tích này.', { analysisId });
    return existing;
  }

  const bookingId = analysis.proof.bookingId;
  let overallStatus: BookingProofComparison['overallStatus'] = 'UNAVAILABLE';
  let resultJson = '{}';
  let errorMessage: string | null = null;
  try {
    const booking = await loadBookingDetail(bookingId);
    const fields = JSON.parse(analysis.extractedDataJson) as ProofExtractedData;
    const result = buildComparisonResult(deriveExpected(booking), deriveDetected(fields, analysis.extractedText));
    overallStatus = result.overall;
    resultJson = JSON.stringify(result);
  } catch {
    errorMessage = GENERIC_COMPARE_ERROR;
    resultJson = JSON.stringify({ overall: 'UNAVAILABLE', version: COMPARISON_VERSION, summary: { matchCount: 0, mismatchCount: 0, warningCount: 0, notFoundCount: 0 }, fields: [] });
  }

  try {
    return await prisma.bookingProofComparison.create({
      data: { bookingId, proofId: analysis.proofId, analysisId, overallStatus, comparisonVersion: COMPARISON_VERSION, resultJson, errorMessage, createdByUserId: opts.createdByUserId ?? null },
    });
  } catch {
    // A racing insert already created the unique row — return it.
    const raced = await prisma.bookingProofComparison.findUnique({
      where: { analysisId_comparisonVersion: { analysisId, comparisonVersion: COMPARISON_VERSION } },
    });
    if (raced) {
      if (opts.throwOnDuplicate) throw ApiError.conflict('Đã có kết quả đối chiếu cho lần phân tích này.', { analysisId });
      return raced;
    }
    throw ApiError.internal('Không thể lưu kết quả đối chiếu.');
  }
}

/**
 * Fire-and-forget comparison triggered when an OCR analysis becomes COMPLETED.
 * Swallows every error so it can never affect OCR or the proof.
 */
export async function runComparisonAfterOcr(analysisId: string): Promise<void> {
  try {
    await runComparisonForAnalysis(analysisId, { throwOnDuplicate: false });
  } catch {
    // Advisory only — never propagate.
  }
}

// --- Admin reads / manual re-compare ---------------------------------------
export async function listComparisons(bookingId: string, proofId: string): Promise<ComparisonView[]> {
  await assertProofInBooking(bookingId, proofId);
  const rows = await prisma.bookingProofComparison.findMany({ where: { proofId }, orderBy: { createdAt: 'desc' } });
  return rows.map(serializeComparison);
}

export async function latestComparison(bookingId: string, proofId: string): Promise<ComparisonView | null> {
  await assertProofInBooking(bookingId, proofId);
  const row = await prisma.bookingProofComparison.findFirst({ where: { proofId }, orderBy: { createdAt: 'desc' } });
  return row ? serializeComparison(row) : null;
}

/**
 * Admin-triggered comparison against the latest COMPLETED OCR analysis.
 *  - 409 when no completed analysis exists.
 *  - 409 when a comparison already exists for that analysis/version.
 */
export async function compareLatest(bookingId: string, proofId: string, adminId: number): Promise<ComparisonView> {
  await assertProofInBooking(bookingId, proofId);
  const analysis = await prisma.bookingProofAnalysis.findFirst({
    where: { proofId, status: 'COMPLETED', extractedDataJson: { not: null } },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  if (!analysis) throw ApiError.conflict('Chưa có kết quả OCR hoàn tất để đối chiếu.', { proofId });
  const row = await runComparisonForAnalysis(analysis.id, { createdByUserId: adminId, throwOnDuplicate: true });
  return serializeComparison(row);
}

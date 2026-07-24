/**
 * Orchestrates OCR analysis of proof screenshots. Everything here is advisory:
 * an analysis never approves, rejects or compares a proof. It only extracts and
 * stores what OCR read, for the Admin to view alongside the image.
 *
 * Guarantees:
 *  - Proof submission never fails because OCR failed or is disabled.
 *  - Runs are immutable: re-analysis creates a NEW row; earlier rows are kept.
 *  - Only one analysis may be active (PENDING/PROCESSING) per proof at a time.
 *  - Stored text is length-capped; structured data is a JSON string; no BLOBs,
 *    no filesystem paths, and error messages are sanitised for the client.
 */
import type { BookingProofAnalysis } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { ApiError } from '../../lib/errors';
import { getClock, type Clock } from '../../lib/clock';
import { env } from '../../config/env';
import { readProofFile } from '../proofStorage';
import { getOcrProvider } from './provider';
import { extractProofFields, limitOcrText } from './normalize';
import type { ProofExtractedData, ProofOcrProvider } from './types';

/** Bump when the extraction logic changes so old rows stay interpretable. */
export const ANALYSIS_VERSION = '1';

/** The only error text ever shown for a failed run — never a stack or path. */
export const GENERIC_OCR_ERROR = 'Không thể nhận diện ảnh. Vui lòng kiểm tra ảnh thủ công.';

/** Sanitises any provider error to a fixed, user-safe message (no internals). */
function sanitizeError(_err: unknown): string {
  return GENERIC_OCR_ERROR;
}

export interface AnalysisView {
  id: string;
  proofId: string;
  status: BookingProofAnalysis['status'];
  provider: string;
  analysisVersion: string;
  extractedText: string | null;
  fields: ProofExtractedData | null;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

/** Admin-facing serialization (full OCR text + structured fields). */
export function serializeAnalysis(a: BookingProofAnalysis): AnalysisView {
  let fields: ProofExtractedData | null = null;
  if (a.extractedDataJson) {
    try {
      fields = JSON.parse(a.extractedDataJson) as ProofExtractedData;
    } catch {
      fields = null;
    }
  }
  return {
    id: a.id,
    proofId: a.proofId,
    status: a.status,
    provider: a.provider,
    analysisVersion: a.analysisVersion,
    extractedText: a.extractedText ?? null,
    fields,
    errorMessage: a.errorMessage ?? null,
    startedAt: iso(a.startedAt),
    completedAt: iso(a.completedAt),
    createdAt: a.createdAt.toISOString(),
  };
}

/** Confirms the proof exists and belongs to the given booking (admin routes). */
async function loadProofInBooking(bookingId: string, proofId: string): Promise<{ id: string; storedFileName: string }> {
  const proof = await prisma.bookingCreationProof.findUnique({
    where: { id: proofId },
    select: { id: true, storedFileName: true, bookingId: true },
  });
  if (!proof || proof.bookingId !== bookingId) throw ApiError.notFound('Không tìm thấy ảnh.');
  return { id: proof.id, storedFileName: proof.storedFileName };
}

/**
 * Atomically refuses a duplicate active run and creates the row. For a disabled
 * provider the row is created already-terminal as DISABLED.
 */
async function createRunGuarded(proofId: string, provider: ProofOcrProvider, clock: Clock): Promise<BookingProofAnalysis> {
  return prisma.$transaction(async (tx) => {
    const active = await tx.bookingProofAnalysis.count({
      where: { proofId, status: { in: ['PENDING', 'PROCESSING'] } },
    });
    if (active > 0) throw ApiError.conflict('Ảnh đang được phân tích, vui lòng đợi.', { proofId });
    return tx.bookingProofAnalysis.create({
      data: {
        proofId,
        provider: provider.name,
        analysisVersion: ANALYSIS_VERSION,
        status: provider.enabled ? 'PENDING' : 'DISABLED',
        startedAt: provider.enabled ? clock.now() : null,
        completedAt: provider.enabled ? null : clock.now(),
      },
    });
  });
}

/** Runs recognition + extraction for an already-created PENDING row. Never throws. */
async function process(id: string, storedFileName: string, provider: ProofOcrProvider, clock: Clock): Promise<BookingProofAnalysis> {
  try {
    await prisma.bookingProofAnalysis.update({ where: { id }, data: { status: 'PROCESSING' } });
    const bytes = await readProofFile(storedFileName);
    const raw = await provider.recognize(bytes, env.PROOF_OCR_LANGUAGE);
    const text = limitOcrText(raw.rawText ?? '');
    const fields = extractProofFields(text, { meanConfidence: raw.meanConfidence });
    return await prisma.bookingProofAnalysis.update({
      where: { id },
      data: {
        status: 'COMPLETED',
        extractedText: text,
        extractedDataJson: JSON.stringify(fields),
        completedAt: clock.now(),
      },
    });
  } catch (err) {
    return prisma.bookingProofAnalysis.update({
      where: { id },
      data: { status: 'FAILED', errorMessage: sanitizeError(err), completedAt: clock.now() },
    });
  }
}

/**
 * Starts (and, for the current in-process implementation, completes) one analysis
 * run for a proof. Throws NOT_FOUND for a missing proof and CONFLICT when a run is
 * already active. The recognition itself never throws — failures land as FAILED.
 */
export async function startProofAnalysis(proofId: string, clock: Clock = getClock()): Promise<BookingProofAnalysis> {
  const proof = await prisma.bookingCreationProof.findUnique({
    where: { id: proofId },
    select: { id: true, storedFileName: true },
  });
  if (!proof) throw ApiError.notFound('Không tìm thấy ảnh.');

  const provider = getOcrProvider();
  const run = await createRunGuarded(proofId, provider, clock);
  if (!provider.enabled) return run; // DISABLED, already terminal
  return process(run.id, proof.storedFileName, provider, clock);
}

/**
 * Fire-and-forget analysis after a proof is submitted. Swallows every error so a
 * failed or disabled OCR can never affect the upload response.
 */
export async function analyzeAfterSubmit(proofId: string): Promise<void> {
  try {
    await startProofAnalysis(proofId);
  } catch {
    // Intentionally ignored — OCR is advisory and must never block submission.
  }
}

// ---------------------------------------------------------------------------
// Admin reads / re-analysis (routes enforce admin-only + proof∈booking)
// ---------------------------------------------------------------------------
export async function listAnalyses(bookingId: string, proofId: string): Promise<AnalysisView[]> {
  await loadProofInBooking(bookingId, proofId);
  const rows = await prisma.bookingProofAnalysis.findMany({ where: { proofId }, orderBy: { createdAt: 'desc' } });
  return rows.map(serializeAnalysis);
}

export async function latestAnalysis(bookingId: string, proofId: string): Promise<AnalysisView | null> {
  await loadProofInBooking(bookingId, proofId);
  const row = await prisma.bookingProofAnalysis.findFirst({ where: { proofId }, orderBy: { createdAt: 'desc' } });
  return row ? serializeAnalysis(row) : null;
}

/** Admin-triggered re-analysis: creates a new run, preserving earlier ones. */
export async function reanalyzeProof(bookingId: string, proofId: string, clock: Clock = getClock()): Promise<AnalysisView> {
  await loadProofInBooking(bookingId, proofId);
  const run = await startProofAnalysis(proofId, clock);
  return serializeAnalysis(run);
}

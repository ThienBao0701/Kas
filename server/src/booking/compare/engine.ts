/**
 * Assembles the field comparators into one comparison result and aggregates the
 * overall status. Advisory only — no approval/rejection, no status change.
 */
import type { ComparisonResult, FieldComparison, OverallStatus } from './types';
import {
  compareBookingCode,
  compareCustomerName,
  compareDate,
  compareNights,
  compareNightlyPrices,
  comparePayment,
  comparePmsNote,
  compareRoomQuantity,
  compareRoomSummary,
  compareTotal,
  type DetectedNote,
  type DetectedRoomType,
  type ExpectedNote,
  type NightPrice,
} from './comparators';
import { enrichComparisonResult, type DetectedConfidences } from './enrich';

/** Bump this (and keep the old modules) whenever the rules change. */
export const COMPARISON_VERSION = 'proof-compare-v1';

export interface ExpectedBooking {
  bookingCode: string | null;
  checkInDate: string | null; // ISO
  checkOutDate: string | null; // ISO
  totalAmount: number | null;
  currency: string;
  roomQuantity: number;
  customerName: string | null;
  roomTypes: string[];
  paymentStatus: 'PAY_BEFORE' | 'PAY_AFTER';
  nights: number;
  nightlyPrices: NightPrice[];
  note: ExpectedNote;
}

export interface DetectedProof {
  bookingCode: string | null;
  checkInDate: string | null;
  checkOutDate: string | null;
  totalAmount: number | null;
  roomQuantity: number | null;
  customerName: string | null;
  roomTypes: DetectedRoomType[];
  paymentStatus: 'PAY_BEFORE' | 'PAY_AFTER' | null;
  nights: number | null;
  nightlyPrices: NightPrice[];
  note: DetectedNote;
}

/**
 * Overall status from the field results:
 *  - any MISMATCH                 → MISMATCH
 *  - else any WARNING / NOT_FOUND → WARNING
 *  - else                         → MATCH
 * NOT_APPLICABLE fields are excluded from the verdict (e.g. unreadable nightly
 * prices never make an otherwise-clean proof "wrong").
 */
export function aggregateOverallStatus(fields: FieldComparison[]): OverallStatus {
  const active = fields.filter((f) => f.result !== 'NOT_APPLICABLE');
  if (active.some((f) => f.result === 'MISMATCH')) return 'MISMATCH';
  if (active.some((f) => f.result === 'WARNING' || f.result === 'NOT_FOUND')) return 'WARNING';
  return 'MATCH';
}

function summarize(fields: FieldComparison[]) {
  return {
    matchCount: fields.filter((f) => f.result === 'MATCH').length,
    mismatchCount: fields.filter((f) => f.result === 'MISMATCH').length,
    warningCount: fields.filter((f) => f.result === 'WARNING').length,
    notFoundCount: fields.filter((f) => f.result === 'NOT_FOUND').length,
  };
}

/**
 * Builds the full comparison result from expected (booking) + detected (OCR).
 * The base field results/aggregate are C.3; `enrichComparisonResult` then appends
 * C.3.5 smart explanations additively (never changing any result or the overall).
 */
export function buildComparisonResult(
  expected: ExpectedBooking,
  detected: DetectedProof,
  confidences: DetectedConfidences = {},
): ComparisonResult {
  const fields: FieldComparison[] = [
    compareBookingCode(expected.bookingCode, detected.bookingCode),
    compareDate('CHECK_IN', 'Check-in', expected.checkInDate, detected.checkInDate),
    compareDate('CHECK_OUT', 'Check-out', expected.checkOutDate, detected.checkOutDate),
    compareTotal(expected.totalAmount, detected.totalAmount),
    compareRoomQuantity(expected.roomQuantity, detected.roomQuantity),
    compareCustomerName(expected.customerName, detected.customerName),
    compareRoomSummary(expected.roomTypes, detected.roomTypes),
    comparePayment(expected.paymentStatus, detected.paymentStatus),
    compareNights(expected.nights, detected.nights),
    compareNightlyPrices(expected.nightlyPrices, detected.nightlyPrices),
    comparePmsNote(expected.note, detected.note),
  ];
  const base: ComparisonResult = { overall: aggregateOverallStatus(fields), version: COMPARISON_VERSION, summary: summarize(fields), fields };
  return enrichComparisonResult(base, expected, detected, confidences);
}

/** The result shown when OCR is disabled/pending/failed or has no completed run. */
export function buildUnavailableResult(): ComparisonResult {
  return {
    overall: 'UNAVAILABLE',
    version: COMPARISON_VERSION,
    summary: { matchCount: 0, mismatchCount: 0, warningCount: 0, notFoundCount: 0 },
    fields: [],
  };
}

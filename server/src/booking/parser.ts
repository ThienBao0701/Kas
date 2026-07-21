import { normalizeText, toLines } from './text';
import { detectCurrency, looksLikeMoney, parseFirstAmount } from './money';
import { findDate, generateStayDates } from './dates';
import { resolvePaymentStatus } from './paymentStatus';
import {
  BRANCH_CONFIDENT_THRESHOLD,
  BRANCH_MATCH_THRESHOLD,
  findBestBranch,
  matchBranch,
} from './branchMatcher';
import type {
  ExtractWarning,
  FieldConfidence,
  MatchableBranch,
  ParsedBooking,
  ParsedNight,
  ParsedRoom,
} from './types';

/** Extraction-engine version stamped onto every booking it produces. */
export const PARSER_VERSION = '4a.2.0';

// How far past a bare label to look for its value on following lines.
const VALUE_LOOKAHEAD = 5;

// Canonical field -> the exact normalised label keys that introduce it. Both the
// clean synthetic labels and the ones Booking.com renders on its detail page.
const FIELD_LABELS: Record<string, readonly string[]> = {
  guestName: [
    'khach', 'ten khach', 'ten khach hang', 'ho ten khach', 'guest', 'guest name',
    'ho ten', 'ten nguoi dat', 'ten', 'name',
  ],
  phone: ['dien thoai', 'so dien thoai', 'sdt', 'dt', 'phone', 'phone number', 'tel', 'mobile'],
  bookingCode: [
    'ma dat phong', 'ma xac nhan', 'so xac nhan', 'so xac nhan dat phong',
    'ma xac nhan dat phong', 'so dat phong', 'ma dat cho', 'ma booking',
    'booking code', 'booking number', 'booking id', 'confirmation',
    'confirmation number', 'reservation', 'reservation number',
  ],
  checkIn: ['nhan phong', 'ngay nhan phong', 'ngay nhan', 'ngay den', 'check in', 'checkin', 'arrival'],
  checkOut: ['tra phong', 'ngay tra phong', 'ngay tra', 'ngay di', 'check out', 'checkout', 'departure'],
  total: [
    'tong cong', 'tong tien', 'tong gia', 'thanh tien', 'tong thanh toan',
    'tong so tien', 'gia cua ban', 'total', 'total price', 'total cost', 'grand total',
  ],
  payment: ['thanh toan', 'hinh thuc thanh toan', 'phuong thuc thanh toan', 'payment', 'payment status'],
  hotel: ['khach san', 'ten khach san', 'hotel', 'property'],
};

const LABEL_LOOKUP = new Map<string, string>();
for (const [field, labels] of Object.entries(FIELD_LABELS)) {
  for (const label of labels) LABEL_LOOKUP.set(label, field);
}

const ROOM_HEADER = /^(?:ph[oòơ]ng|room)\s*(\d+)?\s*[:\-–]\s*(.+)$/i;

// Room-name detection for raw text where the type is a bare line ("Deluxe Double
// Room") rather than "Phòng N: …". Requires a strong type qualifier next to a
// room noun, or a standalone room noun, so policy sentences are not misread.
const ROOM_QUALIFIER =
  /\b(deluxe|superior|standard|suite|twin|double|king|queen|family|junior|executive|studio|single|triple|quad|premium|classic|grand|economy|budget)\b/;
const ROOM_NOUN = /\b(room|suite|studio|villa|apartment|bungalow|penthouse|dormitory|dorm|cabin)\b/;
const ROOM_STANDALONE = /\b(suite|studio|penthouse|bungalow|villa)\b/;

// Vietnamese room descriptors (on diacritic-free normalised text). A line that
// starts with "phong"/"suite" AND carries one of these is a room type — a
// whitelist keeps policy sentences that merely start with "Phòng" out.
const VN_ROOM_DESC =
  /\b(deluxe|superior|standard|suite|studio|premium|executive|junior|tieu chuan|gia dinh|giuong|doi|don|ban cong|nhin ra|thanh pho|cua so|ba nguoi|bon nguoi|hai giuong|view|cao cap|sang trong|thuong gia|gac lung|lien thong|twin|double|king|queen|single|triple|family|penthouse)\b/;

// Bare generic phrases that are never a room type on their own.
const GENERIC_ROOM_PHRASES = new Set([
  'phong', 'phong da dat', 'phong nghi', 'phong cua ban', 'phong va gia',
  'phong khac', 'cac phong', 'so phong', 'loai phong', 'thong tin phong',
  'chi tiet phong', 'chinh sach phong',
]);

// A "Loại phòng: …" / "Phòng đã đặt: …" style prefix that introduces the real type.
const ROOM_PREFIX_LABEL =
  /^(?:phòng đã đặt|loại phòng|kiểu phòng|hạng phòng|room type)\s*[:\-–]\s*(.+)$/i;

// Room-quantity signals within a section.
const PER_ROOM_SIGNAL =
  /\b(moi phong|per room|each room|cho moi phong|gia moi phong|tren moi phong|tung phong|gia mot phong|per room per night)\b/;
const COMBINED_SIGNAL =
  /\b(cho ca \d+ phong|cho ca hai phong|cho \d+ phong|cho hai phong|combined|tong cho|tong \d+ phong|tong gia \d+ phong|ca \d+ phong|for both rooms|for \d+ rooms|gia \d+ phong|gia cho \d+ phong)\b/;

type LineKind = 'room' | 'labeled' | 'bareLabel' | 'other';

interface Classified {
  raw: string;
  kind: LineKind;
  field?: string;
  value?: string;
  roomIndex?: number | null;
  roomName?: string | null;
}

interface FieldCapture {
  value: string | null;
  raw: string | null;
  ambiguous: boolean;
}

function matchRoomHeader(line: string): { index: number | null; name: string } | null {
  const m = line.match(ROOM_HEADER);
  if (!m) return null;
  const index = m[1] ? Number(m[1]) : null;
  return { index, name: (m[2] ?? '').trim() };
}

function clampQuantity(n: number): number | null {
  return Number.isInteger(n) && n >= 1 && n <= 16 ? n : null;
}

/**
 * A standalone room-quantity line ("Số phòng: 2", "Số lượng: 2", "Quantity: 2",
 * "Rooms: 2", "2 phòng", "2 rooms"), or null. Guest/adult/child/night counts and
 * embedded numbers ("3 đêm, 2 phòng") never match — the pattern anchors the whole
 * line so only a bare quantity qualifies.
 */
function detectRoomQuantity(line: string): number | null {
  const norm = normalizeText(line);
  const labelled = norm.match(
    /^(?:so phong|so luong phong|so luong|quantity|number of rooms|rooms?)\s+(\d{1,2})$/,
  );
  if (labelled) return clampQuantity(Number(labelled[1]));
  const bare = norm.match(/^(\d{1,2})\s+(?:phong|rooms?)$/);
  if (bare) return clampQuantity(Number(bare[1]));
  return null;
}

/**
 * Splits an inline room quantity ("Deluxe Double Room x2", "2 x Deluxe Room",
 * "Phòng Đôi (x2)") from a room name. Never treats a bed/person count inside the
 * name ("Phòng Superior 2 Giường Đơn") as a quantity — a quantity requires an
 * explicit x/× marker.
 */
function extractInlineQuantity(name: string): { name: string; quantity: number } {
  const n = name.trim();
  let m = n.match(/^(\d{1,2})\s*[x×]\s+(.+)$/);
  if (m) return { name: m[2]!.trim(), quantity: clampQuantity(Number(m[1])) ?? 1 };
  m = n.match(/^(.+?)\s*\(\s*[x×]?\s*(\d{1,2})\s*(?:phòng|rooms?)?\s*\)\s*$/i);
  if (m) return { name: m[1]!.trim(), quantity: clampQuantity(Number(m[2])) ?? 1 };
  m = n.match(/^(.+?)\s*[x×]\s*(\d{1,2})\s*$/);
  if (m) return { name: m[1]!.trim(), quantity: clampQuantity(Number(m[2])) ?? 1 };
  return { name: n, quantity: 1 };
}

/** True when a bare line reads like a room-type name (not a label or sentence). */
function isRoomTypeName(line: string): boolean {
  const norm = normalizeText(line);
  if (norm.length === 0 || line.length > 60) return false;
  if (LABEL_LOOKUP.has(norm) || GENERIC_ROOM_PHRASES.has(norm)) return false;
  if (detectRoomQuantity(line) !== null) return false;
  if (ROOM_QUALIFIER.test(norm) && ROOM_NOUN.test(norm)) return true;
  if (ROOM_STANDALONE.test(norm)) return true;
  // Vietnamese: "Phòng …" / "Suite …" carrying a whitelisted room descriptor.
  if (/^(?:phong|suite)\b/.test(norm) && VN_ROOM_DESC.test(norm)) return true;
  return false;
}

/**
 * Detects a room section on a line and returns its type name (accents preserved)
 * and any inline quantity. Handles "Phòng N: name", a "Loại phòng: name" prefix,
 * and bare English/Vietnamese type names.
 */
function detectRoom(line: string): { name: string | null; quantity: number } | null {
  const prefixed = line.match(ROOM_PREFIX_LABEL);
  const target = prefixed ? prefixed[1]!.trim() : line;

  const header = matchRoomHeader(target);
  if (header && header.name.length > 0) {
    const { name, quantity } = extractInlineQuantity(header.name);
    return { name: nonEmpty(name), quantity };
  }
  if (isRoomTypeName(target)) {
    const { name, quantity } = extractInlineQuantity(target.trim());
    return { name: nonEmpty(name) ?? target.trim(), quantity };
  }
  return null;
}

function nonEmpty(value: string | undefined | null): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

// Removes date tokens so the amount reader never swallows the date's digits, on
// a line where the stay date and its nightly price share one line.
function stripDates(line: string): string {
  return line
    .replace(/\d{4}-\d{1,2}-\d{1,2}/g, ' ')
    .replace(/\d{1,2}[/\-.]\d{1,2}[/\-.]\d{4}/g, ' ')
    .replace(/\d{1,2}\s*(?:tháng|thang|thg)\s*\d{1,2}[^\d]{0,6}\d{4}/gi, ' ');
}

/** The nightly/total amount stated on a line, ignoring any date it also holds. */
function amountOnLine(line: string): number | null {
  return parseFirstAmount(stripDates(line));
}

/** A plausible person/hotel name line: has letters, is not money/date/phone. */
function cleanName(line: string): string | null {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.length > 80) return null;
  if (!/[a-zA-ZÀ-ỹ]/.test(trimmed)) return null;
  if (looksLikeMoney(trimmed) || findDate(trimmed)) return null;
  if (extractPhone(trimmed)) return null;
  return trimmed;
}

/** A Booking.com confirmation number: 8–12 digits not starting with 0. */
function extractBookingCode(value: string): string | null {
  const runs = value.match(/\d{4,}/g);
  if (!runs) return null;
  const candidate = runs.find((r) => r.length >= 8 && r.length <= 12 && !r.startsWith('0'));
  return candidate ?? null;
}

/** A Vietnamese or international phone number, or null. Dates/codes are rejected. */
function extractPhone(value: string): string | null {
  const m = value.match(/(\+?\d[\d\s.\-()]{6,}\d)/);
  if (!m || !m[1]) return null;
  const token = m[1].trim().replace(/\s{2,}/g, ' ');
  const digits = token.replace(/\D/g, '');
  if (digits.length < 9 || digits.length > 15) return null;
  // VN/international numbers start with 0 or +; this excludes ISO dates and codes.
  if (!(token.startsWith('+') || digits.startsWith('0') || token.startsWith('84'))) return null;
  return token;
}

/**
 * Field-specific value parse, applied both to an inline "Label: value" and to a
 * following line when the label stands alone. Returns the comparable normalised
 * value (or null when the line does not yield this field's type).
 */
function extractField(field: string, line: string): string | null {
  switch (field) {
    case 'guestName':
    case 'hotel':
      return cleanName(line);
    case 'phone':
      return extractPhone(line);
    case 'bookingCode':
      return extractBookingCode(line);
    case 'checkIn':
    case 'checkOut':
      return findDate(line);
    case 'total': {
      const amount = amountOnLine(line);
      return amount === null ? null : String(amount);
    }
    case 'payment':
      return nonEmpty(line);
    default:
      return null;
  }
}

/**
 * The heart of the extraction engine. Pure and deterministic: it takes the raw
 * pasted Booking.com text plus the list of known branches and returns the fully
 * structured booking, generated stay nights and validation warnings — without
 * touching the database or ever inventing a monetary value. It tolerates the
 * noise (duplicated labels, navigation chrome, values on the next line, weekday
 * dates, non-breaking spaces) of text copied straight from a reservation page.
 */
export function parseBooking(
  rawText: string,
  branches: readonly MatchableBranch[],
): ParsedBooking {
  const lines = toLines(rawText);

  // --- Pass 1: classify every line and build the section list ---------------
  // A "section" is one detected room header, carrying a quantity that expands
  // into that many physical rooms in Pass 3.
  const classified: Classified[] = [];
  const roomOrdinalOf: number[] = []; // per line -> index into `sections` (-1 = none yet)
  const sections: { roomName: string | null; quantity: number; startLine: number }[] = [];
  let pendingQuantity: number | null = null;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    let kind: Classified = { raw: line, kind: 'other' };

    const room = detectRoom(line);
    if (room) {
      let quantity = room.quantity;
      if (quantity === 1 && pendingQuantity !== null) quantity = pendingQuantity;
      pendingQuantity = null;
      sections.push({ roomName: room.name, quantity, startLine: i });
      kind = { raw: line, kind: 'room' };
    } else {
      const quantity = detectRoomQuantity(line);
      if (quantity !== null) {
        // Attach the quantity to the current section, or hold it for the next.
        const current = sections[sections.length - 1];
        if (current && current.quantity === 1) current.quantity = quantity;
        else if (!current) pendingQuantity = quantity;
        // Left as an 'other' meta line: it carries no date, so later passes ignore it.
      } else {
        const colon = line.indexOf(':');
        if (colon > 0) {
          const key = normalizeText(line.slice(0, colon));
          const field = LABEL_LOOKUP.get(key);
          if (field) {
            const value = line.slice(colon + 1).trim();
            kind = value.length > 0
              ? { raw: line, kind: 'labeled', field, value }
              : { raw: line, kind: 'bareLabel', field };
          }
        }
        if (kind.kind === 'other') {
          const field = LABEL_LOOKUP.get(normalizeText(line));
          if (field) kind = { raw: line, kind: 'bareLabel', field };
        }
      }
    }

    classified.push(kind);
    roomOrdinalOf.push(sections.length - 1);
  }

  // --- Pass 2: capture scalar fields ---------------------------------------
  const captured: Record<string, FieldCapture> = {};

  const offer = (field: string, value: string | null, raw: string | null): void => {
    const prev = captured[field];
    if (!prev) {
      captured[field] = { value, raw, ambiguous: false };
      return;
    }
    if (value === null) return;
    if (prev.value === null) {
      prev.value = value;
      prev.raw = raw;
    } else if (prev.value !== value) {
      prev.ambiguous = true; // conflicting values -> keep the first, flag it
    }
  };

  const scanForwardValue = (start: number, field: string): { value: string; raw: string } | null => {
    let seen = 0;
    for (let j = start + 1; j < classified.length && seen < VALUE_LOOKAHEAD; j += 1) {
      const entry = classified[j]!;
      if (entry.kind === 'labeled' || entry.kind === 'bareLabel' || entry.kind === 'room') break;
      seen += 1;
      const value = extractField(field, entry.raw);
      if (value !== null) return { value, raw: entry.raw };
    }
    return null;
  };

  for (let i = 0; i < classified.length; i += 1) {
    const entry = classified[i]!;
    if (entry.kind === 'labeled') {
      offer(entry.field!, extractField(entry.field!, entry.value!), entry.value!);
    } else if (entry.kind === 'bareLabel') {
      const found = scanForwardValue(i, entry.field!);
      if (found) offer(entry.field!, found.value, found.raw);
    }
  }

  // --- Hotel / branch resolution -------------------------------------------
  const hotelLabel = captured.hotel?.value ?? null;
  const otherLines = classified.filter((c) => c.kind === 'other').map((c) => c.raw);
  const scan = findBestBranch(otherLines, branches);
  const labelMatch = hotelLabel ? matchBranch(hotelLabel, branches) : null;

  let branchMatchScore = scan.match?.score ?? 0;
  let branchLine = scan.line;
  let branchCandidate = scan.match?.branch ?? null;
  if (labelMatch && labelMatch.score >= branchMatchScore) {
    branchMatchScore = labelMatch.score;
    branchLine = hotelLabel;
    branchCandidate = labelMatch.branch;
  }

  const suggestedBranch = branchMatchScore >= BRANCH_MATCH_THRESHOLD ? branchCandidate : null;
  const branchConfident = suggestedBranch !== null && branchMatchScore >= BRANCH_CONFIDENT_THRESHOLD;
  const hotelName = hotelLabel ?? branchLine ?? otherLines[0] ?? null;

  // --- Scalar fields --------------------------------------------------------
  const guestName = captured.guestName?.value ?? null;
  const phone = captured.phone?.value ?? null;
  const bookingCode = captured.bookingCode?.value ?? null;
  const checkIn = captured.checkIn?.value ?? null;
  const checkOut = captured.checkOut?.value ?? null;
  const totalAmount = captured.total?.value !== undefined && captured.total?.value !== null
    ? Number(captured.total.value)
    : null;
  const currency = detectCurrency(captured.total?.raw) ?? 'VND';
  const paymentStatus = resolvePaymentStatus(rawText, captured.payment?.value ?? null);

  const warnings: ExtractWarning[] = [];
  const rangeValid = checkIn !== null && checkOut !== null && checkOut > checkIn;
  const expectedNights = rangeValid ? generateStayDates(checkIn, checkOut) : [];
  const expectedSet = new Set(expectedNights);

  // --- Pass 3: nightly price association ------------------------------------
  // Collect (date, amount, room) candidates from loose lines. A candidate is a
  // date-bearing line whose amount is on the same line or the immediately
  // following money-only line. Only dates within the stay range count (when the
  // range is known), which keeps cancellation-deadline fees out of the nights.
  interface Candidate { date: string; amount: number | null; room: number }
  const candidates: Candidate[] = [];
  for (let i = 0; i < classified.length; i += 1) {
    const entry = classified[i]!;
    if (entry.kind !== 'other') continue;
    const date = findDate(entry.raw);
    if (!date) continue;
    if (rangeValid && !expectedSet.has(date)) continue;
    let amount = amountOnLine(entry.raw);
    if (amount === null) {
      const next = classified[i + 1];
      if (next && next.kind === 'other' && looksLikeMoney(next.raw) && !findDate(next.raw)) {
        amount = amountOnLine(next.raw);
      }
    }
    candidates.push({ date, amount, room: roomOrdinalOf[i]! });
  }

  const defaultRoomFallback = sections.length === 0;
  const activeSections = sections.length > 0
    ? sections
    : (candidates.length > 0 ? [{ roomName: null, quantity: 1, startLine: 0 }] : []);

  const emptyByDate = new Map<string, number | null>();

  const nightsFrom = (byDate: Map<string, number | null>): ParsedNight[] => {
    if (rangeValid) {
      return expectedNights.map((date) => ({
        stayDate: date,
        amount: byDate.get(date) ?? null,
        currency,
        isEstimated: false,
      }));
    }
    return [...byDate.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([date, amount]) => ({ stayDate: date, amount, currency, isEstimated: false }));
  };
  const foundCount = (byDate: Map<string, number | null>): number =>
    new Set([...byDate.keys()].filter((d) => expectedSet.has(d))).size;
  const sectionSignalText = (si: number): string => {
    if (defaultRoomFallback) return '';
    const start = activeSections[si]!.startLine;
    const end = si + 1 < activeSections.length ? activeSections[si + 1]!.startLine : lines.length;
    return normalizeText(lines.slice(start, end).join(' '));
  };

  const finalRooms: ParsedRoom[] = [];
  let physicalIndex = 0;

  const pushRoom = (
    roomName: string | null,
    byDate: Map<string, number | null>,
    conflict: boolean,
    emitWarnings: boolean,
  ): void => {
    physicalIndex += 1;
    const nights = nightsFrom(byDate);
    if (emitWarnings) {
      const found = foundCount(byDate);
      if (rangeValid && found !== expectedNights.length) {
        warnings.push({
          code: 'NIGHT_COUNT_MISMATCH',
          severity: 'WARNING',
          message: `Phòng ${physicalIndex}: số đêm không khớp (mong đợi ${expectedNights.length}, tìm thấy ${found}).`,
        });
      }
      if (nights.some((n) => n.amount === null)) {
        warnings.push({
          code: 'MISSING_NIGHTLY_PRICE',
          severity: 'WARNING',
          message: `Phòng ${physicalIndex}: có đêm chưa xác định giá.`,
        });
      }
      if (conflict) {
        warnings.push({
          code: 'AMBIGUOUS_NIGHTLY_PRICE',
          severity: 'WARNING',
          message: `Phòng ${physicalIndex}: có giá đêm mâu thuẫn, vui lòng kiểm tra.`,
        });
      }
    }
    finalRooms.push({
      roomIndex: physicalIndex,
      roomName,
      roomTotal: computeRoomTotal(nights),
      nights,
    });
  };

  for (let si = 0; si < activeSections.length; si += 1) {
    const section = activeSections[si]!;
    const mine = candidates.filter((c) => (defaultRoomFallback ? true : c.room === si));

    // Amounts by date, preferring a real amount over a null placeholder and
    // flagging a genuine conflict (two different prices for the same date).
    const byDate = new Map<string, number | null>();
    let priceConflict = false;
    for (const c of mine) {
      if (!byDate.has(c.date)) {
        byDate.set(c.date, c.amount);
      } else {
        const existing = byDate.get(c.date) ?? null;
        if (existing === null) byDate.set(c.date, c.amount);
        else if (c.amount !== null && c.amount !== existing) priceConflict = true;
      }
    }
    const hasPerNight = [...byDate.values()].some((v) => v !== null);

    if (section.quantity <= 1) {
      pushRoom(section.roomName, byDate, priceConflict, true);
      continue;
    }

    // --- Room quantity aggregation: one section = `quantity` physical rooms ---
    const text = sectionSignalText(si);
    const perRoom = PER_ROOM_SIGNAL.test(text);
    const combined = COMBINED_SIGNAL.test(text);

    if (hasPerNight && perRoom && !combined) {
      // Case B: an explicit per-room nightly price is copied to each room. The
      // values are real (not estimated), just shared across identical rooms.
      for (let k = 0; k < section.quantity; k += 1) {
        pushRoom(section.roomName, byDate, priceConflict, k === 0);
      }
    } else {
      // Cases C/D: per-room pricing cannot be established safely. Never divide or
      // duplicate a combined amount — keep each nightly amount null (the combined
      // total, if any, is preserved on the booking) and flag for Admin review.
      warnings.push({
        code: 'AMBIGUOUS_ROOM_QUANTITY_PRICE',
        severity: 'WARNING',
        message: `Phòng "${section.roomName ?? '?'}" (số lượng ${section.quantity}): không xác định được giá cho từng phòng, cần Admin kiểm tra.`,
      });
      if (hasPerNight && !combined) {
        warnings.push({
          code: 'AMBIGUOUS_NIGHTLY_PRICE',
          severity: 'WARNING',
          message: `Phòng "${section.roomName ?? '?'}": không rõ giá là cho mỗi phòng hay tổng, giữ trống giá đêm.`,
        });
      }
      for (let k = 0; k < section.quantity; k += 1) {
        pushRoom(section.roomName, emptyByDate, false, false);
      }
    }
  }

  // --- Booking-level validation & confidence warnings -----------------------
  if (!suggestedBranch) {
    warnings.unshift({
      code: 'UNKNOWN_HOTEL',
      severity: 'WARNING',
      message: hotelName
        ? `Không nhận diện được khách sạn "${hotelName}". Vui lòng chọn chi nhánh thủ công.`
        : 'Không tìm thấy tên khách sạn. Vui lòng chọn chi nhánh thủ công.',
    });
  } else if (!branchConfident) {
    warnings.unshift({
      code: 'LOW_BRANCH_CONFIDENCE',
      severity: 'WARNING',
      message: `Chưa chắc chắn khách sạn là "${suggestedBranch.hotelName}". Vui lòng xác nhận chi nhánh.`,
    });
  }
  if (!guestName) {
    warnings.push({ code: 'MISSING_GUEST', severity: 'WARNING', message: 'Thiếu tên khách.' });
  }
  if (!bookingCode) {
    warnings.push({ code: 'MISSING_BOOKING_CODE', severity: 'WARNING', message: 'Thiếu mã đặt phòng.' });
  } else if (captured.bookingCode?.ambiguous) {
    warnings.push({
      code: 'AMBIGUOUS_BOOKING_CODE',
      severity: 'WARNING',
      message: 'Có nhiều mã đặt phòng khác nhau; vui lòng kiểm tra.',
    });
  }
  if (captured.total?.ambiguous) {
    warnings.push({
      code: 'AMBIGUOUS_TOTAL',
      severity: 'WARNING',
      message: 'Có nhiều tổng tiền khác nhau; vui lòng kiểm tra.',
    });
  }
  for (const field of ['guestName', 'phone', 'checkIn', 'checkOut'] as const) {
    if (captured[field]?.ambiguous) {
      warnings.push({
        code: 'DUPLICATED_LABEL_CONFLICT',
        severity: 'WARNING',
        message: 'Nội dung dán có nhãn lặp lại với giá trị khác nhau; vui lòng kiểm tra.',
      });
      break;
    }
  }
  if (!checkIn || !checkOut) {
    warnings.push({
      code: 'MISSING_DATES',
      severity: 'ERROR',
      message: 'Thiếu hoặc không đọc được ngày nhận/trả phòng.',
    });
  } else if (checkOut <= checkIn) {
    warnings.push({
      code: 'INVALID_DATE_RANGE',
      severity: 'ERROR',
      message: 'Ngày trả phòng phải sau ngày nhận phòng.',
    });
  }
  if (finalRooms.length === 0) {
    warnings.push({
      code: 'MISSING_ROOM',
      severity: 'ERROR',
      message: 'Không tìm thấy phòng nào trong nội dung.',
    });
  }

  const fieldConfidence: Record<string, FieldConfidence> = {
    guestName: confidenceOf(captured.guestName),
    phone: confidenceOf(captured.phone),
    bookingCode: confidenceOf(captured.bookingCode),
    checkIn: confidenceOf(captured.checkIn),
    checkOut: confidenceOf(captured.checkOut),
    total: confidenceOf(captured.total),
  };

  return {
    hotelName,
    guestName,
    phone,
    bookingCode,
    checkIn,
    checkOut,
    currency,
    totalAmount,
    paymentStatus,
    paymentStatusKnown: true,
    rooms: finalRooms,
    suggestedBranch,
    branchMatchScore,
    branchConfident,
    requiresManualConfirmation: !branchConfident,
    fieldConfidence,
    warnings,
    parserVersion: PARSER_VERSION,
  };
}

function confidenceOf(capture: FieldCapture | undefined): FieldConfidence {
  if (!capture || capture.value === null) return 'MISSING';
  return capture.ambiguous ? 'AMBIGUOUS' : 'CONFIDENT';
}

function computeRoomTotal(nights: readonly ParsedNight[]): number | null {
  if (nights.length === 0) return null;
  let sum = 0;
  for (const night of nights) {
    if (night.amount === null) return null; // incomplete -> do not invent a total
    sum += night.amount;
  }
  return sum;
}

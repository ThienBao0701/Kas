import { removeDiacritics } from './text';

/**
 * Distils a concise, operational Vietnamese `specialRequest` from a Booking.com
 * reservation. It composes a handful of independent, deduplicated fragments — in
 * a fixed priority order — from the reservation-level "important information"
 * block, the structured arrival fields and the *guest-authored* chat only:
 *
 *   1. Room-proximity request      "Cần bố trí các phòng gần nhau."
 *   2. Arrival window / time       "Khách dự kiến đến trong khoảng 13:00 - 14:00."
 *   3. Early check-in request      "Khách hỏi nhận phòng sớm."
 *   4. Flight information          "Khách đến bằng 2 chuyến bay; …"
 *   5. Luggage request             "Có thể gửi hành lý nếu phòng chưa sẵn sàng."
 *
 * It never emits phone numbers, email, addresses, links, greetings, signatures,
 * transfer prices, fee tables, hotel-authored replies or automated messages. It
 * returns null when there is no safe operational request.
 */

const MAX_SPECIAL_REQUEST = 500;

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

/** "1pm" -> "13:00", "2 pm" -> "14:00", bare afternoon hour -> +12 with context. */
function to24h(hour: number, minute: number, meridiem: string | undefined, hasPmContext: boolean): string | null {
  if (hour < 1 || hour > 24) return null;
  let h = hour;
  if (meridiem === 'pm') h = hour === 12 ? 12 : (hour % 12) + 12;
  else if (meridiem === 'am') h = hour % 12;
  else if (hasPmContext && hour >= 1 && hour <= 11) h = hour + 12;
  if (h > 23 || h < 0 || minute < 0 || minute > 59) return null;
  return `${pad(h)}:${pad(minute)}`;
}

/** A 24-hour "HH:MM" token from an explicit clock value (no PM inference). */
function clockTo24h(hour: number, minute: number, meridiem: string | undefined): string | null {
  return to24h(hour, minute, meridiem, false);
}

/** Splits the chat into guest-authored text using the sender markers. */
function collectGuestText(rawText: string): string {
  const lines = rawText.split(/\r?\n/);
  let sender: 'guest' | 'hotel' | null = null;
  const guest: string[] = [];

  for (const line of lines) {
    const flat = removeDiacritics(line).trim().toLowerCase();
    if (flat.length === 0) continue;
    // A *chat header* is the sender word followed by a "-"/"–" separator (a
    // timestamp) or standing alone — e.g. "Khách - 09:15", "Khách sạn - …". This
    // deliberately does NOT match room-occupant labels ("Khách lưu trú:") or
    // policy prose that merely starts with "Khách…", so hotel fee/policy text is
    // never mis-collected as a guest message. "khach san" (hotel) is checked
    // before "khach" (guest).
    if (/^(khach san|hotel|host|le tan|front desk|reply)\b(?:\s*[-–—]\s|\s*$)/.test(flat)) {
      sender = 'hotel';
      continue;
    }
    if (/^(khach|guest)\b(?:\s*[-–—]\s|\s*$)/.test(flat)) {
      sender = 'guest';
      continue;
    }
    if (sender === 'guest') guest.push(line.trim());
  }
  return guest.join(' ');
}

const ARRIVAL_CUE = /\b(?:arrive|arriving|arrival|come|coming|reach|get in|den|toi|tới|đến)\b[^.\d]{0,20}(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i;
const LUGGAGE = /\b(?:luggage|bag|bags)\b|hành lý|hanh ly/i;

// -------------------------------------------------------------------------
// Fragment 1: room proximity ("các phòng nằm gần nhau" / "adjacent rooms")
// -------------------------------------------------------------------------
const PROXIMITY_NEEDLES = [
  'phong gan nhau',
  'cac phong gan nhau',
  'cac phong nam gan nhau',
  'phong nam gan nhau',
  'nam gan nhau',
  'adjacent rooms',
  'rooms close together',
  'rooms next to each other',
  'connecting rooms',
];

function proximityFragment(rawText: string): string | null {
  const flat = removeDiacritics(rawText).toLowerCase();
  return PROXIMITY_NEEDLES.some((n) => flat.includes(n)) ? 'Cần bố trí các phòng gần nhau.' : null;
}

// -------------------------------------------------------------------------
// Fragment 2: arrival window (structured) or a single arrival time (chat)
// -------------------------------------------------------------------------

/**
 * The explicit arrival window from Booking.com's structured fields
 * ("Thời gian đến dự kiến" / "Từ 1:00 PM đến 2:00 PM", or a "Yêu cầu nhận phòng"
 * line stating "trong khoảng 13:00 - 14:00"). Returns { start, end } in 24-hour
 * form, or null when no structured window is present.
 */
function structuredArrivalWindow(rawText: string): { start: string; end: string } | null {
  const flat = removeDiacritics(rawText).toLowerCase();
  if (!/(thoi gian den du kien|yeu cau nhan phong)/.test(flat)) return null;

  const h24 = flat.match(/(?:khoang|nhan phong|den du kien)[^\d]{0,40}(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})/);
  if (h24) {
    const start = clockTo24h(Number(h24[1]), Number(h24[2]), undefined);
    const end = clockTo24h(Number(h24[3]), Number(h24[4]), undefined);
    if (start && end) return { start, end };
  }
  const ampm = flat.match(
    /tu\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:den|to|-)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/,
  );
  if (ampm) {
    const start = clockTo24h(Number(ampm[1]), ampm[2] ? Number(ampm[2]) : 0, ampm[3]);
    const end = clockTo24h(Number(ampm[4]), ampm[5] ? Number(ampm[5]) : 0, ampm[6]);
    if (start && end) return { start, end };
  }
  return null;
}

/** A single arrival time from guest chat, e.g. "arrive around 3pm" -> "15:00". */
function chatArrivalTime(guestText: string): string | null {
  const m = guestText.match(ARRIVAL_CUE);
  if (!m) return null;
  const hasPmContext = /\b\d{1,2}\s*pm\b/i.test(guestText);
  return to24h(Number(m[1]), m[2] ? Number(m[2]) : 0, m[3]?.toLowerCase(), hasPmContext);
}

function arrivalFragment(rawText: string, guestText: string): string | null {
  const window = structuredArrivalWindow(rawText);
  if (window) return `Khách dự kiến đến trong khoảng ${window.start} - ${window.end}.`;
  const time = chatArrivalTime(guestText);
  return time ? `Khách dự kiến đến khoảng ${time}.` : null;
}

// -------------------------------------------------------------------------
// Fragment 3: explicit early-check-in *request* (not a mere arrival time)
// -------------------------------------------------------------------------
const EARLY_CHECKIN =
  /\bearly\s*check[\s-]?in\b|\bcheck[\s-]?in\s+early\b|nhan phong som|som hon gio nhan phong|nhan phong truoc gio/i;

function earlyCheckinFragment(guestText: string): string | null {
  const flat = removeDiacritics(guestText).toLowerCase();
  return EARLY_CHECKIN.test(flat) ? 'Khách hỏi nhận phòng sớm.' : null;
}

// -------------------------------------------------------------------------
// Fragment 4: flights (count and/or the flights' arrival times)
// -------------------------------------------------------------------------
function flightCount(guestText: string): number | null {
  const flat = removeDiacritics(guestText).toLowerCase();
  if (!/\bflights?\b|chuyen bay/.test(flat)) return null;
  const num = flat.match(/(\d{1,2})\s*(?:separate\s+)?(?:flights?|chuyen bay)/);
  if (num) {
    const n = Number(num[1]);
    if (n >= 2 && n <= 9) return n;
  }
  if (/\btwo\b\s+(?:separate\s+)?flights?|hai chuyen bay/.test(flat)) return 2;
  if (/separate flights|chuyen bay rieng|different flights/.test(flat)) return 2;
  return null;
}

/** Two flight arrival times joined by "and"/"và", e.g. "8 AM and 11 AM". */
function flightTimes(guestText: string): [string, string] | null {
  const flat = removeDiacritics(guestText).toLowerCase();
  if (!/\bflights?\b|chuyen bay/.test(flat)) return null;
  const hasPmContext = /\b\d{1,2}\s*pm\b/.test(flat);
  const m = flat.match(
    /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:and|va|,|&)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/,
  );
  if (!m) return null;
  const t1 = to24h(Number(m[1]), m[2] ? Number(m[2]) : 0, m[3], hasPmContext);
  const t2 = to24h(Number(m[4]), m[5] ? Number(m[5]) : 0, m[6], hasPmContext);
  return t1 && t2 ? [t1, t2] : null;
}

function flightFragment(guestText: string): string | null {
  const count = flightCount(guestText);
  const times = flightTimes(guestText);
  if (count && times) {
    return `Khách đến bằng ${count} chuyến bay; các chuyến bay dự kiến đến khoảng ${times[0]} và ${times[1]}.`;
  }
  if (count) return `Khách đến bằng ${count} chuyến bay.`;
  if (times) return `Các chuyến bay dự kiến đến khoảng ${times[0]} và ${times[1]}.`;
  return null;
}

// -------------------------------------------------------------------------
// Fragment 5: luggage storage
// -------------------------------------------------------------------------
function luggageFragment(rawText: string, guestText: string): string | null {
  if (LUGGAGE.test(guestText)) return 'Có thể gửi hành lý nếu phòng chưa sẵn sàng.';
  // Also honour an explicit operational "gửi hành lý" in a structured request line.
  if (/(?:gui|gui lai|de)\s+hanh ly|luggage storage/.test(removeDiacritics(rawText).toLowerCase())) {
    return 'Có thể gửi hành lý nếu phòng chưa sẵn sàng.';
  }
  return null;
}

/**
 * Composes the operational special-request note. Fragments are added in the
 * fixed priority order, each already a full sentence, joined by a space and
 * deduplicated. Returns null when nothing safe was found.
 */
export function extractSpecialRequest(rawText: string): string | null {
  const guestText = collectGuestText(rawText);

  const fragments = [
    proximityFragment(rawText),
    arrivalFragment(rawText, guestText),
    earlyCheckinFragment(guestText),
    flightFragment(guestText),
    luggageFragment(rawText, guestText),
  ].filter((f): f is string => f !== null);

  const seen = new Set<string>();
  const out: string[] = [];
  for (const fragment of fragments) {
    if (seen.has(fragment)) continue;
    seen.add(fragment);
    const candidate = out.length === 0 ? fragment : `${out.join(' ')} ${fragment}`;
    if (candidate.length > MAX_SPECIAL_REQUEST) break;
    out.push(fragment);
  }

  return out.length > 0 ? out.join(' ') : null;
}

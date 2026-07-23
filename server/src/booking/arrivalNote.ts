import { removeDiacritics } from './text';

/**
 * Extracts a concise, operational arrival note from the guest conversation of a
 * Booking.com reservation. Only **guest-authored** messages are considered — the
 * chat sender markers ("Khách" vs "Khách sạn"/"Hotel"/"You") let us drop hotel
 * templates, transfer/fee lines and signatures — and only arrival-time,
 * check-in-time and luggage-storage information is kept. English clock times are
 * converted to 24-hour Vietnamese display.
 *
 * Returns a short Vietnamese note (stored in `specialRequest`), or null when no
 * arrival information is present. It never includes phone numbers, greetings,
 * addresses, transfer info or emojis — the output is a fixed, clean template.
 */

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

/** "1pm" -> "13:00", "2 pm" -> "14:00", bare afternoon hour -> +12 with context. */
function to24h(hour: number, minute: number, meridiem: string | undefined, hasPmContext: boolean): string | null {
  if (hour < 1 || hour > 24) return null;
  let h = hour;
  if (meridiem === 'pm') h = (hour % 12) + 12;
  else if (meridiem === 'am') h = hour % 12;
  else if (hasPmContext && hour >= 1 && hour <= 11) h = hour + 12;
  if (h > 23 || h < 0) return null;
  return `${pad(h)}:${pad(minute)}`;
}

/** Splits the chat into guest-authored text using the sender markers. */
function collectGuestText(rawText: string): string {
  const lines = rawText.split(/\r?\n/);
  let sender: 'guest' | 'hotel' | null = null;
  const guest: string[] = [];

  for (const line of lines) {
    const flat = removeDiacritics(line).trim().toLowerCase();
    if (flat.length === 0) continue;
    // Sender markers. "khach san" (hotel) must be checked before "khach" (guest).
    if (/^(khach san|hotel|host|le tan|front desk|reply|ban)\b/.test(flat)) {
      sender = 'hotel';
      continue;
    }
    if (/^(khach|guest)\b/.test(flat)) {
      sender = 'guest';
      continue;
    }
    if (sender === 'guest') guest.push(line.trim());
  }
  return guest.join(' ');
}

const ARRIVAL_CUE = /\b(?:arrive|arriving|arrival|come|coming|reach|get in|den|toi|tới|đến)\b[^.\d]{0,20}(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i;
const CHECKIN_CUE = /\b(?:check[\s-]?in|checking in|nhan phong|nhận phòng)\b[^.\d]{0,20}(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i;
const LUGGAGE = /\b(?:luggage|bag|bags)\b|hành lý|hanh ly/i;

function matchTime(text: string, cue: RegExp, hasPmContext: boolean): string | null {
  const m = text.match(cue);
  if (!m) return null;
  return to24h(Number(m[1]), m[2] ? Number(m[2]) : 0, m[3]?.toLowerCase(), hasPmContext);
}

export function extractArrivalNote(rawText: string): string | null {
  const guestText = collectGuestText(rawText);
  if (guestText.length === 0) return null;

  const hasPmContext = /\b\d{1,2}\s*pm\b/i.test(guestText);
  const arrival = matchTime(guestText, ARRIVAL_CUE, hasPmContext);
  const checkin = matchTime(guestText, CHECKIN_CUE, hasPmContext);
  const luggage = LUGGAGE.test(guestText);

  if (arrival && checkin && luggage) {
    return `Khách dự kiến đến khoảng ${arrival}, gửi hành lý và nhận phòng lúc ${checkin}.`;
  }
  if (arrival && checkin) {
    return `Khách dự kiến đến khoảng ${arrival}, nhận phòng lúc ${checkin}.`;
  }
  if (arrival && luggage) {
    return `Khách dự kiến đến khoảng ${arrival}, muốn gửi hành lý.`;
  }
  if (arrival) {
    return `Khách dự kiến đến khoảng ${arrival}.`;
  }
  if (checkin && luggage) {
    return `Khách dự kiến nhận phòng lúc ${checkin}, muốn gửi hành lý.`;
  }
  if (checkin) {
    return `Khách dự kiến nhận phòng lúc ${checkin}.`;
  }
  if (luggage) {
    return 'Khách muốn gửi hành lý.';
  }
  return null;
}

# Booking.com raw-text fixtures

These files are anonymized samples of the text an Admin pastes into
`POST /api/bookings/extract` — the plain text produced by selecting a
Booking.com reservation-detail page (Ctrl+A / Ctrl+C) and pasting it. The parser
(`server/src/booking/parser.ts`) is regression-tested against them by
`bookingParser.test.ts`, `bookingFixtures.test.ts` and
`bookingRoomFixtures.test.ts`.

## Adding a real anonymized sample

Real samples are the most valuable regression fixtures. When you capture one,
anonymize it **without changing its structure**:

- **Replace guest names** with fictitious names (keep the same shape, e.g. a
  Vietnamese full name stays a Vietnamese full name).
- **Replace phone numbers** with fake but plausible ones (same format/length).
- **Replace the booking / confirmation code and PIN** with different digits of
  the same length.
- **Never include real credit-card details.** The card is already hidden on the
  page; keep the sentence `Quý vị không có quyền xem chi tiết thẻ tín dụng này.`
  verbatim when present — it is the authoritative PAY_BEFORE trigger — but never
  paste an actual card number, expiry, or CVV from anywhere.
- You may change hotel names, but to exercise branch matching, prefer one of the
  eight seeded branch names (see `server/src/db/branches.ts`), including their
  truncations (`Ben Than`, `Luxur`).

Preserve everything else exactly as copied:

- **Keep line breaks, blank lines, labels, punctuation, and duplicated UI text.**
- **Keep navigation chrome, cancellation and payment policy text, weekday date
  text, non-breaking spaces and tabs.** The parser is built to tolerate this
  noise, so removing it defeats the purpose of the fixture.
- **Do not "clean up" or reorder the sample** before saving it. If the real page
  puts a value on the line after its label, leave it there.

## Naming

Use a short kebab-case name with a numeric prefix, e.g.
`24-vi-real-sample-city-view.txt`. Add matching assertions in a `*.test.ts`
file that prove the important fields (hotel/branch, guest, phone, code, dates,
total, payment status, room count, per-night amounts, warnings).

## Compatibility note

The synthetic fixtures here are *structurally* realistic but authored by hand.
**Full Booking.com compatibility should not be claimed until real anonymized
samples have been added and are passing.** Treat each new real sample as the
source of truth and adjust the parser conservatively if it exposes a gap.

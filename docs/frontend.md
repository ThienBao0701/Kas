# Kas Frontend — UI/UX Notes

This document covers the operational front end (React + Vite + Tailwind in
`client/`). It is intentionally brief; the code is the source of truth.

## Kas is not a hotel PMS

Kas does **not** create reservations. It is an internal **Booking Dispatch
Center**. The Admin pastes Booking.com text, reviews the extracted fields,
picks one branch and sends it down. A branch receptionist then re-creates the
reservation in a **separate** hotel system and returns to Kas to confirm.

Never describe Kas as "creating a booking". The UI uses these labels:

| Status     | Label                |
| ---------- | -------------------- |
| `DRAFT`    | Bản nháp             |
| `NEW`      | Chờ chi nhánh tạo    |
| `COMPLETED`| Đã xác nhận tạo      |
| `ARCHIVED` | Đã lưu trữ           |

## Receptionist copy workflow

The receptionist screen (`Đơn mới`) is a master-detail view: a compact list
(~38% width) on the left, the full booking detail (~62%) on the right. The list
scrolls independently while the detail stays in view. On narrow widths the list
stacks above the detail.

The copy surface is deliberately minimal — the receptionist copies only what the
external hotel system needs:

- **Four main fields** have a Copy button: Tên khách, Số điện thoại, Mã Booking,
  Tổng tiền. Branch, check-in, check-out, payment and notes are read-only.
- **Each room night** has a single **Sao chép giá** button that copies just the
  nightly amount. It is disabled (with an accessible reason) when the amount is
  unknown; the row shows `Chưa xác định`.

All copyable amounts use **one consistent format**: Vietnamese thousands
separators, whole đồng, no currency symbol (e.g. `609.120`) — see
`formatAmountCopy` in `src/lib/format.ts`.

### Generated note — "Ghi chú tạo đơn"

A dedicated card generates a ready-to-paste two-line note (plain text, no
Markdown/HTML/JSON) with one **Sao chép ghi chú** button. Logic lives in
`src/lib/pmsNote.ts` (pure, injectable clock) with exact-output tests.

```
BK <CODE>_<ROOM_ABBR>_<NIGHTS> ĐÊM <TOTAL> <PAY> CI
[ĂN SÁNG ]<DD/MM> <CONTACT>[ <ARRIVAL>]
```

- **Booking code** is required; without it the note is blocked with
  "Chưa có mã Booking để tạo ghi chú."
- **Room abbreviation** (`abbreviateRoomType`): most-specific match wins, so
  "Phòng Tiêu Chuẩn Giường Đôi" → `STAN` (not `DBL`). Multiple rooms are never
  dropped — same type collapses with a count (`STANx2`), mixed types join with
  `+` (`STAN+DLX`). Unknown types get a safe non-empty fallback.
- **Nights** = check-in inclusive → check-out exclusive (nightly-row count is a
  fallback only when dates are unusable).
- **Payment** is emitted as `PAY BEFORE` / `PAY AFTER` (never the Vietnamese
  label). **Date** is today in Asia/Ho_Chi_Minh as `DD/MM`.
- **Breakfast**: only the three configured branches prefix `ĂN SÁNG`, keyed by
  stable branch code in `BREAKFAST_BRANCH_CODES` (260 Lý Tự Trọng, 47A Nguyễn
  Trãi, 170-172-174 Nguyễn Thái Bình) — never by array position or numeric id.
- **Contact label**: Vietnamese phone → `CÓ ZL`, other international → `CÓ WA`,
  no phone → `NO CONTACT`. The number itself is not included in the note.
- **Arrival note**: appended only when specialRequest contains an arrival time
  (e.g. `KHÁCH ĐẾN KHOẢNG 13:00`); otherwise nothing is appended.

A missing phone is optional metadata — it shows `(Hiển thị số điện thoại)` and
never raises a warning or blocks the workflow.

## "Xác nhận đã tạo"

After the receptionist has created the reservation in the other system, they
click **Xác nhận đã tạo** and confirm in a dialog that echoes customer name,
booking code and branch. This calls `POST /api/bookings/:id/complete`, which:

- moves the booking `NEW → COMPLETED`,
- records `completedBy` / `completedAt`,
- removes it from `Đơn mới` and lists it under `Đã xác nhận tạo`,
- notifies admins.

A duplicate submit is blocked while the request is in flight. If the booking was
already confirmed elsewhere, the API returns `BOOKING_ALREADY_COMPLETED` (409)
and the UI shows a clear message and refreshes to the confirmed state.

## LAST MINUTE

`isLastMinute` from the backend is authoritative (check-in is today). Such
bookings get a strong red/orange badge (🔥 LAST MINUTE — "Nhận phòng hôm nay"),
a red accent border, and priority ordering wherever the backend already sorts
them first. No flashing, no sound.

## Polling

There is **no SSE**. The receptionist inbox and the notification bell poll every
20 seconds (React Query `refetchInterval`). The inbox shows "Dữ liệu tự động cập
nhật mỗi 20 giây", the last successful refresh time, and a manual refresh button.
The selected booking is preserved across refreshes. If the selected booking
disappears (confirmed here or by another user) the selection advances to the
next available booking; when none remain, a clear empty state shows. If a
background refresh fails, the last good data stays on screen with a warning
("Không thể kết nối đến máy chủ…") and a retry — data is never blanked to a fake
empty state.

## Admin account management — delete not available

There is **no delete endpoint** for user accounts at the current backend
(`server/src/routes/adminUsers.ts` exposes create, update, reset-password,
enable, disable only). The Admin account screen therefore keeps the existing
**lock / unlock (disable / enable)** controls and adds **no** delete button.

To add "Xóa tài khoản lễ tân" the backend would need, for example:

```
DELETE /api/admin/users/:id
```

Hard deletion is likely **unsafe**: booking audit trails reference the
receptionist (`sentBy` / `completedBy` actors and status-history entries). A hard
delete would break those historical references. The recommended contract is a
**soft delete / permanent disable** that preserves audit relations while blocking
login — which the existing `disable` action already provides. No backend change
was made on Máy 2.

## Known limitations at backend baseline `0a30145`

The front end uses only the APIs available at this commit. Notable gaps:

- **No dashboard aggregate endpoint.** The Admin dashboard derives per-branch
  waiting / confirmed / LAST MINUTE counts from the existing list endpoints
  (`/bookings/new`, `/bookings/history?status=COMPLETED`). Counts are capped at
  the list page size and reflect today's confirmations, not an all-time total.
- **Admin completion notification title** is generated by the backend as
  "Đơn đã hoàn thành". The front end renders it faithfully; it cannot be
  relabeled to "Đã xác nhận tạo" without a backend change.
- **Filtered navigation from dashboard counts** relies on `?branchId=` query
  params that the waiting/completed lists read on mount. No dedicated filtered
  routes exist beyond that.

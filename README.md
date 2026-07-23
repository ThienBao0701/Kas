# hotel-booking-dispatch

Hệ thống điều phối và theo dõi đơn đặt phòng nội bộ (internal hotel booking dispatch and tracking system).

Quản trị viên (Admin) dán văn bản đặt phòng thô từ Booking.com, hệ thống trích xuất thông tin (khách, ngày, **giá từng đêm của từng phòng**), Admin kiểm tra rồi **gửi xuống chi nhánh**. Lễ tân (Receptionist) của 8 chi nhánh chỉ thấy đơn của chi nhánh mình, sao chép thông tin, tạo đặt phòng trong hệ thống khách sạn nội bộ, rồi bấm **Đã tạo hoàn thành**. Toàn bộ lịch sử được lưu vĩnh viễn.

## Tech stack

- **Frontend:** React + TypeScript + Vite + Tailwind CSS + TanStack Query + React Hook Form + Zod — installable PWA
- **Backend:** Node.js + Express + TypeScript + Prisma + SQLite, session-based auth, Server-Sent Events
- **Testing:** Vitest, React Testing Library, Supertest

## Quick start (development)

```bash
npm install
copy .env.example .env    # then edit .env (SESSION_SECRET, INITIAL_ADMIN_*)
npm run db:migrate
npm run db:seed
npm run dev               # starts the backend (:3001) and the frontend (:5173) together
```

Then open the frontend at **http://localhost:5173** and log in with the initial
Admin from `.env`. The backend API runs on **http://localhost:3001**; in
development the Vite dev server proxies `/api` to it, so the browser stays
same-origin and the session cookie flows automatically.

To run the two servers separately:

```bash
npm run dev -w server     # backend only, http://localhost:3001
npm run dev -w client     # frontend only, http://localhost:5173 (proxies /api → :3001)
```

**Sessions & credentials:** authentication is a server-side session addressed by
an HTTP-only cookie — the frontend stores **no** token in LocalStorage or
SessionStorage, and every request is sent with `credentials: "include"`.
Refreshing the browser restores the session from the cookie via
`GET /api/auth/me`. A user with a temporary password is forced to change it
before reaching the app.

> The frontend is currently the **Phase 3A foundation**: authentication,
> app shell, role-based navigation and professional empty states. The booking
> screens arrive in later phases.

## Production

```bash
npm run build
npm run start
```

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Start server + client in development mode |
| `npm run build` | Production build (server + client) |
| `npm run start` | Run production server (serves built client) |
| `npm run test` | Run all tests |
| `npm run lint` | Lint all workspaces |
| `npm run typecheck` | TypeScript checks |
| `npm run db:migrate` | Apply database migrations |
| `npm run db:seed` | Seed the 8 branches |

## Authentication & accounts

The backend uses session-based authentication (an HTTP-only cookie holding only
an opaque session id; all session data stays server-side). Sessions are stored
in the SQLite database and survive server restarts.

### Environment variables

| Variable | Purpose |
| --- | --- |
| `SESSION_SECRET` | Signs the session cookie. **Required**, ≥ 16 characters. |
| `SESSION_COOKIE_SECURE` | `true` to send the cookie only over HTTPS (production). Default `false`. |
| `SESSION_MAX_AGE_HOURS` | Session lifetime / rolling idle window. Default `12`. |
| `LOGIN_RATE_LIMIT_MAX` | Login attempts per IP per window before `429`. Default `10`. |
| `LOGIN_RATE_LIMIT_WINDOW_MINUTES` | Login rate-limit window. Default `15`. |
| `INITIAL_ADMIN_USERNAME` / `INITIAL_ADMIN_PASSWORD` / `INITIAL_ADMIN_FULL_NAME` | The first administrator, created once at startup. |

### First login

1. Set `INITIAL_ADMIN_*` in `.env`. On first start the server creates that
   single ADMIN account (password bcrypt-hashed). It is never recreated or
   overwritten on later restarts. **There is no default public account** — in
   production the server refuses to start if these are missing rather than
   inventing a predictable one.
2. Log in at `POST /api/auth/login` with those credentials.
3. The initial admin is flagged `mustChangePassword`. Until the password is
   changed via `POST /api/auth/change-password`, every protected endpoint
   returns `PASSWORD_CHANGE_REQUIRED` — only `GET /api/auth/me`,
   `POST /api/auth/change-password` and `POST /api/auth/logout` are allowed.

Password policy: at least 8 characters including a letter and a number.

### Managing receptionists (admin only)

The admin creates and manages receptionist accounts via `/api/admin/users`
(create, update name/branch, reset password, enable/disable). Each new
receptionist gets a temporary password and is forced to change it at first
login. Accounts are never deleted (historical bookings reference them) — disable
them instead. A disabled account, or one whose password was just reset, loses
access on its next request even if it still holds a session cookie.

### Branch isolation

Every receptionist is bound to exactly one of the 8 branches. The backend
enforces this on every request from the authenticated session — a receptionist
can never reach another branch by changing a URL id, a query parameter, or a
JSON `branchId`. The admin can see and act across all branches.

### Development login workflow

```bash
copy .env.example .env    # then set SESSION_SECRET and INITIAL_ADMIN_*
npm run db:migrate
npm run db:seed
npm run dev
# POST http://localhost:3001/api/auth/login  { username, password }
# -> then POST /api/auth/change-password to clear the forced change
```

## Booking dispatch workflow (backend)

Kas is **not** a hotel PMS and never creates hotel reservations. It only routes a
Booking.com reservation to one branch and tracks whether the branch confirmed it.

### Status flow

```
DRAFT ──(ready, optional)──▶ READY ──┐
  │                                   ├──(send)──▶ NEW ──(complete)──▶ COMPLETED ──▶ ARCHIVED
  └───────────────(send)──────────────┘
```

- **DRAFT** — extracted and saved; the Admin may edit it; not visible to receptionists.
- **READY** — optional review gate: the Admin validated the data. Editing a READY
  booking sends it back to **DRAFT** for revalidation.
- **NEW** — dispatched to exactly one branch; visible in that branch's *Đơn mới*
  list; awaiting confirmation.
- **COMPLETED** — the receptionist confirmed the reservation was created in the
  external hotel system (*Xác nhận đã tạo*). Kept permanently.
- **ARCHIVED** — older history, retained (never hard-deleted).

Every transition writes one immutable `BookingStatusHistory` row.

### Send-to-branch flow

`POST /api/admin/bookings/:id/send` (Admin) assigns one branch, re-runs full
validation, and — if there are no blocking errors and every non-blocking warning
is acknowledged (`acknowledgedWarningCodes`) — atomically: sets `branchId`,
`status = NEW`, `sentAt`, `sentByUserId`, computes `isLastMinute`, writes status
history, and creates an unread notification for every **active** receptionist of
that branch. `sentAt` is permanent and is never overwritten by `completedAt`
(*gửi đơn ngày nào thì phân loại ngày đó*). Re-sending a dispatched booking is a
`409 CONFLICT` with no duplicate side effects.

### Branch isolation

A receptionist only ever sees dispatched bookings for their own branch. A
client-supplied `branchId` on `GET /api/bookings/new|completed|history` is ignored
for receptionists (the server derives the branch from the session), and viewing or
completing another branch's booking returns `403 BRANCH_ACCESS_DENIED`. `rawText`
is returned to the Admin only, not to receptionists.

### Last-minute definition

A booking is **last minute** when its check-in date equals *today in
Asia/Ho_Chi_Minh* at dispatch time. The backend is authoritative (never the
browser timezone), `isLastMinute` is persisted at send time and not recomputed on
read, and the receptionist inbox sorts last-minute bookings first.

### Duplicate detection

Sending is refused with `409 DUPLICATE_BOOKING` when another `NEW`/`COMPLETED`/
`ARCHIVED` booking already exists with the same `bookingCode` + `branchId` +
`checkInDate` (the response carries the existing booking id and status).

### Persistent notifications (no realtime yet)

Notifications are stored rows exposed by polling-ready APIs
(`GET /api/notifications`, `/api/notifications/unread-count`,
`POST /api/notifications/:id/read`, `/api/notifications/read-all`); each is scoped
to its owner. **Server-Sent Events / live push are intentionally deferred to a
later phase.**

### History API

`GET /api/bookings/history` supports search (booking code / customer / phone) and
filters (branch, status, payment, last-minute, sent/check-in/completed date
ranges) with pagination; receptionists are always constrained to their own branch.

## Operational app (frontend)

Kas is an internal **booking dispatch centre** — it is **not** a hotel PMS and
never creates hotel reservations. It extracts Booking.com information, dispatches
it to one branch, helps receptionists copy it into their own hotel system, and
records confirmation.

### Vietnamese status labels (UI)

| DB status | UI label |
| --- | --- |
| `DRAFT` | Bản nháp |
| `NEW` | Chờ chi nhánh tạo |
| `COMPLETED` | Đã xác nhận tạo |
| `ARCHIVED` | Đã lưu trữ |

The receptionist action is **“Xác nhận đã tạo”** — meaning *“I have created this
reservation in the hotel system.”* Kas never claims to create the booking itself.

### Admin workflow

Tổng quan (dashboard) → **Nhập đơn Booking.com** (paste → Trích xuất → sửa → chọn
chi nhánh → Gửi) → **Chờ chi nhánh tạo** (monitor) → **Đã xác nhận tạo** →
**Lịch sử**. Account management lives in the account menu (**Quản lý tài khoản**).

### Receptionist workflow

**Đơn mới** (master-detail inbox, auto-refresh every 20s, last-minute first) →
open a booking → copy fields / **Sao chép toàn bộ** → create it in the hotel
system → **Xác nhận đã tạo** (confirmation dialog) → it moves to **Đã xác nhận
tạo**. Receptionists only ever see their own branch.

### LAST MINUTE

🔥 **LAST MINUTE / Nhận phòng hôm nay** = check-in date is today in
Asia/Ho_Chi_Minh (backend authoritative). Shown with a red badge, sorted first in
the inbox, and distinguished in the notification dropdown. No sound, no flashing.

### “Sao chép toàn bộ” (COPY ALL) format

Plain text (no Markdown/HTML/JSON), Vietnamese accents and VND separators
preserved, every room and every expected night listed; missing values show
`Chưa xác định`, a hidden phone shows `(Hiển thị số điện thoại)`:

```
CHI NHÁNH: 05 Trương Định
NAME: Nguyễn Văn A
SDT: 0901234567
MÃ BOOKING: 489234523
GIÁ TIỀN TỔNG: 1.700.000 ₫
NGÀY CHECK IN: Chủ Nhật, 19/07/2026
NGÀY CHECK OUT: Thứ Ba, 21/07/2026
GIÁ TIỀN CHO TỪNG ĐÊM CỦA TỪNG PHÒNG:

PHÒNG 1:
HẠNG PHÒNG: Deluxe Double Room
* Đêm 19/07/2026: 850.000 ₫
* Đêm 20/07/2026: 850.000 ₫

TRẠNG THÁI: PAY AFTER
```

Individual fields and whole-room blocks each have their own **Sao chép** button.

### PWA (installable app)

The client is an installable PWA (`vite-plugin-pwa`): app name **Kas Booking
Dispatch** / short name **Kas**, `display: standalone`, theme `#2563eb`. A
**“Cài ứng dụng”** button appears when the browser offers installation, and a
**“Có phiên bản mới”** prompt appears when an update is ready. The service worker
**precaches static assets only** — it has **no runtime API caching** and never
serves `/api` from cache, so operational data is always live. See
[`docs/pwa-install.md`](docs/pwa-install.md).

### LAN deployment (internal network)

The Admin machine runs the central server; receptionist machines open the Admin
machine's LAN IP in Chrome/Edge. All users share the **one** SQLite database on
the server machine — never copy the `.db` file to each machine. See
[`docs/deployment.md`](docs/deployment.md). Windows Firewall may need the port
allowed. **Back up the server's `data.db` regularly.** No Docker required.

> Accounting / finance / PMS integration and real-time SSE are **future
> extensions**, intentionally not built in this milestone.

## Documentation

- [`docs/deployment.md`](docs/deployment.md) — LAN deployment on Windows + SQLite backup.
- [`docs/pwa-install.md`](docs/pwa-install.md) — installing Kas as a Windows PWA and pinning to the taskbar.

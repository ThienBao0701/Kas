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
npm run dev
```

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

## Documentation

- Setup, local-network deployment and Windows PWA installation instructions: see `docs/` (completed in the final phase).

> Status: project under construction — phases 0–9. This README is completed in Phase 9.

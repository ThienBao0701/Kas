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

## Documentation

- Setup, local-network deployment and Windows PWA installation instructions: see `docs/` (completed in the final phase).

> Status: project under construction — phases 0–9. This README is completed in Phase 9.

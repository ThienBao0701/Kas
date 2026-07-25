# Kas Frontend — UI/UX Notes

This document covers the operational front end (React + Vite + Tailwind in
`client/`). It is intentionally brief; the code is the source of truth.

## Kas is not a hotel PMS

Kas does **not** create reservations. It is an internal **Booking Dispatch
Center**. The Admin pastes Booking.com text, reviews the extracted fields,
picks one branch and sends it down. A branch receptionist then re-creates the
reservation in a **separate** hotel system and returns to Kas to confirm.

Never describe Kas as "creating a booking". The UI uses these labels:

| Status     | Label                | Verification     | Label              |
| ---------- | -------------------- | ---------------- | ------------------ |
| `DRAFT`    | Bản nháp             | `NOT_SUBMITTED`  | Chưa gửi kiểm tra  |
| `NEW`      | Chờ chi nhánh tạo    | `PENDING_REVIEW` | Chờ kiểm tra       |
| `COMPLETED`| Đã xác nhận đúng     | `APPROVED`       | Đã xác nhận đúng   |
| `ARCHIVED` | Đã lưu trữ           | `REJECTED`       | Cần tạo lại        |

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

## Import sources — Booking.com + Agoda tabs

The **Nhập đơn** page (`DispatchPage`) shows two source tabs, **Booking.com** and
**Agoda**. The chosen source is passed to `POST /api/bookings/extract` as
`source`; the backend selects `parseBooking` or `parseAgodaBooking` (same
normalized output) and stamps the booking's `sourcePlatform`. A `SourceBadge`
chip labels each booking across the lists and detail view. Booking.com behaviour
is unchanged.

## Booking business type + branch address (review form)

On the review form (`DispatchPage` stage 2):

- The first field is **"Địa chỉ khách sạn"** — a **read-only** display of the
  selected branch's address (data priority: selected branch → confidently
  suggested branch → empty with the placeholder "Chưa chọn chi nhánh"). It updates
  the instant the Admin changes the branch dropdown.
  The original `hotelName` is kept internally (parser matching/audit) and the real
  `branchId` is dispatched; the send preview reads the branch address.
- A **business-type card** (`BusinessTypeCard`) shows the detected type
  (🟢 Đơn thường / 🟠 Đơn đối tác / ⚪ Chưa xác định) and, when confident,
  "Độ tin cậy loại đơn: X%". For `UNKNOWN` it prompts the Admin to confirm; two
  actions — **Đánh dấu là Đơn thường** / **Đánh dấu là Đơn đối tác** — call the
  admin-only `confirmBusinessType` endpoint. A manual choice persists, overrides
  detection and shows "Admin đã xác nhận". Detection lives server-side; the
  frontend only displays and confirms.

A `BusinessTypeBadge` renders three distinct colour-plus-text states — **ĐƠN
THƯỜNG** (green) / **ĐƠN ĐỐI TÁC** (orange) / **CHƯA XÁC ĐỊNH** (gray) — on the
booking detail header and history/completed rows. Receptionists see only the final
persisted type, never the detection debug.

## Payment wording

`paymentLabel` and `payStatusCopy` render exactly **PAY BEFORE CHECK-IN** /
**PAY AFTER CHECK-IN** everywhere (detail, dispatch select, COPY ALL, history,
completed, proof review); the PMS note's `paymentCode` matches. The DB enum
`PAY_BEFORE` / `PAY_AFTER` is unchanged — this is display-only.

## PMS note — partner + breakfast

`buildPmsNote` line 2 replaces the contact label (`CÓ ZL` / `CÓ WA` / `NO
CONTACT`) with **ĐƠN ĐỐI TÁC** when `businessType === 'PARTNER'`, keeping the
breakfast prefix, date, arrival note and requests (and never the phone). Breakfast
is keyed by the stable branch `code` set `BREAKFAST_BRANCH_CODES`
(LY_TU_TRONG_260 / NGUYEN_TRAI_47A / NGUYEN_THAI_BINH_170), for both DIRECT and
PARTNER.

## History & completed columns

Both history/completed tables add **Hạng phòng (SL)** (from the backend
`roomSummary`, aggregated by persisted room type) and **Giá tổng** (booking-level
`totalAmount`, "Chưa xác định" when null), plus the business-type badge. Tables
scroll horizontally on mobile; booking code, room summary and total are never
dropped.

## Proof image upload (Ctrl+V paste, drag & drop, browse)

The receptionist attaches a proof screenshot through a reusable
`ImageUploadDropzone` (`client/src/components/ImageUploadDropzone.tsx`), used by
both the first submission and the rejected-booking resubmission (inside
`ProofSection`'s `UploadCard`). It supports three input methods:

- **Clipboard paste (Ctrl+V)** — while the upload area is active, a document-level
  paste listener reads the first image item, converts it to a `File`
  (`pasted-proof-<timestamp>.png`), validates and previews it, and shows *"Đã dán
  ảnh từ clipboard."*. Plain-text pastes are ignored; an unsupported clipboard
  image shows *"Clipboard không có ảnh PNG, JPEG hoặc WebP hợp lệ."*. Nothing is
  uploaded automatically — the receptionist reviews the preview and submits.
- **Drag & drop** — dragging highlights the zone (border + "Thả ảnh vào đây"
  label, not colour alone); dropping validates and previews the first image
  (multiple files → *"Chỉ được gửi một ảnh cho mỗi lần xác nhận."* and the first
  is used).
- **Click / keyboard to browse** — the zone is `role="button"`, focusable, and
  opens the native picker on click, Enter or Space (the accessible/mobile
  fallback; the input `accept`s `image/png,image/jpeg,image/webp` so mobile
  gallery/camera works).

**Formats & size:** PNG / JPEG / WebP, max 10 MB — shared constants in
`client/src/lib/imageUpload.ts` mirror the backend limits. **Frontend validation
is UX only; the backend remains authoritative** (magic-byte sniff + MIME + size);
no filename/extension is trusted. Errors: *"Định dạng ảnh không được hỗ trợ."*,
*"Ảnh vượt quá dung lượng tối đa 10 MB."*.

**Preview:** shows the image (aspect-ratio preserved, constrained), filename,
type, size and `W × H` when available, with **Thay ảnh** (replace) and **Xóa ảnh**
(remove). Object URLs are revoked on replace/remove/unmount (no memory leaks).

**Auto-replace (newest wins):** paste, drop and browse all funnel through the same
commit path, so a second Ctrl+V / drop / pick simply **replaces** the current image
— no confirmation dialog, no duplicate preview. The previous object URL is always
revoked before the new one is created, for every input method.

**Zoom viewer:** clicking the preview opens `ImageViewer`
(`client/src/components/ImageViewer.tsx`) — a **view-only** modal that **reuses the
existing preview object URL** (never re-reads the file, recreates the blob, or
re-uploads). Features: zoom presets (100 / 150 / 200 %, fit-width, original size),
mouse-wheel zoom, drag-to-pan when zoomed (grab / grabbing cursor), 90° rotate
left/right, and a **Đặt lại** (reset) to 100 % / 0° / centered. Rotation and zoom
are pure CSS transforms — they never alter the uploaded file. Keyboard: **ESC**
close, **+/-** zoom, **0** reset, **R** rotate right, **L** rotate left; double-tap
toggles fit-width ⇄ original; optional two-finger pinch zoom on touch. Accessible:
`role="dialog"` + `aria-modal`, focus moved to the close button on open and restored
on close, a Tab focus-trap, body-scroll lock while open, and labelled controls.

**Submit:** unchanged endpoint and workflow. The button is disabled without a
valid image or while uploading (shows *"Đang gửi ảnh..."* + spinner, preventing a
duplicate multipart request). On success the existing toast/state transition
applies; on failure the selected image is kept so the receptionist can retry.

## Proof OCR card (admin-only, advisory)

On the Admin proof-review screen, `ProofOcrCard`
(`client/src/components/ProofOcrCard.tsx`, rendered only inside the admin review
card) shows **"Dữ liệu nhận diện từ ảnh"** — what OCR read from the screenshot. It
polls `GET /api/admin/bookings/:id/proofs/:proofId/analyses/latest` while a run is
in progress and stops once terminal. States: **Đang phân tích ảnh…** (pending),
**Đã nhận diện** (completed, with the extracted fields), **Không thể nhận diện**
(failed → check the image manually), **OCR đang tắt** (disabled). Each field shows
its value or *"Không nhận diện được"* plus *"Độ tin cậy OCR: N%"*. A **Phân tích lại
ảnh** button re-runs analysis.

It is **advisory only**: there is deliberately **no ĐÚNG/SAI/MATCH/MISMATCH/CÓ THỂ
DUYỆT** anywhere, and a permanent disclaimer reads *"Kết quả OCR chỉ là dữ liệu
nhận diện từ ảnh. Admin vẫn phải tự kiểm tra ảnh trước khi xác nhận."* Receptionists
never see this card or any raw OCR data — their pending view only says *"Ảnh đã
được hệ thống tiếp nhận."*

## Proof comparison card (admin-only, advisory)

Below the OCR card, `ProofComparisonCard`
(`client/src/components/ProofComparisonCard.tsx`, driven by `useProofComparison`)
shows **"Kết quả đối chiếu"** — the deterministic proof-vs-booking comparison. The
overall banner is one of **✅ KHỚP**, **⚠️ CẦN KIỂM TRA**, **❌ CÓ SAI KHÁC**, or
**◌ CHƯA CÓ KẾT QUẢ** (each with an icon + text, never colour alone; the banner has
an accessible `aria-label`). A table lists every field — *Hạng mục · Kết quả · Admin
gửi · OCR nhận diện* — with the Vietnamese explanation under any non-matching row.
It polls until a result exists, has a **Làm mới** refresh, and shows loading/error
states.

The manual **Đúng — xác nhận** / **Sai — yêu cầu tạo lại** buttons are **never
disabled or auto-clicked** by the comparison. As a safety net, if the overall
result is **CÓ SAI KHÁC** and the Admin clicks approve, one extra confirmation
appears — *"Hệ thống phát hiện thông tin không khớp. Bạn vẫn muốn xác nhận đúng?"* —
which the Admin can proceed through. Receptionists never see the comparison card or
its data.

**Smart explanations (C.3.5).** The card now also shows: a summary counter row
(*Khớp / Cần kiểm tra / Sai khác / Không tìm thấy*) and an operational headline;
per non-matching field a plain-Vietnamese explanation (money/date/night/room-count
deltas, changed booking-code digit), a **Khuyến nghị** hint, an OCR-confidence
label (*Độ tin cậy cao/trung bình/thấp*), and a safe **token diff** for name/room
type where the added/removed words are shown with underline/strike **plus**
screen-reader wording (*"(thêm)" / "(bỏ)"* — colour is never the only signal, and
nothing is rendered as raw HTML). The PMS note is shown as a compact **✓/✕
checklist** (`noteComponents`) instead of two long strings, and a **"Admin nên
kiểm tra"** list collects the de-duplicated checks. MATCH rows stay compact. The
disclaimer is *"Các giải thích và khuyến nghị chỉ mang tính hỗ trợ. Admin phải kiểm
tra ảnh trước khi xác nhận."* All of this is additive and degrades gracefully for
older C.3 comparison rows that lack the smart fields.

## Hotel issue counters (branch command center)

`useIssueSummary` (`client/src/hooks/useIssueSummary.ts`) polls
`GET /api/issues/summary` (shared query key, 20 s) and drives three surfaces:

- **Sidebar badge** on *"Sự cố khách sạn"* / *"Báo cáo sự cố"* — the unresolved
  count (Admin: all branches; receptionist: own branch). Accessible label
  *"N sự cố chưa xử lý"* (the number, not colour, carries the meaning).
- **Dashboard card** *"Sự cố đang mở"* with an *"N mới · M đang xử lý"* breakdown,
  linking to `/app/issues`.
- **Admin Issues page** — a row of per-branch summary cards (all eight branches,
  including zero-count). Each card shows the address, an unresolved badge and
  *"Mới: x · Đang xử lý: y"*, with an accessible label *"N sự cố chưa xử lý tại
  &lt;address&gt;"*. Clicking a card filters the list to that branch (keeping the
  status filter), shows an active-filter banner, and offers **Bỏ lọc chi nhánh** to
  clear it.

Counts always come from `HotelIssue` status (**NEW + IN_PROGRESS**), never from
unread-notification rows, and refresh via polling — **no SSE**.

## Proof verification — "Gửi Admin kiểm tra" → "Đúng / Sai"

Confirmation is no longer a one-click action; it is a proof-reviewed workflow
driven by `ProofSection` (rendered inside `BookingDetailView`), which adapts to
the viewer's role and the booking's `verificationStatus`:

- **Receptionist, `NOT_SUBMITTED` / `REJECTED`** — an upload card. They pick a
  screenshot (PNG/JPEG/WebP, ≤10 MB, validated client-side too), optionally add a
  note, and press **Gửi Admin kiểm tra** (`POST /api/bookings/:id/proofs`,
  multipart via `api.postForm`). On a rejection the reason banner and prior
  attempts are shown so they can resubmit.
- **Receptionist, `PENDING_REVIEW`** — a waiting card with their submitted image.
- **Admin, `PENDING_REVIEW`** — a desktop **LEFT (original booking) / RIGHT
  (screenshot)** comparison with **Đúng — xác nhận** (`…/approve`) and **Sai —
  yêu cầu tạo lại** (`…/reject`, reason-code dialog). Approval moves the booking
  `NEW → COMPLETED` (`APPROVED`); rejection keeps it `NEW` (`REJECTED`).
- **Approved / COMPLETED** — a success card plus the full attempt history.

Proof images load from the authenticated route
`GET /api/bookings/:id/proofs/:proofId/image` (cookie credentials, branch-isolated
on the server); a click opens a full-screen lightbox. The master-detail inbox owns
the toast (`suppressInternalToast`) so it survives the panel advancing to the next
booking after a submission.

The verification lists — **Chờ (Admin) kiểm tra** and **Cần tạo lại** — are a
shared master-detail page (`VerificationBookingsPage`) polling
`/bookings/pending-review` and `/bookings/rejected` every 20s.

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

## Notifications for the proof workflow

All notifications are still stored rows surfaced by polling (no SSE):

- **Submission → admins:** *Có đơn chờ kiểm tra / `[Mã Booking] — [Chi nhánh]`*.
- **Rejection → the submitting receptionist:** *Đơn cần tạo lại / `[Lý do]`*.
- **Approval → the submitting receptionist:** *Đơn đã được xác nhận đúng /
  `[Mã Booking]`*.

## Known limitations / deferred

The front end uses only the APIs that exist. Notable deferrals (intentional):

- **No SSE / live push.** The receptionist inbox, verification lists and the
  notification bell poll every 20s; the selected booking is preserved across
  refreshes and the last good data is never blanked on a failed refresh.
- **No OCR comparison.** Admin proof review is a manual visual LEFT/RIGHT check;
  Kas does not read text out of the screenshot.
- **No external PMS integration.** Kas never creates the reservation itself.
- **Filtered navigation from dashboard counts** relies on `?branchId=` query
  params that the waiting/pending-review/rejected/completed lists read on mount.

## Developer test tools (development only)

When the server enables the dev tools (`ENABLE_DEV_TEST_TOOLS=true`, non-production),
`DevToolsBar` (`client/src/layout/DevToolsBar.tsx`, in the shell under the top bar)
shows a yellow **“CHẾ ĐỘ DỮ LIỆU TEST ĐANG BẬT”** banner for everyone, plus a
**“Chi nhánh đang test”** branch switcher **only** for the `reception_test` account —
changing it invalidates every branch-scoped query so all lists/counters/notifications
refresh with no logout. `useDevTools` reads `GET /api/dev-test/status`, which resolves
to *disabled* (the endpoint 404s) when the tools are off, so no dev UI ever appears by
accident. Admins additionally get a **“Công cụ dữ liệu test”** panel in Settings
(`DevToolsPanel`) to generate demo data and clear it (two-step, typed-phrase
`XOA DU LIEU DEMO`). Ordinary receptionists see none of this. See
[`testing-8-branches.md`](testing-8-branches.md).

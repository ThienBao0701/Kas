/** Formatting helpers shared across the operational screens. */

const vndFormatter = new Intl.NumberFormat('vi-VN');

/** Whole VND with a đồng sign, or a dash when unknown. Money is never invented. */
export function formatMoney(amount: number | null | undefined, currency = 'VND'): string {
  if (amount === null || amount === undefined) return '—';
  if (currency === 'VND') return `${vndFormatter.format(amount)} ₫`;
  return `${vndFormatter.format(amount)} ${currency}`;
}

/** ISO "YYYY-MM-DD" -> "DD/MM/YYYY". */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

/** ISO datetime -> "DD/MM/YYYY HH:mm" in the viewer's locale time. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const HCM_OFFSET_MS = 7 * 60 * 60 * 1000;

/** Today's calendar date in Asia/Ho_Chi_Minh, as ISO "YYYY-MM-DD". */
export function hcmToday(now: Date = new Date()): string {
  return new Date(now.getTime() + HCM_OFFSET_MS).toISOString().slice(0, 10);
}

/** True when an ISO date equals today in Asia/Ho_Chi_Minh. */
export function isTodayHcm(iso: string | null | undefined): boolean {
  return !!iso && iso.slice(0, 10) === hcmToday();
}

/** Number of nights between two ISO dates (check-out exclusive). */
export function nightCount(checkIn: string | null, checkOut: string | null): number {
  if (!checkIn || !checkOut) return 0;
  const ms = new Date(`${checkOut}T00:00:00Z`).getTime() - new Date(`${checkIn}T00:00:00Z`).getTime();
  return ms > 0 ? Math.round(ms / 86_400_000) : 0;
}

const PAYMENT_LABELS: Record<string, string> = {
  PAY_BEFORE: 'Đã thanh toán',
  PAY_AFTER: 'Thanh toán tại khách sạn',
};

export function paymentLabel(status: string | null | undefined): string {
  return status ? (PAYMENT_LABELS[status] ?? status) : '—';
}

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Bản nháp',
  READY: 'Sẵn sàng',
  NEW: 'Chờ chi nhánh tạo',
  COMPLETED: 'Đã xác nhận tạo',
  ARCHIVED: 'Đã lưu trữ',
};

export function statusLabel(status: string | null | undefined): string {
  return status ? (STATUS_LABELS[status] ?? status) : '—';
}

/** Short relative time in Vietnamese, e.g. "vừa xong", "5 phút trước". */
export function relativeTime(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const diffSec = Math.round((now.getTime() - then) / 1000);
  if (diffSec < 45) return 'vừa xong';
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin} phút trước`;
  const diffHour = Math.round(diffMin / 60);
  if (diffHour < 24) return `${diffHour} giờ trước`;
  const diffDay = Math.round(diffHour / 24);
  if (diffDay < 30) return `${diffDay} ngày trước`;
  return formatDate(iso);
}

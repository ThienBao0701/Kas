import {
  Building2,
  CheckCircle2,
  ClipboardPaste,
  FileText,
  History,
  Inbox,
  LayoutDashboard,
  RotateCcw,
  ScanSearch,
  Users,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import type { UserRole } from '../auth/types';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

/** Admin operates the whole dispatch centre and reviews creation proofs. */
export const ADMIN_NAV: NavItem[] = [
  { to: '/app/dashboard', label: 'Tổng quan', icon: LayoutDashboard },
  { to: '/app/dispatch', label: 'Nhập đơn', icon: ClipboardPaste },
  { to: '/app/waiting', label: 'Chờ chi nhánh tạo', icon: Inbox },
  { to: '/app/pending-review', label: 'Chờ kiểm tra', icon: ScanSearch },
  { to: '/app/rejected', label: 'Cần tạo lại', icon: RotateCcw },
  { to: '/app/completed', label: 'Đã xác nhận đúng', icon: CheckCircle2 },
  { to: '/app/history', label: 'Lịch sử', icon: History },
  { to: '/app/issues', label: 'Sự cố khách sạn', icon: Wrench },
  { to: '/app/charge-documents', label: 'Chứng từ', icon: FileText },
  { to: '/app/branches', label: 'Khách sạn & chi nhánh', icon: Building2 },
  { to: '/app/settings', label: 'Quản lý tài khoản', icon: Users },
];

/**
 * Bộ phận đặt phòng works on charge documents and nothing else.
 *
 * A short menu on purpose: this role is global (no branch), so every other
 * screen either belongs to a branch it does not have or is admin-only.
 */
export const BOOKING_DEPARTMENT_NAV: NavItem[] = [
  { to: '/app/charge-documents', label: 'Chứng từ', icon: FileText },
];

/** Receptionist creates externally, uploads proof, then tracks the verdict. */
export const RECEPTIONIST_NAV: NavItem[] = [
  { to: '/app/new', label: 'Đơn mới', icon: Inbox },
  { to: '/app/pending-review', label: 'Chờ Admin kiểm tra', icon: ScanSearch },
  { to: '/app/rejected', label: 'Cần tạo lại', icon: RotateCcw },
  { to: '/app/completed', label: 'Đã xác nhận đúng', icon: CheckCircle2 },
  { to: '/app/history', label: 'Lịch sử', icon: History },
  { to: '/app/issues', label: 'Báo cáo sự cố', icon: Wrench },
];

export function navForRole(role: UserRole | undefined): NavItem[] {
  if (role === 'ADMIN') return ADMIN_NAV;
  if (role === 'BOOKING_DEPARTMENT') return BOOKING_DEPARTMENT_NAV;
  // Receptionist, and anything unrecognised: never the Chứng từ menu.
  return RECEPTIONIST_NAV;
}

/** Human title for the current route, used as the topbar heading. */
export function titleForPath(pathname: string): string {
  if (pathname.startsWith('/app/booking/')) return 'Chi tiết đơn';
  if (pathname.startsWith('/app/charge-documents/')) return 'Chi tiết chứng từ';
  const all = [...ADMIN_NAV, ...RECEPTIONIST_NAV, ...BOOKING_DEPARTMENT_NAV];
  const match = all
    .slice()
    .sort((a, b) => b.to.length - a.to.length)
    .find((item) => pathname.startsWith(item.to));
  return match?.label ?? 'Kas — Điều phối đặt phòng';
}

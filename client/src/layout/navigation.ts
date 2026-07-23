import {
  CheckCircle2,
  ClipboardPaste,
  History,
  Inbox,
  LayoutDashboard,
  RotateCcw,
  ScanSearch,
  Users,
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
  { to: '/app/settings', label: 'Quản lý tài khoản', icon: Users },
];

/** Receptionist creates externally, uploads proof, then tracks the verdict. */
export const RECEPTIONIST_NAV: NavItem[] = [
  { to: '/app/new', label: 'Đơn mới', icon: Inbox },
  { to: '/app/pending-review', label: 'Chờ Admin kiểm tra', icon: ScanSearch },
  { to: '/app/rejected', label: 'Cần tạo lại', icon: RotateCcw },
  { to: '/app/completed', label: 'Đã xác nhận đúng', icon: CheckCircle2 },
  { to: '/app/history', label: 'Lịch sử', icon: History },
];

export function navForRole(role: UserRole | undefined): NavItem[] {
  return role === 'ADMIN' ? ADMIN_NAV : RECEPTIONIST_NAV;
}

/** Human title for the current route, used as the topbar heading. */
export function titleForPath(pathname: string): string {
  if (pathname.startsWith('/app/booking/')) return 'Chi tiết đơn';
  const all = [...ADMIN_NAV, ...RECEPTIONIST_NAV];
  const match = all
    .slice()
    .sort((a, b) => b.to.length - a.to.length)
    .find((item) => pathname.startsWith(item.to));
  return match?.label ?? 'Kas — Điều phối đặt phòng';
}

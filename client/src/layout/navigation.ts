import {
  CheckCircle2,
  FilePlus2,
  History,
  Inbox,
  LayoutDashboard,
  type LucideIcon,
} from 'lucide-react';
import type { UserRole } from '../auth/types';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

/** Admin operational menu (account/management lives in the account dropdown). */
export const ADMIN_NAV: NavItem[] = [
  { to: '/app/dashboard', label: 'Tổng quan', icon: LayoutDashboard },
  { to: '/app/dispatch', label: 'Nhập đơn Booking.com', icon: FilePlus2 },
  { to: '/app/waiting', label: 'Chờ chi nhánh tạo', icon: Inbox },
  { to: '/app/completed', label: 'Đã xác nhận tạo', icon: CheckCircle2 },
  { to: '/app/history', label: 'Lịch sử', icon: History },
];

/** Receptionist receives, opens, copies and confirms — three items only. */
export const RECEPTIONIST_NAV: NavItem[] = [
  { to: '/app/new', label: 'Đơn mới', icon: Inbox },
  { to: '/app/completed', label: 'Đã xác nhận tạo', icon: CheckCircle2 },
  { to: '/app/history', label: 'Lịch sử', icon: History },
];

export function navForRole(role: UserRole | undefined): NavItem[] {
  return role === 'ADMIN' ? ADMIN_NAV : RECEPTIONIST_NAV;
}

const EXTRA_TITLES: { to: string; label: string }[] = [
  { to: '/app/settings', label: 'Quản lý tài khoản' },
  { to: '/app/booking/', label: 'Chi tiết đơn' },
];

/** Human title for the current route, used as the topbar heading. */
export function titleForPath(pathname: string): string {
  const all = [...ADMIN_NAV, ...RECEPTIONIST_NAV, ...EXTRA_TITLES];
  const match = all
    .slice()
    .sort((a, b) => b.to.length - a.to.length)
    .find((item) => pathname.startsWith(item.to));
  return match?.label ?? 'Kas — Điều phối đặt phòng';
}

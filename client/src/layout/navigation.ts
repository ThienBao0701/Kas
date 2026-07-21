import {
  CheckCircle2,
  FilePlus2,
  History,
  Inbox,
  LayoutDashboard,
  Settings,
  type LucideIcon,
} from 'lucide-react';
import type { UserRole } from '../auth/types';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

/** Admin operates the whole dispatch centre. */
export const ADMIN_NAV: NavItem[] = [
  { to: '/app/dashboard', label: 'Tổng quan', icon: LayoutDashboard },
  { to: '/app/dispatch', label: 'Tạo đơn mới', icon: FilePlus2 },
  { to: '/app/waiting', label: 'Chờ xác nhận', icon: Inbox },
  { to: '/app/completed', label: 'Đã xác nhận', icon: CheckCircle2 },
  { to: '/app/history', label: 'Lịch sử', icon: History },
  { to: '/app/settings', label: 'Cài đặt', icon: Settings },
];

/** Receptionist only receives, opens, copies and confirms. */
export const RECEPTIONIST_NAV: NavItem[] = [
  { to: '/app/new', label: 'Đơn mới', icon: Inbox },
  { to: '/app/completed', label: 'Đã hoàn thành', icon: CheckCircle2 },
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

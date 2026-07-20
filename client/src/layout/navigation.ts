import {
  CheckCircle2,
  FilePlus2,
  History,
  Inbox,
  Users,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

/** Primary navigation, shown to every authenticated role. */
export const PRIMARY_NAV: NavItem[] = [
  { to: '/app/new', label: 'Đơn mới', icon: Inbox },
  { to: '/app/completed', label: 'Đã hoàn thành', icon: CheckCircle2 },
  { to: '/app/history', label: 'Lịch sử', icon: History },
];

/** Secondary navigation, shown only to ADMIN. */
export const ADMIN_NAV: NavItem[] = [
  { to: '/app/extract', label: 'Tạo đơn / Extract', icon: FilePlus2 },
  { to: '/app/users', label: 'Quản lý tài khoản', icon: Users },
];

/** Human title for the current route, used as the topbar heading. */
export function titleForPath(pathname: string): string {
  const match = [...PRIMARY_NAV, ...ADMIN_NAV].find((item) =>
    pathname.startsWith(item.to),
  );
  return match?.label ?? 'Hotel Booking Dispatch';
}

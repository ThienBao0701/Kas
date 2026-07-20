import { ShieldAlert } from 'lucide-react';
import { EmptyState } from '../components/EmptyState';

export function ForbiddenPage() {
  return (
    <EmptyState
      icon={<ShieldAlert className="h-6 w-6" aria-hidden="true" />}
      title="Không có quyền truy cập"
      message="Bạn không có quyền mở khu vực này. Vui lòng liên hệ quản trị viên nếu cần."
    />
  );
}

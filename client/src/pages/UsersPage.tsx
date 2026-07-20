import { Users } from 'lucide-react';
import { EmptyState } from '../components/EmptyState';

export function UsersPage() {
  return (
    <EmptyState
      icon={<Users className="h-6 w-6" aria-hidden="true" />}
      title="Quản lý tài khoản"
      message="Giao diện quản lý tài khoản sẽ được kết nối trong phase tiếp theo."
    />
  );
}

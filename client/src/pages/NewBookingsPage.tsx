import { Inbox } from 'lucide-react';
import { EmptyState } from '../components/EmptyState';

export function NewBookingsPage() {
  return (
    <EmptyState
      icon={<Inbox className="h-6 w-6" aria-hidden="true" />}
      title="Đơn mới"
      message="Chưa có đơn mới được gửi đến."
    />
  );
}

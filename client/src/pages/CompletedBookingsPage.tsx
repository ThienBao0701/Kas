import { CheckCircle2 } from 'lucide-react';
import { EmptyState } from '../components/EmptyState';

export function CompletedBookingsPage() {
  return (
    <EmptyState
      icon={<CheckCircle2 className="h-6 w-6" aria-hidden="true" />}
      title="Đã hoàn thành"
      message="Chưa có đơn nào được hoàn thành."
    />
  );
}

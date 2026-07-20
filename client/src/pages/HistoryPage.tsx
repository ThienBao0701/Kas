import { History } from 'lucide-react';
import { EmptyState } from '../components/EmptyState';

export function HistoryPage() {
  return (
    <EmptyState
      icon={<History className="h-6 w-6" aria-hidden="true" />}
      title="Lịch sử"
      message="Dữ liệu lịch sử sẽ xuất hiện tại đây."
    />
  );
}

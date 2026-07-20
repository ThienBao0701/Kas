import { FilePlus2 } from 'lucide-react';
import { EmptyState } from '../components/EmptyState';

export function ExtractPage() {
  return (
    <EmptyState
      icon={<FilePlus2 className="h-6 w-6" aria-hidden="true" />}
      title="Tạo đơn / Extract"
      message="Công cụ trích xuất Booking.com sẽ được triển khai trong phase tiếp theo."
    />
  );
}

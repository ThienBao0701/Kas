import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { bookingsApi } from '../api/bookings';
import { toUserMessage } from '../api/errors';
import { ErrorAlert } from '../components/ErrorAlert';
import { InlineSpinner } from '../components/PageState';
import { BookingDetailView } from '../components/BookingDetailView';

export function BookingDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();

  const query = useQuery({
    queryKey: ['booking', id],
    queryFn: () => bookingsApi.detail(id),
    enabled: id.length > 0,
  });

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-700"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Quay lại
      </button>

      {query.isLoading ? (
        <InlineSpinner />
      ) : query.isError ? (
        <ErrorAlert>{toUserMessage(query.error)}</ErrorAlert>
      ) : (
        <BookingDetailView booking={query.data!.booking} />
      )}
    </div>
  );
}

import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { Button } from '../components/Button';

export function NotFoundPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-100 px-6 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600">
        <Compass className="h-6 w-6" aria-hidden="true" />
      </div>
      <div>
        <h1 className="text-xl font-semibold text-slate-800">Không tìm thấy trang</h1>
        <p className="mt-1 text-sm text-slate-500">
          Đường dẫn bạn truy cập không tồn tại.
        </p>
      </div>
      <Link to="/app/new">
        <Button>Về trang chính</Button>
      </Link>
    </div>
  );
}

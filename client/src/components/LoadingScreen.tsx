import { Loader2 } from 'lucide-react';

export function LoadingScreen({ message = 'Đang tải...' }: { message?: string }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-100 text-slate-600">
      <Loader2 className="h-8 w-8 animate-spin text-brand-600" aria-hidden="true" />
      <p className="text-sm" role="status">
        {message}
      </p>
    </div>
  );
}

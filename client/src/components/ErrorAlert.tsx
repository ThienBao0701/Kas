import { AlertCircle } from 'lucide-react';
import type { ReactNode } from 'react';

export function ErrorAlert({ children }: { children: ReactNode }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700"
    >
      <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}

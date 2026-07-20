import type { ReactNode } from 'react';

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  message: string;
  action?: ReactNode;
}

export function EmptyState({ icon, title, message, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
      {icon ? (
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600">
          {icon}
        </div>
      ) : null}
      <h2 className="text-lg font-semibold text-slate-800">{title}</h2>
      <p className="mt-1 max-w-md text-sm text-slate-500">{message}</p>
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}

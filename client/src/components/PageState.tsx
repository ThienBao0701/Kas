import { Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { toUserMessage } from '../api/errors';
import { ErrorAlert } from './ErrorAlert';

export function InlineSpinner({ label = 'Đang tải…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500">
      <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

interface QueryStateProps {
  isLoading: boolean;
  isError: boolean;
  error?: unknown;
  children: ReactNode;
}

/** Renders a spinner while loading, an error alert on failure, else the content. */
export function QueryState({ isLoading, isError, error, children }: QueryStateProps) {
  if (isLoading) return <InlineSpinner />;
  if (isError) return <ErrorAlert>{toUserMessage(error)}</ErrorAlert>;
  return <>{children}</>;
}

/** A page heading with an optional description and right-aligned actions. */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
        {description ? <p className="mt-1 text-sm text-slate-500">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

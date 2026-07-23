import { Check, Copy } from 'lucide-react';
import { useCopy } from '../lib/copy';

interface CopyButtonProps {
  value: string;
  /** Accessible label, e.g. "Sao chép tên khách". */
  label: string;
  /** Visible button text; defaults to "Sao chép". */
  text?: string;
  /** When set, the control is disabled and explains why (accessible title). */
  disabled?: boolean;
  disabledReason?: string;
  className?: string;
}

/** A compact copy control that briefly confirms with "Đã sao chép". */
export function CopyButton({ value, label, text = 'Sao chép', disabled = false, disabledReason, className = '' }: CopyButtonProps) {
  const { copied, copy } = useCopy();
  return (
    <button
      type="button"
      onClick={() => copy(value)}
      disabled={disabled}
      aria-label={label}
      title={disabled ? disabledReason ?? label : label}
      className={`inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent ${className}`}
    >
      {copied ? (
        <>
          <Check className="h-3.5 w-3.5 text-green-600" aria-hidden="true" />
          <span className="text-green-700">Đã sao chép</span>
        </>
      ) : (
        <>
          <Copy className="h-3.5 w-3.5" aria-hidden="true" />
          <span>{text}</span>
        </>
      )}
    </button>
  );
}

interface CopyFieldProps {
  label: string;
  value: string | null | undefined;
  /** The exact text to copy; defaults to the displayed value. */
  copyValue?: string;
  mono?: boolean;
}

/**
 * A labelled read-only field with its own Copy button — the core receptionist
 * primitive so any single piece of a booking can be copied in one click.
 */
export function CopyField({ label, value, copyValue, mono = false }: CopyFieldProps) {
  const display = value && value.length > 0 ? value : '—';
  const canCopy = !!value && value.length > 0;
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2.5">
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
        <p className={`mt-0.5 break-words text-base font-medium text-slate-900 ${mono ? 'font-mono' : ''}`}>{display}</p>
      </div>
      {canCopy ? <CopyButton value={copyValue ?? value} label={`Sao chép ${label}`} className="flex-shrink-0" /> : null}
    </div>
  );
}

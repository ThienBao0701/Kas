import { useState } from 'react';
import { Download, Info } from 'lucide-react';
import { installBlockMessage } from './installability';
import { useInstallPrompt } from './useInstallPrompt';

/**
 * The reusable install affordance.
 *
 * Three states, and the middle one is the reason this component exists:
 *
 *   installable      — a button that opens the browser's install dialog;
 *   blocked, and the
 *   operator can act — a short explanation of why installation is impossible;
 *   nothing to say   — renders null.
 *
 * An operator on `http://<lan-ip>:3001` gets the explanation rather than an
 * empty corner of the screen. Silence there costs a support call and an
 * afternoon of debugging the manifest, which is not where the problem is.
 */
export function InstallButton({ className = '' }: { className?: string }) {
  const { canInstall, reason, promptInstall } = useInstallPrompt();
  const [busy, setBusy] = useState(false);
  const message = installBlockMessage(reason);

  if (canInstall) {
    return (
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          // Guard inside the handler: a double click must not open two dialogs.
          if (busy) return;
          setBusy(true);
          void promptInstall().finally(() => setBusy(false));
        }}
        data-testid="pwa-install-button"
        className={`inline-flex min-h-[2.75rem] items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 shadow-lg hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 disabled:opacity-60 ${className}`}
      >
        <Download className="h-4 w-4 text-brand-600" aria-hidden="true" />
        Cài ứng dụng
      </button>
    );
  }

  if (message) {
    return (
      <div
        role="note"
        data-testid="pwa-install-blocked"
        className={`max-w-sm rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 shadow-lg ${className}`}
      >
        <div className="flex gap-2">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>{message}</p>
        </div>
      </div>
    );
  }

  return null;
}

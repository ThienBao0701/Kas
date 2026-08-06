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
/**
 * `card` — the floating affordance in the screen corner (PwaManager).
 * `inline` — sits in the top bar, where every Admin and Reception screen has
 *   it in reach. The explanation paragraph is suppressed there: a 64px bar is
 *   no place for three lines of prose, and the floating card already carries
 *   it on the same page.
 */
export type InstallButtonVariant = 'card' | 'inline';

export function InstallButton({
  className = '',
  variant = 'card',
}: {
  className?: string;
  variant?: InstallButtonVariant;
}) {
  const { canInstall, reason, promptInstall } = useInstallPrompt();
  const [busy, setBusy] = useState(false);
  const message = installBlockMessage(reason);

  if (canInstall) {
    const shape =
      variant === 'inline'
        ? 'rounded-xl border-brand-200 bg-brand-50 px-3 text-brand-700 hover:bg-brand-100'
        : 'rounded-2xl border-slate-200 bg-white px-4 text-slate-700 shadow-lg hover:bg-slate-50';
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
        className={`inline-flex min-h-[2.75rem] items-center gap-2 border text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 disabled:opacity-60 ${shape} ${className}`}
      >
        <Download className="h-4 w-4 text-brand-600" aria-hidden="true" />
        Tải ứng dụng
      </button>
    );
  }

  // In the bar, an impossible install is simply absent — the floating card on
  // the same page states the reason once, and saying it twice is noise.
  if (variant === 'inline') return null;

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

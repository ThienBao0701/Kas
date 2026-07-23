import { useEffect, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { Download, RefreshCw, X } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * PWA install + update surface. Mounted once from main.tsx (outside the test
 * tree), so the virtual SW module is never pulled into unit tests.
 *
 * - "Cài ứng dụng" appears only when the browser fires beforeinstallprompt.
 * - "Có phiên bản mới" appears when the service worker has an update ready.
 * The service worker only precaches static assets, so no API data is cached.
 */
export function PwaManager() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const { needRefresh, updateServiceWorker } = useRegisterSW();
  const [needsUpdate, setNeedsUpdate] = needRefresh;

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setInstallEvent(null);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const install = async () => {
    if (!installEvent) return;
    await installEvent.prompt();
    await installEvent.userChoice;
    setInstallEvent(null);
  };

  if (needsUpdate) {
    return (
      <div className="fixed bottom-4 left-4 z-[70] flex items-center gap-3 rounded-2xl border border-brand-200 bg-white px-4 py-3 shadow-lg">
        <RefreshCw className="h-5 w-5 text-brand-600" aria-hidden="true" />
        <div className="text-sm">
          <p className="font-semibold text-slate-800">Có phiên bản mới</p>
          <p className="text-slate-500">Tải lại để cập nhật Kas.</p>
        </div>
        <button
          type="button"
          onClick={() => void updateServiceWorker(true)}
          className="rounded-xl bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
        >
          Cập nhật
        </button>
        <button type="button" onClick={() => setNeedsUpdate(false)} aria-label="Bỏ qua" className="text-slate-400 hover:text-slate-600">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    );
  }

  if (installEvent) {
    return (
      <button
        type="button"
        onClick={() => void install()}
        className="fixed bottom-4 left-4 z-[70] inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-lg hover:bg-slate-50"
      >
        <Download className="h-4 w-4 text-brand-600" aria-hidden="true" />
        Cài ứng dụng
      </button>
    );
  }

  return null;
}

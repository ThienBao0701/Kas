import { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';

/**
 * A slim banner shown when the browser reports it is offline. Operational data
 * already on screen stays visible; this only warns that it may be stale.
 */
export function OfflineIndicator() {
  const [offline, setOffline] = useState(() => typeof navigator !== 'undefined' && !navigator.onLine);

  useEffect(() => {
    const goOnline = () => setOffline(false);
    const goOffline = () => setOffline(true);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  if (!offline) return null;

  return (
    <div role="alert" className="flex items-center justify-center gap-2 bg-amber-500 px-4 py-1.5 text-sm font-medium text-white">
      <WifiOff className="h-4 w-4" aria-hidden="true" />
      Mất kết nối mạng — dữ liệu có thể chưa được cập nhật.
    </div>
  );
}

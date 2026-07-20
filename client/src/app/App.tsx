import { AlertTriangle } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { LoadingScreen } from '../components/LoadingScreen';
import { Button } from '../components/Button';
import { AppRoutes } from './router';

function ConnectionErrorScreen({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-100 px-6 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-600">
        <AlertTriangle className="h-6 w-6" aria-hidden="true" />
      </div>
      <div>
        <h1 className="text-lg font-semibold text-slate-800">Mất kết nối máy chủ</h1>
        <p className="mt-1 max-w-sm text-sm text-slate-500" role="alert">
          Không thể kết nối đến máy chủ. Vui lòng kiểm tra kết nối và thử lại.
        </p>
      </div>
      <Button onClick={onRetry}>Thử lại</Button>
    </div>
  );
}

export function App() {
  const { isLoading, isError, refreshUser } = useAuth();

  // Do not flash login or the shell while the initial /api/auth/me resolves.
  if (isLoading) {
    return <LoadingScreen message="Đang tải ứng dụng..." />;
  }

  // A 401 resolves to "not signed in" (handled in the provider); reaching here
  // means a real connection/server failure, so offer a retry.
  if (isError) {
    return (
      <ConnectionErrorScreen
        onRetry={() => {
          void refreshUser();
        }}
      />
    );
  }

  return <AppRoutes />;
}

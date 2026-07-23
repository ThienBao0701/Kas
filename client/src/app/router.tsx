import { Navigate, Route, Routes } from 'react-router-dom';
import { LoginPage } from '../auth/LoginPage';
import { ChangePasswordPage } from '../auth/ChangePasswordPage';
import { PublicOnly, RequireAuth, RequirePasswordChange, RequireRole } from '../auth/ProtectedRoute';
import { useAuth } from '../auth/AuthProvider';
import { AppShell } from '../layout/AppShell';
import { DashboardPage } from '../pages/DashboardPage';
import { DispatchPage } from '../pages/DispatchPage';
import { NewBookingsPage } from '../pages/NewBookingsPage';
import { PendingReviewPage, RejectedPage } from '../pages/VerificationBookingsPage';
import { CompletedBookingsPage } from '../pages/CompletedBookingsPage';
import { HistoryPage } from '../pages/HistoryPage';
import { BookingDetailPage } from '../pages/BookingDetailPage';
import { SettingsPage } from '../pages/SettingsPage';
import { NotFoundPage } from '../pages/NotFoundPage';

/** Sends each role to its natural landing page. */
function RoleLanding() {
  const { user } = useAuth();
  return <Navigate to={user?.role === 'ADMIN' ? '/app/dashboard' : '/app/new'} replace />;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <PublicOnly>
            <LoginPage />
          </PublicOnly>
        }
      />
      <Route
        path="/change-password"
        element={
          <RequirePasswordChange>
            <ChangePasswordPage />
          </RequirePasswordChange>
        }
      />

      <Route element={<RequireAuth />}>
        <Route path="/app" element={<AppShell />}>
          <Route index element={<RoleLanding />} />
          <Route path="dashboard" element={<RequireRole role="ADMIN"><DashboardPage /></RequireRole>} />
          <Route path="dispatch" element={<RequireRole role="ADMIN"><DispatchPage /></RequireRole>} />
          <Route path="waiting" element={<RequireRole role="ADMIN"><NewBookingsPage /></RequireRole>} />
          <Route path="new" element={<NewBookingsPage />} />
          <Route path="pending-review" element={<PendingReviewPage />} />
          <Route path="rejected" element={<RejectedPage />} />
          <Route path="completed" element={<CompletedBookingsPage />} />
          <Route path="history" element={<HistoryPage />} />
          <Route path="booking/:id" element={<BookingDetailPage />} />
          <Route path="settings" element={<RequireRole role="ADMIN"><SettingsPage /></RequireRole>} />
        </Route>
      </Route>

      <Route path="/" element={<Navigate to="/app" replace />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

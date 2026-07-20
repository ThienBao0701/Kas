import { Navigate, Route, Routes } from 'react-router-dom';
import { LoginPage } from '../auth/LoginPage';
import { ChangePasswordPage } from '../auth/ChangePasswordPage';
import {
  PublicOnly,
  RequireAuth,
  RequirePasswordChange,
  RequireRole,
} from '../auth/ProtectedRoute';
import { AppShell } from '../layout/AppShell';
import { NewBookingsPage } from '../pages/NewBookingsPage';
import { CompletedBookingsPage } from '../pages/CompletedBookingsPage';
import { HistoryPage } from '../pages/HistoryPage';
import { ExtractPage } from '../pages/ExtractPage';
import { UsersPage } from '../pages/UsersPage';
import { NotFoundPage } from '../pages/NotFoundPage';

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
          <Route index element={<Navigate to="/app/new" replace />} />
          <Route path="new" element={<NewBookingsPage />} />
          <Route path="completed" element={<CompletedBookingsPage />} />
          <Route path="history" element={<HistoryPage />} />
          <Route
            path="extract"
            element={
              <RequireRole role="ADMIN">
                <ExtractPage />
              </RequireRole>
            }
          />
          <Route
            path="users"
            element={
              <RequireRole role="ADMIN">
                <UsersPage />
              </RequireRole>
            }
          />
        </Route>
      </Route>

      <Route path="/" element={<Navigate to="/app/new" replace />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

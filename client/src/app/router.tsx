import { Navigate, Route, Routes } from 'react-router-dom';
import { LoginPage } from '../auth/LoginPage';
import { ChangePasswordPage } from '../auth/ChangePasswordPage';
import { PublicOnly, RequireAuth, RequirePasswordChange, RequireRole } from '../auth/ProtectedRoute';
import { useAuth } from '../auth/AuthProvider';
import type { UserRole } from '../auth/types';
import { AppShell } from '../layout/AppShell';
import { ChargeDocumentsPage } from '../pages/ChargeDocumentsPage';
import { ChatBoxPage } from '../pages/ChatBoxPage';
import { ChatConversationPage } from '../pages/ChatConversationPage';
import { ChargeDocumentDetailPage } from '../pages/ChargeDocumentDetailPage';
import { ChargeReportPage } from '../pages/ChargeReportPage';

/** The two roles Chứng từ is for. Mirrors the server's route gate. */
const CHARGE_ROLES: readonly UserRole[] = ['ADMIN', 'BOOKING_DEPARTMENT'];
/**
 * Chat box is reception↔Admin correspondence. Bộ phận đặt phòng has no stated
 * part in it, so it is excluded here as it is on the API — this gate only
 * renders a forbidden page; the server is the security boundary.
 */
const CHAT_ROLES: readonly UserRole[] = ['ADMIN', 'RECEPTIONIST'];
import { DashboardPage } from '../pages/DashboardPage';
import { DispatchPage } from '../pages/DispatchPage';
import { NewBookingsPage } from '../pages/NewBookingsPage';
import { PendingReviewPage, RejectedPage } from '../pages/VerificationBookingsPage';
import { CompletedBookingsPage } from '../pages/CompletedBookingsPage';
import { HistoryPage } from '../pages/HistoryPage';
import { IssuesPage } from '../pages/IssuesPage';
import { BookingDetailPage } from '../pages/BookingDetailPage';
import { SettingsPage } from '../pages/SettingsPage';
import { BranchesPage } from '../pages/BranchesPage';
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
          <Route path="issues" element={<IssuesPage />} />
          <Route path="booking/:id" element={<BookingDetailPage />} />
          {/*
            Chứng từ. Reception is refused here AND by the API — this gate only
            renders a forbidden page; the server is the security boundary.
          */}
          <Route
            path="charge-documents"
            element={
              <RequireRole role={CHARGE_ROLES}>
                <ChargeDocumentsPage />
              </RequireRole>
            }
          />
          <Route
            path="charge-documents/report"
            element={
              <RequireRole role={CHARGE_ROLES}>
                <ChargeReportPage />
              </RequireRole>
            }
          />
          <Route
            path="charge-documents/:id"
            element={
              <RequireRole role={CHARGE_ROLES}>
                <ChargeDocumentDetailPage />
              </RequireRole>
            }
          />
          <Route
            path="chat"
            element={
              <RequireRole role={CHAT_ROLES}>
                <ChatBoxPage />
              </RequireRole>
            }
          />
          <Route
            path="chat/:id"
            element={
              <RequireRole role={CHAT_ROLES}>
                <ChatConversationPage />
              </RequireRole>
            }
          />
          <Route path="branches" element={<RequireRole role="ADMIN"><BranchesPage /></RequireRole>} />
          <Route path="settings" element={<RequireRole role="ADMIN"><SettingsPage /></RequireRole>} />
        </Route>
      </Route>

      <Route path="/" element={<Navigate to="/app" replace />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

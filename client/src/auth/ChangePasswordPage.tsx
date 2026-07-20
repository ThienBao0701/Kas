import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, KeyRound, LogOut } from 'lucide-react';
import { useAuth } from './AuthProvider';
import { authApi } from './api';
import { ApiError, NetworkError } from '../api/errors';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { PasswordInput } from '../components/PasswordInput';
import { ErrorAlert } from '../components/ErrorAlert';

// Client-side mirror of the backend password policy (min 8, a letter, a number),
// plus a confirmation match. The backend remains the authoritative validator.
const schema = z
  .object({
    currentPassword: z.string().min(1, 'Vui lòng nhập mật khẩu hiện tại.'),
    newPassword: z
      .string()
      .min(8, 'Mật khẩu phải có ít nhất 8 ký tự.')
      .regex(/[A-Za-z]/, 'Mật khẩu phải chứa ít nhất một chữ cái.')
      .regex(/[0-9]/, 'Mật khẩu phải chứa ít nhất một chữ số.'),
    confirmPassword: z.string().min(1, 'Vui lòng xác nhận mật khẩu mới.'),
  })
  .refine((values) => values.newPassword === values.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Mật khẩu xác nhận không khớp.',
  });

type FormValues = z.infer<typeof schema>;

export function ChangePasswordPage() {
  const { user, refreshUser, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // Forced when the account still owes a password change; otherwise this is a
  // voluntary change opened from the account menu.
  const isForced = Boolean(user?.mustChangePassword);

  // Where a voluntary change / cancel returns to (the page the user came from).
  const returnTo = (location.state as { from?: string } | null)?.from ?? '/app/new';

  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [awaitingForcedRedirect, setAwaitingForcedRedirect] = useState(false);

  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });

  // Race-free forced exit: once the refreshed user reports the flag cleared,
  // leave for the app. Running in an effect (not inline after the await)
  // guarantees the fresh user is committed before RequireAuth re-evaluates.
  useEffect(() => {
    if (awaitingForcedRedirect && user && !user.mustChangePassword) {
      navigate('/app/new', { replace: true });
    }
  }, [awaitingForcedRedirect, user, navigate]);

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    setSuccessMessage(null);
    const wasForced = isForced;
    try {
      await authApi.changePassword({
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });
      await refreshUser();
      if (wasForced) {
        // Redirect happens in the effect once the cleared user is committed.
        setAwaitingForcedRedirect(true);
      } else {
        reset();
        setSuccessMessage('Đổi mật khẩu thành công.');
      }
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.code === 'INVALID_CREDENTIALS') {
          setError('currentPassword', { message: 'Mật khẩu hiện tại không đúng.' });
        } else if (error.code === 'VALIDATION_ERROR') {
          setError('newPassword', { message: error.message });
        } else {
          setFormError(error.message);
        }
      } else if (error instanceof NetworkError) {
        setFormError(error.message);
      } else {
        setFormError('Đã xảy ra lỗi không mong muốn. Vui lòng thử lại.');
      }
    }
  });

  const onCancel = () => navigate(returnTo, { replace: true });

  const onLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-600 text-white">
            <KeyRound className="h-6 w-6" aria-hidden="true" />
          </div>
          <h1 className="text-xl font-semibold text-slate-900">Đổi mật khẩu</h1>
          <p className="mt-1 text-sm text-slate-500">
            {isForced
              ? 'Vì lý do bảo mật, vui lòng đặt mật khẩu mới trước khi tiếp tục.'
              : 'Cập nhật mật khẩu cho tài khoản của bạn.'}
          </p>
        </div>

        <Card className="p-6">
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            {formError ? <ErrorAlert>{formError}</ErrorAlert> : null}
            {successMessage ? (
              <div
                role="status"
                className="flex items-start gap-2 rounded-xl border border-green-200 bg-green-50 px-3 py-2.5 text-sm text-green-700"
              >
                <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
                <span>{successMessage}</span>
              </div>
            ) : null}

            <PasswordInput
              label="Mật khẩu hiện tại"
              autoComplete="current-password"
              error={errors.currentPassword?.message}
              {...register('currentPassword')}
            />
            <PasswordInput
              label="Mật khẩu mới"
              autoComplete="new-password"
              hint="Tối thiểu 8 ký tự, gồm cả chữ và số."
              error={errors.newPassword?.message}
              {...register('newPassword')}
            />
            <PasswordInput
              label="Xác nhận mật khẩu mới"
              autoComplete="new-password"
              error={errors.confirmPassword?.message}
              {...register('confirmPassword')}
            />

            <Button type="submit" fullWidth loading={isSubmitting}>
              {isForced ? 'Đổi mật khẩu và tiếp tục' : 'Cập nhật mật khẩu'}
            </Button>
          </form>

          <div className="mt-4 border-t border-slate-100 pt-4">
            {isForced ? (
              <Button variant="ghost" fullWidth onClick={onLogout}>
                <LogOut className="h-4 w-4" aria-hidden="true" />
                Đăng xuất
              </Button>
            ) : (
              <Button variant="ghost" fullWidth onClick={onCancel}>
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                Quay lại
              </Button>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

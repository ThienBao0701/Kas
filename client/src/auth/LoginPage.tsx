import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { Building2 } from 'lucide-react';
import { useAuth } from './AuthProvider';
import { ApiError, NetworkError } from '../api/errors';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Input } from '../components/Input';
import { PasswordInput } from '../components/PasswordInput';
import { ErrorAlert } from '../components/ErrorAlert';

interface LoginForm {
  username: string;
  password: string;
}

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginForm>({ defaultValues: { username: '', password: '' } });

  const onSubmit = handleSubmit(async ({ username, password }) => {
    setFormError(null);
    try {
      const result = await login(username, password);
      navigate(result.mustChangePassword ? '/change-password' : '/app/new', { replace: true });
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.code === 'ACCOUNT_DISABLED') {
          setFormError('Tài khoản đã bị vô hiệu hoá. Vui lòng liên hệ quản trị viên.');
        } else if (error.code === 'RATE_LIMITED') {
          setFormError(error.message);
        } else {
          // Generic message for any credential problem — never reveal specifics.
          setFormError('Tên đăng nhập hoặc mật khẩu không đúng.');
        }
      } else if (error instanceof NetworkError) {
        setFormError(error.message);
      } else {
        setFormError('Đã xảy ra lỗi không mong muốn. Vui lòng thử lại.');
      }
    }
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-600 text-white">
            <Building2 className="h-6 w-6" aria-hidden="true" />
          </div>
          <h1 className="text-xl font-semibold text-slate-900">Hotel Booking Dispatch</h1>
          <p className="mt-1 text-sm text-slate-500">Hệ thống điều phối đặt phòng nội bộ</p>
        </div>

        <Card className="p-6">
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            {formError ? <ErrorAlert>{formError}</ErrorAlert> : null}

            <Input
              label="Tên đăng nhập"
              autoComplete="username"
              autoFocus
              error={errors.username?.message}
              {...register('username', { required: 'Vui lòng nhập tên đăng nhập.' })}
            />

            <PasswordInput
              label="Mật khẩu"
              autoComplete="current-password"
              error={errors.password?.message}
              {...register('password', { required: 'Vui lòng nhập mật khẩu.' })}
            />

            <Button type="submit" fullWidth loading={isSubmitting}>
              Đăng nhập
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}

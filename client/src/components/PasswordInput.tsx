import { forwardRef, useState, type InputHTMLAttributes } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Input } from './Input';

interface PasswordInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: string;
  error?: string;
  hint?: string;
}

export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  function PasswordInput({ label, error, hint, ...rest }, ref) {
    const [visible, setVisible] = useState(false);

    return (
      <Input
        ref={ref}
        label={label}
        error={error}
        hint={hint}
        type={visible ? 'text' : 'password'}
        rightSlot={
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            className="rounded-lg p-1.5 text-slate-500 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
            aria-label={visible ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
            aria-pressed={visible}
          >
            {visible ? (
              <EyeOff className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Eye className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
        }
        {...rest}
      />
    );
  },
);

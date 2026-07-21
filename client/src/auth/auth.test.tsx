import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  ADMIN_USER,
  installApiMock,
  jsonResponse,
  renderApp,
} from '../test/utils';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const unauthorized = () => ({
  status: 401,
  body: { error: { code: 'AUTH_REQUIRED', message: 'Bạn cần đăng nhập.' } },
});

describe('authentication flow', () => {
  it('shows a full-screen loading state while the initial /me check is pending', async () => {
    let resolve!: (r: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>((r) => (resolve = r)));
    vi.stubGlobal('fetch', fetchMock);

    renderApp('/app/new');

    expect(screen.getByText('Đang tải ứng dụng...')).toBeInTheDocument();

    resolve(jsonResponse(401, { error: { code: 'AUTH_REQUIRED', message: '' } }));
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Hotel Booking Dispatch' })).toBeInTheDocument(),
    );
  });

  it('redirects an unauthenticated user from a protected route to /login', async () => {
    installApiMock({ 'GET /api/auth/me': unauthorized });

    renderApp('/app/new');

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Hotel Booking Dispatch' })).toBeInTheDocument(),
    );
    expect(screen.getByLabelText('Tên đăng nhập')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mở menu tài khoản' })).not.toBeInTheDocument();
  });

  it('logs in with valid credentials and lands on the operational shell', async () => {
    installApiMock({
      'GET /api/auth/me': unauthorized,
      'POST /api/auth/login': () => ({ status: 200, body: { user: ADMIN_USER, mustChangePassword: false } }),
    });

    const user = userEvent.setup();
    renderApp('/login');

    await screen.findByRole('heading', { name: 'Hotel Booking Dispatch' });
    await user.type(screen.getByLabelText('Tên đăng nhập'), 'admin');
    await user.type(screen.getByLabelText('Mật khẩu'), 'Admin12345');
    await user.click(screen.getByRole('button', { name: 'Đăng nhập' }));

    expect(await screen.findByRole('button', { name: 'Mở menu tài khoản' })).toBeInTheDocument();
  });

  it('shows a generic message for invalid credentials', async () => {
    installApiMock({
      'GET /api/auth/me': unauthorized,
      'POST /api/auth/login': () => ({
        status: 401,
        body: { error: { code: 'INVALID_CREDENTIALS', message: 'Tên đăng nhập hoặc mật khẩu không đúng.' } },
      }),
    });

    const user = userEvent.setup();
    renderApp('/login');

    await screen.findByRole('heading', { name: 'Hotel Booking Dispatch' });
    await user.type(screen.getByLabelText('Tên đăng nhập'), 'admin');
    await user.type(screen.getByLabelText('Mật khẩu'), 'wrongpass1');
    await user.click(screen.getByRole('button', { name: 'Đăng nhập' }));

    expect(await screen.findByText('Tên đăng nhập hoặc mật khẩu không đúng.')).toBeInTheDocument();
  });

  it('shows a clear message for a disabled account', async () => {
    installApiMock({
      'GET /api/auth/me': unauthorized,
      'POST /api/auth/login': () => ({
        status: 403,
        body: { error: { code: 'ACCOUNT_DISABLED', message: 'Tài khoản đã bị vô hiệu hoá.' } },
      }),
    });

    const user = userEvent.setup();
    renderApp('/login');

    await screen.findByRole('heading', { name: 'Hotel Booking Dispatch' });
    await user.type(screen.getByLabelText('Tên đăng nhập'), 'letan');
    await user.type(screen.getByLabelText('Mật khẩu'), 'Reception1');
    await user.click(screen.getByRole('button', { name: 'Đăng nhập' }));

    expect(await screen.findByText(/Tài khoản đã bị vô hiệu hoá/)).toBeInTheDocument();
  });

  it('restores the session from the cookie via /me after a refresh', async () => {
    installApiMock({
      'GET /api/auth/me': () => ({ status: 200, body: { user: ADMIN_USER } }),
    });

    renderApp('/app/new');

    // No login step — the server session alone restores the authenticated shell.
    expect(await screen.findByRole('button', { name: 'Mở menu tài khoản' })).toBeInTheDocument();
  });

  it('logs out, clearing the authenticated UI and returning to /login', async () => {
    installApiMock({
      'GET /api/auth/me': () => ({ status: 200, body: { user: ADMIN_USER } }),
      'POST /api/auth/logout': () => ({ status: 200, body: { success: true } }),
    });

    const user = userEvent.setup();
    renderApp('/app/new');

    await screen.findByRole('button', { name: 'Mở menu tài khoản' });
    await user.click(screen.getByRole('button', { name: 'Mở menu tài khoản' }));
    await user.click(screen.getByRole('menuitem', { name: /Đăng xuất/ }));

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Hotel Booking Dispatch' })).toBeInTheDocument(),
    );
    expect(screen.queryByRole('button', { name: 'Mở menu tài khoản' })).not.toBeInTheDocument();
  });

  it('sends a user who must change their password to /change-password', async () => {
    installApiMock({
      'GET /api/auth/me': () => ({
        status: 200,
        body: { user: { ...ADMIN_USER, mustChangePassword: true } },
      }),
    });

    renderApp('/app/new');

    expect(await screen.findByRole('heading', { name: 'Đổi mật khẩu' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mở menu tài khoản' })).not.toBeInTheDocument();
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ADMIN_USER, installApiMock, renderApp } from '../test/utils';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const forcedUser = { ...ADMIN_USER, mustChangePassword: true };
const unauthorized = () => ({
  status: 401,
  body: { error: { code: 'AUTH_REQUIRED', message: '' } },
});

describe('change password — forced mode', () => {
  it('lets a forced user access /change-password (mandatory prompt)', async () => {
    installApiMock({ 'GET /api/auth/me': () => ({ status: 200, body: { user: forcedUser } }) });
    renderApp('/change-password');

    expect(await screen.findByRole('heading', { name: 'Đổi mật khẩu' })).toBeInTheDocument();
    expect(
      screen.getByText('Vì lý do bảo mật, vui lòng đặt mật khẩu mới trước khi tiếp tục.'),
    ).toBeInTheDocument();
    // Forced mode offers logout, not a cancel/back.
    expect(screen.getByRole('button', { name: /Đăng xuất/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Quay lại/ })).not.toBeInTheDocument();
  });

  it('keeps a forced user out of operational pages', async () => {
    installApiMock({ 'GET /api/auth/me': () => ({ status: 200, body: { user: forcedUser } }) });
    renderApp('/app/new');

    expect(await screen.findByRole('heading', { name: 'Đổi mật khẩu' })).toBeInTheDocument();
    expect(screen.queryByText('Chưa có đơn mới được gửi đến.')).not.toBeInTheDocument();
  });

  it('rejects a weak new password on the client, without calling the API', async () => {
    const fetchMock = installApiMock({
      'GET /api/auth/me': () => ({ status: 200, body: { user: forcedUser } }),
      'POST /api/auth/change-password': () => ({ status: 200, body: { success: true } }),
    });

    const user = userEvent.setup();
    renderApp('/change-password');

    await screen.findByRole('heading', { name: 'Đổi mật khẩu' });
    await user.type(screen.getByLabelText('Mật khẩu hiện tại'), 'OldPass123');
    await user.type(screen.getByLabelText('Mật khẩu mới'), 'short');
    await user.type(screen.getByLabelText('Xác nhận mật khẩu mới'), 'short');
    await user.click(screen.getByRole('button', { name: 'Đổi mật khẩu và tiếp tục' }));

    expect(await screen.findByText('Mật khẩu phải có ít nhất 8 ký tự.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith('/api/auth/change-password', expect.anything());
  });

  it('rejects when the confirmation does not match', async () => {
    installApiMock({ 'GET /api/auth/me': () => ({ status: 200, body: { user: forcedUser } }) });

    const user = userEvent.setup();
    renderApp('/change-password');

    await screen.findByRole('heading', { name: 'Đổi mật khẩu' });
    await user.type(screen.getByLabelText('Mật khẩu hiện tại'), 'OldPass123');
    await user.type(screen.getByLabelText('Mật khẩu mới'), 'NewPass123');
    await user.type(screen.getByLabelText('Xác nhận mật khẩu mới'), 'Different123');
    await user.click(screen.getByRole('button', { name: 'Đổi mật khẩu và tiếp tục' }));

    expect(await screen.findByText('Mật khẩu xác nhận không khớp.')).toBeInTheDocument();
  });

  it('changes the password, refreshes the user, and opens the operational shell', async () => {
    let mustChange = true;
    installApiMock({
      'GET /api/auth/me': () => ({
        status: 200,
        body: { user: { ...ADMIN_USER, mustChangePassword: mustChange } },
      }),
      'POST /api/auth/change-password': () => {
        mustChange = false;
        return { status: 200, body: { success: true } };
      },
    });

    const user = userEvent.setup();
    renderApp('/change-password');

    await screen.findByRole('heading', { name: 'Đổi mật khẩu' });
    await user.type(screen.getByLabelText('Mật khẩu hiện tại'), 'OldPass123');
    await user.type(screen.getByLabelText('Mật khẩu mới'), 'NewPass123');
    await user.type(screen.getByLabelText('Xác nhận mật khẩu mới'), 'NewPass123');
    await user.click(screen.getByRole('button', { name: 'Đổi mật khẩu và tiếp tục' }));

    expect(await screen.findByText('Chưa có đơn mới được gửi đến.')).toBeInTheDocument();
  });
});

describe('change password — voluntary mode', () => {
  it('opens from the account menu and stays on the page (not redirected away)', async () => {
    installApiMock({ 'GET /api/auth/me': () => ({ status: 200, body: { user: ADMIN_USER } }) });

    const user = userEvent.setup();
    renderApp('/app/new');

    await screen.findByText('Chưa có đơn mới được gửi đến.');
    await user.click(screen.getByRole('button', { name: 'Mở menu tài khoản' }));
    await user.click(screen.getByRole('menuitem', { name: /Đổi mật khẩu/ }));

    expect(await screen.findByText('Cập nhật mật khẩu cho tài khoản của bạn.')).toBeInTheDocument();
    expect(screen.getByLabelText('Mật khẩu hiện tại')).toBeInTheDocument();
    expect(screen.queryByText('Chưa có đơn mới được gửi đến.')).not.toBeInTheDocument();
  });

  it('does not immediately redirect a non-forced user who lands on /change-password', async () => {
    installApiMock({ 'GET /api/auth/me': () => ({ status: 200, body: { user: ADMIN_USER } }) });
    renderApp('/change-password');

    expect(await screen.findByText('Cập nhật mật khẩu cho tài khoản của bạn.')).toBeInTheDocument();
    // Voluntary mode offers a back action, not logout.
    expect(screen.getByRole('button', { name: /Quay lại/ })).toBeInTheDocument();
  });

  it('changes the password voluntarily and shows a success message', async () => {
    const fetchMock = installApiMock({
      'GET /api/auth/me': () => ({ status: 200, body: { user: ADMIN_USER } }),
      'POST /api/auth/change-password': () => ({ status: 200, body: { success: true } }),
    });

    const user = userEvent.setup();
    renderApp('/change-password');

    await screen.findByText('Cập nhật mật khẩu cho tài khoản của bạn.');
    await user.type(screen.getByLabelText('Mật khẩu hiện tại'), 'OldPass123');
    await user.type(screen.getByLabelText('Mật khẩu mới'), 'NewPass123');
    await user.type(screen.getByLabelText('Xác nhận mật khẩu mới'), 'NewPass123');
    await user.click(screen.getByRole('button', { name: 'Cập nhật mật khẩu' }));

    expect(await screen.findByText('Đổi mật khẩu thành công.')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/change-password',
      expect.objectContaining({ method: 'POST' }),
    );
    // Still authenticated and on the page (not logged out / bounced to login).
    expect(screen.queryByRole('heading', { name: 'Hotel Booking Dispatch' })).not.toBeInTheDocument();
  });

  it('returns to the operational page when cancelled', async () => {
    installApiMock({ 'GET /api/auth/me': () => ({ status: 200, body: { user: ADMIN_USER } }) });

    const user = userEvent.setup();
    renderApp('/change-password');

    await screen.findByText('Cập nhật mật khẩu cho tài khoản của bạn.');
    await user.click(screen.getByRole('button', { name: /Quay lại/ }));

    expect(await screen.findByText('Chưa có đơn mới được gửi đến.')).toBeInTheDocument();
  });
});

describe('change password — access control', () => {
  it('redirects an unauthenticated user to /login', async () => {
    installApiMock({ 'GET /api/auth/me': unauthorized });
    renderApp('/change-password');

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Hotel Booking Dispatch' })).toBeInTheDocument(),
    );
    expect(screen.queryByText('Cập nhật mật khẩu cho tài khoản của bạn.')).not.toBeInTheDocument();
  });
});

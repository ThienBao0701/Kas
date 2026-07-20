import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import {
  ADMIN_USER,
  RECEPTIONIST_USER,
  installApiMock,
  renderApp,
} from '../test/utils';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mockMe(user: unknown) {
  installApiMock({ 'GET /api/auth/me': () => ({ status: 200, body: { user } }) });
}

describe('role-based shell and routing', () => {
  it('shows Extract and Users navigation to an admin', async () => {
    mockMe(ADMIN_USER);
    renderApp('/app/new');

    const nav = await screen.findByRole('navigation', { name: 'Điều hướng chính' });
    expect(within(nav).getByRole('link', { name: 'Tạo đơn / Extract' })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Quản lý tài khoản' })).toBeInTheDocument();
    expect(within(nav).getAllByRole('link')).toHaveLength(5);
  });

  it('shows only the three primary items to a receptionist', async () => {
    mockMe(RECEPTIONIST_USER);
    renderApp('/app/new');

    const nav = await screen.findByRole('navigation', { name: 'Điều hướng chính' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((l) => l.textContent)).toEqual(['Đơn mới', 'Đã hoàn thành', 'Lịch sử']);
    expect(within(nav).queryByRole('link', { name: 'Tạo đơn / Extract' })).not.toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: 'Quản lý tài khoản' })).not.toBeInTheDocument();
  });

  it('blocks a receptionist from opening an admin route directly', async () => {
    mockMe(RECEPTIONIST_USER);
    renderApp('/app/users');

    expect(await screen.findByText('Không có quyền truy cập')).toBeInTheDocument();
    expect(
      screen.queryByText('Giao diện quản lý tài khoản sẽ được kết nối trong phase tiếp theo.'),
    ).not.toBeInTheDocument();
  });

  it('shows the receptionist their assigned branch', async () => {
    mockMe(RECEPTIONIST_USER);
    renderApp('/app/new');

    expect(await screen.findByText(/Saigon Hotel & Ben Thanh/)).toBeInTheDocument();
  });

  it('renders a professional empty state with no fabricated booking data', async () => {
    mockMe(RECEPTIONIST_USER);
    renderApp('/app/new');

    expect(await screen.findByText('Chưa có đơn mới được gửi đến.')).toBeInTheDocument();
    // No fake bookings: nothing tabular is rendered on the placeholder page.
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByRole('row')).not.toBeInTheDocument();
  });
});

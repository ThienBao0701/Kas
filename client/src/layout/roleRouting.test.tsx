import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { ADMIN_USER, RECEPTIONIST_USER, installApiMock, renderApp } from '../test/utils';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const EMPTY_NEW = {
  status: 200,
  body: { bookings: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 } },
};

function mockShell(user: unknown, extra: Record<string, () => { status: number; body?: unknown }> = {}) {
  installApiMock({
    'GET /api/auth/me': () => ({ status: 200, body: { user } }),
    'GET /api/notifications/unread-count': () => ({ status: 200, body: { count: 0 } }),
    // Admin waiting list (paged) and receptionist inbox (large page) both hit /bookings/new.
    'GET /api/bookings/new?page=1&pageSize=20': () => EMPTY_NEW,
    'GET /api/bookings/new?pageSize=100': () => EMPTY_NEW,
    'GET /api/branches': () => ({ status: 200, body: { branches: [] } }),
    ...extra,
  });
}

describe('role-based shell and routing', () => {
  it('shows the full admin menu (9 items)', async () => {
    mockShell(ADMIN_USER);
    renderApp('/app/new');

    const nav = await screen.findByRole('navigation', { name: 'Điều hướng chính' });
    const labels = within(nav).getAllByRole('link').map((l) => l.textContent);
    expect(labels).toEqual([
      'Tổng quan',
      'Nhập đơn',
      'Chờ chi nhánh tạo',
      'Chờ kiểm tra',
      'Cần tạo lại',
      'Đã xác nhận đúng',
      'Lịch sử',
      'Sự cố khách sạn',
      'Quản lý tài khoản',
    ]);
  });

  it('shows only the six receptionist items', async () => {
    mockShell(RECEPTIONIST_USER);
    renderApp('/app/new');

    const nav = await screen.findByRole('navigation', { name: 'Điều hướng chính' });
    const labels = within(nav).getAllByRole('link').map((l) => l.textContent);
    expect(labels).toEqual(['Đơn mới', 'Chờ Admin kiểm tra', 'Cần tạo lại', 'Đã xác nhận đúng', 'Lịch sử', 'Báo cáo sự cố']);
    expect(within(nav).queryByRole('link', { name: 'Quản lý tài khoản' })).not.toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: 'Nhập đơn' })).not.toBeInTheDocument();
  });

  it('blocks a receptionist from an admin route directly', async () => {
    mockShell(RECEPTIONIST_USER);
    renderApp('/app/settings');

    expect(await screen.findByText('Không có quyền truy cập')).toBeInTheDocument();
  });

  it('shows the receptionist their assigned branch', async () => {
    mockShell(RECEPTIONIST_USER);
    renderApp('/app/new');

    expect((await screen.findAllByText(/Saigon Hotel & Ben Thanh/)).length).toBeGreaterThan(0);
  });

  it('renders a professional empty state with no fabricated booking data', async () => {
    mockShell(RECEPTIONIST_USER);
    renderApp('/app/new');

    expect(await screen.findByText('Chưa có đơn mới')).toBeInTheDocument();
    // No fake bookings: nothing tabular is rendered when the list is empty.
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByRole('row')).not.toBeInTheDocument();
  });
});

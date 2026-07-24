import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ADMIN_USER, RECEPTIONIST_USER, installApiMock, renderApp } from '../test/utils';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const BRANCH = { id: 1, code: 'TRUONG_DINH_05', hotelName: 'Saigon Hotel & Ben Thanh', address: '05 Trương Định' };

function issue(over: Record<string, unknown> = {}) {
  return {
    id: 'i1',
    branchId: 1,
    branch: BRANCH,
    roomNumber: '301',
    category: 'AIR_CONDITIONER',
    description: 'Máy lạnh không lạnh',
    photoUrl: null,
    status: 'NEW',
    reportedBy: { id: 2, fullName: 'Lễ tân Một' },
    acceptedBy: null,
    resolvedBy: null,
    createdAt: '2026-07-24T02:00:00.000Z',
    updatedAt: '2026-07-24T02:00:00.000Z',
    resolvedAt: null,
    ...over,
  };
}

function listBody(issues: unknown[]) {
  return { status: 200, body: { issues, pagination: { page: 1, pageSize: 100, total: issues.length, totalPages: 1 } } };
}

describe('IssuesPage — receptionist', () => {
  it('creates a new issue report via the modal form', async () => {
    let created = false;
    const fetchMock = installApiMock({
      'GET /api/auth/me': () => ({ status: 200, body: { user: RECEPTIONIST_USER } }),
      'GET /api/notifications/unread-count': () => ({ status: 200, body: { count: 0 } }),
      'GET /api/issues?pageSize=100': () => listBody(created ? [issue()] : []),
      'POST /api/issues': () => {
        created = true;
        return { status: 201, body: { issue: issue() } };
      },
    });

    const user = userEvent.setup();
    renderApp('/app/issues');

    // Empty state until a report is filed.
    expect(await screen.findByText('Chưa có báo cáo nào')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Báo cáo mới' }));
    const dialog = await screen.findByRole('dialog');
    // Room number is clearly marked optional with helper text.
    expect(within(dialog).getByText('Để trống nếu sự cố không liên quan đến phòng.')).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText('Mô tả'), 'Máy lạnh không lạnh');
    await user.click(within(dialog).getByRole('button', { name: 'Gửi báo cáo' }));

    expect(await screen.findByText('Đã gửi báo cáo sự cố cho Admin.')).toBeInTheDocument();
    const called = fetchMock.mock.calls.some(
      ([url, init]) => String(url) === '/api/issues' && (init as RequestInit).method === 'POST',
    );
    expect(called).toBe(true);
  });
});

describe('IssuesPage — admin', () => {
  it('lists issues and accepts then resolves one', async () => {
    let status: 'NEW' | 'IN_PROGRESS' | 'RESOLVED' = 'NEW';
    const fetchMock = installApiMock({
      'GET /api/auth/me': () => ({ status: 200, body: { user: ADMIN_USER } }),
      'GET /api/notifications/unread-count': () => ({ status: 200, body: { count: 0 } }),
      'GET /api/issues?pageSize=100': () => listBody([issue({ status })]),
      'POST /api/issues/i1/accept': () => {
        status = 'IN_PROGRESS';
        return { status: 200, body: { issue: issue({ status }) } };
      },
      'POST /api/issues/i1/resolve': () => {
        status = 'RESOLVED';
        return { status: 200, body: { issue: issue({ status }) } };
      },
    });

    const user = userEvent.setup();
    renderApp('/app/issues');

    const table = await screen.findByRole('table');
    expect(within(table).getByText('05 Trương Định')).toBeInTheDocument();
    expect(within(table).getByText('Máy lạnh')).toBeInTheDocument();
    expect(within(table).getByText('Lễ tân Một')).toBeInTheDocument();

    await user.click(within(table).getByRole('button', { name: 'Tiếp nhận' }));
    expect(await screen.findByText('Đã tiếp nhận sự cố.')).toBeInTheDocument();

    await user.click(within(table).getByRole('button', { name: /Đã xử lý/ }));
    expect(await screen.findByText('Đã đánh dấu sự cố đã xử lý.')).toBeInTheDocument();

    const acceptCalled = fetchMock.mock.calls.some(([u, i]) => String(u) === '/api/issues/i1/accept' && (i as RequestInit).method === 'POST');
    const resolveCalled = fetchMock.mock.calls.some(([u, i]) => String(u) === '/api/issues/i1/resolve' && (i as RequestInit).method === 'POST');
    expect(acceptCalled).toBe(true);
    expect(resolveCalled).toBe(true);
  });

  it('renders visually distinct NEW / IN_PROGRESS / RESOLVED status badges', async () => {
    installApiMock({
      'GET /api/auth/me': () => ({ status: 200, body: { user: ADMIN_USER } }),
      'GET /api/notifications/unread-count': () => ({ status: 200, body: { count: 0 } }),
      'GET /api/issues?pageSize=100': () =>
        listBody([
          issue({ id: 'a', status: 'NEW' }),
          issue({ id: 'b', status: 'IN_PROGRESS' }),
          issue({ id: 'c', status: 'RESOLVED' }),
        ]),
    });
    renderApp('/app/issues');

    const table = await screen.findByRole('table');
    const rows = within(table).getAllByRole('row').slice(1); // skip the header row
    // Rows are newest-first but each was created with the same timestamp, so match
    // by the badge label within its own row. Each status has a distinct colour
    // class (colour is not the sole signal — the labels differ too).
    expect(within(rows.find((r) => within(r).queryByText('Mới'))!).getByText('Mới').className).toMatch(/amber/);
    expect(within(rows.find((r) => within(r).queryByText('Đang xử lý'))!).getByText('Đang xử lý').className).toMatch(/blue/);
    const resolvedRow = rows.find((r) => within(r).queryByText('Đã xử lý') && !within(r).queryByRole('button', { name: /Đã xử lý/ }))!;
    expect(within(resolvedRow).getByText('Đã xử lý').className).toMatch(/green/);
  });
});

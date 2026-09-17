import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ADMIN_USER, RECEPTIONIST_USER, installApiMock, renderApp } from '../test/utils';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const BRANCH = { id: 1, code: 'TRUONG_DINH_05', hotelName: 'Saigon Hotel & Ben Thanh', address: '05 Trương Định' };

/** The receptionist is checked in, so the shift picker never interrupts. */
const OPEN_SHIFT = {
  status: 200,
  body: {
    session: {
      id: 's1',
      branchId: 1,
      shiftType: 'A',
      shiftName: 'Ca A',
      shiftWindow: '06:00 – 14:00',
      receptionistName: 'Lễ tân Một',
      startedAt: '2026-09-16T23:00:00.000Z',
      nominalEndAt: '2026-09-17T07:00:00.000Z',
      graceEndAt: '2026-09-17T07:10:00.000Z',
      closedAt: null,
      promptDue: false,
    },
  },
};

function issue(over: Record<string, unknown> = {}) {
  return {
    id: 'i1',
    branchId: 1,
    branch: BRANCH,
    areaCategory: 'ROOM',
    roomNumber: '301',
    floorNumber: null,
    areaSubtype: null,
    locationDetail: null,
    locationLabel: 'Phòng · Phòng 301',
    category: 'AIR_CONDITIONER',
    description: 'Máy lạnh không lạnh',
    photoUrl: null,
    status: 'NEW',
    reportedBy: { id: 2, fullName: 'Lễ tân Một' },
    reportedByName: 'Lễ tân Một',
    acceptedBy: null,
    acceptedByName: null,
    acceptedAt: null,
    technicianName: null,
    technicianPhone: null,
    completedBy: null,
    completedByName: null,
    completedAt: null,
    createdAt: '2026-07-24T02:00:00.000Z',
    updatedAt: '2026-07-24T02:00:00.000Z',
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
      'GET /api/reception/shifts/current': () => OPEN_SHIFT,
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

    // The area is asked FIRST, and it decides the rest of the form.
    expect(within(dialog).getByLabelText('Sự cố')).toHaveValue('ROOM');
    await user.type(within(dialog).getByText('Số phòng').querySelector('input')!, '301');
    await user.type(within(dialog).getByLabelText('Mô tả sự cố'), 'Máy lạnh không lạnh');
    await user.click(within(dialog).getByRole('button', { name: 'Gửi báo cáo' }));

    expect(await screen.findByText('Đã gửi báo cáo sự cố cho bộ phận kỹ thuật.')).toBeInTheDocument();
    const called = fetchMock.mock.calls.some(
      ([url, init]) => String(url) === '/api/issues' && (init as RequestInit).method === 'POST',
    );
    expect(called).toBe(true);
  });

  it('shows the reported incident with its location and status', async () => {
    installApiMock({
      'GET /api/auth/me': () => ({ status: 200, body: { user: RECEPTIONIST_USER } }),
      'GET /api/notifications/unread-count': () => ({ status: 200, body: { count: 0 } }),
      'GET /api/reception/shifts/current': () => OPEN_SHIFT,
      'GET /api/issues?pageSize=100': () => listBody([issue()]),
    });

    renderApp('/app/issues');

    const list = await screen.findByRole('list', { name: 'Danh sách sự cố' });
    expect(within(list).getByText('Phòng · Phòng 301')).toBeInTheDocument();
    expect(within(list).getByText('Máy lạnh không lạnh')).toBeInTheDocument();
    expect(within(list).getByText('Sự cố khách sạn')).toBeInTheDocument();
  });
});

describe('IssuesPage — admin', () => {
  /**
   * THE ADMIN IS READ-ONLY FOR THE WORKFLOW.
   *
   * This test used to accept and resolve an incident from here, which recorded
   * an administrator as having done maintenance work. Bộ phận kỹ thuật does that
   * now, and the API refuses an Admin outright — so what this screen must show
   * is the state, not a way to change it.
   */
  it('lists issues with their technician, and offers no workflow actions', async () => {
    installApiMock({
      'GET /api/auth/me': () => ({ status: 200, body: { user: ADMIN_USER } }),
      'GET /api/notifications/unread-count': () => ({ status: 200, body: { count: 0 } }),
      'GET /api/issues?pageSize=100': () =>
        listBody([
          issue({
            status: 'IN_PROGRESS',
            technicianName: 'Trần Văn B',
            technicianPhone: '0901234567',
            acceptedAt: '2026-07-24T03:00:00.000Z',
          }),
        ]),
    });

    renderApp('/app/issues');

    const table = await screen.findByRole('table');
    expect(within(table).getByText('05 Trương Định')).toBeInTheDocument();
    expect(within(table).getByText('Máy lạnh')).toBeInTheDocument();
    expect(within(table).getByText('Lễ tân Một')).toBeInTheDocument();
    // The technician and how to reach them.
    expect(within(table).getByText('Trần Văn B')).toBeInTheDocument();
    expect(within(table).getByText('0901234567')).toBeInTheDocument();

    // No way to transition anything from here.
    expect(within(table).queryByRole('button', { name: 'Tiếp nhận' })).toBeNull();
    expect(within(table).queryByRole('button', { name: /Hoàn thành/ })).toBeNull();
    expect(within(table).queryByRole('button', { name: /Đã xử lý/ })).toBeNull();
  });

  it('renders visually distinct NEW / IN_PROGRESS / COMPLETED status badges', async () => {
    installApiMock({
      'GET /api/auth/me': () => ({ status: 200, body: { user: ADMIN_USER } }),
      'GET /api/notifications/unread-count': () => ({ status: 200, body: { count: 0 } }),
      'GET /api/issues?pageSize=100': () =>
        listBody([
          issue({ id: 'a', status: 'NEW' }),
          issue({ id: 'b', status: 'IN_PROGRESS' }),
          issue({ id: 'c', status: 'COMPLETED' }),
        ]),
    });
    renderApp('/app/issues');

    const table = await screen.findByRole('table');
    const rows = within(table).getAllByRole('row').slice(1); // skip the header row
    // Rows are newest-first but each was created with the same timestamp, so match
    // by the badge label within its own row. Each status has a distinct colour
    // class (colour is not the sole signal — the labels differ too).
    const badge = (label: string) =>
      within(rows.find((r) => within(r).queryByText(label))!).getByText(label).className;

    expect(badge('Sự cố khách sạn')).toMatch(/amber/);
    expect(badge('Đang sửa')).toMatch(/blue/);
    expect(badge('Đã hoàn thành')).toMatch(/green/);
  });
});

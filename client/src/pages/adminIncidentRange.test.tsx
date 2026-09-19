/**
 * The Admin's incident date-range monitoring.
 *
 * THE CLAIMS THIS FILE EXISTS TO PROVE:
 *   1. The screen is UNCHANGED until a period is asked for. Defaulting to today
 *      would hide every unresolved incident older than this morning — the ones
 *      that most need looking at.
 *   2. The narrowing reaches the SERVER. Filtering a loaded page would only ever
 *      narrow the page that happened to load.
 *   3. "Tồn đọng hiện tại" and a date range are mutually exclusive, and the
 *      screen says which one is in force.
 *   4. "Lượt không sửa được" and "Cần xử lý lại" are shown as two numbers,
 *      because they are two numbers.
 *   5. The export starts from the period already on screen.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ADMIN_USER, renderApp } from '../test/utils';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const BRANCH = { id: 1, code: 'TRUONG_DINH_05', hotelName: 'KAS Passion', address: '05 Trương Định' };

const SUMMARY = {
  total: 7,
  newCount: 2,
  inProgressCount: 1,
  completedCount: 4,
  cannotRepairAttempts: 4,
  needsReworkIssues: 1,
  outstandingTotal: 9,
};

function issue(over: Record<string, unknown> = {}) {
  return {
    id: 'i1',
    branchId: 1,
    branch: BRANCH,
    areaCategory: 'ROOM',
    roomNumber: '101',
    floorNumber: null,
    areaSubtype: null,
    locationDetail: null,
    locationLabel: 'Phòng · Phòng 101',
    category: 'TOILET',
    description: 'Hello',
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
    shiftType: 'A',
    shiftReceptionistName: 'Nguyễn Văn A',
    durationSeconds: null,
    durationLabel: null,
    attempts: [],
    cannotRepairCount: 0,
    needsRework: false,
    createdAt: '2026-09-17T02:00:00.000Z',
    updatedAt: '2026-09-17T02:00:00.000Z',
    ...over,
  };
}

/**
 * A PREFIX-matching mock, unlike `installApiMock`.
 *
 * The page's request URL carries whatever period the operator picked, and the
 * period is derived from the real clock — so a test that pinned the full URL
 * would have to restate today's date. What each test actually cares about is
 * which URLs were requested, which `seen` records.
 */
function installMocks(onRequest?: (url: string) => void) {
  const fetchMock = vi.fn(async (url: string | URL) => {
    const u = String(url);
    onRequest?.(u);
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    if (u === '/api/auth/me') return json({ user: ADMIN_USER });
    if (u === '/api/notifications/unread-count') return json({ count: 0 });
    if (u === '/api/issues/summary')
      return json({
        summary: {
          totalUnresolved: 3,
          newCount: 2,
          inProgressCount: 1,
          byBranch: [{ branchId: 1, code: BRANCH.code, address: BRANCH.address, hotelName: BRANCH.hotelName, newCount: 2, inProgressCount: 1, totalUnresolved: 3 }],
        },
      });
    if (u === '/api/nav-badges')
      return json({ counts: { new: 0, pendingReview: 0, rejected: 0, resendOrders: 0, chat: 0, reminders: 0 } });
    if (u.startsWith('/api/admin/reports/incidents/summary'))
      return json({ range: { from: '', to: '' }, summary: SUMMARY });
    if (u.startsWith('/api/issues'))
      return json({
        issues: [issue()],
        pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
      });
    return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: `no mock for ${u}` } }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
}

describe('the incident period controls', () => {
  it('asks for NO period by default — the screen is unchanged', async () => {
    const seen: string[] = [];
    installMocks((u) => seen.push(u));
    renderApp('/app/issues');

    await screen.findByRole('table');
    const listCalls = seen.filter((u) => u.startsWith('/api/issues?'));
    expect(listCalls.length).toBeGreaterThan(0);
    // Byte for byte the request this endpoint has always received.
    expect(listCalls.every((u) => u === '/api/issues?pageSize=100')).toBe(true);
    expect(screen.getByTestId('issue-scope-note')).toHaveTextContent('Đang xem toàn bộ sự cố');
  });

  it('sends the chosen period to the SERVER', async () => {
    const seen: string[] = [];
    installMocks((u) => seen.push(u));
    const user = userEvent.setup();
    renderApp('/app/issues');

    await screen.findByRole('table');
    await user.click(screen.getByTestId('issue-range-today'));

    await waitFor(() =>
      expect(seen.some((u) => u.startsWith('/api/issues?') && u.includes('from=') && u.includes('to=')))
        .toBe(true),
    );
    expect(screen.getByTestId('issue-scope-note')).toHaveTextContent('báo trong khoảng đã chọn');
  });

  it('sends the outstanding flag, and drops the period when it is chosen', async () => {
    const seen: string[] = [];
    installMocks((u) => seen.push(u));
    const user = userEvent.setup();
    renderApp('/app/issues');

    await screen.findByRole('table');
    await user.click(screen.getByTestId('issue-range-today'));
    await waitFor(() => expect(seen.some((u) => u.includes('from='))).toBe(true));

    seen.length = 0;
    await user.click(screen.getByTestId('issue-outstanding'));

    await waitFor(() => expect(seen.some((u) => u.includes('outstanding=true'))).toBe(true));
    // The two are mutually exclusive on the server — "tồn đọng" IS a status set,
    // so combining them would silently answer a different question.
    const outstandingCalls = seen.filter((u) => u.includes('outstanding=true'));
    expect(outstandingCalls.every((u) => !u.includes('from='))).toBe(true);
    expect(screen.getByTestId('issue-scope-note')).toHaveTextContent('không giới hạn ngày báo');
  });

  /**
   * Asserted on the SCOPE, not on a new request.
   *
   * Clearing the period returns the query to the key it already fetched at
   * mount, so React Query serves it from cache and no second request is made —
   * which is the right behaviour, and would make "a request went out" a test of
   * the cache rather than of the control.
   */
  /**
   * THE STATUS FILTER IS NOT SILENTLY DISCARDED.
   *
   * "Tồn đọng" IS a status set on the server — NEW plus IN_PROGRESS — so
   * `listIssues` replaces any chosen status with it. For a few hours the
   * dropdown stayed enabled and still read "Đã hoàn thành" while the table
   * listed exactly the incidents that filter excludes, with nothing on screen
   * admitting the filter had been dropped.
   */
  it('disables the status filter while the outstanding view is on', async () => {
    const seen: string[] = [];
    installMocks((u) => seen.push(u));
    const user = userEvent.setup();
    renderApp('/app/issues');

    await screen.findByRole('table');
    const status = screen.getByLabelText('Lọc theo trạng thái') as HTMLSelectElement;
    await user.selectOptions(status, 'COMPLETED');
    expect(status.value).toBe('COMPLETED');

    seen.length = 0;
    await user.click(screen.getByTestId('issue-outstanding'));

    // Visibly overridden rather than quietly ignored.
    await waitFor(() => expect(status).toBeDisabled());
    expect(status.value).toBe('');
    // And the request stops carrying a status the server would have overridden.
    await waitFor(() => expect(seen.some((u) => u.includes('outstanding=true'))).toBe(true));
    expect(seen.filter((u) => u.includes('outstanding=true')).every((u) => !u.includes('status='))).toBe(true);

    // Turning it off gives the control back.
    await user.click(screen.getByTestId('issue-outstanding'));
    await waitFor(() => expect(status).toBeEnabled());
  });

  it('clears the period on request', async () => {
    installMocks();
    const user = userEvent.setup();
    renderApp('/app/issues');

    await screen.findByRole('table');
    await user.click(screen.getByTestId('issue-range-today'));
    expect(screen.getByTestId('issue-scope-note')).toHaveTextContent('báo trong khoảng đã chọn');
    await screen.findByTestId('incident-range-summary');

    await user.click(screen.getByTestId('issue-range-clear'));

    await waitFor(() =>
      expect(screen.getByTestId('issue-scope-note')).toHaveTextContent('Đang xem toàn bộ sự cố'),
    );
    expect((screen.getByTestId('issue-range-from') as HTMLInputElement).value).toBe('');
    // The period summary goes with the period it summarised.
    expect(screen.queryByTestId('incident-range-summary')).not.toBeInTheDocument();
  });
});

describe('the period summary', () => {
  it('is hidden until a period is chosen', async () => {
    installMocks();
    renderApp('/app/issues');

    await screen.findByRole('table');
    expect(screen.queryByTestId('incident-range-summary')).not.toBeInTheDocument();
  });

  /**
   * TWO NUMBERS THAT SOUND LIKE ONE, SHOWN AS TWO.
   *
   * Four separate visits failed; one incident is waiting to be picked up again.
   * Printing either alone, or adding them, produces a figure nobody can
   * interpret.
   */
  it('separates failed attempts from incidents needing rework', async () => {
    installMocks();
    const user = userEvent.setup();
    renderApp('/app/issues');

    await screen.findByRole('table');
    await user.click(screen.getByTestId('issue-range-today'));

    const summary = await screen.findByTestId('incident-range-summary');
    const cell = (label: string) =>
      within(summary).getByText(label).parentElement!.textContent ?? '';
    expect(cell('Tổng sự cố phát sinh')).toContain('7');
    expect(cell('Lượt không sửa được')).toContain('4');
    expect(cell('Cần xử lý lại')).toContain('1');
  });

  it('reports the outstanding total as explicitly OUTSIDE the period', async () => {
    installMocks();
    const user = userEvent.setup();
    renderApp('/app/issues');

    await screen.findByRole('table');
    await user.click(screen.getByTestId('issue-range-today'));

    const summary = await screen.findByTestId('incident-range-summary');
    expect(within(summary).getByText(/Ngoài khoảng thời gian này/)).toBeInTheDocument();
    expect(within(summary).getByText('9')).toBeInTheDocument();
  });

  it('does not add a second table to the page', async () => {
    installMocks();
    const user = userEvent.setup();
    renderApp('/app/issues');

    await screen.findByRole('table');
    await user.click(screen.getByTestId('issue-range-today'));
    await screen.findByTestId('incident-range-summary');

    // `findByRole('table')` has to stay unambiguous — for a screen reader as
    // much as for a test.
    expect(screen.getAllByRole('table')).toHaveLength(1);
  });
});

describe('the incident table', () => {
  it('keeps the branch, status and export controls', async () => {
    installMocks();
    renderApp('/app/issues');

    await screen.findByRole('table');
    expect(screen.getByLabelText('Lọc theo trạng thái')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Xuất báo cáo/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Làm mới' })).toBeInTheDocument();
    expect(screen.getByText('Sự cố theo chi nhánh')).toBeInTheDocument();
  });

  it('shows the repair duration the server computed', async () => {
    installMocks();
    renderApp('/app/issues');

    const table = await screen.findByRole('table');
    expect(within(table).getByText('Thời gian xử lý')).toBeInTheDocument();
  });

  it('offers no way to transition anything', async () => {
    installMocks();
    renderApp('/app/issues');

    const table = await screen.findByRole('table');
    expect(within(table).queryByRole('button', { name: 'Tiếp nhận' })).toBeNull();
    expect(within(table).queryByRole('button', { name: /Hoàn thành/ })).toBeNull();
    expect(within(table).queryByRole('button', { name: /Không sửa được/ })).toBeNull();
    // And nowhere else on the page either — the server refuses an Admin
    // transition outright, and the screen must agree with that rule.
    expect(screen.queryByRole('button', { name: /Không sửa được/ })).toBeNull();
  });
});

describe('the export', () => {
  it('starts from the period already on screen', async () => {
    installMocks();
    const user = userEvent.setup();
    renderApp('/app/issues');

    await screen.findByRole('table');
    await user.click(screen.getByTestId('issue-range-today'));
    const from = (screen.getByTestId('issue-range-from') as HTMLInputElement).value;

    await user.click(screen.getByRole('button', { name: /Xuất báo cáo/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Xuất báo cáo sự cố' });

    // The file and the table cannot silently describe two different weeks.
    expect((within(dialog).getByTestId('incident-report-range-from') as HTMLInputElement).value).toBe(from);
  });

  it('opens the PDF with the chosen range', async () => {
    installMocks();
    const open = vi.fn();
    vi.stubGlobal('open', open);
    const user = userEvent.setup();
    renderApp('/app/issues');

    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: /Xuất báo cáo/ }));
    await user.click(await screen.findByTestId('incident-export-confirm'));

    expect(open).toHaveBeenCalledTimes(1);
    const url = String(open.mock.calls[0]![0]);
    expect(url).toContain('/api/admin/reports/incidents.pdf');
    expect(url).toContain('from=');
    expect(url).toContain('to=');
  });
});

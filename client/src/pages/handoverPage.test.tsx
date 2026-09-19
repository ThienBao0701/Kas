/**
 * "BÀN GIAO CA" — the page the next shift opens.
 *
 * THE CLAIMS THIS FILE EXISTS TO PROVE:
 *   1. The next shift can read what the last one said, without doing anything.
 *   2. The form takes ONE required field. It is written by somebody who wants to
 *      go home; anything longer stops being used, and a handover nobody writes
 *      is worse than no feature at all.
 *   3. "Việc đang tồn" is shown BESIDE the box and never typed into it.
 *   4. The author is never asked for — it comes from the shift.
 *   5. An Admin monitors and does not write.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ADMIN_USER, RECEPTIONIST_USER, installApiMock, renderApp } from '../test/utils';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const BRANCH = { id: 1, code: 'TRUONG_DINH_05', hotelName: 'KAS Passion', address: '05 Trương Định' };

function session(over: Record<string, unknown> = {}) {
  return {
    id: 's1',
    branchId: 1,
    shiftType: 'A',
    shiftName: 'Ca A',
    shiftWindow: '06:00 – 14:00',
    receptionistName: 'Nguyễn Văn A',
    startedAt: '2026-09-16T23:00:00.000Z',
    nominalEndAt: '2026-09-17T07:00:00.000Z',
    graceEndAt: '2026-09-17T07:10:00.000Z',
    closedAt: null,
    promptDue: false,
    ...over,
  };
}

function note(over: Record<string, unknown> = {}) {
  return {
    id: 'n1',
    branchId: 1,
    branch: BRANCH,
    shiftSessionId: 's0',
    handoverId: null,
    outgoingName: 'Nguyễn Văn A',
    outgoingShiftType: 'A',
    outgoingShiftName: 'Ca A',
    outgoingShiftWindow: '06:00 – 14:00',
    incomingName: 'Nguyễn Văn B',
    incomingShiftType: 'B',
    incomingShiftName: 'Ca B',
    content: 'Phòng 101 đang chờ kỹ thuật. Booking ABC123 cần kiểm tra.',
    priority: 'NORMAL',
    createdAt: '2026-09-17T06:15:00.000Z',
    ...over,
  };
}

const PENDING = {
  openIssues: [
    { id: 'i1', location: 'Phòng · Phòng 101', status: 'NEW', needsRework: true },
    { id: 'i2', location: 'Khu Vực Sảnh · Sofa', status: 'IN_PROGRESS', needsRework: false },
  ],
  bookings: { awaitingCreation: 3, awaitingReview: 1, needsRecreation: 2 },
};

function shellRoutes(
  user: unknown,
  extra: Record<string, (init: RequestInit) => { status: number; body?: unknown }> = {},
) {
  return {
    'GET /api/auth/me': () => ({ status: 200, body: { user } }),
    'GET /api/notifications/unread-count': () => ({ status: 200, body: { count: 0 } }),
    'GET /api/issues/summary': () => ({
      status: 200,
      body: { summary: { totalUnresolved: 0, newCount: 0, inProgressCount: 0, byBranch: [] } },
    }),
    'GET /api/nav-badges': () => ({
      status: 200,
      body: { counts: { new: 0, pendingReview: 0, rejected: 0, resendOrders: 0, chat: 0, reminders: 0 } },
    }),
    'GET /api/reception/shifts/current': () => ({ status: 200, body: { session: session() } }),
    'GET /api/reception/shifts/options': () => ({ status: 200, body: { shifts: [] } }),
    'GET /api/reception/handover-notes': () => ({ status: 200, body: { notes: [note()] } }),
    'GET /api/reception/handover-notes/context': () => ({ status: 200, body: { pending: PENDING } }),
    ...extra,
  };
}

describe('reading the handover', () => {
  it('shows what the previous shift left, and who left it', async () => {
    installApiMock(shellRoutes(RECEPTIONIST_USER));
    renderApp('/app/handover');

    const card = await screen.findByTestId('handover-note-card');
    expect(within(card).getByText('Ca A')).toBeInTheDocument();
    expect(within(card).getByText('Nguyễn Văn A')).toBeInTheDocument();
    expect(within(card).getByText('→ Nguyễn Văn B')).toBeInTheDocument();
    expect(
      within(card).getByText('Phòng 101 đang chờ kỹ thuật. Booking ABC123 cần kiểm tra.'),
    ).toBeInTheDocument();
  });

  it('marks a priority note', async () => {
    installApiMock(
      shellRoutes(RECEPTIONIST_USER, {
        'GET /api/reception/handover-notes': () => ({
          status: 200,
          body: { notes: [note({ priority: 'HIGH' })] },
        }),
      }),
    );
    renderApp('/app/handover');

    const card = await screen.findByTestId('handover-note-card');
    expect(within(card).getByText('Ưu tiên')).toBeInTheDocument();
  });

  it('says so plainly when there is nothing to read', async () => {
    installApiMock(
      shellRoutes(RECEPTIONIST_USER, {
        'GET /api/reception/handover-notes': () => ({ status: 200, body: { notes: [] } }),
      }),
    );
    renderApp('/app/handover');

    expect(await screen.findByText('Chưa có bàn giao nào')).toBeInTheDocument();
  });
});

describe('writing one', () => {
  it('never asks who is writing — that comes from the shift', async () => {
    installApiMock(shellRoutes(RECEPTIONIST_USER));
    renderApp('/app/handover');

    await screen.findByTestId('handover-note-content');
    // The shift and the person are STATED, not asked for: a note that could
    // name its own author proves nothing about who left it. Scoped to the form,
    // because the same name also appears on the note below it.
    const banner = screen.getByText(/Ca bàn giao:/).closest('div')!;
    expect(within(banner).getByText(/Ca A · 06:00 – 14:00/)).toBeInTheDocument();
    expect(within(banner).getByText('Nguyễn Văn A')).toBeInTheDocument();
    // And there is no input asking for any of it.
    expect(screen.queryByLabelText(/Người bàn giao/)).not.toBeInTheDocument();
  });

  it('requires content and nothing else', async () => {
    installApiMock(shellRoutes(RECEPTIONIST_USER));
    const user = userEvent.setup();
    renderApp('/app/handover');

    const submit = await screen.findByTestId('handover-note-submit');
    expect(submit).toBeDisabled();

    await user.type(screen.getByTestId('handover-note-content'), 'Khách 302 cần gọi lại');
    expect(submit).toBeEnabled();
  });

  it('treats whitespace as nothing', async () => {
    installApiMock(shellRoutes(RECEPTIONIST_USER));
    const user = userEvent.setup();
    renderApp('/app/handover');

    await user.type(await screen.findByTestId('handover-note-content'), '    ');
    expect(screen.getByTestId('handover-note-submit')).toBeDisabled();
  });

  it('posts the content, the optional receiver and the priority', async () => {
    let body: Record<string, unknown> | null = null;
    installApiMock(
      shellRoutes(RECEPTIONIST_USER, {
        'POST /api/reception/handover-notes': (init) => {
          body = JSON.parse(String(init.body)) as Record<string, unknown>;
          return { status: 201, body: { note: note() } };
        },
      }),
    );
    const user = userEvent.setup();
    renderApp('/app/handover');

    await user.type(await screen.findByTestId('handover-note-content'), '  Khách 302 cần gọi lại  ');
    await user.type(screen.getByTestId('handover-note-incoming'), 'Nguyễn Văn B');
    await user.click(screen.getByTestId('handover-note-priority'));
    await user.click(screen.getByTestId('handover-note-submit'));

    await waitFor(() => expect(body).not.toBeNull());
    expect(body).toEqual({
      content: 'Khách 302 cần gọi lại',
      incomingName: 'Nguyễn Văn B',
      priority: 'HIGH',
    });
    // Never sent: the server takes all three from the open session, and a client
    // that could set them could sign a note as somebody else.
    expect(body).not.toHaveProperty('outgoingName');
    expect(body).not.toHaveProperty('branchId');
    expect(body).not.toHaveProperty('outgoingShiftType');
  });

  it('asks for a shift first when there is none', async () => {
    installApiMock(
      shellRoutes(RECEPTIONIST_USER, {
        'GET /api/reception/shifts/current': () => ({ status: 200, body: { session: null } }),
      }),
    );
    renderApp('/app/handover');

    expect(
      await screen.findByText('Vui lòng chọn ca làm việc trước khi ghi bàn giao ca.'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('handover-note-content')).not.toBeInTheDocument();
  });
});

describe('"việc đang tồn"', () => {
  it('shows the branch’s open work beside the box', async () => {
    installApiMock(shellRoutes(RECEPTIONIST_USER));
    renderApp('/app/handover');

    const context = await screen.findByTestId('handover-context');
    expect(within(context).getByText(/Đơn chưa tạo/)).toHaveTextContent('3');
    expect(within(context).getByText(/Chờ Admin kiểm tra/)).toHaveTextContent('1');
    expect(within(context).getByText(/Cần tạo lại/)).toHaveTextContent('2');
    expect(within(context).getByText('Phòng · Phòng 101')).toBeInTheDocument();
    expect(within(context).getByText(/cần xử lý lại/)).toBeInTheDocument();
  });

  /**
   * IT IS NOT PRE-FILLED, AND THAT IS THE POINT.
   *
   * Freezing it into the text would produce a list that is wrong the moment
   * somebody else resolves one of the items — sending the next shift to chase
   * something already done. The note carries what a PERSON needs to say.
   */
  it('is not typed into the note', async () => {
    installApiMock(shellRoutes(RECEPTIONIST_USER));
    renderApp('/app/handover');

    const box = (await screen.findByTestId('handover-note-content')) as HTMLTextAreaElement;
    expect(box.value).toBe('');
  });
});

describe('the Admin view', () => {
  it('monitors without writing', async () => {
    installApiMock(shellRoutes(ADMIN_USER));
    renderApp('/app/handover');

    // The history is there…
    const card = await screen.findByTestId('handover-note-card');
    expect(within(card).getByText('Nguyễn Văn A')).toBeInTheDocument();
    // …and the box is not. An Admin has no shift to hand over.
    expect(screen.queryByTestId('handover-note-content')).not.toBeInTheDocument();
    expect(screen.queryByTestId('handover-note-submit')).not.toBeInTheDocument();
  });
});

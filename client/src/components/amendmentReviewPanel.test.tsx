/**
 * The Amendment Review screen.
 *
 * An amended mail restates a booking the branch is already working from, so
 * two things must hold no matter what the reviewer does:
 *
 *   nothing is applied that they did not tick, and
 *   a mail saying CANCELLED warns but never cancels.
 *
 * The comparison and the write both belong to the server; this panel decides
 * only which fields were selected. These tests therefore assert what it SENDS
 * and what it SHOWS, not what the amendment means.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AmendmentReviewPanel } from './AmendmentReviewPanel';
import type { AmendmentPreview, AmendmentResult } from '../api/otaReview';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const CHANGES = [
  { field: 'guestName', label: 'Tên khách', oldValue: 'Nga Đỗ', newValue: 'Hai Nguyễn' },
  { field: 'checkOut', label: 'Ngày trả phòng', oldValue: '2026-08-05', newValue: '2026-08-07' },
  { field: 'branchPrice', label: 'Giá chi nhánh', oldValue: '529537', newValue: '780000' },
  { field: 'rooms[0].roomType', label: 'Hạng phòng dòng 1', oldValue: 'SUP', newValue: 'DEL' },
  { field: 'rooms[1].roomType', label: 'Hạng phòng dòng 2', oldValue: null, newValue: 'STAN' },
];

function preview(over: Partial<AmendmentPreview> = {}): AmendmentPreview {
  return {
    bookingId: 'bk_1',
    review: {} as AmendmentPreview['review'],
    changes: CHANGES,
    otaCancelled: false,
    currentStatus: 'NEW',
    expectedVersion: '2026-08-02T00:00:00.000Z',
    ...over,
  };
}

function result(over: Partial<AmendmentResult> = {}): AmendmentResult {
  return {
    bookingId: 'bk_1',
    applied: CHANGES.slice(0, 2),
    rejected: CHANGES.slice(2),
    correctionIds: ['corr_a', 'corr_b'],
    ...over,
  };
}

/**
 * Mocks both endpoints, recording every apply body so a test can assert what
 * was actually sent — the only thing this panel decides.
 */
function mockApi(options: { previewData?: AmendmentPreview; applyFails?: boolean } = {}) {
  const applyBodies: { acceptedFields: string[] }[] = [];
  let applyCalls = 0;

  const fetchMock = vi.fn(async (url: string | URL, init: RequestInit = {}) => {
    const body = init.body ? JSON.parse(String(init.body)) : undefined;

    if (String(url).includes('/amendment/apply')) {
      applyCalls += 1;
      applyBodies.push(body);
      if (options.applyFails) {
        return new Response(
          JSON.stringify({ error: { code: 'VALIDATION_ERROR', message: 'Không áp dụng được.' } }),
          { status: 422, headers: { 'Content-Type': 'application/json' } },
        );
      }
      const accepted = CHANGES.filter((c) => body.acceptedFields.includes(c.field));
      const ignored = CHANGES.filter((c) => !body.acceptedFields.includes(c.field));
      return new Response(
        JSON.stringify(
          result({
            applied: accepted,
            rejected: ignored,
            correctionIds: accepted.map((_, i) => `corr_${i}`),
          }),
        ),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    return new Response(JSON.stringify(options.previewData ?? preview()), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  vi.stubGlobal('fetch', fetchMock);
  return { applyBodies, applyCallCount: () => applyCalls };
}

const mount = (onCancel?: () => void) =>
  render(<AmendmentReviewPanel source="AGODA" rawText="RAW" onCancel={onCancel} />);

/* ================================================================== */
/* Rendering                                                           */
/* ================================================================== */
describe('the comparison', () => {
  it('shows only changed fields, old beside new', async () => {
    mockApi();
    mount();

    await screen.findByTestId('amendment-review');
    // Every change is listed with both values.
    for (const change of CHANGES) {
      const row = screen.getByLabelText(`Áp dụng ${change.label}`).closest('li')!;
      expect(within(row).getByText(change.oldValue ?? '—')).toBeInTheDocument();
      expect(within(row).getByText(change.newValue ?? '—')).toBeInTheDocument();
    }
    // Nothing unchanged appears: exactly as many rows as changes.
    expect(screen.getAllByRole('checkbox')).toHaveLength(CHANGES.length);
  });

  it('marks every row as changed', async () => {
    mockApi();
    mount();
    await screen.findByTestId('amendment-review');
    expect(screen.getAllByText('đã thay đổi')).toHaveLength(CHANGES.length);
  });

  it('says so plainly when the mail changes nothing', async () => {
    mockApi({ previewData: preview({ changes: [] }) });
    mount();

    expect(await screen.findByTestId('amendment-no-changes')).toBeInTheDocument();
    // With nothing to apply, neither action is offered.
    expect(screen.getByRole('button', { name: /Áp dụng/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Từ chối tất cả/ })).toBeDisabled();
  });

  it('handles several rooms, prices, dates and guests at once', async () => {
    mockApi();
    mount();
    await screen.findByTestId('amendment-review');

    // Two room lines, a price, a date and a guest — all independently listed.
    expect(screen.getByLabelText('Áp dụng Hạng phòng dòng 1')).toBeInTheDocument();
    expect(screen.getByLabelText('Áp dụng Hạng phòng dòng 2')).toBeInTheDocument();
    expect(screen.getByLabelText('Áp dụng Giá chi nhánh')).toBeInTheDocument();
    expect(screen.getByLabelText('Áp dụng Ngày trả phòng')).toBeInTheDocument();
    expect(screen.getByLabelText('Áp dụng Tên khách')).toBeInTheDocument();
  });
});

/* ================================================================== */
/* Selection                                                           */
/* ================================================================== */
describe('field selection', () => {
  it('starts with every change accepted', async () => {
    mockApi();
    mount();
    await screen.findByTestId('amendment-review');
    for (const box of screen.getAllByRole('checkbox')) expect(box).toBeChecked();
  });

  it('lets the reviewer deselect a single field', async () => {
    mockApi();
    mount();
    await screen.findByTestId('amendment-review');

    const price = screen.getByLabelText('Áp dụng Giá chi nhánh');
    await userEvent.click(price);

    expect(price).not.toBeChecked();
    // Deselecting one leaves the others alone.
    expect(screen.getByLabelText('Áp dụng Tên khách')).toBeChecked();
  });

  it('applies ONLY the ticked fields', async () => {
    const { applyBodies } = mockApi();
    mount();
    await screen.findByTestId('amendment-review');

    await userEvent.click(screen.getByLabelText('Áp dụng Giá chi nhánh'));
    await userEvent.click(screen.getByLabelText('Áp dụng Hạng phòng dòng 2'));
    await userEvent.click(screen.getByRole('button', { name: /Áp dụng/ }));

    await waitFor(() => expect(applyBodies).toHaveLength(1));
    expect(applyBodies[0]!.acceptedFields.sort()).toEqual(
      ['checkOut', 'guestName', 'rooms[0].roomType'].sort(),
    );
  });

  it('disables apply when nothing is ticked', async () => {
    mockApi();
    mount();
    await screen.findByTestId('amendment-review');

    for (const box of screen.getAllByRole('checkbox')) await userEvent.click(box);
    expect(screen.getByRole('button', { name: /Áp dụng/ })).toBeDisabled();
  });
});

/* ================================================================== */
/* Applying and rejecting                                              */
/* ================================================================== */
describe('applying', () => {
  it('reports applied and ignored fields, with the audit ids', async () => {
    mockApi();
    mount();
    await screen.findByTestId('amendment-review');

    await userEvent.click(screen.getByLabelText('Áp dụng Giá chi nhánh'));
    await userEvent.click(screen.getByRole('button', { name: /Áp dụng/ }));

    const applied = await screen.findByTestId('amendment-applied');
    expect(within(applied).getByText(/Tên khách/)).toBeInTheDocument();

    const ignored = screen.getByTestId('amendment-ignored');
    expect(within(ignored).getByText('Giá chi nhánh')).toBeInTheDocument();

    // The real correction rows, so "it was recorded" is verifiable.
    expect(screen.getByTestId('amendment-correction-ids')).toHaveTextContent('corr_0');
  });

  it('rejects everything without applying a single field', async () => {
    const { applyBodies } = mockApi();
    mount();
    await screen.findByTestId('amendment-review');

    await userEvent.click(screen.getByRole('button', { name: /Từ chối tất cả/ }));

    await waitFor(() => expect(applyBodies).toHaveLength(1));
    expect(applyBodies[0]!.acceptedFields).toEqual([]);
    expect(await screen.findByTestId('amendment-result')).toBeInTheDocument();
  });

  it('cannot be submitted twice by a double click', async () => {
    const api = mockApi();
    mount();
    await screen.findByTestId('amendment-review');

    const apply = screen.getByRole('button', { name: /Áp dụng/ });
    await userEvent.click(apply);
    await userEvent.click(apply);

    await waitFor(() => expect(screen.getByTestId('amendment-result')).toBeInTheDocument());
    // One request, one set of corrections — not two.
    expect(api.applyCallCount()).toBe(1);
  });

  it('rolls back to the comparison when the apply fails', async () => {
    mockApi({ applyFails: true });
    mount();
    await screen.findByTestId('amendment-review');

    await userEvent.click(screen.getByLabelText('Áp dụng Giá chi nhánh'));
    await userEvent.click(screen.getByRole('button', { name: /Áp dụng/ }));

    // No success screen, and the selection survives so a retry needs no re-ticking.
    await waitFor(() => expect(screen.queryByTestId('amendment-result')).not.toBeInTheDocument());
    expect(screen.getByTestId('amendment-review')).toBeInTheDocument();
    expect(screen.getByLabelText('Áp dụng Giá chi nhánh')).not.toBeChecked();
    expect(screen.getByLabelText('Áp dụng Tên khách')).toBeChecked();
  });
});

/* ================================================================== */
/* Cancellation is a warning, never an action                          */
/* ================================================================== */
describe('an OTA cancellation', () => {
  it('shows a prominent banner naming the unchanged status', async () => {
    mockApi({ previewData: preview({ otaCancelled: true, currentStatus: 'RECEIVED' }) });
    mount();

    const banner = await screen.findByTestId('amendment-cancelled-banner');
    expect(banner).toHaveTextContent(/ĐÃ HUỶ/);
    expect(banner).toHaveTextContent(/KHÔNG tự huỷ đơn/);
    // The booking's real status is stated, so nobody assumes it changed.
    expect(banner).toHaveTextContent('RECEIVED');
  });

  it('shows no banner for an ordinary amendment', async () => {
    mockApi();
    mount();
    await screen.findByTestId('amendment-review');
    expect(screen.queryByTestId('amendment-cancelled-banner')).not.toBeInTheDocument();
  });

  it('still requires the reviewer to choose — nothing is auto-applied', async () => {
    const { applyBodies } = mockApi({ previewData: preview({ otaCancelled: true }) });
    mount();

    await screen.findByTestId('amendment-cancelled-banner');
    // Merely opening a cancelled amendment writes nothing.
    expect(applyBodies).toHaveLength(0);
  });
});

/* ================================================================== */
/* Cancel                                                              */
/* ================================================================== */
describe('cancelling the review', () => {
  it('closes without applying anything', async () => {
    const onCancel = vi.fn();
    const { applyBodies } = mockApi();
    mount(onCancel);
    await screen.findByTestId('amendment-review');

    await userEvent.click(screen.getByRole('button', { name: 'Huỷ' }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(applyBodies).toHaveLength(0);
  });
});

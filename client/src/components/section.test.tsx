/**
 * The collapsible section, and the statistics panel that consumes 7b.
 *
 * Sections start open on purpose: a detail page that opens half-hidden costs a
 * receptionist a click before they can read, on every guest. Collapsing exists
 * for the long tail, and collapsed content is UNMOUNTED — if it stayed in the
 * DOM the collapse would save nothing and there would be little point to it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Section } from './Section';
import { StatisticsPanel } from './charts/StatisticsPanel';
import { jsonResponse } from '../test/utils';

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

/* ================================================================== */
/* Section                                                             */
/* ================================================================== */
describe('Section', () => {
  const mount = () =>
    render(
      <Section id="t" title="Nhật ký" count={3} testId="s">
        <p>nội dung bên trong</p>
      </Section>,
    );

  it('starts open, so nothing needs a click to be read', () => {
    mount();
    expect(screen.getByText('nội dung bên trong')).toBeInTheDocument();
  });

  it('unmounts its children when collapsed', async () => {
    mount();
    await userEvent.click(screen.getByRole('button', { name: /Nhật ký/ }));
    expect(screen.queryByText('nội dung bên trong')).toBeNull();
  });

  it('reports its expanded state to assistive tech', async () => {
    mount();
    const toggle = screen.getByRole('button', { name: /Nhật ký/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('links the toggle to the panel it controls', () => {
    mount();
    const toggle = screen.getByRole('button', { name: /Nhật ký/ });
    const panel = screen.getByRole('region');
    expect(toggle.getAttribute('aria-controls')).toBe(panel.getAttribute('id'));
  });

  it('shows the count beside the title', () => {
    mount();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('is reachable and operable by keyboard alone', async () => {
    mount();
    await userEvent.tab();
    expect(screen.getByRole('button', { name: /Nhật ký/ })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(screen.queryByText('nội dung bên trong')).toBeNull();
  });

  it('remembers the collapsed choice for next time', async () => {
    const first = mount();
    await userEvent.click(screen.getByRole('button', { name: /Nhật ký/ }));
    first.unmount();

    mount();
    expect(screen.queryByText('nội dung bên trong')).toBeNull();
  });

  it('still renders when storage is unavailable', () => {
    // Private mode throws on access. A section that cannot render because a
    // preference could not be read would be a far worse failure.
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    mount();
    expect(screen.getByText('nội dung bên trong')).toBeInTheDocument();
    spy.mockRestore();
  });
});

/* ================================================================== */
/* StatisticsPanel                                                     */
/* ================================================================== */
const STATS = {
  range: { from: '2026-07-04', to: '2026-08-02' },
  bookingCount: 3,
  revenue: 2_000_000,
  stayNights: 6,
  averageRevenuePerStayNight: 333_333,
  averageStayNights: 2,
  adr: { value: null, reason: 'Room quantity is not stored per room line.' },
  occupancy: { value: null, reason: 'Room inventory not configured.' },
  revPar: { value: null, reason: 'Room inventory not configured.' },
  cancelledCount: 1,
  noShowCount: 1,
  cancellationRate: 20,
  noShowRate: 20,
  byOta: [
    { key: 'AGODA', label: 'Agoda', bookings: 1, revenue: 1_000_000, share: 33.3 },
    { key: 'CTRIP', label: 'CTrip', bookings: 1, revenue: 600_000, share: 33.3 },
  ],
  byBranch: [{ key: '1', label: 'Saigon Hotel', bookings: 2, revenue: 1_600_000, share: 66.7 }],
};

let statsUrls: string[] = [];

function mountStats() {
  statsUrls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL) => {
      statsUrls.push(String(url));
      return jsonResponse(200, STATS);
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <StatisticsPanel />
    </QueryClientProvider>,
  );
}

describe('StatisticsPanel', () => {
  it('reads the 7b endpoint that previously had no consumer', async () => {
    mountStats();
    await waitFor(() => expect(statsUrls.length).toBeGreaterThan(0));
    expect(statsUrls[0]).toContain('/admin/dashboard/statistics');
    expect(statsUrls[0]).toMatch(/from=\d{4}-\d{2}-\d{2}/);
  });

  it('shows the figures the server actually computed', async () => {
    mountStats();
    expect(await screen.findByTestId('stat-revenue')).toHaveTextContent('2.000.000');
    expect(screen.getByTestId('stat-nights')).toHaveTextContent('6');
  });

  it('shows occupancy, RevPAR and ADR as unavailable with the server reason', async () => {
    mountStats();
    expect(await screen.findByTestId('stat-occupancy')).toHaveTextContent('Room inventory not configured.');
    expect(screen.getByTestId('stat-revpar')).toHaveTextContent('Room inventory not configured.');
    expect(screen.getByTestId('stat-adr')).toHaveTextContent('Room quantity is not stored per room line.');
  });

  it('never turns an unavailable metric into a zero', async () => {
    mountStats();
    const occupancy = await screen.findByTestId('stat-occupancy');
    expect(occupancy).toHaveTextContent('N/A');
    expect(occupancy.textContent).not.toMatch(/0%|\b0\b/);
  });

  it('renders the charts from the breakdowns', async () => {
    mountStats();
    expect(await screen.findByTestId('chart-ota')).toBeInTheDocument();
    expect(screen.getByTestId('chart-branch')).toBeInTheDocument();
    expect(screen.getByTestId('chart-rates')).toBeInTheDocument();
  });

  it('refetches for a different range when one is chosen', async () => {
    mountStats();
    await waitFor(() => expect(statsUrls.length).toBeGreaterThan(0));
    const before = statsUrls.length;
    await userEvent.click(screen.getByRole('button', { name: '7 ngày' }));
    await waitFor(() => expect(statsUrls.length).toBeGreaterThan(before));
  });

  it('marks the selected range for assistive tech', async () => {
    mountStats();
    const thirty = await screen.findByRole('button', { name: '30 ngày' });
    expect(thirty).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '7 ngày' })).toHaveAttribute('aria-pressed', 'false');
  });
});

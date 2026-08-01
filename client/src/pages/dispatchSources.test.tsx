/**
 * The intake source tabs.
 *
 * Three platforms have a real extraction parser — Booking.com, Agoda and
 * CTrip — and only those may be offered. Tripadvisor and Traveloka are valid
 * platform identities an Admin can configure, but offering them here would
 * promise an intake the system cannot perform.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ADMIN_USER, installApiMock, renderApp } from '../test/utils';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const BRANCH = {
  id: 1,
  code: 'TRUONG_DINH_05',
  hotelName: 'Saigon Hotel & Ben Thanh',
  address: '05 Trương Định',
};

function mount(onExtract?: (init: RequestInit) => void) {
  const fetchMock = installApiMock({
    'GET /api/auth/me': () => ({ status: 200, body: { user: ADMIN_USER } }),
    'GET /api/notifications/unread-count': () => ({ status: 200, body: { count: 0 } }),
    'GET /api/branches': () => ({ status: 200, body: { branches: [BRANCH] } }),
    'POST /api/bookings/extract': (init) => {
      onExtract?.(init);
      // Deliberately fail: this suite is about the tabs and the request, not
      // the review screen that a success would navigate to.
      return { status: 422, body: { error: { code: 'VALIDATION_ERROR', message: 'Nội dung không hợp lệ.' } } };
    },
  });
  renderApp('/app/dispatch');
  return fetchMock;
}

describe('DispatchPage — intake source tabs', () => {
  it('offers exactly the three platforms that have a parser', async () => {
    mount();
    const tablist = await screen.findByRole('tablist', { name: 'Nguồn đặt phòng' });
    const tabs = within(tablist).getAllByRole('tab');

    expect(tabs.map((t) => t.textContent)).toEqual(['Booking.com', 'Agoda', 'CTrip']);
    // The identity-only platforms are not offered for intake.
    expect(within(tablist).queryByText('Tripadvisor')).not.toBeInTheDocument();
    expect(within(tablist).queryByText('Traveloka')).not.toBeInTheDocument();
  });

  it('marks exactly one tab selected, starting on Booking.com', async () => {
    mount();
    const tablist = await screen.findByRole('tablist', { name: 'Nguồn đặt phòng' });
    const tabs = within(tablist).getAllByRole('tab');

    expect(tabs.filter((t) => t.getAttribute('aria-selected') === 'true')).toHaveLength(1);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('moves the selection when another source is chosen', async () => {
    mount();
    const user = userEvent.setup();
    const tablist = await screen.findByRole('tablist', { name: 'Nguồn đặt phòng' });

    await user.click(within(tablist).getByRole('tab', { name: 'CTrip' }));

    const tabs = within(tablist).getAllByRole('tab');
    expect(tabs.filter((t) => t.getAttribute('aria-selected') === 'true')).toHaveLength(1);
    expect(within(tablist).getByRole('tab', { name: 'CTrip' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('changes the label and helper text with the selected platform', async () => {
    mount();
    const user = userEvent.setup();
    const tablist = await screen.findByRole('tablist', { name: 'Nguồn đặt phòng' });

    expect(await screen.findByText('Nội dung Booking.com')).toBeInTheDocument();
    expect(screen.getByText(/Extranet/)).toBeInTheDocument();

    await user.click(within(tablist).getByRole('tab', { name: 'CTrip' }));
    expect(await screen.findByText('Nội dung CTrip')).toBeInTheDocument();
    // CTrip's helper is explicit that some fields may need manual checking.
    expect(screen.getByText(/kiểm tra và bổ sung thủ công/)).toBeInTheDocument();

    await user.click(within(tablist).getByRole('tab', { name: 'Agoda' }));
    expect(await screen.findByText('Nội dung Agoda')).toBeInTheDocument();
    expect(screen.getByText(/YCS/)).toBeInTheDocument();
  });

  it('sends the chosen source to the extract API', async () => {
    let body: Record<string, unknown> | null = null;
    mount((init) => {
      body = JSON.parse(String(init.body)) as Record<string, unknown>;
    });
    const user = userEvent.setup();

    const tablist = await screen.findByRole('tablist', { name: 'Nguồn đặt phòng' });
    await user.click(within(tablist).getByRole('tab', { name: 'CTrip' }));
    await user.type(screen.getByRole('textbox'), 'KAS Passion Boutique Hotel');
    await user.click(screen.getByRole('button', { name: /Trích xuất thông tin/ }));

    expect(body).not.toBeNull();
    expect(body!.source).toBe('CTRIP');
    expect(body!.rawText).toContain('KAS Passion Boutique Hotel');
  });
});

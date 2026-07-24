import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { BusinessTypeBadge, PaymentBadge } from './Badges';
import { RoomSummary } from './RoomSummary';

describe('BusinessTypeBadge — three labelled states', () => {
  it('shows ĐƠN THƯỜNG for DIRECT (green, text not colour-only)', () => {
    render(<BusinessTypeBadge type="DIRECT" />);
    const el = screen.getByText('ĐƠN THƯỜNG');
    expect(el).toBeInTheDocument();
    expect(el.className).toMatch(/green/);
  });

  it('shows ĐƠN ĐỐI TÁC for PARTNER (orange)', () => {
    render(<BusinessTypeBadge type="PARTNER" />);
    const el = screen.getByText('ĐƠN ĐỐI TÁC');
    expect(el).toBeInTheDocument();
    expect(el.className).toMatch(/orange/);
  });

  it('shows CHƯA XÁC ĐỊNH for UNKNOWN (neutral/gray)', () => {
    render(<BusinessTypeBadge type="UNKNOWN" />);
    const el = screen.getByText('CHƯA XÁC ĐỊNH');
    expect(el).toBeInTheDocument();
    expect(el.className).toMatch(/slate/);
  });
});

describe('PaymentBadge — green / amber, exact wording', () => {
  it('renders PAY BEFORE CHECK-IN in green', () => {
    render(<PaymentBadge status="PAY_BEFORE" />);
    const el = screen.getByText('PAY BEFORE CHECK-IN');
    expect(el).toBeInTheDocument();
    expect(el.className).toMatch(/green/);
  });

  it('renders PAY AFTER CHECK-IN in amber', () => {
    render(<PaymentBadge status="PAY_AFTER" />);
    const el = screen.getByText('PAY AFTER CHECK-IN');
    expect(el).toBeInTheDocument();
    expect(el.className).toMatch(/amber/);
  });
});

describe('RoomSummary — one type per line', () => {
  it('renders an identical-room aggregation on a single line', () => {
    render(<RoomSummary summary="Superior Double (3)" />);
    expect(screen.getByText('Superior Double (3)')).toBeInTheDocument();
  });

  it('renders each type on its own line for a mixed summary', () => {
    const { container } = render(<RoomSummary summary="Superior Double (2) | Deluxe Double (1)" />);
    expect(screen.getByText('Superior Double (2)')).toBeInTheDocument();
    expect(screen.getByText('Deluxe Double (1)')).toBeInTheDocument();
    // Two separate line elements (not one concatenated string with " | ").
    expect(within(container).queryByText(/\|/)).not.toBeInTheDocument();
    expect(container.querySelectorAll('.whitespace-nowrap')).toHaveLength(2);
  });

  it('falls back to a dash when empty', () => {
    render(<RoomSummary summary={null} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});

/**
 * The hand-written SVG charts.
 *
 * These tests are mostly about what a chart says when it has nothing good to
 * say. A bar chart given no data must not draw an empty axis that reads as
 * "zero", and a metric the server refuses to compute must show its reason
 * rather than a confident-looking N/A with no explanation.
 *
 * The other half is accessibility: every chart carries its numbers in text,
 * because a figure that can only be read by eye excludes people from the
 * operational data.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BarChart, DonutChart, Sparkline, UnavailableMetric } from './Charts';
import { seriesColor } from './palette';

const money = (v: number) => `${v.toLocaleString('vi-VN')} ₫`;

describe('BarChart', () => {
  const data = [
    { key: 'a', label: 'Agoda', value: 1_000_000 },
    { key: 'b', label: 'CTrip', value: 600_000 },
  ];

  it('draws one row per datum with its value in text', () => {
    render(<BarChart title="Doanh thu" data={data} format={money} testId="c" />);
    expect(screen.getAllByTestId('bar-row')).toHaveLength(2);
    expect(screen.getByText('Agoda')).toBeInTheDocument();
    expect(screen.getByText(money(1_000_000))).toBeInTheDocument();
  });

  it('describes itself in text for a screen reader', () => {
    render(<BarChart title="Doanh thu" data={data} format={money} testId="c" />);
    const summary = screen.getByTestId('c-summary');
    expect(summary).toHaveTextContent('Agoda');
    expect(summary).toHaveTextContent('CTrip');
    expect(summary).toHaveTextContent(money(600_000));
  });

  it('says there is no data rather than drawing an empty chart', () => {
    render(<BarChart title="Doanh thu" data={[]} format={money} testId="c" />);
    expect(screen.queryAllByTestId('bar-row')).toHaveLength(0);
    expect(screen.getByText(/Chưa có dữ liệu/)).toBeInTheDocument();
  });

  it('scales bars against the largest value, not the total', () => {
    // With a dominant first bar, scaling to the sum would leave the second an
    // invisible sliver. The largest bar is full width.
    const { container } = render(<BarChart title="x" data={data} format={money} testId="c" />);
    // The filled bars carry an explicit colour; the grey track behind them does
    // not, so this measures the bars rather than their backgrounds.
    const widths = [...container.querySelectorAll('rect[fill^="#"]')].map((r) =>
      Number(r.getAttribute('width')),
    );
    expect(widths).toHaveLength(2);
    expect(widths[0]).toBe(100); // the largest value fills the row
    expect(widths[1]).toBeCloseTo(60, 5); // 600k of 1,000k

  });

  it('hides the decorative bars from assistive tech', () => {
    // The number is already in the text beside it; reading the rectangle too
    // would just repeat it.
    const { container } = render(<BarChart title="x" data={data} format={money} testId="c" />);
    for (const svg of container.querySelectorAll('svg')) {
      expect(svg).toHaveAttribute('aria-hidden', 'true');
    }
  });
});

describe('DonutChart', () => {
  const data = [
    { key: 'a', label: 'Agoda', value: 750 },
    { key: 'b', label: 'CTrip', value: 250 },
  ];

  it('turns values into shares that add up', () => {
    render(<DonutChart title="Nguồn" data={data} format={String} testId="d" />);
    expect(screen.getByText('75.0%')).toBeInTheDocument();
    expect(screen.getByText('25.0%')).toBeInTheDocument();
  });

  it('gives every slice a text legend, never colour alone', () => {
    render(<DonutChart title="Nguồn" data={data} format={String} testId="d" />);
    const rows = screen.getAllByTestId('donut-legend-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Agoda');
  });

  it('is labelled as an image with its title', () => {
    render(<DonutChart title="Nguồn" data={data} format={String} testId="d" />);
    expect(screen.getByRole('img', { name: 'Nguồn' })).toBeInTheDocument();
  });

  it('shows no-data rather than a zero-total donut', () => {
    render(
      <DonutChart
        title="Nguồn"
        data={[{ key: 'a', label: 'Agoda', value: 0 }]}
        format={String}
        testId="d"
      />,
    );
    expect(screen.getByText(/Chưa có dữ liệu/)).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
  });
});

describe('Sparkline', () => {
  it('draws a path through several points', () => {
    const { container } = render(
      <Sparkline
        title="Xu hướng"
        points={[
          { label: 'T1', value: 10 },
          { label: 'T2', value: 30 },
          { label: 'T3', value: 20 },
        ]}
        format={String}
        testId="s"
      />,
    );
    const path = container.querySelector('path');
    expect(path).not.toBeNull();
    expect(path!.getAttribute('d')).toMatch(/^M/);
  });

  it('draws a single point as a dot, not an invisible line', () => {
    // One day of data is still data; an empty box would read as none.
    const { container } = render(
      <Sparkline title="Xu hướng" points={[{ label: 'T1', value: 5 }]} format={String} testId="s" />,
    );
    expect(container.querySelector('circle')).not.toBeNull();
    expect(container.querySelector('path')).toBeNull();
  });

  it('carries its points in the text summary', () => {
    render(
      <Sparkline
        title="Xu hướng"
        points={[
          { label: 'T1', value: 10 },
          { label: 'T2', value: 30 },
        ]}
        format={String}
        testId="s"
      />,
    );
    expect(screen.getByTestId('s-summary')).toHaveTextContent('T1: 10; T2: 30');
  });
});

describe('UnavailableMetric', () => {
  it('shows N/A together with the reason the server gave', () => {
    render(<UnavailableMetric title="Công suất" reason="Room inventory not configured." testId="u" />);
    expect(screen.getByText('N/A')).toBeInTheDocument();
    expect(screen.getByText('Room inventory not configured.')).toBeInTheDocument();
  });

  it('never renders a zero — that would read as a real measurement', () => {
    render(<UnavailableMetric title="RevPAR" reason="Room inventory not configured." testId="u" />);
    expect(screen.getByTestId('u').textContent).not.toMatch(/\b0\b/);
  });
});

describe('the palette', () => {
  it('assigns distinct colours to the first few series and then wraps', () => {
    expect(seriesColor(0)).not.toBe(seriesColor(1));
    expect(seriesColor(0)).toBe(seriesColor(6));
  });
});

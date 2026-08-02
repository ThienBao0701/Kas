import { useId } from 'react';
import { seriesColor } from './palette';

/**
 * Hand-written SVG charts.
 *
 * No charting library, by instruction — and at this scale a library would be
 * mostly cost anyway: these are three shapes, and the whole file is smaller
 * than the import it replaces.
 *
 * Three rules hold across all of them:
 *
 *   They scale with their container, never a measured pixel width. Charts sized
 *   from a ResizeObserver need a second paint to look right and jump on a phone
 *   rotation; a `viewBox` with `width: 100%` is resolution-independent and
 *   correct on the first frame.
 *
 *   Colour is never the only carrier of meaning. Every series is labelled in
 *   text, and every chart exposes a table-shaped description to screen readers,
 *   because a chart that can only be read by eye excludes people from the
 *   operational numbers.
 *
 *   Nothing is invented. A metric with no value renders as an explicit
 *   "unavailable" panel with its reason, never as a zero — a zero bar reads as
 *   "we measured none", which is a different and false claim.
 */

/** One slice or bar. */
export interface ChartDatum {
  key: string;
  label: string;
  value: number;
}

/* ================================================================== */
/* Shared frame                                                        */
/* ================================================================== */

/**
 * A chart with its heading and its screen-reader description.
 *
 * `summary` is the chart in words. A sighted user reads the bars; everyone else
 * reads this, so it carries the same numbers rather than describing the picture.
 */
function ChartFrame({
  title,
  summary,
  children,
  testId,
}: {
  title: string;
  summary: string;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <figure className="m-0" data-testid={testId}>
      <figcaption className="mb-2 text-sm font-semibold text-slate-700">{title}</figcaption>
      {children}
      <p className="sr-only" data-testid={testId ? `${testId}-summary` : undefined}>
        {summary}
      </p>
    </figure>
  );
}

/** "Không có dữ liệu" — an empty chart, said plainly rather than drawn as zero. */
function NoData({ message = 'Chưa có dữ liệu trong khoảng thời gian này.' }: { message?: string }) {
  return (
    <p className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
      {message}
    </p>
  );
}

/**
 * A metric the system refuses to compute, with the reason it gives.
 *
 * Occupancy, RevPAR and ADR land here: the inputs genuinely do not exist, and
 * a plausible-looking percentage would be worse than an empty panel because
 * nobody could tell it was invented.
 */
export function UnavailableMetric({
  title,
  reason,
  testId,
}: {
  title: string;
  reason: string;
  testId?: string;
}) {
  return (
    <div
      className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/60 p-5"
      data-testid={testId}
    >
      <p className="text-sm font-semibold text-slate-700">{title}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-400">N/A</p>
      <p className="mt-1 text-xs text-slate-500">{reason}</p>
    </div>
  );
}

/* ================================================================== */
/* Bar chart                                                           */
/* ================================================================== */

/**
 * A horizontal bar chart.
 *
 * Horizontal rather than vertical because the labels are branch addresses and
 * hotel names — long, Vietnamese, and unreadable rotated 90 degrees under a
 * vertical axis.
 */
export function BarChart({
  title,
  data,
  format,
  testId,
}: {
  title: string;
  data: ChartDatum[];
  /** How a value reads in the label, e.g. money or a percentage. */
  format: (value: number) => string;
  testId?: string;
}) {
  if (data.length === 0) {
    return (
      <ChartFrame title={title} summary={`${title}: không có dữ liệu.`} testId={testId}>
        <NoData />
      </ChartFrame>
    );
  }

  // Scale to the largest bar, never to the total: with one dominant branch
  // every other bar would collapse to an invisible sliver.
  const max = Math.max(...data.map((d) => d.value), 1);

  return (
    <ChartFrame
      title={title}
      summary={`${title}. ${data.map((d) => `${d.label}: ${format(d.value)}`).join('; ')}.`}
      testId={testId}
    >
      <ul className="space-y-2">
        {data.map((d, i) => (
          <li key={d.key} data-testid="bar-row">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate text-slate-700">{d.label}</span>
              <span className="shrink-0 font-medium text-slate-900">{format(d.value)}</span>
            </div>
            {/*
              The bar is decoration: the number beside it is the fact, and it is
              already in the text above. Hidden from assistive tech so the
              summary is not read twice.
            */}
            <svg
              viewBox="0 0 100 6"
              preserveAspectRatio="none"
              className="mt-1 h-2 w-full"
              aria-hidden="true"
              focusable="false"
            >
              <rect x="0" y="0" width="100" height="6" rx="3" className="fill-slate-100" />
              <rect
                x="0"
                y="0"
                width={Math.max((d.value / max) * 100, d.value > 0 ? 1 : 0)}
                height="6"
                rx="3"
                fill={seriesColor(i)}
              />
            </svg>
          </li>
        ))}
      </ul>
    </ChartFrame>
  );
}

/* ================================================================== */
/* Donut chart                                                         */
/* ================================================================== */

/**
 * A donut for share-of-total.
 *
 * Drawn with stroke-dasharray on circles rather than arc paths: one circle per
 * slice, each offset by the running total. It is far less arithmetic than arc
 * geometry, and there is no seam artefact where the last slice meets the first.
 */
export function DonutChart({
  title,
  data,
  format,
  testId,
}: {
  title: string;
  data: ChartDatum[];
  format: (value: number) => string;
  testId?: string;
}) {
  const titleId = useId();
  const total = data.reduce((sum, d) => sum + d.value, 0);

  if (data.length === 0 || total <= 0) {
    return (
      <ChartFrame title={title} summary={`${title}: không có dữ liệu.`} testId={testId}>
        <NoData />
      </ChartFrame>
    );
  }

  // Circumference of r=15.915 is ~100, so a slice's dash length IS its percent.
  const RADIUS = 15.915;
  let offset = 0;
  const slices = data.map((d, i) => {
    const percent = (d.value / total) * 100;
    const slice = { ...d, percent, offset, color: seriesColor(i) };
    offset += percent;
    return slice;
  });

  return (
    <ChartFrame
      title={title}
      summary={`${title}. ${slices
        .map((s) => `${s.label}: ${format(s.value)}, ${s.percent.toFixed(1)}%`)
        .join('; ')}.`}
      testId={testId}
    >
      <div className="flex flex-wrap items-center gap-5">
        <svg viewBox="0 0 42 42" className="h-32 w-32 shrink-0" role="img" aria-labelledby={titleId}>
          <title id={titleId}>{title}</title>
          <circle cx="21" cy="21" r={RADIUS} fill="transparent" className="stroke-slate-100" strokeWidth="6" />
          {slices.map((s) => (
            <circle
              key={s.key}
              cx="21"
              cy="21"
              r={RADIUS}
              fill="transparent"
              stroke={s.color}
              strokeWidth="6"
              strokeDasharray={`${s.percent} ${100 - s.percent}`}
              // -25 puts the first slice at 12 o'clock instead of 3 o'clock.
              strokeDashoffset={25 - s.offset}
            />
          ))}
        </svg>
        <ul className="min-w-0 flex-1 space-y-1.5 text-sm">
          {slices.map((s) => (
            <li key={s.key} className="flex items-center gap-2" data-testid="donut-legend-row">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: s.color }}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1 truncate text-slate-700">{s.label}</span>
              <span className="shrink-0 text-slate-500">{s.percent.toFixed(1)}%</span>
              <span className="shrink-0 font-medium text-slate-900">{format(s.value)}</span>
            </li>
          ))}
        </ul>
      </div>
    </ChartFrame>
  );
}

/* ================================================================== */
/* Sparkline                                                           */
/* ================================================================== */

/** One point on a trend line. */
export interface TrendPoint {
  label: string;
  value: number;
}

/**
 * A small trend line.
 *
 * A single point draws as a dot rather than an invisible zero-length line —
 * one day's data is still data, and an empty box would read as no data.
 */
export function Sparkline({
  title,
  points,
  format,
  testId,
}: {
  title: string;
  points: TrendPoint[];
  format: (value: number) => string;
  testId?: string;
}) {
  const titleId = useId();

  if (points.length === 0) {
    return (
      <ChartFrame title={title} summary={`${title}: không có dữ liệu.`} testId={testId}>
        <NoData />
      </ChartFrame>
    );
  }

  const values = points.map((p) => p.value);
  const max = Math.max(...values);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const W = 100;
  const H = 28;

  const at = (index: number, value: number) => {
    const x = points.length === 1 ? W / 2 : (index / (points.length - 1)) * W;
    const y = H - ((value - min) / span) * H;
    return { x, y };
  };

  const line = points.map((p, i) => {
    const { x, y } = at(i, p.value);
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
  });

  return (
    <ChartFrame
      title={title}
      summary={`${title}. ${points.map((p) => `${p.label}: ${format(p.value)}`).join('; ')}.`}
      testId={testId}
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="h-16 w-full"
        role="img"
        aria-labelledby={titleId}
      >
        <title id={titleId}>{title}</title>
        {points.length === 1 ? (
          <circle cx={W / 2} cy={at(0, points[0]!.value).y} r="1.5" fill={seriesColor(0)} />
        ) : (
          <path
            d={line.join(' ')}
            fill="none"
            stroke={seriesColor(0)}
            strokeWidth="1.5"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      <div className="mt-1 flex justify-between text-xs text-slate-500">
        <span>{points[0]!.label}</span>
        <span>{points[points.length - 1]!.label}</span>
      </div>
    </ChartFrame>
  );
}

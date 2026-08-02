/**
 * The chart palette.
 *
 * Its own module so the chart file exports only components — a mixed module
 * breaks fast refresh, and the palette is data rather than UI.
 *
 * The six are ordered to stay distinguishable when they land next to each
 * other, and to differ in lightness as well as hue so they survive greyscale
 * printing and the commoner forms of colour blindness. Colour is never the only
 * carrier of meaning in these charts regardless — every series is labelled in
 * text — but a legend is easier to follow when the swatches do not collide.
 */
const SERIES = ['#2563eb', '#0d9488', '#f59e0b', '#7c3aed', '#dc2626', '#64748b'];

/** The colour for series `index`, wrapping once the palette is exhausted. */
export function seriesColor(index: number): string {
  return SERIES[index % SERIES.length]!;
}

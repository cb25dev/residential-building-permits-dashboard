// Choropleth classification. Every threshold is computed from the values currently on
// the map (after filters) - nothing here is a hand-picked break. Breaks are rounded to
// "nice" numbers for a readable legend; rounding never reorders or merges classes.

import { fmtCompact } from './format';

export const PALETTES = {
  // Sequential blue (reference ramp, steps 100..700) for absolute permits.
  blue: ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'],
  // Sequential violet, lightness-matched to the blue ramp (OKLCH), for per-1,000 rates.
  violet: ['#e2daf8', '#c7b7ef', '#ad93e4', '#946dda', '#7753b5', '#5a3d8d', '#3f2865'],
  // Diverging arms (dark -> light) and neutral midpoint for YoY growth.
  red: ['#8c2924', '#da554b', '#f3ada5'],
  green: ['#03622a', '#2b9f52', '#9fd0a8'],
  blueArm: ['#125095', '#3987e5', '#9fc5f4'],
  neutral: '#f0efec',
  zeroBlue: '#f2f6fb',
  zeroViolet: '#f6f3fc',
} as const;

export const SPECIAL = {
  nodata: { fill: '#e7e6e1', label: 'No BPS county data' },
  na: { fill: '#c9c8c1', label: 'N/A – not comparable' },
  low: { fill: '#e2e1db', label: 'Below minimum prior volume' },
} as const;

export interface LegendClass {
  color: string;
  lo: number | null; // inclusive lower bound (null = open)
  hi: number | null; // exclusive upper bound (null = open)
  label: string;
  count: number;
}

export interface Scale {
  classes: LegendClass[];
  classify: (v: number) => number;
  note: string;
}

export function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Round to two significant figures (integers stay integers above 10). */
export function niceRound(v: number): number {
  if (v === 0 || !Number.isFinite(v)) return v;
  const sign = Math.sign(v);
  const a = Math.abs(v);
  const p = Math.pow(10, Math.floor(Math.log10(a)) - 1);
  const r = Math.round(a / p) * p;
  return sign * (a >= 10 ? Math.round(r) : +r.toPrecision(2));
}

/** Snap to the nearest 1-2-2.5-5 x 10^n value (for log-spaced breaks). */
export function niceLog(v: number): number {
  const e = Math.floor(Math.log10(v));
  const base = Math.pow(10, e);
  const steps = [1, 2, 2.5, 5, 10];
  const m = v / base;
  let best = steps[0];
  for (const s of steps) if (Math.abs(Math.log(m / s)) < Math.abs(Math.log(m / best))) best = s;
  return +(best * base).toPrecision(3);
}

function uniqueIncreasing(xs: number[]): number[] {
  const out: number[] = [];
  for (const x of xs) if (Number.isFinite(x) && (out.length === 0 || x > out[out.length - 1])) out.push(x);
  return out;
}

function classifier(breaks: number[]) {
  // class i covers [breaks[i-1], breaks[i])
  return (v: number) => {
    let i = 0;
    while (i < breaks.length && v >= breaks[i]) i++;
    return i;
  };
}

function rangeLabel(lo: number | null, hi: number | null, fmt: (v: number) => string) {
  if (lo == null && hi != null) return `< ${fmt(hi)}`;
  if (hi == null && lo != null) return `≥ ${fmt(lo)}`;
  return `${fmt(lo!)} – ${fmt(hi!)}`;
}

function build(values: number[], breaks: number[], colors: readonly string[], fmt: (v: number) => string,
               zeroColor: string | null, note: string): Scale {
  const pos = zeroColor ? values.filter((v) => v > 0) : values;
  const cls = classifier(breaks);
  const classes: LegendClass[] = [];
  const nb = breaks.length + 1;
  // Spread available colors across the actual number of classes (dark end kept).
  const pick = (i: number) => colors[Math.round((i * (colors.length - 1)) / Math.max(nb - 1, 1))];
  if (zeroColor) classes.push({ color: zeroColor, lo: 0, hi: 0, label: '0', count: values.length - pos.length });
  for (let i = 0; i < nb; i++) {
    const lo = i === 0 ? (zeroColor ? null : null) : breaks[i - 1];
    const hi = i === nb - 1 ? null : breaks[i];
    classes.push({ color: pick(i), lo, hi, label: rangeLabel(lo, hi, fmt), count: 0 });
  }
  const off = zeroColor ? 1 : 0;
  for (const v of pos) classes[off + cls(v)].count++;
  if (zeroColor && classes.length > 1 && classes[1].lo == null) {
    const first = classes[1];
    first.label = first.hi != null ? `> 0 – ${fmt(first.hi)}` : '> 0';
  }
  return {
    classes,
    classify: (v: number) => (zeroColor && v === 0 ? 0 : off + cls(v)),
    note,
  };
}

/** Sequential classes for non-negative magnitudes. Zero gets its own class. */
export function sequentialScale(values: number[], mode: 'log' | 'quantile', colors: readonly string[],
                                zeroColor: string, k = 7, fmt: (v: number) => string = fmtCompact): Scale {
  const pos = values.filter((v) => v > 0).sort((a, b) => a - b);
  if (pos.length < 2) return build(values, [], colors, fmt, zeroColor, 'Too few values to classify');
  let breaks: number[];
  let note: string;
  if (mode === 'quantile') {
    breaks = uniqueIncreasing(Array.from({ length: k - 1 }, (_, i) => niceRound(quantile(pos, (i + 1) / k))));
    note = `Quantile classes: each holds about 1/${k} of counties with permits (breaks from the data shown).`;
  } else {
    const lo = Math.max(quantile(pos, 0.02), pos[0]);
    const hi = quantile(pos, 0.995);
    const r = hi / lo;
    breaks = uniqueIncreasing(Array.from({ length: k - 1 }, (_, i) => niceLog(lo * Math.pow(r, (i + 1) / k))));
    note = `Logarithmic classes spanning the 2nd–99.5th percentile of counties with permits (${fmt(lo)}–${fmt(hi)}).`;
  }
  return build(values, breaks, colors, fmt, zeroColor, note);
}

/** Diverging YoY classes: neutral band around zero, data-driven terciles on each side. */
export function divergingScale(values: number[], negColors: readonly string[], posColors: readonly string[],
                               neutral: string): Scale {
  const fmt = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v) >= 10 ? Math.round(Math.abs(v)) : +Math.abs(v).toFixed(1)}%`;
  const abs = values.map(Math.abs).sort((a, b) => a - b);
  if (values.length < 6) {
    return { classes: [{ color: neutral, lo: null, hi: null, label: 'All', count: values.length }], classify: () => 0, note: 'Too few values to classify' };
  }
  // "Approximately zero": the band holding the 10% of counties with the smallest
  // absolute change, rounded, at least ±1%.
  const n = Math.max(1, niceRound(quantile(abs, 0.1)));
  const neg = values.filter((v) => v <= -n).sort((a, b) => a - b);
  const pos = values.filter((v) => v >= n).sort((a, b) => a - b);
  const nb = uniqueIncreasing([niceRound(quantile(neg, 1 / 3)), niceRound(quantile(neg, 2 / 3))]).filter((x) => x < -n);
  const pb = uniqueIncreasing([niceRound(quantile(pos, 1 / 3)), niceRound(quantile(pos, 2 / 3))]).filter((x) => x > n);
  const breaks = [...nb, -n, n, ...pb];
  const negC = negColors.slice(negColors.length - (nb.length + 1));
  const posC = [...posColors].reverse().slice(0, pb.length + 1);
  const colors = [...negC, neutral, ...posC];
  const cls = classifier(breaks);
  const classes: LegendClass[] = colors.map((color, i) => {
    const lo = i === 0 ? null : breaks[i - 1];
    const hi = i === colors.length - 1 ? null : breaks[i];
    const label = color === neutral ? `−${n}% to +${n}%` : rangeLabel(lo, hi, fmt);
    return { color, lo, hi, label, count: 0 };
  });
  for (const v of values) classes[cls(v)].count++;
  const lo = neg.length ? neg[0] : null;
  const hi = pos.length ? pos[pos.length - 1] : null;
  return {
    classes,
    classify: cls,
    note: `Neutral band ±${n}% holds the 10% of counties with the smallest change; other breaks are terciles of ` +
      `declines and of increases. Outer classes are open-ended (observed range ${lo != null ? fmt(lo) : '–'} to ${hi != null ? fmt(hi) : '–'}).`,
  };
}

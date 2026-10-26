const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const NA = 'N/A';

export function fmtInt(v: number | null | undefined): string {
  return v == null || Number.isNaN(v) ? NA : Math.round(v).toLocaleString('en-US');
}

export function fmtPct(v: number | null | undefined, digits = 1): string {
  if (v == null || Number.isNaN(v)) return NA;
  const s = v.toFixed(digits);
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${s.replace('-', '')}%`;
}

export function fmtRate(v: number | null | undefined, digits = 2): string {
  return v == null || Number.isNaN(v) ? NA : v.toFixed(digits);
}

export function fmtShare(v: number | null | undefined): string {
  return v == null || Number.isNaN(v) ? NA : `${Math.round(v * 100)}%`;
}

/** Compact legend numbers: 1,250 / 12.5k / 1.2M. */
export function fmtCompact(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e6) return `${+(v / 1e6).toFixed(1)}M`;
  if (a >= 1e4) return `${+(v / 1e3).toFixed(0)}k`;
  if (a >= 1e3) return `${+(v / 1e3).toFixed(1)}k`;
  if (a >= 10 || Number.isInteger(v)) return `${Math.round(v)}`;
  return `${+v.toFixed(2)}`;
}

export function monthLabel(period: string, long = false): string {
  const [y, m] = period.split('-').map(Number);
  return `${(long ? MONTHS_LONG : MONTHS)[m - 1]} ${y}`;
}

export function periodRange([a, b]: [string, string]): string {
  return `${monthLabel(a)} – ${monthLabel(b)}`;
}

export function dateLabel(iso: string | null): string {
  if (!iso) return NA;
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export function addMonths(period: string, n: number): string {
  const [y, m] = period.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}

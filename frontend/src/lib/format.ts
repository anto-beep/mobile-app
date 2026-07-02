// AU formatters and small i18n helpers — Phase A.
// `formatAUD` / `formatAUD2` already live in lib/theme.ts; this module adds
// AU-formatted dates ("3 Mar 2026"), relative dates ("3 days left"),
// and a colour-swatch lookup that drives the participant switcher.

import { formatDate } from './formatDate';

export const COLOR_SWATCHES = [
  '#0E4D52',  // teal-600
  '#3D8488',  // teal-400
  '#54775A',  // sage-500
  '#A5512B',  // clay-500
  '#6E6559',  // neutral-600
] as const;

export function swatchForIndex(idx: number | null | undefined): string {
  const i = Math.max(0, Math.min(COLOR_SWATCHES.length - 1, Number(idx ?? 0)));
  return COLOR_SWATCHES[i];
}

export function initialOf(s: string | null | undefined): string {
  if (!s) return '?';
  const c = s.trim().charAt(0);
  return c ? c.toUpperCase() : '?';
}

export function formatAUDate(input: string | Date | null | undefined): string {
  if (!input) return '—';
  // §19 — delegate to the canonical DD/MM/YYYY formatter so EVERY screen that
  // calls formatAUDate (statements, audit, timeline, alerts, settings/plan,
  // dashboard, etc.) renders dates in Australian DD/MM/YYYY form.
  const out = formatDate(input);
  return out || '—';
}

/** "Mon, 03/03/2026" — used in trial-end labels. Day-of-week + DD/MM/YYYY. */
export function formatAUWeekday(input: string | Date | null | undefined): string {
  if (!input) return '—';
  const d = typeof input === 'string' ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return '—';
  const wd = d.toLocaleDateString('en-AU', { weekday: 'short' });
  return `${wd}, ${formatDate(d)}`;
}

export function daysUntil(input: string | Date | null | undefined): number | null {
  if (!input) return null;
  const d = typeof input === 'string' ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return null;
  const ms = d.getTime() - Date.now();
  if (ms <= 0) return 0;
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
}

export function shortFirstName(name: string | null | undefined, max = 14): string {
  if (!name) return '';
  const f = name.trim().split(/\s+/)[0] || '';
  return f.length > max ? f.slice(0, max - 1) + '…' : f;
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

/** "2026-05" → "May 2026". Month + year always render as "Month YYYY". */
export function formatMonthYear(input: string | Date | null | undefined): string {
  if (!input) return '';
  if (typeof input === 'string') {
    const m = input.match(/^(\d{4})-(0[1-9]|1[0-2])$/);
    if (m) return `${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
  }
  const d = typeof input === 'string' ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return String(input);
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

// Render-time guard (UI-2 follow-up): historical records on production still
// stream raw "YYYY-MM" tokens through the API. Apply this to any alert or
// notification title/body before display so "2026-05" renders as "May 2026".
export function humanizeMonths(text: string): string {
  if (!text) return text;
  return text.replace(/\b(\d{4})-(0[1-9]|1[0-2])\b(?!-\d)/g,
    (_m, y, mo) => `${MONTHS[Number(mo) - 1]} ${y}`);
}

// Apostrophe-safe Title Case (UI-2 Rule 2.4). Never produces "Month'S" —
// letters directly after an apostrophe stay lowercase.
export function titleCaseSafe(text: string): string {
  if (!text) return text;
  return text.replace(/\b\w/g, (ch, offset: number) => {
    const prev = text[offset - 1];
    if (prev === "'" || prev === '\u2019') return ch;
    return ch.toUpperCase();
  });
}

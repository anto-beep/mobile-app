// Australian date formatting — DD/MM/YYYY everywhere.
//
// Web parity: /app/frontend/src/lib/formatDate.js
//
// Inputs accepted:
//   • ISO strings ("2026-04-15", "2026-04-15T12:30:00Z")
//   • Date instances
//   • Australian short strings ("15/04/2026") — pass through
//
// Outputs:
//   formatDate(x)     → "15/04/2026"
//   formatDateTime(x) → "15/04/2026, 12:30 pm"
//   formatRelative(x) → "Just now" / "5 minutes ago" / "2 hours ago" /
//                       "Yesterday" / fallback to formatDate

const PAD = (n: number) => (n < 10 ? `0${n}` : String(n));

function parse(input: any): Date | null {
  if (!input) return null;
  if (input instanceof Date) return isNaN(input.getTime()) ? null : input;
  if (typeof input !== 'string') {
    const d = new Date(input);
    return isNaN(d.getTime()) ? null : d;
  }
  // Already DD/MM/YYYY — pass-through (we re-parse defensively).
  const auMatch = input.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (auMatch) {
    const [, dd, mm, yyyy] = auMatch;
    const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(input);
  return isNaN(d.getTime()) ? null : d;
}

export function formatDate(input: any): string {
  const d = parse(input);
  if (!d) return '';
  return `${PAD(d.getDate())}/${PAD(d.getMonth() + 1)}/${d.getFullYear()}`;
}

export function formatDateTime(input: any): string {
  const d = parse(input);
  if (!d) return '';
  let h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? 'pm' : 'am';
  h = h % 12;
  if (h === 0) h = 12;
  return `${formatDate(d)}, ${h}:${PAD(m)} ${ampm}`;
}

export function formatRelative(input: any): string {
  const d = parse(input);
  if (!d) return '';
  const now = Date.now();
  const diffMs = now - d.getTime();
  const diffSec = Math.round(diffMs / 1000);
  if (diffSec < 60 && diffSec > -60) return 'Just now';
  const diffMin = Math.round(diffSec / 60);
  if (diffMin > 0 && diffMin < 60) return `${diffMin} minute${diffMin === 1 ? '' : 's'} ago`;
  if (diffMin < 0 && diffMin > -60) return `in ${-diffMin} minute${diffMin === -1 ? '' : 's'}`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr > 0 && diffHr < 24) return `${diffHr} hour${diffHr === 1 ? '' : 's'} ago`;
  if (diffHr < 0 && diffHr > -24) return `in ${-diffHr} hour${diffHr === -1 ? '' : 's'}`;
  // Yesterday only if the calendar date is one day before today.
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (d.getFullYear() === yesterday.getFullYear() && d.getMonth() === yesterday.getMonth() && d.getDate() === yesterday.getDate()) {
    return 'Yesterday';
  }
  return formatDate(d);
}

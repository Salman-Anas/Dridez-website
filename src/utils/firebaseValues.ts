// ─── Reading values back out of Firebase ─────────────────────────────────────
// Field types in this project are not uniform, and cannot be made uniform
// without a migration that older app builds would not survive: money has been
// written as both a number and a numeric string, timestamps arrive as epoch
// milliseconds, epoch seconds, Firestore Timestamps and locale date strings,
// and a location may be an address string or any of several coordinate shapes.
// Everything that reads those fields goes through here.

/** Milliseconds since epoch, from whichever timestamp shape arrived. */
export const toMs = (v: unknown): number => {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return v > 1e12 ? v : v * 1000;
  if (typeof v === 'string') { const t = Date.parse(v); return Number.isNaN(t) ? 0 : t; }
  if (typeof v === 'object') {
    const o = v as { seconds?: number; _seconds?: number; toDate?: () => Date };
    if (typeof o.toDate === 'function') return o.toDate().getTime();
    if (typeof o.seconds === 'number') return o.seconds * 1000;
    if (typeof o._seconds === 'number') return o._seconds * 1000;
  }
  return 0;
};

/** A real number, never NaN and never a string that would concatenate. */
export const toNum = (v: unknown): number => {
  if (v === null || v === undefined || v === '') return 0;
  const n = typeof v === 'number' ? v : Number(String(v).trim());
  return Number.isFinite(n) ? n : 0;
};

export const formatDateTime = (v: unknown): string => {
  const ms = toMs(v);
  if (!ms) return '—';
  return new Date(ms).toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' });
};

export const formatDateOnly = (v: unknown): string => {
  const ms = toMs(v);
  if (!ms) return '—';
  return new Date(ms).toLocaleDateString('en-PK', { dateStyle: 'medium' });
};

// ─── Period filtering ────────────────────────────────────────────────────────

export type TimePeriod = 'today' | 'week' | 'month' | 'year' | 'all' | 'custom';

export const PERIOD_LABEL: Record<TimePeriod, string> = {
  today: 'Today',
  week: 'This Week',
  month: 'This Month',
  year: 'This Year',
  all: 'All Time',
  custom: 'Custom',
};

export const getPeriodStart = (period: TimePeriod): number => {
  const now = new Date();
  switch (period) {
    case 'today': { const d = new Date(now); d.setHours(0, 0, 0, 0); return d.getTime(); }
    case 'week':  { const d = new Date(now); d.setDate(d.getDate() - d.getDay()); d.setHours(0, 0, 0, 0); return d.getTime(); }
    case 'month': return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    case 'year':  return new Date(now.getFullYear(), 0, 1).getTime();
    default:      return 0;
  }
};

export interface PeriodRange {
  from: number;
  /** Exclusive upper bound; Infinity for an open-ended period. */
  to: number;
}

/**
 * The window a period selection covers. A custom range with only one end filled
 * in stays open on the other side rather than silently matching nothing.
 */
export const periodRange = (
  period: TimePeriod,
  customStart?: string,
  customEnd?: string,
): PeriodRange => {
  if (period === 'all') return { from: 0, to: Infinity };
  if (period === 'custom') {
    const from = customStart ? new Date(customStart).getTime() : 0;
    let to = Infinity;
    if (customEnd) {
      const end = new Date(customEnd);
      end.setHours(23, 59, 59, 999);
      to = end.getTime();
    }
    return { from, to };
  }
  return { from: getPeriodStart(period), to: Infinity };
};

/** Timestamp 0 means "no date recorded" and only belongs in an All Time view. */
export const inPeriod = (ms: number, range: PeriodRange): boolean => {
  if (range.from === 0 && range.to === Infinity) return true;
  if (!ms) return false;
  return ms >= range.from && ms <= range.to;
};

// ─── Locations ───────────────────────────────────────────────────────────────

/** A human-readable place from whatever shape the pickup/dropoff arrived in. */
export const extractLocation = (loc: unknown): string => {
  if (!loc) return 'N/A';
  if (typeof loc === 'string') return loc.trim() || 'N/A';
  if (typeof loc !== 'object') return 'N/A';
  const o = loc as Record<string, unknown>;

  const textFields = [
    'address', 'name', 'place', 'location', 'description', 'title', 'area',
    'label', 'placeName', 'place_name', 'formattedAddress', 'formatted_address',
  ];
  for (const key of textFields) {
    const val = o[key];
    if (typeof val === 'string' && val.trim()) return val.trim();
  }

  const pairs: [string, string][] = [
    ['lat', 'lng'], ['lat', 'long'], ['latitude', 'longitude'],
    ['_lat', '_long'], ['Lat', 'Lng'], ['Latitude', 'Longitude'],
  ];
  for (const [latKey, lngKey] of pairs) {
    const latN = toNum(o[latKey]);
    const lngN = toNum(o[lngKey]);
    if (latN && lngN) return `${latN.toFixed(5)}, ${lngN.toFixed(5)}`;
  }

  return 'N/A';
};

/** "Pickup → Dropoff", trimmed for a table cell. */
export const routeSummary = (pickup: unknown, dropoff: unknown, max = 22): string => {
  const cut = (s: string) => (s.length > max ? `${s.slice(0, max)}…` : s);
  return `${cut(extractLocation(pickup))} → ${cut(extractLocation(dropoff))}`;
};

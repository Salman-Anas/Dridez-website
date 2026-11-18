// ─── TestRates — the portal's own fare experiments ───────────────────────────
// One document per region in `TestRates/{autoId}`. The mobile app never reads
// this collection; it exists so an admin can plot fares observed in a region
// (distance → price) against a candidate fare curve and see how far apart they
// are before changing anything real in `rates/rates`.
//
//   name       string
//   points     { id, distance, rate, label? }[]   distance in km, rate in PKR
//   curve      { minFare, threshold, perKm, cuts } the candidate formula;
//              cuts = { fromKm, perKm }[], ascending by fromKm
//   createdAt  Timestamp (serverTimestamp)
//   updatedAt  Timestamp (serverTimestamp)

import { toNum } from './firebaseValues';

export const TEST_RATES_COLLECTION = 'TestRates';

export interface TestPoint {
  id: string;
  /** Trip length in km. */
  distance: number;
  /** What was charged for it, in PKR. */
  rate: number;
  /** Where the figure came from, e.g. a competitor or a ride type. */
  label?: string;
}

/** From `fromKm` on, each further km is charged `perKm` instead. */
export interface FareCut {
  fromKm: number;
  perKm: number;
}

export interface FareCurve {
  /** Charged for any trip up to the threshold. */
  minFare: number;
  /** Distance in km up to which only the minimum fare is charged. */
  threshold: number;
  /** PKR per km charged beyond the threshold, up to the first cut. */
  perKm: number;
  /** Where the per-km rate changes, ascending by `fromKm`, all past the threshold. */
  cuts: FareCut[];
}

export interface TestRegion {
  id: string;
  name: string;
  points: TestPoint[];
  curve: FareCurve;
  updatedAt: unknown;
}

export const EMPTY_CURVE: FareCurve = { minFare: 0, threshold: 0, perKm: 0, cuts: [] };

/** One straight stretch of the curve: `perKm` from `fromKm` up to `toKm`. */
export interface CurveSegment {
  fromKm: number;
  /** Infinity for the last stretch. */
  toKm: number;
  perKm: number;
  /** Fare at `fromKm`. */
  fareAtStart: number;
}

/**
 * The curve past the threshold as consecutive stretches. Each cut starts a new
 * stretch where the last one ended, so the fare changes slope at a cut but
 * never jumps. Cuts at or before the threshold are ignored.
 */
export const curveSegments = (c: FareCurve): CurveSegment[] => {
  const cuts = c.cuts.filter(k => k.fromKm > c.threshold).sort((a, b) => a.fromKm - b.fromKm);
  const segments: CurveSegment[] = [];
  let fromKm = c.threshold;
  let perKm = c.perKm;
  let fare = c.minFare;
  for (const cut of cuts) {
    if (cut.fromKm === fromKm) { perKm = cut.perKm; continue; }
    segments.push({ fromKm, toKm: cut.fromKm, perKm, fareAtStart: fare });
    fare += (cut.fromKm - fromKm) * perKm;
    fromKm = cut.fromKm;
    perKm = cut.perKm;
  }
  segments.push({ fromKm, toKm: Infinity, perKm, fareAtStart: fare });
  return segments;
};

/**
 * Fare for a trip under the curve: the minimum fare up to the threshold, then
 * each km past it at the per-km rate of the stretch it falls in.
 */
export const curveFare = (c: FareCurve, distance: number): number => {
  if (distance <= c.threshold) return c.minFare;
  const seg = curveSegments(c).find(g => distance <= g.toKm)!;
  return seg.fareAtStart + (distance - seg.fromKm) * seg.perKm;
};

/** Tolerant read of a region document; stored numbers may arrive as strings. */
export const parseRegion = (id: string, data: Record<string, unknown>): TestRegion => {
  const rawPoints = Array.isArray(data.points) ? data.points : [];
  const rawCurve = (data.curve ?? {}) as Record<string, unknown>;
  return {
    id,
    name: typeof data.name === 'string' && data.name.trim() ? data.name : 'Untitled region',
    points: rawPoints
      .map((p, i) => {
        const o = (p ?? {}) as Record<string, unknown>;
        return {
          id: typeof o.id === 'string' ? o.id : `p${i}`,
          distance: toNum(o.distance),
          rate: toNum(o.rate),
          ...(typeof o.label === 'string' && o.label.trim() ? { label: o.label.trim() } : {}),
        };
      })
      .sort((a, b) => a.distance - b.distance),
    curve: {
      minFare: toNum(rawCurve.minFare),
      threshold: toNum(rawCurve.threshold),
      perKm: toNum(rawCurve.perKm),
      cuts: (Array.isArray(rawCurve.cuts) ? rawCurve.cuts : [])
        .map(k => {
          const o = (k ?? {}) as Record<string, unknown>;
          return { fromKm: toNum(o.fromKm), perKm: toNum(o.perKm) };
        })
        .sort((a, b) => a.fromKm - b.fromKm),
    },
    updatedAt: data.updatedAt,
  };
};

export interface PointError {
  point: TestPoint;
  /** What the curve charges at the point's distance. */
  ours: number;
  /** ours − test: positive means the curve charges more. */
  diff: number;
  /** diff as a fraction of the test rate; null when the test rate is 0. */
  pct: number | null;
}

export interface ErrorSummary {
  rows: PointError[];
  /** Mean of |diff|, PKR. */
  mae: number;
  /** Root mean square of diff, PKR. */
  rmse: number;
  /** Mean of diff — the curve's overall lean above (+) or below (−) the test rates. */
  bias: number;
  /** Mean of |pct|, over points with a non-zero test rate. */
  mape: number | null;
  /** The point the curve misses by the most. */
  worst: PointError | null;
}

export const summarizeError = (points: TestPoint[], curve: FareCurve): ErrorSummary => {
  const rows = points.map(point => {
    const ours = curveFare(curve, point.distance);
    const diff = ours - point.rate;
    return { point, ours, diff, pct: point.rate ? diff / point.rate : null };
  });
  const n = rows.length;
  const pcts = rows.flatMap(r => (r.pct === null ? [] : [Math.abs(r.pct)]));
  return {
    rows,
    mae: n ? rows.reduce((s, r) => s + Math.abs(r.diff), 0) / n : 0,
    rmse: n ? Math.sqrt(rows.reduce((s, r) => s + r.diff * r.diff, 0) / n) : 0,
    bias: n ? rows.reduce((s, r) => s + r.diff, 0) / n : 0,
    mape: pcts.length ? pcts.reduce((s, p) => s + p, 0) / pcts.length : null,
    worst: rows.reduce<PointError | null>(
      (w, r) => (!w || Math.abs(r.diff) > Math.abs(w.diff) ? r : w), null),
  };
};

/**
 * Reads pasted lines of "distance, rate[, label]" — commas, tabs or spaces
 * between the numbers, so a column pair copied from a spreadsheet works.
 * Lines that don't start with two numbers are reported back, not dropped.
 */
export const parsePointLines = (text: string): { points: Omit<TestPoint, 'id'>[]; bad: string[] } => {
  const points: Omit<TestPoint, 'id'>[] = [];
  const bad: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^(-?[\d.]+)\s*[,\t; ]\s*(-?[\d.]+)\s*(?:[,\t;]\s*(.*))?$/);
    const distance = m ? Number(m[1]) : NaN;
    const rate = m ? Number(m[2]) : NaN;
    if (!m || !Number.isFinite(distance) || !Number.isFinite(rate) || distance < 0 || rate < 0) {
      bad.push(line);
      continue;
    }
    const label = m[3]?.trim();
    points.push({ distance, rate, ...(label ? { label } : {}) });
  }
  return { points, bad };
};

export const newPointId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

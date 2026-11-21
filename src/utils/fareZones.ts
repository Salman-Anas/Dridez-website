/**
 * District-wise fares — the portal's half of the app's constants/fares.ts.
 * The full contract is in the app repo's schema.md (`fareZones`).
 *
 *   fareZones/national        the common fare for the whole country
 *   fareZones/{districtId}    one district's own prices — only what differs
 *                             (district ids are OCHA P-codes, "PK608" …)
 *
 * Each document: { name, province, vehicles: { bike: Rule, … },
 * cityToCity: { private: Rule, delivery: Rule },
 * commission, ctcCommission, updatedAt, updatedBy }.
 *
 * A Rule is { base, thresholdKm, perKm, steps: [{ fromKm, perKm }] }: the
 * base fare up to thresholdKm, perKm after it, and each step changes the
 * per-km rate from its distance on. A district leaves out whatever should
 * follow the national price; the app then uses the national one (and, with
 * no national price either, the old flat rates in rates/rates).
 */

import { DISTRICT_LIST } from '../data/districts';

export const NATIONAL_ZONE = 'national';

export interface District { id: string; name: string; province: string }

/** Every district of Pakistan, by province then name. */
export const DISTRICTS: District[] = DISTRICT_LIST
  .slice()
  .sort((a, b) => a.province.localeCompare(b.province) || a.name.localeCompare(b.name));

export const PROVINCES: string[] = Array.from(new Set(DISTRICTS.map(d => d.province)));

export interface FareStep { fromKm: number; perKm: number }
export interface FareRule { base: number; thresholdKm: number; perKm: number; steps: FareStep[] }

export interface FareZoneDoc {
  name?: string;
  province?: string;
  vehicles?: Record<string, FareRule>;
  cityToCity?: Record<string, FareRule>;
  commission?: number | null;
  ctcCommission?: number | null;
}

export const VEHICLE_TYPES: { key: string; label: string }[] = [
  { key: 'bike', label: 'Motorcycle' },
  { key: 'bike_delivery', label: 'Motorcycle delivery' },
  { key: 'rickshaw', label: 'Rickshaw' },
  { key: 'mini_nonac', label: 'Mini · Non AC' },
  { key: 'mini_ac', label: 'Mini · AC' },
  { key: 'comfort_nonac', label: 'Comfort · Non AC' },
  { key: 'comfort_ac', label: 'Comfort · AC' },
  { key: 'car_delivery', label: 'Car delivery' },
];

/** City-to-city types with a price of their own. Sharing follows from the private (full-car) fare. */
export const CITY_TYPES: { key: string; label: string; hint: string }[] = [
  { key: 'private', label: 'Private car', hint: 'full car — shared seats are worked out from this' },
  { key: 'delivery', label: 'Delivery', hint: 'whole vehicle' },
];

/**
 * Shared seats cost a share of the full-car fare — the app's SEAT_SHARE in
 * constants/cityRides.ts; keep the two in step. Four seats or more is the
 * whole car. Used for passengers' shared requests and for seats on trips
 * drivers post.
 */
export const SEAT_SHARE: { seats: number; share: number }[] = [
  { seats: 1, share: 0.45 },
  { seats: 2, share: 0.7 },
  { seats: 3, share: 0.9 },
  { seats: 4, share: 1 },
];

const num = (v: unknown): number => {
  const n = typeof v === 'string' ? parseFloat(v) : Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

/** A stored rule tidied up, or null if it doesn't price anything (the app ignores it). */
export function cleanRule(r: unknown): FareRule | null {
  if (!r || typeof r !== 'object') return null;
  const o = r as Record<string, unknown>;
  const steps = (Array.isArray(o.steps) ? o.steps : [])
    .map((s: Record<string, unknown>) => ({ fromKm: num(s?.fromKm), perKm: num(s?.perKm) }))
    .filter(s => s.fromKm > 0)
    .sort((a, b) => a.fromKm - b.fromKm);
  const rule = { base: num(o.base), thresholdKm: num(o.thresholdKm), perKm: num(o.perKm), steps };
  return rule.base > 0 || rule.perKm > 0 || steps.some(s => s.perKm > 0) ? rule : null;
}

/** The fare for `km` under a rule, exactly as the app works it out (before rounding to tens). */
export function fareForRule(rule: FareRule, km: number): number {
  const distance = Math.max(0, km);
  let fare = rule.base;
  if (distance <= rule.thresholdKm) return fare;
  let at = rule.thresholdKm;
  let rate = rule.perKm;
  for (const step of rule.steps) {
    if (step.fromKm <= at) { rate = step.perKm; continue; }
    if (distance <= step.fromKm) break;
    fare += (step.fromKm - at) * rate;
    at = step.fromKm;
    rate = step.perKm;
  }
  return fare + (distance - at) * rate;
}

/** Fares are shown and asked in round tens, as in the app. */
export const roundFare = (n: number): number => (n > 0 ? Math.round(n / 10) * 10 : 0);

/** Commission as stored (0.1 or 10) → a fraction, or null if unset. */
export function parseCommission(v: unknown): number | null {
  const raw = typeof v === 'string' ? parseFloat(v) : Number(v);
  if (!Number.isFinite(raw) || raw <= 0) return null;
  const rate = raw > 1 ? raw / 100 : raw;
  return rate < 1 ? rate : null;
}

export const emptyRule = (): FareRule => ({ base: 0, thresholdKm: 0, perKm: 0, steps: [] });

/** A deep copy that's safe to edit. */
export const copyRule = (r: FareRule): FareRule => ({ ...r, steps: r.steps.map(s => ({ ...s })) });

// ─── Driver and rider ledgers ────────────────────────────────────────────────
// A statement of where the money went, for both sides of an account. This
// mirrors the app's `dridez/constants/ledger.ts` rule for rule, so the portal
// and the app agree on every number:
//
// Driver: every movement of the prepaid wallet (`wallets/{uid}/entries`) —
// top-ups in, commission out, refunds, reversals — plus what each finished
// trip earned. Fares are paid to the driver directly, so "earnings" are the
// fares of completed trips, and "net" is those fares less the commission the
// wallet paid on them.
//
// Rider: what each completed trip cost — in-city rides, city-to-city requests,
// and seats booked on drivers' trips.
//
// Everything is read with single-field queries and filtered here, so no
// composite indexes are needed. The builders are pure, so the per-driver
// statement and the portal-wide commission report share one code path.

import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { toMs, toNum, inPeriod, extractLocation, type PeriodRange } from './firebaseValues';
import { cabtypeLabel } from './rideTaxonomy';
import { isInstantTopup } from './walletSchema';
import type { Cell, SheetSpec } from './excelExport';

type Data = Record<string, unknown>;
/** A Firestore document as the builders need it. */
export interface RawDoc { id: string; data: Data }

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Milliseconds from the first of these that holds a time. */
const firstMs = (...values: unknown[]): number => {
  for (const v of values) {
    const ms = toMs(v);
    if (ms > 0) return ms;
  }
  return 0;
};

/** Rupees, rounded to the paisa, from a number or a numeric string. */
export const money = (v: unknown): number => Math.round(toNum(v) * 100) / 100;

/** "Lahore" from "Liberty Market, Gulberg III, Lahore, Pakistan". */
const shortPlace = (address: unknown): string => {
  const text = typeof address === 'string' ? address : extractLocation(address);
  const parts = (text === 'N/A' ? '' : text)
    .split(',')
    .map(p => p.trim())
    .filter(p => p && !/^pakistan$/i.test(p));
  return parts.length ? parts[parts.length - 1] : '';
};

const routeOf = (pickup: unknown, dropoff: unknown): string =>
  [shortPlace(pickup), shortPlace(dropoff)].filter(Boolean).join(' → ');

const distanceOf = (v: unknown): string => {
  const km = toNum(v);
  if (km > 0) return `${km.toFixed(1)} km`;
  return typeof v === 'string' ? v.trim() : '';
};

/** City-to-city vehicle labels, as the app shows them. Legacy "cabin" = private. */
const CITY_CAB_LABEL: Record<string, string> = {
  private: 'Cabin', cabin: 'Cabin', sharing: 'Sharing', hiace: 'Hiace', delivery: 'Delivery',
};
const cityCabLabel = (raw: unknown): string => {
  const key = str(raw).toLowerCase().trim();
  if (!key) return 'Standard';
  return CITY_CAB_LABEL[key] ?? key.charAt(0).toUpperCase() + key.slice(1);
};

const inCityLabel = (raw: unknown): string => {
  const label = cabtypeLabel(str(raw));
  return label === '—' ? 'Ride' : label;
};

// ─── Periods ─────────────────────────────────────────────────────────────────

export type LedgerPeriod = '7d' | '30d' | 'month' | 'all' | 'custom';

export const LEDGER_PERIOD_LABEL: Record<LedgerPeriod, string> = {
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  month: 'This month',
  all: 'All time',
  custom: 'Custom range',
};

/** "2026-10-01" from a date input, as local midnight. */
const localDay = (iso: string): Date | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
};

/** The window a period covers; a custom range may be open at either end. */
export const ledgerRange = (
  period: LedgerPeriod,
  customStart = '',
  customEnd = '',
  now = Date.now(),
): PeriodRange => {
  switch (period) {
    case '7d': return { from: now - 7 * 86400000, to: Infinity };
    case '30d': return { from: now - 30 * 86400000, to: Infinity };
    case 'month': {
      const d = new Date(now);
      return { from: new Date(d.getFullYear(), d.getMonth(), 1).getTime(), to: Infinity };
    }
    case 'custom': {
      const start = localDay(customStart);
      const end = localDay(customEnd);
      if (end) end.setHours(23, 59, 59, 999);
      return { from: start ? start.getTime() : 0, to: end ? end.getTime() : Infinity };
    }
    default: return { from: 0, to: Infinity };
  }
};

/** "This month", or "1 Oct 2026 – 15 Oct 2026" for a custom range. */
export const ledgerPeriodLabel = (period: LedgerPeriod, customStart = '', customEnd = ''): string => {
  if (period !== 'custom') return LEDGER_PERIOD_LABEL[period];
  const fmt = (iso: string) => {
    const d = localDay(iso);
    return d ? d.toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  };
  const from = fmt(customStart);
  const to = fmt(customEnd);
  if (!from && !to) return 'All time';
  return `${from || 'start'} – ${to || 'today'}`;
};

export const rowsInRange = <T extends { at: number }>(rows: T[], range: PeriodRange): T[] =>
  rows.filter(r => inPeriod(r.at, range));

// ─── Trips ───────────────────────────────────────────────────────────────────

export type TripKind = 'in_city' | 'city' | 'seat';

export const TRIP_KIND_LABEL: Record<TripKind, string> = {
  in_city: 'In-city ride',
  city: 'City to city',
  seat: 'Seat booking',
};

/** One finished trip, from either side. */
export interface TripRow {
  id: string;
  kind: TripKind;
  at: number;
  /** "Mini · AC" / "Cabin" / "2 seats". */
  title: string;
  /** "Lahore → Islamabad", or a distance for in-city rides. */
  route: string;
  fare: number;
  /** Driver side only: commission charged on this trip, net of refunds. */
  commission: number;
}

// ─── Wallet ──────────────────────────────────────────────────────────────────

export type WalletEntryType =
  | 'topup' | 'topup_reversal' | 'commission' | 'ctc_commission' | 'ctc_commission_refund' | 'other';

export const ENTRY_LABEL: Record<WalletEntryType, string> = {
  topup: 'Balance added',
  topup_reversal: 'Top-up reversed',
  commission: 'Commission · in-city ride',
  ctc_commission: 'Commission · city to city',
  ctc_commission_refund: 'Commission refunded',
  other: 'Adjustment',
};

export interface WalletRow {
  id: string;
  type: WalletEntryType;
  at: number;
  /** Signed: positive into the wallet, negative out of it. */
  amount: number;
  balanceAfter: number | null;
  /** What it was for — a ride id, booking or top-up request id. */
  reference: string;
  /** "Added instantly", "Approved by …", a reversal's reason. */
  note: string;
}

const ENTRY_TYPES: WalletEntryType[] = ['topup', 'topup_reversal', 'commission', 'ctc_commission', 'ctc_commission_refund'];
const entryType = (raw: unknown): WalletEntryType =>
  ENTRY_TYPES.includes(raw as WalletEntryType) ? (raw as WalletEntryType) : 'other';

const isCommissionType = (t: WalletEntryType) =>
  t === 'commission' || t === 'ctc_commission' || t === 'ctc_commission_refund';
const isTopupType = (t: WalletEntryType) => t === 'topup' || t === 'topup_reversal';

// ─── Driver ledger ───────────────────────────────────────────────────────────

export interface DriverLedger {
  wallet: WalletRow[];
  trips: TripRow[];
}

export interface DriverTotals {
  /** Top-ups less reversals. */
  added: number;
  /** Commission paid, net of refunds. */
  commission: number;
  earnings: number;
  net: number;
  trips: number;
}

export const driverTotals = (ledger: DriverLedger, range: PeriodRange): DriverTotals => {
  let added = 0;
  let commission = 0;
  for (const e of rowsInRange(ledger.wallet, range)) {
    if (isTopupType(e.type)) added += e.amount;
    if (isCommissionType(e.type)) commission -= e.amount;
  }
  const trips = rowsInRange(ledger.trips, range);
  const earnings = trips.reduce((s, t) => s + t.fare, 0);
  return {
    added: money(added),
    commission: money(commission),
    earnings: money(earnings),
    net: money(earnings - commission),
    trips: trips.length,
  };
};

/** One driver's ledger from their raw documents (already scoped to them). */
export const buildDriverLedger = (input: {
  entries: RawDoc[];
  rides: RawDoc[];
  cityRides: RawDoc[];
  bookings: RawDoc[];
  tripsById: Map<string, Data>;
  now?: number;
}): DriverLedger => {
  const now = input.now ?? Date.now();

  // Wallet movements, and the commission each trip ended up costing.
  const wallet: WalletRow[] = [];
  const commissionFor = new Map<string, number>();
  const charge = (key: string, amount: number) =>
    commissionFor.set(key, (commissionFor.get(key) || 0) - amount);

  for (const { id, data: e } of input.entries) {
    const type = entryType(e.type);
    const amount = money(e.amount);
    let reference: string;
    let note = '';
    if (type === 'commission') {
      reference = str(e.rideId) || id;
      charge(`in_city:${reference}`, amount);
    } else if (type === 'ctc_commission' || type === 'ctc_commission_refund') {
      if (e.bookingId) {
        reference = str(e.bookingId);
        charge(`seat:${reference}`, amount);
      } else {
        reference = str(e.rideId) || id.replace(/^ctc_/, '');
        charge(`city:${reference}`, amount);
      }
    } else {
      reference = str(e.reference);
    }
    if (type === 'topup') {
      note = isInstantTopup({ method: str(e.method), by: str(e.by) })
        ? 'Added instantly'
        : `Approved by ${str(e.by) || '—'}`;
    } else if (type === 'topup_reversal') {
      note = [str(e.reason), e.by ? `reversed by ${str(e.by)}` : ''].filter(Boolean).join(' · ');
    }
    wallet.push({
      id,
      type,
      at: firstMs(e.at),
      amount,
      balanceAfter: e.balanceAfter !== undefined && e.balanceAfter !== null ? money(e.balanceAfter) : null,
      reference,
      note,
    });
  }
  wallet.sort((a, b) => b.at - a.at);

  const trips: TripRow[] = [];

  for (const { id, data: r } of input.rides) {
    if (r.status !== 'completed') continue;
    trips.push({
      id,
      kind: 'in_city',
      at: firstMs(r.completedAt, r.time, r.createdAt),
      title: inCityLabel(r.cabtype),
      route: distanceOf(r.distance),
      fare: money(r.price),
      commission: money(commissionFor.get(`in_city:${id}`) ?? r.commission ?? 0),
    });
  }

  for (const { id, data: r } of input.cityRides) {
    if (r.status !== 'completed') continue;
    trips.push({
      id,
      kind: 'city',
      at: firstMs(r.completedAt, r.createdAt, r.time),
      title: cityCabLabel(r.cabtype),
      route: routeOf(r.pickup, r.dropoff),
      fare: money(r.price),
      commission: money(commissionFor.get(`city:${id}`) || 0),
    });
  }

  // A seat booking has earned its fare once the trip has left and neither the
  // booking nor the trip was called off.
  for (const { id, data: b } of input.bookings) {
    const trip = input.tripsById.get(str(b.tripId));
    if (b.status !== 'confirmed' || !trip || trip.status === 'cancelled') continue;
    const departAt = toMs(trip.departAt);
    if (!departAt || departAt > now) continue;
    const seats = toNum(b.seats);
    trips.push({
      id,
      kind: 'seat',
      at: departAt,
      title: `${seats} ${seats === 1 ? 'seat' : 'seats'}${b.riderName ? ` · ${str(b.riderName)}` : ''}`,
      route: routeOf(trip.pickup, trip.dropoff),
      fare: money(b.fare),
      commission: money(commissionFor.get(`seat:${id}`) || 0),
    });
  }

  trips.sort((a, b) => b.at - a.at);
  return { wallet, trips };
};

const toRaw = (snap: { docs: { id: string; data: () => Data }[] }): RawDoc[] =>
  snap.docs.map(d => ({ id: d.id, data: d.data() }));

export const fetchDriverLedger = async (uid: string): Promise<DriverLedger> => {
  const [entries, rides, city, bookings, trips] = await Promise.all([
    getDocs(collection(db, 'wallets', uid, 'entries')),
    getDocs(query(collection(db, 'rides'), where('driver', '==', uid))),
    getDocs(query(collection(db, 'citytocity'), where('driver', '==', uid))),
    getDocs(query(collection(db, 'driver_trip_bookings'), where('driver', '==', uid))),
    getDocs(query(collection(db, 'driver_trips'), where('driver', '==', uid))),
  ]);
  return buildDriverLedger({
    entries: toRaw(entries),
    rides: toRaw(rides),
    cityRides: toRaw(city),
    bookings: toRaw(bookings),
    tripsById: new Map(trips.docs.map(d => [d.id, d.data()])),
  });
};

/**
 * Every driver's ledger at once, for the portal-wide commission report. The
 * ledger entries are passed in (the Driver Accounts page has already read
 * them); the trips are read whole and grouped by driver here.
 */
export const fetchAllDriverLedgers = async (
  entriesByDriver: Map<string, RawDoc[]>,
): Promise<Map<string, DriverLedger>> => {
  const [rides, city, bookings, trips] = await Promise.all([
    getDocs(collection(db, 'rides')),
    getDocs(collection(db, 'citytocity')),
    getDocs(collection(db, 'driver_trip_bookings')),
    getDocs(collection(db, 'driver_trips')),
  ]);
  const group = (docs: RawDoc[]) => {
    const by = new Map<string, RawDoc[]>();
    for (const d of docs) {
      const driver = str(d.data.driver);
      if (!driver) continue;
      const list = by.get(driver);
      if (list) list.push(d); else by.set(driver, [d]);
    }
    return by;
  };
  const ridesBy = group(toRaw(rides));
  const cityBy = group(toRaw(city));
  const bookingsBy = group(toRaw(bookings));
  const tripsById = new Map(trips.docs.map(d => [d.id, d.data()]));

  const uids = new Set([...entriesByDriver.keys(), ...ridesBy.keys(), ...cityBy.keys(), ...bookingsBy.keys()]);
  const now = Date.now();
  const out = new Map<string, DriverLedger>();
  for (const uid of uids) {
    out.set(uid, buildDriverLedger({
      entries: entriesByDriver.get(uid) ?? [],
      rides: ridesBy.get(uid) ?? [],
      cityRides: cityBy.get(uid) ?? [],
      bookings: bookingsBy.get(uid) ?? [],
      tripsById,
      now,
    }));
  }
  return out;
};

// ─── Rider ledger ────────────────────────────────────────────────────────────

export interface RiderTotals { spent: number; trips: number; average: number }

export const riderTotals = (trips: TripRow[], range: PeriodRange): RiderTotals => {
  const rows = rowsInRange(trips, range);
  const spent = rows.reduce((s, t) => s + t.fare, 0);
  return {
    spent: money(spent),
    trips: rows.length,
    average: rows.length ? Math.round(spent / rows.length) : 0,
  };
};

export const buildRiderTrips = (input: {
  rides: RawDoc[];
  cityRides: RawDoc[];
  bookings: RawDoc[];
  tripsById: Map<string, Data>;
  now?: number;
}): TripRow[] => {
  const now = input.now ?? Date.now();
  const trips: TripRow[] = [];

  for (const { id, data: r } of input.rides) {
    if (r.status !== 'completed') continue;
    trips.push({
      id,
      kind: 'in_city',
      at: firstMs(r.completedAt, r.time, r.createdAt),
      title: inCityLabel(r.cabtype),
      route: distanceOf(r.distance),
      fare: money(r.price),
      commission: 0,
    });
  }

  for (const { id, data: r } of input.cityRides) {
    if (r.status !== 'completed') continue;
    trips.push({
      id,
      kind: 'city',
      at: firstMs(r.completedAt, r.createdAt, r.time),
      title: cityCabLabel(r.cabtype),
      route: routeOf(r.pickup, r.dropoff),
      fare: money(r.price),
      commission: 0,
    });
  }

  // Seats count once the trip has left; the trip itself says when.
  for (const { id, data: b } of input.bookings) {
    if (b.status !== 'confirmed') continue;
    const trip = input.tripsById.get(str(b.tripId));
    if (!trip || trip.status === 'cancelled') continue;
    const departAt = toMs(trip.departAt);
    if (!departAt || departAt > now) continue;
    const seats = toNum(b.seats);
    trips.push({
      id,
      kind: 'seat',
      at: departAt,
      title: `${seats} ${seats === 1 ? 'seat' : 'seats'}`,
      route: routeOf(trip.pickup, trip.dropoff),
      fare: money(b.fare),
      commission: 0,
    });
  }

  trips.sort((a, b) => b.at - a.at);
  return trips;
};

export const fetchRiderLedger = async (uid: string): Promise<TripRow[]> => {
  const [rides, city, bookings] = await Promise.all([
    getDocs(query(collection(db, 'rides'), where('rider', '==', uid))),
    getDocs(query(collection(db, 'citytocity'), where('rider', '==', uid))),
    getDocs(query(collection(db, 'driver_trip_bookings'), where('rider', '==', uid))),
  ]);
  const bookingDocs = toRaw(bookings);
  const tripIds = [...new Set(
    bookingDocs.filter(b => b.data.status === 'confirmed').map(b => str(b.data.tripId)).filter(Boolean),
  )];
  const tripSnaps = await Promise.all(tripIds.map(id => getDoc(doc(db, 'driver_trips', id)).catch(() => null)));
  const tripsById = new Map<string, Data>();
  for (const s of tripSnaps) if (s?.exists()) tripsById.set(s.id, s.data());
  return buildRiderTrips({ rides: toRaw(rides), cityRides: toRaw(city), bookings: bookingDocs, tripsById });
};

// ─── Export sheets ───────────────────────────────────────────────────────────
// The same sheets, columns and widths the app exports.

const date = (at: number): Date | null => (at ? new Date(at) : null);

const monthKey = (at: number): string => {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const monthLabel = (key: string): string => {
  if (key === 'undated') return 'No date';
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-PK', { month: 'short', year: 'numeric' });
};
const keyOf = (at: number) => (at ? monthKey(at) : 'undated');
const byMonthDesc = <T>(m: Map<string, T>) => [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]));

export const driverStatementSheets = (args: {
  name: string;
  phone: string;
  periodLabel: string;
  balance: number | null;
  totals: DriverTotals;
  wallet: WalletRow[];
  trips: TripRow[];
}): SheetSpec[] => {
  const months = new Map<string, { trips: number; earnings: number; commission: number; added: number }>();
  const month = (at: number) => {
    const k = keyOf(at);
    let m = months.get(k);
    if (!m) { m = { trips: 0, earnings: 0, commission: 0, added: 0 }; months.set(k, m); }
    return m;
  };
  for (const t of args.trips) {
    const m = month(t.at);
    m.trips += 1;
    m.earnings += t.fare;
  }
  for (const e of args.wallet) {
    const m = month(e.at);
    if (isTopupType(e.type)) m.added += e.amount;
    if (isCommissionType(e.type)) m.commission -= e.amount;
  }

  return [
    {
      name: 'Summary',
      columns: ['Item', 'Value'],
      widths: [26, 28],
      rows: [
        ['Driver', args.name],
        ['Phone', args.phone],
        ['Period', args.periodLabel],
        ['Generated', new Date()],
        ['Total earnings (PKR)', args.totals.earnings],
        ['Commission paid (PKR)', args.totals.commission],
        ['Net earnings (PKR)', args.totals.net],
        ['Balance added (PKR)', args.totals.added],
        ['Completed trips', args.totals.trips],
        ['Current balance (PKR)', args.balance],
      ],
    },
    {
      name: 'Wallet',
      columns: ['Date', 'Type', 'Details', 'Amount (PKR)', 'Balance after (PKR)', 'Reference'],
      widths: [20, 26, 32, 14, 18, 24],
      rows: args.wallet.map((e): Cell[] => [
        date(e.at), ENTRY_LABEL[e.type], e.note, e.amount, e.balanceAfter, e.reference,
      ]),
    },
    {
      name: 'Trips',
      columns: ['Date', 'Type', 'Details', 'Route', 'Fare (PKR)', 'Commission (PKR)', 'Net (PKR)', 'Trip ID'],
      widths: [20, 16, 22, 28, 12, 16, 12, 24],
      rows: args.trips.map((t): Cell[] => [
        date(t.at), TRIP_KIND_LABEL[t.kind], t.title, t.route, t.fare, t.commission,
        money(t.fare - t.commission), t.id,
      ]),
    },
    {
      name: 'Monthly',
      columns: ['Month', 'Trips', 'Earnings (PKR)', 'Commission (PKR)', 'Net (PKR)', 'Balance added (PKR)'],
      widths: [12, 8, 16, 18, 14, 20],
      rows: byMonthDesc(months).map(([k, m]): Cell[] => [
        monthLabel(k), m.trips, money(m.earnings), money(m.commission), money(m.earnings - m.commission), money(m.added),
      ]),
    },
  ];
};

export const riderSpendingSheets = (args: {
  name: string;
  phone: string;
  periodLabel: string;
  totals: RiderTotals;
  trips: TripRow[];
}): SheetSpec[] => {
  const months = new Map<string, { trips: number; spent: number }>();
  for (const t of args.trips) {
    const k = keyOf(t.at);
    const m = months.get(k) ?? { trips: 0, spent: 0 };
    m.trips += 1;
    m.spent += t.fare;
    months.set(k, m);
  }
  return [
    {
      name: 'Summary',
      columns: ['Item', 'Value'],
      widths: [22, 28],
      rows: [
        ['Rider', args.name],
        ['Phone', args.phone],
        ['Period', args.periodLabel],
        ['Generated', new Date()],
        ['Total spent (PKR)', args.totals.spent],
        ['Completed trips', args.totals.trips],
        ['Average fare (PKR)', args.totals.average],
      ],
    },
    {
      name: 'Trips',
      columns: ['Date', 'Type', 'Details', 'Route', 'Fare (PKR)', 'Trip ID'],
      widths: [20, 16, 18, 28, 12, 24],
      rows: args.trips.map((t): Cell[] => [date(t.at), TRIP_KIND_LABEL[t.kind], t.title, t.route, t.fare, t.id]),
    },
    {
      name: 'Monthly',
      columns: ['Month', 'Trips', 'Spent (PKR)'],
      widths: [12, 8, 14],
      rows: byMonthDesc(months).map(([k, m]): Cell[] => [monthLabel(k), m.trips, money(m.spent)]),
    },
  ];
};

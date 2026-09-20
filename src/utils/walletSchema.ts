// ─── Driver wallets and the commission ledger ────────────────────────────────
// `wallets/{uid}` is the driver's prepaid balance; commission on a finished
// ride is taken from it. `wallets/{uid}/entries/{entryId}` is the ledger, one
// document per movement of money, with deterministic ids so that a retried
// completion can never charge twice.
//
// Sign convention in the stored data: a commission is written as a negative
// `amount`, a refund and a top-up as positive. This module reads the `type`
// rather than trusting the sign, because the type is what the ids and the
// Cloud Functions agree on, and reports every figure as a positive magnitude —
// whether it moved towards the platform or away from it is the caller's
// question, answered by `LEDGER_META[type].direction`.

import { toMs, toNum } from './firebaseValues';

export interface WalletDoc {
  /** Document id — the driver's auth uid. */
  uid: string;
  balance?: unknown;
  currency?: string;
  openingCredit?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface LedgerEntry {
  id: string;
  /** The wallet this entry belongs to; not stored on the entry itself. */
  uid: string;
  type?: string;
  amount?: unknown;
  rate?: unknown;
  fare?: unknown;
  rideId?: string;
  bookingId?: string;
  tripId?: string;
  balanceAfter?: unknown;
  at?: unknown;
  /** Top-ups only, written by this portal. */
  method?: string;
  reference?: string;
  by?: string;
}

export type LedgerType =
  | 'commission'
  | 'ctc_commission'
  | 'ctc_commission_refund'
  | 'topup'
  | 'unknown';

/** Which way the money moved, from the platform's point of view. */
export type LedgerDirection = 'earned' | 'returned' | 'credited' | 'unknown';

export const LEDGER_META: Record<LedgerType, {
  label: string;
  direction: LedgerDirection;
}> = {
  commission:            { label: 'In-city commission',      direction: 'earned' },
  ctc_commission:        { label: 'City-to-city commission', direction: 'earned' },
  ctc_commission_refund: { label: 'Commission refunded',     direction: 'returned' },
  topup:                 { label: 'Wallet top-up',           direction: 'credited' },
  unknown:               { label: 'Other movement',          direction: 'unknown' },
};

export const normaliseLedgerType = (raw?: string): LedgerType => {
  const t = (raw || '').toLowerCase().trim();
  if (t === 'commission' || t === 'ctc_commission' || t === 'ctc_commission_refund' || t === 'topup') {
    return t;
  }
  return 'unknown';
};

/**
 * Where a ledger entry came from. `ctc_commission` has two producers that the
 * fields tell apart: the app charges it with a `rideId` when a driver completes
 * a rider-posted city ride, and the server charges it with a `bookingId` when a
 * rider confirms a seat on a driver-posted trip.
 */
export type LedgerSource = 'in_city' | 'city_ride' | 'seat_booking' | 'refund' | 'topup' | 'other';

export const LEDGER_SOURCE_LABEL: Record<LedgerSource, string> = {
  in_city: 'In-city ride',
  city_ride: 'City-to-city ride',
  seat_booking: 'Seat booking',
  refund: 'Refund',
  topup: 'Top-up',
  other: 'Other',
};

export const ledgerSource = (entry: LedgerEntry): LedgerSource => {
  switch (normaliseLedgerType(entry.type)) {
    case 'commission': return 'in_city';
    case 'ctc_commission': return entry.bookingId ? 'seat_booking' : 'city_ride';
    case 'ctc_commission_refund': return 'refund';
    case 'topup': return 'topup';
    default: return 'other';
  }
};

/**
 * The ride an entry was charged against, when there is one. In-city entries use
 * the ride id as the entry id; city rides prefix it with `ctc_`. Older entries
 * may carry the id only in the document id, so both are checked.
 */
export const ledgerRideId = (entry: LedgerEntry): string | null => {
  if (entry.rideId) return entry.rideId;
  const type = normaliseLedgerType(entry.type);
  if (type === 'commission') return entry.id;
  if (type === 'ctc_commission' && entry.id.startsWith('ctc_')) return entry.id.slice(4);
  return null;
};

/** The magnitude of an entry in rupees — always positive. */
export const entryMagnitude = (entry: LedgerEntry): number => Math.abs(toNum(entry.amount));

export const entryMs = (entry: LedgerEntry): number => toMs(entry.at);

// ─── Per-driver totals ───────────────────────────────────────────────────────

export interface WalletTotals {
  /** Commission taken from this driver. */
  earned: number;
  /** Commission given back when a booking or trip was cancelled. */
  refunded: number;
  /** What the platform actually kept: earned − refunded. */
  net: number;
  /** Credit added from this portal. */
  toppedUp: number;
  /** Number of rides that produced a commission charge. */
  chargeCount: number;
}

export const EMPTY_TOTALS: WalletTotals = {
  earned: 0, refunded: 0, net: 0, toppedUp: 0, chargeCount: 0,
};

export const summariseEntries = (entries: LedgerEntry[]): WalletTotals => {
  const t: WalletTotals = { ...EMPTY_TOTALS };
  for (const e of entries) {
    const amount = entryMagnitude(e);
    switch (normaliseLedgerType(e.type)) {
      case 'commission':
      case 'ctc_commission':
        t.earned += amount;
        t.chargeCount += 1;
        break;
      case 'ctc_commission_refund':
        t.refunded += amount;
        break;
      case 'topup':
        t.toppedUp += amount;
        break;
      default:
        break;
    }
  }
  t.net = t.earned - t.refunded;
  return t;
};

export const addTotals = (a: WalletTotals, b: WalletTotals): WalletTotals => ({
  earned: a.earned + b.earned,
  refunded: a.refunded + b.refunded,
  net: a.net + b.net,
  toppedUp: a.toppedUp + b.toppedUp,
  chargeCount: a.chargeCount + b.chargeCount,
});

// ─── Balance health ──────────────────────────────────────────────────────────

/** The threshold the Cloud Function sends a "low balance" push below. */
export const LOW_BALANCE_THRESHOLD = 200;

export type BalanceState = 'negative' | 'low' | 'ok';

/**
 * A balance may go negative: the commission on a finished ride is always taken,
 * even when the wallet cannot cover it. A driver in that state can no longer
 * offer on rides, which is why it is worth surfacing rather than just counting.
 */
export const balanceState = (balance: number): BalanceState => {
  if (balance < 0) return 'negative';
  if (balance < LOW_BALANCE_THRESHOLD) return 'low';
  return 'ok';
};

export const BALANCE_STATE_LABEL: Record<BalanceState, string> = {
  negative: 'Negative',
  low: 'Low',
  ok: 'Healthy',
};

// ─── Commission that a cancellation cost the platform ────────────────────────

/**
 * A ride cancelled after a driver was accepted earns nothing: commission is
 * only charged on completion. The fare that had been agreed is still on the
 * record, so what the platform would have kept had it finished can be worked
 * out — that is what this represents. It is a counterfactual, not money that
 * ever existed, and is never added to any earnings figure.
 */
export interface MissedCommission {
  rideId: string;
  source: 'in_city' | 'city_ride';
  driver: string;
  /** The agreed fare at the moment of cancellation. */
  fare: number;
  /** The commission rate applied — the ride's own if it recorded one. */
  rate: number;
  /** fare × rate. */
  amount: number;
  /** Whether the rate came from the ride or from the current settings. */
  rateFromRide: boolean;
  at: number;
  cancelledBy?: string;
  cabtype?: string;
  pickup?: unknown;
  dropoff?: unknown;
}

export const computeMissed = (args: {
  rideId: string;
  source: 'in_city' | 'city_ride';
  driver: string;
  fare: unknown;
  /** `commissionRate` from the ride document, if it happens to carry one. */
  rideRate?: unknown;
  /** The rate currently configured for this kind of ride. */
  currentRate: number | null;
  at: number;
  cancelledBy?: string;
  cabtype?: string;
  pickup?: unknown;
  dropoff?: unknown;
}): MissedCommission | null => {
  const fare = toNum(args.fare);
  const ownRate = toNum(args.rideRate);
  const rate = ownRate > 0 ? ownRate : (args.currentRate ?? 0);
  // With no fare or no configured rate there is nothing meaningful to report,
  // and guessing would put an invented number next to real ledger figures.
  if (fare <= 0 || rate <= 0) return null;

  return {
    rideId: args.rideId,
    source: args.source,
    driver: args.driver,
    fare,
    rate,
    amount: fare * rate,
    rateFromRide: ownRate > 0,
    at: args.at,
    cancelledBy: args.cancelledBy,
    cabtype: args.cabtype,
    pickup: args.pickup,
    dropoff: args.dropoff,
  };
};

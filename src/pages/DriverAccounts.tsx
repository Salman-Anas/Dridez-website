import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  collection, collectionGroup, doc, getDoc, getDocs, onSnapshot,
} from 'firebase/firestore';
import { db } from '../firebase';
import {
  cabtypeLabel, formatPKR, resolveCommission, type RatesMap,
} from '../utils/rideTaxonomy';
import {
  getStatus, getUid, getVehicleTitle, getTierLabel,
  STATUS_LABEL, type DriverApplicationFields, type AppStatus,
} from '../utils/driverSchema';
import {
  toMs, toNum, formatDateTime, periodRange, inPeriod, routeSummary,
  PERIOD_LABEL, type TimePeriod,
} from '../utils/firebaseValues';
import {
  summariseEntries, entryMs, entryMagnitude, normaliseLedgerType, ledgerSource,
  ledgerRideId, computeMissed, balanceState, addTotals, topupEntryNote,
  LEDGER_SOURCE_LABEL, BALANCE_STATE_LABEL, LOW_BALANCE_THRESHOLD,
  EMPTY_TOTALS,
  type LedgerEntry, type WalletTotals, type MissedCommission, type BalanceState,
} from '../utils/walletSchema';
import {
  topupStatus, readTopupTrust, REVIEW_REASON_LABEL, TOPUP_STATUS_LABEL,
  type TopupRequest, type TopupStatus, type TopupTrust,
} from '../utils/topupSchema';
import {
  fetchAllDriverLedgers, driverTotals, money, type RawDoc,
} from '../utils/ledgerSchema';
import { downloadWorkbook, exportFileName, type Cell } from '../utils/excelExport';
import { PaymentAccountPanel } from '../components/PaymentAccountPanel';
import { TopupQueue, type TopupDriverInfo } from '../components/TopupQueue';
import { TopupTrustPanel } from '../components/TopupTrustPanel';
import { DriverStatement } from '../components/LedgerStatements';
import {
  Wallet, Search, X, Loader, RefreshCw, AlertCircle, AlertTriangle,
  Calendar, Filter, ChevronRight, TrendingUp, TrendingDown, Car, Phone,
  ArrowUpDown, XCircle, Coins, PiggyBank, Undo2, Hash, User, Percent,
  Download, FileSpreadsheet, PauseCircle, ShieldAlert,
} from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Only the ride fields this page needs, from `rides` or `citytocity`. */
interface RideLite {
  id: string;
  driver?: string;
  status?: string;
  price?: unknown;
  cabtype?: string;
  pickup?: unknown;
  dropoff?: unknown;
  commission?: unknown;
  commissionRate?: unknown;
  completedAt?: unknown;
  cancelledAt?: unknown;
  createdAt?: unknown;
  time?: unknown;
  date?: unknown;
  cancelledBy?: string;
}

/** One driver's account: identity, wallet, whole ledger, whole miss history. */
interface Account {
  uid: string;
  name: string;
  phone: string;
  vehicle: string;
  tier: string;
  appStatus: AppStatus | null;
  hasWallet: boolean;
  balance: number;
  openingCredit: number;
  currency: string;
  walletUpdatedAt: unknown;
  /** Top-up trust settings on the wallet (defaults when there is none). */
  authentic: boolean;
  safeLimit: number;
  minTopup: number;
  entries: LedgerEntry[];
  missed: MissedCommission[];
}

/** An account with the selected period applied. */
interface AccountRow {
  account: Account;
  entries: LedgerEntry[];
  totals: WalletTotals;
  missed: MissedCommission[];
  missedTotal: number;
  state: BalanceState;
}

type BalanceFilter = 'all' | 'negative' | 'low' | 'ok' | 'no_wallet' | 'unauthentic';

type SortKey =
  | 'commission_desc' | 'commission_asc'
  | 'missed_desc' | 'balance_asc' | 'balance_desc' | 'rides_desc' | 'name';

const SORT_LABEL: Record<SortKey, string> = {
  commission_desc: 'Commission — highest first',
  commission_asc: 'Commission — lowest first',
  missed_desc: 'Missed commission — highest first',
  balance_asc: 'Balance — lowest first',
  balance_desc: 'Balance — highest first',
  rides_desc: 'Rides — most first',
  name: 'Name (A–Z)',
};

const BALANCE_FILTER_LABEL: Record<BalanceFilter, string> = {
  all: 'All drivers',
  negative: 'Negative balance',
  low: `Low (under ${LOW_BALANCE_THRESHOLD})`,
  ok: 'Healthy',
  no_wallet: 'No wallet yet',
  unauthentic: 'Unauthentic',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** When a ride record happened, whichever timestamp it carries. */
const rideMs = (r: RideLite): number =>
  toMs(r.completedAt) || toMs(r.cancelledAt) || toMs(r.createdAt) || toMs(r.time) || toMs(r.date);

const isCancelled = (s?: string) =>
  ['cancelled', 'canceled'].includes((s || '').toLowerCase().trim());

const BalancePill: React.FC<{ state: BalanceState; hasWallet: boolean }> = ({ state, hasWallet }) => {
  if (!hasWallet) return <span className="da-pill da-pill-none">No wallet</span>;
  return <span className={`da-pill da-pill-${state}`}>{BALANCE_STATE_LABEL[state]}</span>;
};

// ─── Summary tile ────────────────────────────────────────────────────────────

const Tile: React.FC<{
  label: string;
  value: string;
  sub?: string;
  color: string;
  icon: React.ReactNode;
  loading: boolean;
}> = ({ label, value, sub, color, icon, loading }) => (
  <div className="da-tile" style={{ '--tile-color': color } as React.CSSProperties}>
    <div className="da-tile-head">
      <span className="da-tile-label">{label}</span>
      <span className="da-tile-icon">{icon}</span>
    </div>
    <div className="da-tile-value">
      {loading ? <span className="loading-pulse" style={{ height: '1.6rem', width: '5rem', display: 'inline-block' }} /> : value}
    </div>
    {sub && <div className="da-tile-sub">{sub}</div>}
  </div>
);

// ─── Detail drawer ───────────────────────────────────────────────────────────

interface DrawerProps {
  row: AccountRow;
  periodLabel: string;
  ridesById: Map<string, RideLite>;
  onClose: () => void;
  /** The wallet's live trust settings, so the list behind stays current. */
  onTrust: (uid: string, trust: TopupTrust) => void;
}

interface ContactInfo {
  name?: string; phone?: string; email?: string;
  suspended?: boolean; suspendedBy?: string; suspendedAt?: unknown;
}

const AccountDrawer: React.FC<DrawerProps> = ({ row, periodLabel, ridesById, onClose, onTrust }) => {
  const { account, totals, entries, missed, missedTotal } = row;
  const [contact, setContact] = useState<ContactInfo | null>(null);

  useEffect(() => {
    getDoc(doc(db, 'users', account.uid))
      .then(snap => setContact(snap.exists() ? (snap.data() as ContactInfo) : null))
      .catch(() => setContact(null));
  }, [account.uid]);

  // The ledger, split by what each entry actually is. Commission charges are
  // the answer to "what did we make from this driver"; the other two lists
  // exist so the balance on screen can be reconciled against them.
  const charges = entries
    .filter(e => ['commission', 'ctc_commission'].includes(normaliseLedgerType(e.type)))
    .sort((a, b) => entryMs(b) - entryMs(a));
  const refunds = entries
    .filter(e => normaliseLedgerType(e.type) === 'ctc_commission_refund')
    .sort((a, b) => entryMs(b) - entryMs(a));
  // Reversals sit with the top-ups they undo, so the two reconcile.
  const topups = entries
    .filter(e => ['topup', 'topup_reversal'].includes(normaliseLedgerType(e.type)))
    .sort((a, b) => entryMs(b) - entryMs(a));

  const sortedMissed = [...missed].sort((a, b) => b.at - a.at);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-drawer da-drawer" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title-row">
            <strong className="da-drawer-name">{account.name}</strong>
            <BalancePill state={row.state} hasWallet={account.hasWallet} />
            {account.hasWallet && !account.authentic && <span className="da-pill da-pill-unauthentic">Unauthentic</span>}
            {contact?.suspended && <span className="da-pill da-pill-suspended"><PauseCircle size={10} /> Suspended</span>}
            {account.appStatus && (
              <span className="cell-dim">{STATUS_LABEL[account.appStatus]}</span>
            )}
          </div>
          <button className="modal-close-btn" onClick={onClose}><X size={20} /></button>
        </div>

        <div className="modal-body">
          {contact?.suspended && (
            <div className="rate-status rate-status-error" style={{ marginBottom: '1rem' }}>
              <PauseCircle size={13} />
              <span>
                Account suspended {contact.suspendedBy === 'self' ? 'by the driver from the app' : `by ${contact.suspendedBy || 'an admin'}`}
                {contact.suspendedAt ? ` on ${formatDateTime(contact.suspendedAt)}` : ''}. Reactivate it from the Users page.
              </span>
            </div>
          )}

          {/* Who */}
          <div className="modal-section">
            <h3 className="modal-section-title"><User size={16} /> Driver</h3>
            <div className="modal-details-grid">
              <div className="detail-item"><span className="di-label"><Phone size={12} /> Phone</span><span className="di-value">{account.phone || contact?.phone || '—'}</span></div>
              <div className="detail-item"><span className="di-label">Email</span><span className="di-value">{contact?.email || '—'}</span></div>
              <div className="detail-item"><span className="di-label"><Car size={12} /> Vehicle</span><span className="di-value">{account.vehicle || '—'}</span></div>
              <div className="detail-item"><span className="di-label">Tier</span><span className="di-value">{account.tier}</span></div>
              <div className="detail-item" style={{ gridColumn: '1 / -1' }}>
                <span className="di-label">UID</span><span className="di-value mono">{account.uid}</span>
              </div>
            </div>
          </div>

          {/* Wallet */}
          <div className="modal-section">
            <h3 className="modal-section-title"><Wallet size={16} /> Wallet</h3>
            {!account.hasWallet ? (
              <p className="modal-no-data">
                No wallet document exists for this driver. The app creates one the first time they
                open the driver side — so this driver has not started driving yet.
              </p>
            ) : (
              <>
                <div className="da-balance-strip">
                  <div className={`da-balance-figure da-balance-${row.state}`}>
                    {formatPKR(account.balance)}
                    <span>current balance</span>
                  </div>
                  <div className="da-balance-meta">
                    <div><span>Opening credit</span><strong>{formatPKR(account.openingCredit)}</strong></div>
                    <div><span>Currency</span><strong>{account.currency || 'PKR'}</strong></div>
                    <div><span>Last movement</span><strong>{formatDateTime(account.walletUpdatedAt)}</strong></div>
                  </div>
                </div>
                {row.state === 'negative' && (
                  <div className="rate-status rate-status-error">
                    <AlertTriangle size={13} />
                    <span>
                      This balance is negative — the commission on a finished ride is taken whether
                      the wallet can cover it or not. Until it is topped up, this driver cannot
                      offer on any ride.
                    </span>
                  </div>
                )}
                {row.state === 'low' && (
                  <div className="rate-status rate-status-warn">
                    <AlertCircle size={13} />
                    <span>
                      Below {formatPKR(LOW_BALANCE_THRESHOLD)} — the driver has been sent a low
                      balance notification and may not be able to cover the next commission.
                    </span>
                  </div>
                )}
                <TopupTrustPanel uid={account.uid} onTrust={t => onTrust(account.uid, t)} />
              </>
            )}
          </div>

          {/* Period totals */}
          <div className="modal-section">
            <h3 className="modal-section-title"><Coins size={16} /> {periodLabel}</h3>
            <div className="modal-details-grid">
              <div className="detail-item"><span className="di-label">Commission charged</span><span className="di-value">{formatPKR(totals.earned)}</span></div>
              <div className="detail-item"><span className="di-label">Refunded</span><span className="di-value">{formatPKR(totals.refunded)}</span></div>
              <div className="detail-item"><span className="di-label">Net to platform</span><span className="di-value text-green">{formatPKR(totals.net)}</span></div>
              <div className="detail-item"><span className="di-label">Rides charged</span><span className="di-value">{totals.chargeCount}</span></div>
              <div className="detail-item"><span className="di-label">Balance added (less reversals)</span><span className="di-value">{formatPKR(totals.toppedUp)}</span></div>
              <div className="detail-item">
                <span className="di-label">Missed on cancellations</span>
                <span className="di-value text-orange">{formatPKR(missedTotal)}</span>
              </div>
            </div>
          </div>

          {/* Commission, ride by ride */}
          <div className="modal-section">
            <h3 className="modal-section-title">
              <TrendingUp size={16} /> Commission by ride
              <span className="rides-count-badge">{charges.length}</span>
            </h3>
            {charges.length === 0 ? (
              <p className="modal-no-data">No commission was charged to this driver in this period.</p>
            ) : (
              <div className="da-mini-table-wrap">
                <table className="da-mini-table">
                  <thead>
                    <tr>
                      <th>When</th><th>Source</th><th>Ride</th>
                      <th className="num">Fare</th><th className="num">Rate</th><th className="num">Commission</th>
                    </tr>
                  </thead>
                  <tbody>
                    {charges.map(e => {
                      const rideId = ledgerRideId(e);
                      const ride = rideId ? ridesById.get(rideId) : undefined;
                      const rate = toNum(e.rate);
                      const fare = toNum(e.fare);
                      return (
                        <tr key={e.id}>
                          <td className="cell-dim">{formatDateTime(e.at)}</td>
                          <td><span className="da-src">{LEDGER_SOURCE_LABEL[ledgerSource(e)]}</span></td>
                          <td>
                            {ride ? (
                              <>
                                <div className="da-ride-type">{cabtypeLabel(ride.cabtype)}</div>
                                <div className="cell-dim">{routeSummary(ride.pickup, ride.dropoff)}</div>
                              </>
                            ) : (
                              <span className="mono cell-dim">
                                {rideId ?? e.bookingId ?? e.id}
                              </span>
                            )}
                          </td>
                          <td className="num cell-dim">{fare ? formatPKR(fare) : '—'}</td>
                          <td className="num cell-dim">{rate ? `${(rate * 100).toFixed(1)}%` : '—'}</td>
                          <td className="num cell-fare">{formatPKR(entryMagnitude(e))}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={5}>Total charged</td>
                      <td className="num cell-fare">{formatPKR(totals.earned)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>

          {/* Cancelled rides — commission that never happened */}
          <div className="modal-section">
            <h3 className="modal-section-title">
              <XCircle size={16} /> Cancelled rides
              <span className="rides-count-badge">{sortedMissed.length}</span>
            </h3>
            <p className="tk-hint">
              Commission is only charged when a ride completes, so none of these earned anything.
              The figures below are what the platform <em>would</em> have kept at the fare that had
              been agreed when the ride was cancelled — a counterfactual, never added to any
              earnings total on this page.
            </p>
            {sortedMissed.length === 0 ? (
              <p className="modal-no-data">
                No cancelled rides for this driver in this period. Rides cancelled before a driver
                was accepted are not kept, so they never appear here.
              </p>
            ) : (
              <div className="da-mini-table-wrap">
                <table className="da-mini-table">
                  <thead>
                    <tr>
                      <th>When</th><th>Source</th><th>Ride</th><th>Cancelled by</th>
                      <th className="num">Fare</th><th className="num">Rate</th><th className="num">Could have earned</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedMissed.map(m => (
                      <tr key={`${m.source}_${m.rideId}`}>
                        <td className="cell-dim">{formatDateTime(m.at)}</td>
                        <td>
                          <span className="da-src">
                            {m.source === 'in_city' ? 'In-city ride' : 'City-to-city ride'}
                          </span>
                        </td>
                        <td>
                          <div className="da-ride-type">{cabtypeLabel(m.cabtype)}</div>
                          <div className="cell-dim">{routeSummary(m.pickup, m.dropoff)}</div>
                        </td>
                        <td className="cell-dim">{m.cancelledBy || '—'}</td>
                        <td className="num cell-dim">{formatPKR(m.fare)}</td>
                        <td className="num cell-dim">
                          {(m.rate * 100).toFixed(1)}%
                          {!m.rateFromRide && <span className="da-rate-note" title="The ride recorded no rate, so the rate currently configured in Settings was used">*</span>}
                        </td>
                        <td className="num da-missed">{formatPKR(m.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={6}>Total missed</td>
                      <td className="num da-missed">{formatPKR(missedTotal)}</td>
                    </tr>
                  </tfoot>
                </table>
                {sortedMissed.some(m => !m.rateFromRide) && (
                  <p className="da-footnote">
                    * the ride recorded no commission rate of its own, so the rate currently set in
                    Settings was applied.
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Refunds */}
          {refunds.length > 0 && (
            <div className="modal-section">
              <h3 className="modal-section-title">
                <Undo2 size={16} /> Commission refunded
                <span className="rides-count-badge">{refunds.length}</span>
              </h3>
              <p className="tk-hint">
                City-to-city commission is charged when a seat booking is confirmed and returned
                automatically when the booking or the whole trip is cancelled.
              </p>
              <div className="da-mini-table-wrap">
                <table className="da-mini-table">
                  <thead>
                    <tr><th>When</th><th>Booking</th><th>Trip</th><th className="num">Refunded</th></tr>
                  </thead>
                  <tbody>
                    {refunds.map(e => (
                      <tr key={e.id}>
                        <td className="cell-dim">{formatDateTime(e.at)}</td>
                        <td className="mono cell-dim">{e.bookingId || '—'}</td>
                        <td className="mono cell-dim">{e.tripId || '—'}</td>
                        <td className="num da-refund">{formatPKR(entryMagnitude(e))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Top-ups */}
          {topups.length > 0 && (
            <div className="modal-section">
              <h3 className="modal-section-title">
                <PiggyBank size={16} /> Top-ups &amp; reversals
                <span className="rides-count-badge">{topups.length}</span>
              </h3>
              <div className="da-mini-table-wrap">
                <table className="da-mini-table">
                  <thead>
                    <tr><th>When</th><th>Kind</th><th>How</th><th>Reference</th><th className="num">Amount</th><th className="num">Balance after</th></tr>
                  </thead>
                  <tbody>
                    {topups.map(e => {
                      const reversal = normaliseLedgerType(e.type) === 'topup_reversal';
                      return (
                        <tr key={e.id}>
                          <td className="cell-dim">{formatDateTime(e.at)}</td>
                          <td><span className="da-src">{reversal ? 'Reversed' : 'Top-up'}</span></td>
                          <td className="cell-dim">
                            {topupEntryNote(e)}
                            {reversal && e.reason && <div className="tq-reason">“{e.reason}”</div>}
                          </td>
                          <td className="mono cell-dim">{e.reference || '—'}</td>
                          <td className={`num ${reversal ? 'ls-neg' : 'cell-fare'}`}>
                            {reversal ? '−' : '+'}{formatPKR(entryMagnitude(e))}
                          </td>
                          <td className="num cell-dim">{e.balanceAfter !== undefined && e.balanceAfter !== null ? formatPKR(toNum(e.balanceAfter)) : '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={4}>Balance added, less reversals</td>
                      <td className="num cell-fare">{formatPKR(totals.toppedUp)}</td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {/* Statement, with its own period, as the driver sees it in the app */}
          <div className="modal-section">
            <h3 className="modal-section-title"><FileSpreadsheet size={16} /> Driver statement</h3>
            <DriverStatement
              uid={account.uid}
              name={account.name}
              phone={account.phone || contact?.phone || ''}
              balance={account.hasWallet ? account.balance : null}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── Page ────────────────────────────────────────────────────────────────────

export const DriverAccounts: React.FC = () => {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [ridesById, setRidesById] = useState<Map<string, RideLite>>(new Map());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [rateNote, setRateNote] = useState<string | null>(null);

  const [period, setPeriod] = useState<TimePeriod>('month');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [balanceFilter, setBalanceFilter] = useState<BalanceFilter>('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('commission_desc');
  const [selected, setSelected] = useState<string | null>(null);

  const [topups, setTopups] = useState<TopupRequest[]>([]);
  const [topupsLoading, setTopupsLoading] = useState(true);
  const [topupsError, setTopupsError] = useState('');

  // Live, so a request filed while the page is open shows up without a refresh.
  useEffect(() => onSnapshot(
    collection(db, 'topupRequests'),
    snap => {
      setTopups(snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<TopupRequest, 'id'>) })));
      setTopupsError('');
      setTopupsLoading(false);
    },
    err => {
      console.error(err);
      setTopupsError('Reading topupRequests was refused — confirm your account carries the admin claim.');
      setTopupsLoading(false);
    },
  ), []);

  /**
   * The ledger lives in a subcollection under every wallet. One collection
   * group query reads them all; if the security rules only grant the nested
   * path (a collection group needs its own `{path=**}` rule), that query is
   * refused and the wallets are read one at a time instead.
   */
  const loadEntries = useCallback(async (uids: string[]): Promise<LedgerEntry[]> => {
    try {
      const snap = await getDocs(collectionGroup(db, 'entries'));
      const rows: LedgerEntry[] = [];
      snap.forEach(d => {
        const walletDoc = d.ref.parent.parent;
        // guard against any other collection in the project named "entries"
        if (!walletDoc || walletDoc.parent.id !== 'wallets') return;
        rows.push({ id: d.id, uid: walletDoc.id, ...(d.data() as Omit<LedgerEntry, 'id' | 'uid'>) });
      });
      return rows;
    } catch {
      const perWallet = await Promise.all(uids.map(async uid => {
        try {
          const snap = await getDocs(collection(db, 'wallets', uid, 'entries'));
          const rows: LedgerEntry[] = [];
          snap.forEach(d => rows.push({ id: d.id, uid, ...(d.data() as Omit<LedgerEntry, 'id' | 'uid'>) }));
          return rows;
        } catch {
          return [] as LedgerEntry[];
        }
      }));
      return perWallet.flat();
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    setRateNote(null);
    try {
      const [ratesSnap, walletSnap, appSnap, rideSnap, c2cSnap] = await Promise.all([
        getDoc(doc(db, 'rates', 'rates')),
        getDocs(collection(db, 'wallets')),
        getDocs(collection(db, 'driverProfileRequests')),
        getDocs(collection(db, 'rides')),
        getDocs(collection(db, 'citytocity')),
      ]);

      const rates: RatesMap = ratesSnap.exists() ? (ratesSnap.data() as RatesMap) : {};
      const inCityRate = resolveCommission(rates, 'comission').value;
      const ctcRate = resolveCommission(rates, 'ctc_commission').value;
      const unset = [
        inCityRate === null ? 'in-city' : null,
        ctcRate === null ? 'city-to-city' : null,
      ].filter(Boolean);
      if (unset.length) {
        setRateNote(
          `No ${unset.join(' or ')} commission rate is configured, so missed commission cannot be ` +
          'worked out for those cancelled rides. Set it on the Settings page.',
        );
      }

      // Wallets
      const wallets = new Map<string, {
        balance: number; openingCredit: number; currency: string; updatedAt: unknown; trust: TopupTrust;
      }>();
      walletSnap.forEach(d => {
        const w = d.data() as Record<string, unknown>;
        wallets.set(d.id, {
          balance: toNum(w.balance),
          openingCredit: toNum(w.openingCredit),
          currency: typeof w.currency === 'string' ? w.currency : 'PKR',
          updatedAt: w.updatedAt ?? w.createdAt,
          trust: readTopupTrust(w),
        });
      });

      // Driver identity, keyed by uid rather than document id — legacy records
      // store the uid in a field instead of the id.
      const apps = new Map<string, DriverApplicationFields>();
      appSnap.forEach(d => {
        const a = d.data() as DriverApplicationFields;
        apps.set(getUid(a, d.id), a);
      });

      // Every ride, indexed once so both the ledger join and the cancellation
      // scan below can read it without another round trip.
      const rideIndex = new Map<string, RideLite>();
      const inCity: RideLite[] = [];
      rideSnap.forEach(d => {
        const r = { id: d.id, ...(d.data() as Omit<RideLite, 'id'>) };
        rideIndex.set(d.id, r);
        inCity.push(r);
      });
      const cityRides: RideLite[] = [];
      c2cSnap.forEach(d => {
        const r = { id: d.id, ...(d.data() as Omit<RideLite, 'id'>) };
        rideIndex.set(d.id, r);
        cityRides.push(r);
      });

      const entries = await loadEntries([...wallets.keys()]);

      // Group the ledger and the cancellations by driver.
      const entriesByDriver = new Map<string, LedgerEntry[]>();
      for (const e of entries) {
        const list = entriesByDriver.get(e.uid);
        if (list) list.push(e); else entriesByDriver.set(e.uid, [e]);
      }

      const missedByDriver = new Map<string, MissedCommission[]>();
      const pushMissed = (m: MissedCommission | null) => {
        if (!m) return;
        const list = missedByDriver.get(m.driver);
        if (list) list.push(m); else missedByDriver.set(m.driver, [m]);
      };

      for (const r of inCity) {
        // A ride cancelled before a driver accepted is never written to
        // Firestore, so an absent driver here means the record is unusable.
        if (!isCancelled(r.status) || !r.driver) continue;
        pushMissed(computeMissed({
          rideId: r.id, source: 'in_city', driver: r.driver,
          fare: r.price, rideRate: r.commissionRate, currentRate: inCityRate,
          at: rideMs(r), cancelledBy: r.cancelledBy, cabtype: r.cabtype,
          pickup: r.pickup, dropoff: r.dropoff,
        }));
      }
      for (const r of cityRides) {
        if (!isCancelled(r.status) || !r.driver) continue;
        pushMissed(computeMissed({
          rideId: r.id, source: 'city_ride', driver: r.driver,
          fare: r.price, rideRate: r.commissionRate, currentRate: ctcRate,
          at: rideMs(r), cancelledBy: r.cancelledBy, cabtype: r.cabtype,
          pickup: r.pickup, dropoff: r.dropoff,
        }));
      }

      // Every driver with a wallet, plus approved applicants who have not
      // opened the driver side yet — an account that exists but has never moved
      // is a real state, and hiding it would make the list look complete when
      // it is not.
      const uids = new Set<string>([...wallets.keys()]);
      for (const [uid, a] of apps) {
        if (getStatus(a) === 'approved') uids.add(uid);
      }

      const built: Account[] = [...uids].map(uid => {
        const app = apps.get(uid);
        const wallet = wallets.get(uid);
        const trust = wallet?.trust ?? readTopupTrust(undefined);
        return {
          uid,
          name: app?.fullName?.trim() || `Driver ${uid.slice(0, 8)}…`,
          phone: app?.phoneNumber?.trim() || '',
          vehicle: app ? getVehicleTitle(app) : '',
          tier: app ? getTierLabel(app) : '—',
          appStatus: app ? getStatus(app) : null,
          hasWallet: Boolean(wallet),
          balance: wallet?.balance ?? 0,
          openingCredit: wallet?.openingCredit ?? 0,
          currency: wallet?.currency ?? 'PKR',
          walletUpdatedAt: wallet?.updatedAt,
          authentic: trust.authentic,
          safeLimit: trust.safeLimit,
          minTopup: trust.minTopup,
          entries: entriesByDriver.get(uid) ?? [],
          missed: missedByDriver.get(uid) ?? [],
        };
      });

      setRidesById(rideIndex);
      setAccounts(built);
    } catch (e) {
      console.error(e);
      setLoadError(
        'Could not load driver accounts. Confirm your account carries the admin claim — the ' +
        'security rules refuse wallet reads to everyone else.',
      );
    } finally {
      setLoading(false);
    }
  }, [loadEntries]);

  useEffect(() => { void load(); }, [load]);

  // ── Period, filters, sort ──────────────────────────────────────────────────

  const range = useMemo(
    () => periodRange(period, customStart, customEnd),
    [period, customStart, customEnd],
  );

  const rows: AccountRow[] = useMemo(() => accounts.map(account => {
    const entries = account.entries.filter(e => inPeriod(entryMs(e), range));
    const missed = account.missed.filter(m => inPeriod(m.at, range));
    return {
      account,
      entries,
      totals: entries.length ? summariseEntries(entries) : { ...EMPTY_TOTALS },
      missed,
      missedTotal: missed.reduce((sum, m) => sum + m.amount, 0),
      state: balanceState(account.balance),
    };
  }), [accounts, range]);

  const grandTotals = useMemo(
    () => rows.reduce((acc, r) => addTotals(acc, r.totals), { ...EMPTY_TOTALS }),
    [rows],
  );
  const grandMissed = useMemo(
    () => rows.reduce((sum, r) => sum + r.missedTotal, 0),
    [rows],
  );
  const balanceHeld = useMemo(
    () => rows.reduce((sum, r) => sum + Math.max(0, r.account.balance), 0),
    [rows],
  );
  const deficit = useMemo(
    () => rows.filter(r => r.account.hasWallet && r.account.balance < 0),
    [rows],
  );
  const deficitTotal = useMemo(
    () => deficit.reduce((sum, r) => sum + Math.abs(r.account.balance), 0),
    [deficit],
  );

  const balanceCounts = useMemo(() => {
    const c: Record<BalanceFilter, number> = { all: rows.length, negative: 0, low: 0, ok: 0, no_wallet: 0, unauthentic: 0 };
    for (const r of rows) {
      if (!r.account.hasWallet) { c.no_wallet += 1; continue; }
      c[r.state] += 1;
      if (!r.account.authentic) c.unauthentic += 1;
    }
    return c;
  }, [rows]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = rows.filter(r => {
      if (balanceFilter === 'no_wallet' && r.account.hasWallet) return false;
      if (balanceFilter === 'unauthentic' && (!r.account.hasWallet || r.account.authentic)) return false;
      if (balanceFilter !== 'all' && balanceFilter !== 'no_wallet' && balanceFilter !== 'unauthentic') {
        if (!r.account.hasWallet || r.state !== balanceFilter) return false;
      }
      if (!q) return true;
      return [r.account.name, r.account.phone, r.account.vehicle, r.account.uid]
        .some(v => (v || '').toLowerCase().includes(q));
    });

    const byName = (a: AccountRow, b: AccountRow) => a.account.name.localeCompare(b.account.name);
    return filtered.sort((a, b) => {
      switch (sort) {
        case 'commission_desc': return (b.totals.net - a.totals.net) || byName(a, b);
        case 'commission_asc':  return (a.totals.net - b.totals.net) || byName(a, b);
        case 'missed_desc':     return (b.missedTotal - a.missedTotal) || byName(a, b);
        case 'balance_asc':     return (a.account.balance - b.account.balance) || byName(a, b);
        case 'balance_desc':    return (b.account.balance - a.account.balance) || byName(a, b);
        case 'rides_desc':      return (b.totals.chargeCount - a.totals.chargeCount) || byName(a, b);
        default:                return byName(a, b);
      }
    });
  }, [rows, balanceFilter, search, sort]);

  const selectedRow = useMemo(
    () => visible.find(r => r.account.uid === selected) ?? rows.find(r => r.account.uid === selected) ?? null,
    [visible, rows, selected],
  );

  const periodLabel = period === 'custom'
    ? (customStart || customEnd ? `${customStart || 'start'} → ${customEnd || 'now'}` : 'Custom range')
    : PERIOD_LABEL[period];

  const periods = Object.keys(PERIOD_LABEL) as TimePeriod[];

  const topupDrivers = useMemo(() => new Map<string, TopupDriverInfo>(accounts.map(a => [a.uid, {
    name: a.name, phone: a.phone, balance: a.balance, hasWallet: a.hasWallet,
    authentic: a.authentic, safeLimit: a.safeLimit,
  }])), [accounts]);

  const pendingTopupDrivers = useMemo(
    () => new Set(topups.filter(t => (topupStatus(t) === 'pending' || topupStatus(t) === 'auto_credited') && t.driver).map(t => t.driver as string)),
    [topups],
  );

  const handleTrust = useCallback((uid: string, t: TopupTrust) => {
    setAccounts(prev => prev.map(a => (
      a.uid === uid && (a.authentic !== t.authentic || a.safeLimit !== t.safeLimit || a.minTopup !== t.minTopup)
        ? { ...a, authentic: t.authentic, safeLimit: t.safeLimit, minTopup: t.minTopup }
        : a
    )));
  }, []);

  // ── Portal-wide exports, for the selected period ───────────────────────────

  const [exporting, setExporting] = useState<'topups' | 'commission' | null>(null);
  const [exportError, setExportError] = useState('');

  const exportTopups = async () => {
    setExporting('topups');
    setExportError('');
    try {
      const names = new Map(accounts.map(a => [a.uid, a]));
      const date = (v: unknown): Date | null => (toMs(v) ? new Date(toMs(v)) : null);
      const list = topups
        .filter(t => inPeriod(toMs(t.createdAt), range))
        .sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt));
      const rows = list.map((t): Cell[] => {
        const a = t.driver ? names.get(t.driver) : undefined;
        const status = topupStatus(t);
        return [
          date(t.createdAt),
          a?.name ?? '',
          a?.phone ?? '',
          t.driver ?? '',
          money(t.amount),
          t.creditedAmount !== undefined && t.creditedAmount !== null ? money(t.creditedAmount) : null,
          status === 'unknown' ? `Unknown (${String(t.status ?? '')})` : TOPUP_STATUS_LABEL[status],
          t.reviewReason ? (REVIEW_REASON_LABEL[t.reviewReason] ?? t.reviewReason) : '',
          date(t.creditedAt),
          toNum(t.safeLimitBefore) || null,
          toNum(t.safeLimitAfter) || null,
          t.reviewedBy ?? '',
          date(t.reviewedAt),
          t.rejectionReason || t.reversalReason || '',
          t.id,
        ];
      });
      const order: TopupStatus[] = ['pending', 'auto_credited', 'approved', 'rejected', 'reversed', 'unknown'];
      const byStatus = new Map(order.map(k => [k, { count: 0, amount: 0, credited: 0 }]));
      for (const t of list) {
        const m = byStatus.get(topupStatus(t))!;
        m.count += 1;
        m.amount += toNum(t.amount);
        m.credited += toNum(t.creditedAmount);
      }
      await downloadWorkbook(exportFileName('topups', periodLabel), [
        {
          name: 'Summary',
          columns: ['Status', 'Requests', 'Amount claimed (PKR)', 'Credited (PKR)'],
          widths: [26, 22, 20, 16],
          rows: [
            ...order.filter(k => byStatus.get(k)!.count > 0).map((k): Cell[] => {
              const m = byStatus.get(k)!;
              return [TOPUP_STATUS_LABEL[k], m.count, money(m.amount), money(m.credited)];
            }),
            ['Total', list.length, money(list.reduce((sum, t) => sum + toNum(t.amount), 0)), money(list.reduce((sum, t) => sum + toNum(t.creditedAmount), 0))],
            [null, null, null, null],
            ['Period', periodLabel, null, null],
            ['Generated', new Date(), null, null],
          ],
        },
        {
          name: 'Top-ups',
          columns: [
            'Requested', 'Driver', 'Phone', 'Driver UID', 'Amount (PKR)', 'Credited (PKR)', 'Status',
            'Review reason', 'Credited instantly at', 'Safe limit before (PKR)', 'Safe limit after (PKR)',
            'Reviewed by', 'Reviewed at', 'Rejection / reversal reason', 'Request ID',
          ],
          widths: [20, 22, 14, 30, 13, 14, 22, 30, 20, 18, 18, 22, 20, 36, 24],
          rows,
        },
      ]);
    } catch (e) {
      console.error(e);
      setExportError(e instanceof Error ? e.message : 'The top-ups export failed.');
    } finally {
      setExporting(null);
    }
  };

  const exportCommission = async () => {
    setExporting('commission');
    setExportError('');
    try {
      const entriesByDriver = new Map<string, RawDoc[]>(accounts.map(a => [
        a.uid,
        a.entries.map(({ id, uid: _uid, ...data }) => ({ id, data: data as Record<string, unknown> })),
      ]));
      const ledgers = await fetchAllDriverLedgers(entriesByDriver);
      const byUid = new Map(accounts.map(a => [a.uid, a]));
      const uids = new Set([...accounts.map(a => a.uid), ...ledgers.keys()]);
      const sum = { trips: 0, earnings: 0, commission: 0, net: 0, added: 0, held: 0, owed: 0 };
      const rows: Cell[][] = [];
      for (const uid of uids) {
        const ledger = ledgers.get(uid) ?? { wallet: [], trips: [] };
        const t = driverTotals(ledger, range);
        const a = byUid.get(uid);
        if (!a && !t.trips && !t.commission && !t.added) continue;
        sum.trips += t.trips;
        sum.earnings += t.earnings;
        sum.commission += t.commission;
        sum.net += t.net;
        sum.added += t.added;
        // Same split as the "Balance held" and "Drivers in deficit" tiles.
        if (a?.hasWallet && a.balance > 0) sum.held += a.balance;
        if (a?.hasWallet && a.balance < 0) sum.owed -= a.balance;
        rows.push([
          a?.name ?? `Driver ${uid.slice(0, 8)}…`,
          a?.phone ?? '',
          uid,
          t.trips, t.earnings, t.commission, t.net, t.added,
          a?.hasWallet ? a.balance : null,
          a?.hasWallet ? (a.authentic ? 'Yes' : 'No') : '',
          a?.hasWallet ? a.safeLimit : null,
        ]);
      }
      rows.sort((x, y) => (y[5] as number) - (x[5] as number));
      await downloadWorkbook(exportFileName('commission', periodLabel), [
        {
          name: 'Summary',
          columns: ['Item', 'Value'],
          widths: [34, 22],
          rows: [
            ['Period', periodLabel],
            ['Generated', new Date()],
            ['Drivers', rows.length],
            ['Completed trips', sum.trips],
            ['Total earnings (PKR)', money(sum.earnings)],
            ['Commission paid (PKR)', money(sum.commission)],
            ['Net earnings (PKR)', money(sum.net)],
            ['Balance added (PKR)', money(sum.added)],
            ['Balance held now (PKR)', money(sum.held)],
            ['Owed by drivers in deficit now (PKR)', money(sum.owed)],
          ],
        },
        {
          name: 'Drivers',
          columns: [
            'Driver', 'Phone', 'Driver UID', 'Trips', 'Earnings (PKR)', 'Commission (PKR)', 'Net (PKR)',
            'Balance added (PKR)', 'Current balance (PKR)', 'Authentic', 'Safe limit (PKR)',
          ],
          widths: [24, 14, 30, 8, 16, 16, 14, 18, 20, 10, 16],
          rows,
        },
      ]);
    } catch (e) {
      console.error(e);
      setExportError(e instanceof Error ? e.message : 'The commission report failed.');
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="rides-page">
      <div className="dashboard-header settings-top-bar">
        <div style={{ textAlign: 'left' }}>
          <h1>Driver Accounts</h1>
          <p>Wallet balances, the commission each driver paid, and what cancellations cost</p>
        </div>
        <button className="pay-view-all-btn settings-refresh" onClick={() => { void load(); }} disabled={loading}>
          <RefreshCw size={17} className={loading ? 'spin' : ''} />
          <span>{loading ? 'Loading…' : 'Refresh'}</span>
        </button>
      </div>

      {/* Where drivers send money, and the payments waiting to be verified */}
      <PaymentAccountPanel />
      <TopupQueue
        requests={topups}
        loading={topupsLoading}
        error={topupsError}
        drivers={topupDrivers}
        onReviewed={() => { void load(); }}
      />

      {/* Period */}
      <div className="pay-period-bar" style={{ marginBottom: '1.25rem' }}>
        <div className="pay-period-label"><Filter size={15} /> Period</div>
        <div className="pay-period-tabs">
          {periods.map(p => (
            <button
              key={p}
              className={`pay-period-tab ${period === p ? 'active' : ''}`}
              onClick={() => setPeriod(p)}
            >
              <Calendar size={13} />
              {PERIOD_LABEL[p]}
            </button>
          ))}
        </div>
        {period === 'custom' && (
          <div className="custom-date-filters" style={{ display: 'flex', gap: '0.5rem', marginLeft: '1rem', alignItems: 'center' }}>
            <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} style={{ padding: '0.4rem', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)' }} />
            <span style={{ color: 'var(--text-secondary)' }}>to</span>
            <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} style={{ padding: '0.4rem', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)' }} />
          </div>
        )}
      </div>

      {/* Exports for the period above */}
      <div className="dv-control-row" style={{ marginBottom: '1.25rem', gap: '0.5rem', flexWrap: 'wrap' }}>
        <button className="pay-view-all-btn" onClick={() => { void exportTopups(); }} disabled={exporting !== null || topupsLoading || loading}>
          {exporting === 'topups' ? <Loader size={15} className="spin" /> : <Download size={15} />}
          <span>All top-ups · {periodLabel}</span>
        </button>
        <button className="pay-view-all-btn" onClick={() => { void exportCommission(); }} disabled={exporting !== null || loading}>
          {exporting === 'commission' ? <Loader size={15} className="spin" /> : <FileSpreadsheet size={15} />}
          <span>Commission report · {periodLabel}</span>
        </button>
        {exportError && <span className="rate-error"><AlertCircle size={13} /> {exportError}</span>}
      </div>

      {/* What the period adds up to */}
      <div className="da-tiles">
        <Tile
          label={`Commission kept · ${periodLabel}`}
          value={formatPKR(grandTotals.net)}
          sub={`${grandTotals.chargeCount} charged ride${grandTotals.chargeCount === 1 ? '' : 's'}`}
          color="var(--accent-green)"
          icon={<TrendingUp size={17} />}
          loading={loading}
        />
        <Tile
          label="Charged"
          value={formatPKR(grandTotals.earned)}
          sub="before refunds"
          color="var(--accent-blue)"
          icon={<Coins size={17} />}
          loading={loading}
        />
        <Tile
          label="Refunded"
          value={formatPKR(grandTotals.refunded)}
          sub="cancelled seat bookings"
          color="var(--accent-orange)"
          icon={<Undo2 size={17} />}
          loading={loading}
        />
        <Tile
          label="Missed on cancellations"
          value={formatPKR(grandMissed)}
          sub="never charged — counterfactual"
          color="var(--accent-red)"
          icon={<XCircle size={17} />}
          loading={loading}
        />
        <Tile
          label="Balance held"
          value={formatPKR(balanceHeld)}
          sub={`${formatPKR(grandTotals.toppedUp)} topped up this period`}
          color="var(--accent-purple)"
          icon={<Wallet size={17} />}
          loading={loading}
        />
        <Tile
          label="Drivers in deficit"
          value={String(deficit.length)}
          sub={deficit.length ? `${formatPKR(deficitTotal)} owed` : 'none'}
          color="var(--accent-red)"
          icon={<TrendingDown size={17} />}
          loading={loading}
        />
      </div>

      {rateNote && (
        <div className="rate-alert rate-alert-warn">
          <AlertCircle size={20} />
          <div><strong>Commission rate missing</strong><p>{rateNote}</p></div>
        </div>
      )}

      {loadError && (
        <div className="rate-alert rate-alert-error">
          <AlertTriangle size={20} />
          <div><strong>Driver accounts could not be loaded</strong><p>{loadError}</p></div>
        </div>
      )}

      {/* Balance filter + sort */}
      <div className="dv-filter-row">
        {(Object.keys(BALANCE_FILTER_LABEL) as BalanceFilter[]).map(f => (
          <button
            key={f}
            className={`dv-filter-pill ${balanceFilter === f ? 'active' : ''}`}
            onClick={() => setBalanceFilter(f)}
          >
            {BALANCE_FILTER_LABEL[f]}
            <span className="dv-pill-count">{balanceCounts[f]}</span>
          </button>
        ))}
      </div>

      <div className="dv-control-row">
        <label className="dv-select-wrap">
          <ArrowUpDown size={14} />
          <select value={sort} onChange={e => setSort(e.target.value as SortKey)}>
            {(Object.keys(SORT_LABEL) as SortKey[]).map(k => (
              <option key={k} value={k}>{SORT_LABEL[k]}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="users-search-bar" style={{ marginBottom: '1.5rem' }}>
        <Search size={16} style={{ color: 'var(--text-secondary)' }} />
        <input
          className="users-search-input"
          placeholder="Search by driver name, phone, vehicle or uid…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {search && (
          <button
            onClick={() => setSearch('')}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', display: 'flex' }}
          >
            <X size={15} />
          </button>
        )}
      </div>

      {loading ? (
        <div className="rides-loading">
          <Loader size={32} className="spin" />
          <p>Reading wallets and the commission ledger…</p>
        </div>
      ) : visible.length === 0 ? (
        <div className="rides-empty">
          <Wallet size={40} style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }} />
          <p>{accounts.length === 0 ? 'No driver wallets exist yet.' : 'No drivers match these filters.'}</p>
        </div>
      ) : (
        <div className="rides-table-wrapper">
          <table className="rides-table">
            <thead>
              <tr>
                <th>Driver</th>
                <th>Vehicle</th>
                <th className="num">Balance</th>
                <th className="num">Safe limit</th>
                <th className="num">Rides</th>
                <th className="num">Commission</th>
                <th className="num">Refunded</th>
                <th className="num">Net kept</th>
                <th className="num">Missed</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visible.map(r => (
                <tr key={r.account.uid} className="ride-row" onClick={() => setSelected(r.account.uid)}>
                  <td>
                    <div className="da-driver-name">
                      {r.account.name}
                      {r.account.hasWallet && !r.account.authentic && (
                        <span className="da-pill da-pill-unauthentic" title="Every top-up is checked by hand"><ShieldAlert size={10} /> Unauthentic</span>
                      )}
                      {pendingTopupDrivers.has(r.account.uid) && (
                        <span className="tq-status tq-status-pending" style={{ marginLeft: '0.4rem' }} title="A top-up is waiting to be approved or checked">Top-up to review</span>
                      )}
                    </div>
                    <div className="cell-dim">{r.account.phone || r.account.uid.slice(0, 12) + '…'}</div>
                  </td>
                  <td>
                    <div className="cell-dim">{r.account.vehicle || '—'}</div>
                    <div className="cell-dim">{r.account.tier}</div>
                  </td>
                  <td className="num">
                    <div className={`da-balance-cell da-balance-${r.state}`}>
                      {r.account.hasWallet ? formatPKR(r.account.balance) : '—'}
                    </div>
                    <BalancePill state={r.state} hasWallet={r.account.hasWallet} />
                  </td>
                  <td className="num">
                    {r.account.hasWallet ? (
                      <>
                        <div className="cell-dim">{formatPKR(r.account.safeLimit)}</div>
                        <div className="da-limit">min {formatPKR(r.account.minTopup)}</div>
                      </>
                    ) : <span className="cell-dim">—</span>}
                  </td>
                  <td className="num cell-dim">{r.totals.chargeCount || '—'}</td>
                  <td className="num cell-dim">{r.totals.earned ? formatPKR(r.totals.earned) : '—'}</td>
                  <td className="num cell-dim">{r.totals.refunded ? formatPKR(r.totals.refunded) : '—'}</td>
                  <td className="num cell-fare">{r.totals.net ? formatPKR(r.totals.net) : '—'}</td>
                  <td className="num">
                    {r.missedTotal
                      ? <span className="da-missed">{formatPKR(r.missedTotal)}<span className="da-missed-count">{r.missed.length} cancelled</span></span>
                      : <span className="cell-dim">—</span>}
                  </td>
                  <td><ChevronRight size={16} style={{ color: 'var(--text-secondary)' }} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="settings-note-box" style={{ marginTop: '2rem' }}>
        <div className="snb-icon"><Percent size={22} /></div>
        <div className="snb-text">
          <strong>Where these figures come from:</strong> balances are{' '}
          <span className="mono">wallets/&#123;uid&#125;.balance</span> and every commission figure is
          summed from that wallet’s <span className="mono">entries</span> ledger — charges of type{' '}
          <span className="mono">commission</span> and <span className="mono">ctc_commission</span>,
          less <span className="mono">ctc_commission_refund</span>. Balance is current and is not
          affected by the period; everything else is scoped to it.{' '}
          <strong>Missed commission is not revenue:</strong> commission is only ever charged when a
          ride completes, so it is an estimate of what a cancelled ride would have produced at the
          fare that had been agreed, shown so cancellations can be weighed against earnings.{' '}
          <Hash size={12} style={{ display: 'inline', verticalAlign: 'middle' }} /> Rides cancelled
          before any driver accepted are never stored, so they cannot appear here.
        </div>
      </div>

      {selectedRow && (
        <AccountDrawer
          row={selectedRow}
          periodLabel={periodLabel}
          ridesById={ridesById}
          onClose={() => setSelected(null)}
          onTrust={handleTrust}
        />
      )}
    </div>
  );
};

export default DriverAccounts;

import React, { useEffect, useState, useCallback } from 'react';
import { collection, getDocs, query, orderBy, doc, getDoc } from 'firebase/firestore';
import { ref, onValue, off } from 'firebase/database';
import { db, rtdb } from '../firebase';
import {
  CreditCard, CheckCircle, XCircle, Clock, Users, Car,
  Wallet, DollarSign, TrendingUp, TrendingDown, X,
  Loader, AlertCircle, ChevronRight, Calendar, MapPin,
  User, Phone, Shield, ArrowUpRight, ArrowDownLeft,
  BarChart3, Filter
} from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface RideDoc {
  id: string;
  source: 'rtdb' | 'firestore' | 'citytocity';
  status?: string;
  price?: unknown;   // Firebase may return as string — always read via toNum()
  time?: number | string | { seconds: number };
  rider?: string;
  driver?: string;
  pickup?: unknown;   // Firebase location shape varies
  dropoff?: unknown;  // Firebase location shape varies
  cabtype?: string;
  distance?: string | number;
}

interface UserDoc {
  name?: string;
  phone?: string;
  // Firebase may return these as strings — always read via toNum()
  walletBalance?: unknown;
  balance?: unknown;
  email?: string;
}

interface DriverDoc {
  fullName?: string;
  phoneNumber?: string;
  // Firebase may return these as strings — always read via toNum()
  walletBalance?: unknown;
  balance?: unknown;
  accountBalance?: unknown;
  carMake?: string;
  carModel?: string;
  carPlate?: string;
}

type TimePeriod = 'today' | 'week' | 'month' | 'year' | 'all' | 'custom';
type CategoryFilter = 'all' | 'received' | 'cancelled' | 'inprocess' | 'customer-balance' | 'driver-balance';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const toMs = (t: unknown): number => {
  if (!t) return 0;
  if (typeof t === 'number') return t > 1e12 ? t : t * 1000;
  if (typeof t === 'string') { const d = Date.parse(t); return isNaN(d) ? 0 : d; }
  if (typeof t === 'object' && t !== null && 'seconds' in t) return (t as { seconds: number }).seconds * 1000;
  return 0;
};

const isCompleted = (s?: string) => ['completed', 'finished', 'done'].includes((s || '').toLowerCase());
const isCancelled = (s?: string) => ['cancelled', 'canceled', 'rejected'].includes((s || '').toLowerCase());
const isInProcess = (s?: string) => ['ongoing', 'started', 'active', 'accepted', 'pending', 'searching', 'waiting'].includes((s || '').toLowerCase());

const getPeriodStart = (period: TimePeriod): number => {
  const now = new Date();
  switch (period) {
    case 'today': { const d = new Date(now); d.setHours(0, 0, 0, 0); return d.getTime(); }
    case 'week': { const d = new Date(now); d.setDate(d.getDate() - d.getDay()); d.setHours(0, 0, 0, 0); return d.getTime(); }
    case 'month': { const d = new Date(now.getFullYear(), now.getMonth(), 1); return d.getTime(); }
    case 'year': { return new Date(now.getFullYear(), 0, 1).getTime(); }
    default: return 0;
  }
};

/** Safely coerce any Firebase value to a real number (avoids string concatenation). */
const toNum = (v: unknown): number => {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
};

const formatCurrency = (amount: number): string =>
  `Rs. ${Math.round(amount).toLocaleString('en-PK', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

const formatTime = (t: RideDoc['time']): string => {
  const ms = toMs(t);
  if (!ms) return '—';
  return new Date(ms).toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' });
};

/**
 * Safely extract a human-readable location string from whatever shape
 * Firebase stores the pickup/dropoff in.
 */
const extractLocation = (loc: unknown): string => {
  if (!loc) return 'N/A';

  if (typeof loc === 'string') return loc.trim() || 'N/A';

  if (typeof loc !== 'object') return 'N/A';
  const o = loc as Record<string, unknown>;

  // Text / address fields
  const textFields = ['address', 'name', 'place', 'location', 'description', 'title', 'area', 'label', 'placeName', 'place_name', 'formattedAddress', 'formatted_address'];
  for (const key of textFields) {
    const val = o[key];
    if (typeof val === 'string' && val.trim()) return val.trim();
  }

  // Coordinate fields
  const tryCoords = (...pairs: [string, string][]): string | null => {
    for (const [latKey, lngKey] of pairs) {
      const lat = o[latKey];
      const lng = o[lngKey];
      const latN = typeof lat === 'number' ? lat : typeof lat === 'string' ? parseFloat(lat) : NaN;
      const lngN = typeof lng === 'number' ? lng : typeof lng === 'string' ? parseFloat(lng) : NaN;
      if (!isNaN(latN) && !isNaN(lngN)) return `${latN.toFixed(5)}, ${lngN.toFixed(5)}`;
    }
    return null;
  };

  const coords = tryCoords(
    ['lat',      'lng'],
    ['lat',      'long'],
    ['latitude', 'longitude'],
    ['_lat',     '_long'],
    ['Lat',      'Lng'],
    ['Latitude', 'Longitude'],
  );
  if (coords) return coords;

  console.warn('[extractLocation] Unrecognised location shape:', JSON.stringify(o));
  return 'N/A';
};

const getPickupText  = (pickup:  unknown) => extractLocation(pickup);
const getDropoffText = (dropoff: unknown) => extractLocation(dropoff);

// ─── Payment Status Badge ────────────────────────────────────────────────────

const PaymentBadge: React.FC<{ status: string }> = ({ status }) => {
  const s = (status || '').toLowerCase();
  let cls = 'pay-badge';
  let label = status;
  if (isCompleted(s)) { cls += ' pay-badge-received'; label = 'Received'; }
  else if (isCancelled(s)) { cls += ' pay-badge-cancelled'; label = 'Cancelled'; }
  else if (isInProcess(s)) { cls += ' pay-badge-inprocess'; label = 'In Process'; }
  else { cls += ' pay-badge-unknown'; }
  return <span className={cls}>{label}</span>;
};

// ─── Ride Detail Modal ────────────────────────────────────────────────────────

const PaymentDetailModal: React.FC<{ ride: RideDoc; onClose: () => void }> = ({ ride, onClose }) => {
  const [riderInfo, setRiderInfo] = useState<UserDoc | null>(null);
  const [driverInfo, setDriverInfo] = useState<DriverDoc | null>(null);
  const [loadingRider, setLoadingRider] = useState(false);
  const [loadingDriver, setLoadingDriver] = useState(false);

  useEffect(() => {
    if (ride.rider) {
      setLoadingRider(true);
      getDoc(doc(db, 'users', ride.rider))
        .then(snap => setRiderInfo(snap.exists() ? snap.data() as UserDoc : null))
        .catch(() => setRiderInfo(null))
        .finally(() => setLoadingRider(false));
    }
    if (ride.driver) {
      setLoadingDriver(true);
      getDoc(doc(db, 'driverProfileRequests', ride.driver))
        .then(snap => setDriverInfo(snap.exists() ? snap.data() as DriverDoc : null))
        .catch(() => setDriverInfo(null))
        .finally(() => setLoadingDriver(false));
    }
  }, [ride.rider, ride.driver]);

  const payType = isCompleted(ride.status) ? 'received' : isCancelled(ride.status) ? 'cancelled' : 'inprocess';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-drawer pay-modal-drawer" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title-row">
            <div className="pay-modal-icon-wrap" style={{
              background: payType === 'received' ? 'rgba(5,150,105,0.1)' : payType === 'cancelled' ? 'rgba(220,38,38,0.1)' : 'rgba(217,119,6,0.1)',
              color: payType === 'received' ? '#059669' : payType === 'cancelled' ? '#dc2626' : '#d97706'
            }}>
              {payType === 'received' ? <CheckCircle size={20} /> : payType === 'cancelled' ? <XCircle size={20} /> : <Clock size={20} />}
            </div>
            <div>
              <div className="pay-modal-amount">
                {formatCurrency(toNum(ride.price))}
              </div>
              <PaymentBadge status={ride.status || 'unknown'} />
            </div>
          </div>
          <button className="modal-close-btn" onClick={onClose}><X size={20} /></button>
        </div>

        <div className="modal-body">
          {/* Route */}
          <div className="modal-section">
            <h3 className="modal-section-title"><MapPin size={16} /> Route</h3>
            <div className="modal-route-card">
              <div className="route-point">
                <span className="route-dot green" />
                <div>
                  <div className="route-label">Pickup</div>
                  <div className="route-value">{getPickupText(ride.pickup)}</div>
                </div>
              </div>
              <div className="route-line" />
              <div className="route-point">
                <span className="route-dot red" />
                <div>
                  <div className="route-label">Dropoff</div>
                  <div className="route-value">{getDropoffText(ride.dropoff)}</div>
                </div>
              </div>
            </div>
          </div>

          {/* Payment Details */}
          <div className="modal-section">
            <h3 className="modal-section-title"><CreditCard size={16} /> Payment Details</h3>
            <div className="modal-details-grid">
              <div className="detail-item"><span className="di-label">Amount</span><span className="di-value pay-amount-cell">{formatCurrency(toNum(ride.price))}</span></div>
              <div className="detail-item"><span className="di-label">Status</span><span className="di-value"><PaymentBadge status={ride.status || 'unknown'} /></span></div>
              <div className="detail-item"><span className="di-label">Distance</span><span className="di-value">{ride.distance || '—'}</span></div>
              <div className="detail-item"><span className="di-label">Vehicle</span><span className="di-value">{ride.cabtype || '—'}</span></div>
              <div className="detail-item"><span className="di-label">Date & Time</span><span className="di-value">{formatTime(ride.time)}</span></div>
              <div className="detail-item"><span className="di-label">Source</span><span className="di-value">{ride.source === 'rtdb' ? 'Realtime DB' : ride.source === 'citytocity' ? 'Inter-City' : 'Firestore'}</span></div>
              <div className="detail-item" style={{ gridColumn: '1 / -1' }}><span className="di-label">Ride ID</span><span className="di-value mono">{ride.id}</span></div>
            </div>
          </div>

          {/* Rider */}
          <div className="modal-section">
            <h3 className="modal-section-title"><User size={16} /> Customer</h3>
            {loadingRider ? (
              <div className="loading-row"><Loader size={16} className="spin" /> Loading customer…</div>
            ) : riderInfo ? (
              <div className="modal-details-grid">
                <div className="detail-item"><span className="di-label">Name</span><span className="di-value">{riderInfo.name || '—'}</span></div>
                <div className="detail-item"><span className="di-label"><Phone size={12} /> Phone</span><span className="di-value">{riderInfo.phone || '—'}</span></div>
                <div className="detail-item"><span className="di-label"><Wallet size={12} /> Wallet</span><span className="di-value">{formatCurrency(toNum(riderInfo.walletBalance) || toNum(riderInfo.balance))}</span></div>
              </div>
            ) : ride.rider ? (
              <p className="modal-no-data">Customer profile not found (UID: {ride.rider.slice(0, 10)}…)</p>
            ) : (
              <p className="modal-no-data">No customer UID on this record.</p>
            )}
          </div>

          {/* Driver */}
          <div className="modal-section">
            <h3 className="modal-section-title"><Car size={16} /> Driver</h3>
            {!ride.driver ? (
              <p className="modal-no-data">No driver assigned.</p>
            ) : loadingDriver ? (
              <div className="loading-row"><Loader size={16} className="spin" /> Loading driver…</div>
            ) : driverInfo ? (
              <div className="modal-details-grid">
                <div className="detail-item"><span className="di-label">Name</span><span className="di-value">{driverInfo.fullName || '—'}</span></div>
                <div className="detail-item"><span className="di-label"><Phone size={12} /> Phone</span><span className="di-value">{driverInfo.phoneNumber || '—'}</span></div>
                <div className="detail-item"><span className="di-label"><Wallet size={12} /> Balance</span><span className="di-value">{formatCurrency(toNum(driverInfo.accountBalance) || toNum(driverInfo.walletBalance) || toNum(driverInfo.balance))}</span></div>
                <div className="detail-item"><span className="di-label">Vehicle</span><span className="di-value">{driverInfo.carMake} {driverInfo.carModel}</span></div>
                <div className="detail-item"><span className="di-label">Plate</span><span className="di-value">{driverInfo.carPlate || '—'}</span></div>
              </div>
            ) : (
              <p className="modal-no-data">Driver profile not found.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── Customer Balance Modal ────────────────────────────────────────────────────

const CustomerBalanceModal: React.FC<{ users: Array<{ id: string } & UserDoc>; onClose: () => void }> = ({ users, onClose }) => {
  const uBal = (u: UserDoc) => toNum(u.walletBalance) || toNum(u.balance);
  const totalBalance = users.reduce((sum, u) => sum + uBal(u), 0);
  const sorted = [...users].sort((a, b) => uBal(b) - uBal(a));

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-drawer pay-modal-drawer" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title-row">
            <div className="pay-modal-icon-wrap" style={{ background: 'rgba(79,70,229,0.1)', color: '#4f46e5' }}>
              <Users size={20} />
            </div>
            <div>
              <div className="pay-modal-amount">{formatCurrency(totalBalance)}</div>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Total Customer Wallet Balance</span>
            </div>
          </div>
          <button className="modal-close-btn" onClick={onClose}><X size={20} /></button>
        </div>

        <div className="modal-body">
          <div className="modal-section">
            <h3 className="modal-section-title"><BarChart3 size={16} /> Balance Summary</h3>
            <div className="modal-details-grid">
              <div className="detail-item"><span className="di-label">Total Customers</span><span className="di-value">{users.length.toLocaleString()}</span></div>
              <div className="detail-item"><span className="di-label">Total Balance</span><span className="di-value pay-amount-cell">{formatCurrency(totalBalance)}</span></div>
              <div className="detail-item"><span className="di-label">Avg per Customer</span><span className="di-value">{users.length ? formatCurrency(Math.round(totalBalance / users.length)) : '—'}</span></div>
              <div className="detail-item"><span className="di-label">With Balance &gt; 0</span><span className="di-value">{users.filter(u => uBal(u) > 0).length}</span></div>
            </div>
          </div>

          <div className="modal-section">
            <h3 className="modal-section-title"><Users size={16} /> Top Customers by Balance</h3>
            <div className="balance-list">
              {sorted.slice(0, 50).map((u, i) => (
                <div key={u.id} className="balance-list-item">
                  <div className="bli-rank">{i + 1}</div>
                  <div className="bli-info">
                    <div className="bli-name">{u.name || 'Unnamed User'}</div>
                    <div className="bli-sub">{u.phone || u.email || u.id.slice(0, 12) + '…'}</div>
                  </div>
                  <div className="bli-amount">{formatCurrency(uBal(u))}</div>
                </div>
              ))}
              {sorted.length > 50 && (
                <div className="balance-list-more">… and {sorted.length - 50} more customers</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── Driver Balance Modal ────────────────────────────────────────────────────

const DriverBalanceModal: React.FC<{ drivers: Array<{ id: string } & DriverDoc>; onClose: () => void }> = ({ drivers, onClose }) => {
  const dBal = (d: DriverDoc) => toNum(d.accountBalance) || toNum(d.walletBalance) || toNum(d.balance);
  const totalBalance = drivers.reduce((sum, d) => sum + dBal(d), 0);
  const sorted = [...drivers].sort((a, b) => dBal(b) - dBal(a));

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-drawer pay-modal-drawer" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title-row">
            <div className="pay-modal-icon-wrap" style={{ background: 'rgba(8,145,178,0.1)', color: '#0891b2' }}>
              <Car size={20} />
            </div>
            <div>
              <div className="pay-modal-amount">{formatCurrency(totalBalance)}</div>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Total Driver Account Balance</span>
            </div>
          </div>
          <button className="modal-close-btn" onClick={onClose}><X size={20} /></button>
        </div>

        <div className="modal-body">
          <div className="modal-section">
            <h3 className="modal-section-title"><BarChart3 size={16} /> Balance Summary</h3>
            <div className="modal-details-grid">
              <div className="detail-item"><span className="di-label">Total Drivers</span><span className="di-value">{drivers.length.toLocaleString()}</span></div>
              <div className="detail-item"><span className="di-label">Total Balance</span><span className="di-value pay-amount-cell">{formatCurrency(totalBalance)}</span></div>
              <div className="detail-item"><span className="di-label">Avg per Driver</span><span className="di-value">{drivers.length ? formatCurrency(Math.round(totalBalance / drivers.length)) : '—'}</span></div>
              <div className="detail-item"><span className="di-label">With Balance &gt; 0</span><span className="di-value">{drivers.filter(d => dBal(d) > 0).length}</span></div>
            </div>
          </div>

          <div className="modal-section">
            <h3 className="modal-section-title"><Car size={16} /> Top Drivers by Balance</h3>
            <div className="balance-list">
              {sorted.slice(0, 50).map((d, i) => (
                <div key={d.id} className="balance-list-item">
                  <div className="bli-rank">{i + 1}</div>
                  <div className="bli-info">
                    <div className="bli-name">{d.fullName || 'Unnamed Driver'}</div>
                    <div className="bli-sub">{d.phoneNumber || d.id.slice(0, 12) + '…'} {d.carPlate ? `· ${d.carPlate}` : ''}</div>
                  </div>
                  <div className="bli-amount">{formatCurrency(dBal(d))}</div>
                </div>
              ))}
              {sorted.length > 50 && (
                <div className="balance-list-more">… and {sorted.length - 50} more drivers</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── Main Payments Page ───────────────────────────────────────────────────────

export const Payments: React.FC = () => {
  const [rides, setRides] = useState<RideDoc[]>([]);
  const [users, setUsers] = useState<Array<{ id: string } & UserDoc>>([]);
  const [drivers, setDrivers] = useState<Array<{ id: string } & DriverDoc>>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<TimePeriod>('all');
  const [category, setCategory] = useState<CategoryFilter>('all');
  const [selectedRide, setSelectedRide] = useState<RideDoc | null>(null);
  const [showCustomerBalance, setShowCustomerBalance] = useState(false);
  const [showDriverBalance, setShowDriverBalance] = useState(false);
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');

  // ── Data Loading ──────────────────────────────────────────────────────────

  const loadUsers = useCallback(async () => {
    try {
      const snap = await getDocs(collection(db, 'users'));
      const list: Array<{ id: string } & UserDoc> = [];
      snap.forEach(d => list.push({ id: d.id, ...d.data() as UserDoc }));
      setUsers(list);
    } catch { /* silent */ }
  }, []);

  const loadDrivers = useCallback(async () => {
    try {
      const snap = await getDocs(collection(db, 'driverProfileRequests'));
      const list: Array<{ id: string } & DriverDoc> = [];
      snap.forEach(d => list.push({ id: d.id, ...d.data() as DriverDoc }));
      setDrivers(list);
    } catch { /* silent */ }
  }, []);

  const loadFirestoreRides = useCallback(async (): Promise<RideDoc[]> => {
    const result: RideDoc[] = [];
    try {
      const snap = await getDocs(query(collection(db, 'rides'), orderBy('time', 'desc')));
      snap.forEach(d => result.push({ id: d.id, source: 'firestore', ...d.data() } as RideDoc));
    } catch {
      try {
        const snap = await getDocs(collection(db, 'rides'));
        snap.forEach(d => result.push({ id: d.id, source: 'firestore', ...d.data() } as RideDoc));
      } catch { /* silent */ }
    }
    return result;
  }, []);

  const loadCitytocity = useCallback(async (): Promise<RideDoc[]> => {
    const result: RideDoc[] = [];
    try {
      const snap = await getDocs(collection(db, 'citytocity'));
      snap.forEach(d => result.push({ id: d.id, source: 'citytocity', ...d.data() } as RideDoc));
    } catch { /* silent */ }
    return result;
  }, []);

  useEffect(() => {
    let mounted = true;
    const rtdbRef = ref(rtdb, 'rides');

    const handleRtdb = (snapshot: unknown) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const snap = snapshot as any;
      const rtdbRides: RideDoc[] = [];
      if (snap && snap.exists()) {
        snap.forEach((child: { key: string; val: () => object }) => {
          rtdbRides.push({ id: child.key, source: 'rtdb', ...child.val() } as RideDoc);
        });
      }
      if (!mounted) return;
      Promise.all([loadFirestoreRides(), loadCitytocity()]).then(([fsRides, c2c]) => {
        if (!mounted) return;
        const seen = new Set<string>();
        const merged: RideDoc[] = [];
        for (const r of [...rtdbRides, ...fsRides, ...c2c]) {
          if (!seen.has(r.id)) { seen.add(r.id); merged.push(r); }
        }
        merged.sort((a, b) => toMs(b.time) - toMs(a.time));
        setRides(merged);
        setLoading(false);
      });
    };

    onValue(rtdbRef, handleRtdb);
    Promise.all([loadUsers(), loadDrivers()]);

    return () => {
      mounted = false;
      off(rtdbRef, 'value', handleRtdb);
    };
  }, [loadFirestoreRides, loadCitytocity, loadUsers, loadDrivers]);

  // ── Filtering ─────────────────────────────────────────────────────────────

  const periodStart = getPeriodStart(period);

  const periodRides = rides.filter(r => {
    if (period === 'all') return true;
    const tMs = toMs(r.time);
    if (period === 'custom') {
      if (!customStartDate || !customEndDate) return true;
      const start = new Date(customStartDate).getTime();
      const end = new Date(customEndDate);
      end.setHours(23, 59, 59, 999);
      return tMs >= start && tMs <= end.getTime();
    }
    return tMs >= periodStart;
  });

  const receivedRides = periodRides.filter(r => isCompleted(r.status));
  const cancelledRides = periodRides.filter(r => isCancelled(r.status));
  const inProcessRides = periodRides.filter(r => isInProcess(r.status));

  const ridePrice = (r: RideDoc) => toNum(r.price);
  const userBal = (u: { walletBalance?: unknown; balance?: unknown }) => toNum(u.walletBalance) || toNum(u.balance);
  const driverBal = (d: { accountBalance?: unknown; walletBalance?: unknown; balance?: unknown }) =>
    toNum(d.accountBalance) || toNum(d.walletBalance) || toNum(d.balance);

  const receivedTotal = receivedRides.reduce((s, r) => s + ridePrice(r), 0);
  const cancelledTotal = cancelledRides.reduce((s, r) => s + ridePrice(r), 0);
  const inProcessTotal = inProcessRides.reduce((s, r) => s + ridePrice(r), 0);

  const totalCustomerBalance = users.reduce((s, u) => s + userBal(u), 0);
  const totalDriverBalance = drivers.reduce((s, d) => s + driverBal(d), 0);

  // Rides to show in table
  const tableRides: RideDoc[] = (() => {
    if (category === 'received') return receivedRides;
    if (category === 'cancelled') return cancelledRides;
    if (category === 'inprocess') return inProcessRides;
    return periodRides;
  })();

  // ── Summary Cards ─────────────────────────────────────────────────────────

  const summaryCards = [
    {
      key: 'received' as CategoryFilter,
      label: 'Received',
      sublabel: 'Completed payments',
      amount: receivedTotal,
      count: receivedRides.length,
      color: '#059669',
      bg: 'rgba(5,150,105,0.08)',
      icon: <CheckCircle size={24} />,
      trend: <ArrowUpRight size={16} />,
    },
    {
      key: 'cancelled' as CategoryFilter,
      label: 'Cancelled',
      sublabel: 'Cancelled ride value',
      amount: cancelledTotal,
      count: cancelledRides.length,
      color: '#dc2626',
      bg: 'rgba(220,38,38,0.08)',
      icon: <XCircle size={24} />,
      trend: <ArrowDownLeft size={16} />,
    },
    {
      key: 'inprocess' as CategoryFilter,
      label: 'In Process',
      sublabel: 'Active & pending rides',
      amount: inProcessTotal,
      count: inProcessRides.length,
      color: '#d97706',
      bg: 'rgba(217,119,6,0.08)',
      icon: <Clock size={24} />,
      trend: null,
    },
    {
      key: 'customer-balance' as CategoryFilter,
      label: 'Customer Balance',
      sublabel: 'Total wallet spending power',
      amount: totalCustomerBalance,
      count: users.length,
      color: '#4f46e5',
      bg: 'rgba(79,70,229,0.08)',
      icon: <Users size={24} />,
      trend: null,
      onClick: () => { setShowCustomerBalance(true); setCategory('customer-balance'); },
    },
    {
      key: 'driver-balance' as CategoryFilter,
      label: 'Driver Balance',
      sublabel: 'Amount held in driver accounts',
      amount: totalDriverBalance,
      count: drivers.length,
      color: '#0891b2',
      bg: 'rgba(8,145,178,0.08)',
      icon: <Car size={24} />,
      trend: null,
      onClick: () => { setShowDriverBalance(true); setCategory('driver-balance'); },
    },
  ];

  const periods: { key: TimePeriod; label: string }[] = [
    { key: 'today', label: 'Today' },
    { key: 'week', label: 'This Week' },
    { key: 'month', label: 'This Month' },
    { key: 'year', label: 'This Year' },
    { key: 'all', label: 'All Time' },
    { key: 'custom', label: 'Custom' },
  ];

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="payments-page">
      {/* Header */}
      <div className="dashboard-header" style={{ textAlign: 'left', marginBottom: '2rem' }}>
        <h1>Payments</h1>
        <p>Financial overview — received, cancelled, in-process, and balance analytics</p>
      </div>

      {/* Time Period Filter */}
      <div className="pay-period-bar">
        <div className="pay-period-label"><Filter size={15} /> Period</div>
        <div className="pay-period-tabs">
          {periods.map(p => (
            <button
              key={p.key}
              className={`pay-period-tab ${period === p.key ? 'active' : ''}`}
              onClick={() => setPeriod(p.key)}
            >
              <Calendar size={13} />
              {p.label}
            </button>
          ))}
        </div>
        {period === 'custom' && (
          <div className="custom-date-filters" style={{ display: 'flex', gap: '0.5rem', marginLeft: '1rem', alignItems: 'center' }}>
            <input type="date" value={customStartDate} onChange={e => setCustomStartDate(e.target.value)} style={{ padding: '0.4rem', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)' }} />
            <span style={{ color: 'var(--text-secondary)' }}>to</span>
            <input type="date" value={customEndDate} onChange={e => setCustomEndDate(e.target.value)} style={{ padding: '0.4rem', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)' }} />
          </div>
        )}
      </div>

      {/* Summary Cards */}
      <div className="pay-summary-grid">
        {summaryCards.map(card => (
          <button
            key={card.key}
            className={`pay-stat-card ${category === card.key ? 'selected' : ''}`}
            style={{ '--pay-color': card.color, '--pay-bg': card.bg } as React.CSSProperties}
            onClick={() => {
              if (card.onClick) { card.onClick(); }
              else {
                setCategory(prev => prev === card.key ? 'all' : card.key);
              }
            }}
          >
            <div className="psc-header">
              <div className="psc-icon">{card.icon}</div>
              {card.trend && <div className="psc-trend" style={{ color: card.color }}>{card.trend}</div>}
            </div>
            <div className="psc-amount">{loading ? <span className="loading-pulse" style={{ height: '1.4rem', width: '5rem', display: 'inline-block' }} /> : formatCurrency(card.amount)}</div>
            <div className="psc-label">{card.label}</div>
            <div className="psc-meta">
              {loading
                ? <span className="loading-pulse" style={{ height: '0.85rem', width: '4rem', display: 'inline-block' }} />
                : <>{card.key === 'customer-balance' ? `${card.count} customers` : card.key === 'driver-balance' ? `${card.count} drivers` : `${card.count} rides`}</>
              }
              <span className="psc-sublabel">{card.sublabel}</span>
            </div>
            {category === card.key && <div className="psc-active-bar" />}
          </button>
        ))}
      </div>

      {/* Overview Row */}
      <div className="pay-overview-row">
        <div className="pay-kpi-card">
          <div className="pay-kpi-icon" style={{ color: '#059669' }}><TrendingUp size={20} /></div>
          <div>
            <div className="pay-kpi-label">Total Received</div>
            <div className="pay-kpi-value">{loading ? '…' : formatCurrency(receivedTotal)}</div>
          </div>
        </div>
        <div className="pay-kpi-card">
          <div className="pay-kpi-icon" style={{ color: '#4f46e5' }}><DollarSign size={20} /></div>
          <div>
            <div className="pay-kpi-label">Avg Fare (Received)</div>
            <div className="pay-kpi-value">{loading ? '…' : receivedRides.length ? formatCurrency(Math.round(receivedTotal / receivedRides.length)) : '—'}</div>
          </div>
        </div>
        <div className="pay-kpi-card">
          <div className="pay-kpi-icon" style={{ color: '#dc2626' }}><TrendingDown size={20} /></div>
          <div>
            <div className="pay-kpi-label">Cancellation Loss</div>
            <div className="pay-kpi-value">{loading ? '…' : formatCurrency(cancelledTotal)}</div>
          </div>
        </div>
        <div className="pay-kpi-card">
          <div className="pay-kpi-icon" style={{ color: '#d97706' }}><Wallet size={20} /></div>
          <div>
            <div className="pay-kpi-label">Float in System</div>
            <div className="pay-kpi-value">{loading ? '…' : formatCurrency(totalCustomerBalance + totalDriverBalance)}</div>
          </div>
        </div>
      </div>

      {/* Table Section */}
      {category !== 'customer-balance' && category !== 'driver-balance' && (
        <>
          <div className="rides-table-header" style={{ marginTop: '2rem' }}>
            <span className="rides-table-title">
              <CreditCard size={18} />
              {category === 'all' ? 'All Transactions' : category === 'received' ? 'Received Payments' : category === 'cancelled' ? 'Cancelled Payments' : 'In-Process Payments'}
              <span className="rides-count-badge">{tableRides.length}</span>
            </span>
            {category !== 'all' && (
              <button className="clear-filter-btn" onClick={() => setCategory('all')}>
                <X size={14} /> Clear filter
              </button>
            )}
          </div>

          {loading ? (
            <div className="rides-loading">
              <Loader size={32} className="spin" />
              <p>Loading payment data…</p>
            </div>
          ) : tableRides.length === 0 ? (
            <div className="rides-empty">
              <AlertCircle size={40} style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }} />
              <p>No transactions found for this filter.</p>
            </div>
          ) : (
            <div className="rides-table-wrapper">
              <table className="rides-table">
                <thead>
                  <tr>
                    <th>Status</th>
                    <th>Amount</th>
                    <th>Route</th>
                    <th>Vehicle</th>
                    <th>Distance</th>
                    <th>Date & Time</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {tableRides.map(ride => (
                    <tr key={ride.id} className="ride-row" onClick={() => setSelectedRide(ride)}>
                      <td><PaymentBadge status={ride.status || 'unknown'} /></td>
                      <td className="cell-fare">
                        {formatCurrency(toNum(ride.price))}
                      </td>
                      <td>
                        <div className="route-cell">
                          <span className="route-pickup">
                            <span className="dot green-dot" />
                            {getPickupText(ride.pickup).slice(0, 22)}{getPickupText(ride.pickup).length > 22 ? '…' : ''}
                          </span>
                          <span className="route-arrow">→</span>
                          <span className="route-dropoff">
                            <span className="dot red-dot" />
                            {getDropoffText(ride.dropoff).slice(0, 22)}{getDropoffText(ride.dropoff).length > 22 ? '…' : ''}
                          </span>
                        </div>
                      </td>
                      <td className="cell-dim">{ride.cabtype || '—'}</td>
                      <td className="cell-dim">{ride.distance || '—'}</td>
                      <td className="cell-dim">{formatTime(ride.time)}</td>
                      <td><ChevronRight size={16} style={{ color: 'var(--text-secondary)' }} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* Balance panels for customer/driver */}
      {category === 'customer-balance' && !showCustomerBalance && (
        <div className="pay-balance-panel">
          <div className="pay-balance-panel-header">
            <Shield size={18} style={{ color: '#4f46e5' }} />
            Customer Balance Overview
            <button className="clear-filter-btn" onClick={() => setCategory('all')}><X size={14} /> Clear</button>
          </div>
          <div className="pay-balance-quick">
            <div className="pay-bq-stat"><span className="pay-bq-val">{users.length}</span><span className="pay-bq-lbl">Total Customers</span></div>
            <div className="pay-bq-stat"><span className="pay-bq-val">{formatCurrency(totalCustomerBalance)}</span><span className="pay-bq-lbl">Total Wallet Balance</span></div>
            <div className="pay-bq-stat"><span className="pay-bq-val">{users.filter(u => (toNum(u.walletBalance) || toNum(u.balance)) > 0).length}</span><span className="pay-bq-lbl">Customers with Balance</span></div>
            <div className="pay-bq-stat"><span className="pay-bq-val">{users.length ? formatCurrency(Math.round(totalCustomerBalance / users.length)) : '—'}</span><span className="pay-bq-lbl">Avg Balance</span></div>
          </div>
          <button className="pay-view-all-btn" onClick={() => setShowCustomerBalance(true)}>
            <Users size={16} /> View All Customer Balances
          </button>
        </div>
      )}

      {category === 'driver-balance' && !showDriverBalance && (
        <div className="pay-balance-panel">
          <div className="pay-balance-panel-header">
            <Shield size={18} style={{ color: '#0891b2' }} />
            Driver Balance Overview
            <button className="clear-filter-btn" onClick={() => setCategory('all')}><X size={14} /> Clear</button>
          </div>
          <div className="pay-balance-quick">
            <div className="pay-bq-stat"><span className="pay-bq-val">{drivers.length}</span><span className="pay-bq-lbl">Total Drivers</span></div>
            <div className="pay-bq-stat"><span className="pay-bq-val">{formatCurrency(totalDriverBalance)}</span><span className="pay-bq-lbl">Total Account Balance</span></div>
            <div className="pay-bq-stat"><span className="pay-bq-val">{drivers.filter(d => (toNum(d.accountBalance) || toNum(d.walletBalance) || toNum(d.balance)) > 0).length}</span><span className="pay-bq-lbl">Drivers with Balance</span></div>
            <div className="pay-bq-stat"><span className="pay-bq-val">{drivers.length ? formatCurrency(Math.round(totalDriverBalance / drivers.length)) : '—'}</span><span className="pay-bq-lbl">Avg Balance</span></div>
          </div>
          <button className="pay-view-all-btn" style={{ '--pay-color': '#0891b2' } as React.CSSProperties} onClick={() => setShowDriverBalance(true)}>
            <Car size={16} /> View All Driver Balances
          </button>
        </div>
      )}

      {/* Modals */}
      {selectedRide && <PaymentDetailModal ride={selectedRide} onClose={() => setSelectedRide(null)} />}
      {showCustomerBalance && <CustomerBalanceModal users={users} onClose={() => { setShowCustomerBalance(false); }} />}
      {showDriverBalance && <DriverBalanceModal drivers={drivers} onClose={() => { setShowDriverBalance(false); }} />}
    </div>
  );
};

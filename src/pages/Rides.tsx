import React, { useEffect, useState, useCallback } from 'react';
import { collection, getDocs, doc, getDoc, query, orderBy } from 'firebase/firestore';
import { ref, onValue, off } from 'firebase/database';
import { db, rtdb } from '../firebase';
import {
  Navigation, Clock, CheckCircle, XCircle, AlertCircle,
  Car, Truck, Bike, MapPin, X, User, Phone, Shield,
  Package, Calendar, ChevronRight, Loader, Globe,
  Activity, Hash, Filter
} from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

// Firebase location objects can have many shapes — keep it open
type RideLocation = Record<string, unknown>;

interface Ride {
  id: string;
  source: 'rtdb' | 'firestore' | 'citytocity';
  rider?: string;
  driver?: string;
  pickup?: string | RideLocation;
  dropoff?: string | RideLocation;
  cabtype?: string;
  status?: string;
  price?: number;
  distance?: string | number;
  duration?: string | number;
  time?: number | string | { seconds: number };
  items?: string;
  when?: string;
  freightSize?: string;
  receiver?: string;
  passengers?: number;
  detail?: string;
}

interface RiderInfo {
  name?: string;
  phone?: string;
  os?: string;
  isVerified?: boolean;
}

interface DriverInfo {
  fullName?: string;
  phoneNumber?: string;
  carMake?: string;
  carModel?: string;
  carYear?: string;
  carPlate?: string;
  carImg?: string;
  licenseImg?: string;
  isVerified?: boolean;
}

type FilterType = 'all' | 'active' | 'pending' | 'completed' | 'cancelled';
type TimePeriod = 'today' | 'week' | 'month' | 'year' | 'all' | 'custom';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Safely extract a human-readable location string from whatever shape
 * Firebase stores the pickup/dropoff in. Logs unknown shapes once to console
 * so you can see the real structure in DevTools.
 */
const extractLocation = (loc: unknown): string => {
  if (!loc) return 'N/A';

  // Plain string
  if (typeof loc === 'string') return loc.trim() || 'N/A';

  if (typeof loc !== 'object') return 'N/A';
  const o = loc as Record<string, unknown>;

  // ── Text / address fields (try all common names) ──────────────────────────
  const textFields = ['address', 'name', 'place', 'location', 'description', 'title', 'area', 'label', 'placeName', 'place_name', 'formattedAddress', 'formatted_address'];
  for (const key of textFields) {
    const val = o[key];
    if (typeof val === 'string' && val.trim()) return val.trim();
  }

  // ── Coordinate fields (try all common names) ──────────────────────────────
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
    ['_lat',     '_long'],     // Firestore GeoPoint serialised
    ['Lat',      'Lng'],
    ['Latitude', 'Longitude'],
  );
  if (coords) return coords;

  // ── Unknown shape — log once so you can see it in DevTools ─────────────────
  console.warn('[extractLocation] Unrecognised location shape:', JSON.stringify(o));
  return 'N/A';
};

const getPickupText  = (pickup:  Ride['pickup'])  => extractLocation(pickup);
const getDropoffText = (dropoff: Ride['dropoff']) => extractLocation(dropoff);

const getTimestamp = (time: Ride['time']): Date | null => {
  if (!time) return null;
  if (typeof time === 'number') return new Date(time > 1e12 ? time : time * 1000);
  if (typeof time === 'string') return new Date(time);
  if (typeof time === 'object' && 'seconds' in time) return new Date(time.seconds * 1000);
  return null;
};

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

const formatTime = (time: Ride['time']): string => {
  const d = getTimestamp(time);
  if (!d) return '—';
  return d.toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' });
};

const normalizeStatus = (status?: string): string => (status || 'unknown').toLowerCase();

const isActive = (s: string) => ['ongoing', 'started', 'active', 'accepted'].includes(s);
const isPending = (s: string) => ['pending', 'searching', 'waiting'].includes(s);
const isCompleted = (s: string) => ['completed', 'finished', 'done'].includes(s);
const isCancelled = (s: string) => ['cancelled', 'canceled', 'rejected'].includes(s);

const getRideType = (ride: Ride): string => {
  if (ride.source === 'citytocity') return 'intercity';
  if (ride.cabtype) {
    const t = ride.cabtype.toLowerCase();
    if (t.includes('freight') || t.includes('truck')) return 'freight';
    if (t.includes('bike') || t.includes('moto')) return 'bike';
    if (t.includes('ac') || t.includes('air')) return 'ac';
    if (t.includes('mini')) return 'mini';
    return 'car';
  }
  return 'car';
};

const isFreightRide = (ride: Ride): boolean =>
  ride.items != null || ride.freightSize != null || getRideType(ride) === 'freight';

// ─── Sub-components ───────────────────────────────────────────────────────────

const TypeBadge: React.FC<{ type: string }> = ({ type }) => {
  const map: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
    mini:      { label: 'Mini',       color: '#3b82f6', icon: <Car size={11} /> },
    car:       { label: 'Car',        color: '#8b5cf6', icon: <Car size={11} /> },
    ac:        { label: 'AC',         color: '#06b6d4', icon: <Car size={11} /> },
    bike:      { label: 'Bike',       color: '#f59e0b', icon: <Bike size={11} /> },
    freight:   { label: 'Freight',    color: '#ef4444', icon: <Truck size={11} /> },
    intercity: { label: 'Inter-City', color: '#10b981', icon: <Globe size={11} /> },
  };
  const config = map[type] || map.car;
  return (
    <span className="ride-type-badge" style={{ '--badge-color': config.color } as React.CSSProperties}>
      {config.icon} {config.label}
    </span>
  );
};

const StatusPill: React.FC<{ status: string }> = ({ status }) => {
  const s = normalizeStatus(status);
  let cls = 'ride-status-pill';
  if (isActive(s)) cls += ' pill-active';
  else if (isPending(s)) cls += ' pill-pending';
  else if (isCompleted(s)) cls += ' pill-completed';
  else if (isCancelled(s)) cls += ' pill-cancelled';
  else cls += ' pill-unknown';
  const label = status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Unknown';
  return <span className={cls}>{isActive(s) && <span className="blink-dot" />} {label}</span>;
};

// ─── Ride Detail Modal ────────────────────────────────────────────────────────

const RideDetailModal: React.FC<{ ride: Ride; onClose: () => void }> = ({ ride, onClose }) => {
  const [rider, setRider] = useState<RiderInfo | null>(null);
  const [driver, setDriver] = useState<DriverInfo | null>(null);
  const [loadingRider, setLoadingRider] = useState(false);
  const [loadingDriver, setLoadingDriver] = useState(false);

  useEffect(() => {
    if (ride.rider) {
      setLoadingRider(true);
      getDoc(doc(db, 'users', ride.rider))
        .then(snap => setRider(snap.exists() ? (snap.data() as RiderInfo) : null))
        .catch(() => setRider(null))
        .finally(() => setLoadingRider(false));
    }
    if (ride.driver) {
      setLoadingDriver(true);
      getDoc(doc(db, 'driverProfileRequests', ride.driver))
        .then(snap => setDriver(snap.exists() ? (snap.data() as DriverInfo) : null))
        .catch(() => setDriver(null))
        .finally(() => setLoadingDriver(false));
    }
  }, [ride.rider, ride.driver]);

  const rideType = getRideType(ride);
  const freight = isFreightRide(ride);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-drawer" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title-row">
            <TypeBadge type={rideType} />
            <StatusPill status={ride.status || 'unknown'} />
          </div>
          <button className="modal-close-btn" onClick={onClose}><X size={20} /></button>
        </div>

        <div className="modal-body">
          {/* Route */}
          <div className="modal-section">
            <h3 className="modal-section-title"><Navigation size={16} /> Route</h3>
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

          {/* Trip Details */}
          <div className="modal-section">
            <h3 className="modal-section-title"><Activity size={16} /> Trip Details</h3>
            <div className="modal-details-grid">
              <div className="detail-item"><span className="di-label">Fare</span><span className="di-value">Rs. {ride.price ?? '—'}</span></div>
              <div className="detail-item"><span className="di-label">Distance</span><span className="di-value">{ride.distance ?? '—'}</span></div>
              <div className="detail-item"><span className="di-label">Duration</span><span className="di-value">{ride.duration ?? '—'}</span></div>
              <div className="detail-item"><span className="di-label">Time</span><span className="di-value">{formatTime(ride.time)}</span></div>
              {ride.source === 'citytocity' && ride.passengers != null && (
                <div className="detail-item"><span className="di-label">Passengers</span><span className="di-value">{ride.passengers}</span></div>
              )}
              <div className="detail-item"><span className="di-label">Source</span><span className="di-value">{ride.source === 'rtdb' ? 'Realtime DB' : ride.source === 'citytocity' ? 'Inter-City' : 'Firestore'}</span></div>
              <div className="detail-item" style={{ gridColumn: '1 / -1' }}><span className="di-label">Ride ID</span><span className="di-value mono">{ride.id}</span></div>
            </div>
          </div>

          {/* Freight */}
          {freight && (
            <div className="modal-section">
              <h3 className="modal-section-title"><Package size={16} /> Freight Details</h3>
              <div className="modal-details-grid">
                {ride.freightSize && <div className="detail-item"><span className="di-label">Payload Size</span><span className="di-value">{ride.freightSize}</span></div>}
                {ride.items && <div className="detail-item" style={{ gridColumn: '1 / -1' }}><span className="di-label">Items</span><span className="di-value">{ride.items}</span></div>}
                {ride.when && <div className="detail-item"><span className="di-label">Scheduled For</span><span className="di-value"><Calendar size={13} style={{ display: 'inline', marginRight: 4 }} />{ride.when}</span></div>}
                {ride.receiver && <div className="detail-item" style={{ gridColumn: '1 / -1' }}><span className="di-label">Receiver Info</span><span className="di-value">{ride.receiver}</span></div>}
              </div>
            </div>
          )}

          {/* Rider */}
          <div className="modal-section">
            <h3 className="modal-section-title"><User size={16} /> Rider Information</h3>
            {loadingRider ? (
              <div className="loading-row"><Loader size={16} className="spin" /> Loading rider…</div>
            ) : rider ? (
              <div className="modal-details-grid">
                <div className="detail-item"><span className="di-label">Name</span><span className="di-value">{rider.name || '—'}</span></div>
                <div className="detail-item"><span className="di-label"><Phone size={12} /> Phone</span><span className="di-value">{rider.phone || '—'}</span></div>
                <div className="detail-item"><span className="di-label">OS</span><span className="di-value">{rider.os || '—'}</span></div>
                <div className="detail-item">
                  <span className="di-label"><Shield size={12} /> Verified</span>
                  <span className={`di-value ${rider.isVerified ? 'text-green' : 'text-orange'}`}>{rider.isVerified ? 'Yes' : 'No'}</span>
                </div>
              </div>
            ) : ride.rider ? (
              <p className="modal-no-data">Rider profile not found (UID: {ride.rider.slice(0, 10)}…)</p>
            ) : (
              <p className="modal-no-data">No rider UID on this record.</p>
            )}
          </div>

          {/* Driver */}
          <div className="modal-section">
            <h3 className="modal-section-title"><Car size={16} /> Driver Information</h3>
            {!ride.driver ? (
              <p className="modal-no-data">No driver assigned yet.</p>
            ) : loadingDriver ? (
              <div className="loading-row"><Loader size={16} className="spin" /> Loading driver…</div>
            ) : driver ? (
              <>
                <div className="modal-details-grid">
                  <div className="detail-item"><span className="di-label">Name</span><span className="di-value">{driver.fullName || '—'}</span></div>
                  <div className="detail-item"><span className="di-label"><Phone size={12} /> Phone</span><span className="di-value">{driver.phoneNumber || '—'}</span></div>
                  <div className="detail-item"><span className="di-label">Vehicle</span><span className="di-value">{driver.carMake} {driver.carModel} ({driver.carYear})</span></div>
                  <div className="detail-item"><span className="di-label">Plate</span><span className="di-value">{driver.carPlate || '—'}</span></div>
                  <div className="detail-item">
                    <span className="di-label"><Shield size={12} /> Verified</span>
                    <span className={`di-value ${driver.isVerified ? 'text-green' : 'text-orange'}`}>{driver.isVerified ? 'Yes' : 'No'}</span>
                  </div>
                </div>
                {(driver.carImg || driver.licenseImg) && (
                  <div className="driver-thumb-row">
                    {driver.carImg && (
                      <a href={driver.carImg} target="_blank" rel="noopener noreferrer" className="driver-thumb">
                        <img src={driver.carImg} alt="Vehicle" />
                        <span>Vehicle</span>
                      </a>
                    )}
                    {driver.licenseImg && (
                      <a href={driver.licenseImg} target="_blank" rel="noopener noreferrer" className="driver-thumb">
                        <img src={driver.licenseImg} alt="License" />
                        <span>License</span>
                      </a>
                    )}
                  </div>
                )}
              </>
            ) : (
              <p className="modal-no-data">Driver profile not found (UID: {ride.driver.slice(0, 10)}…)</p>
            )}
          </div>

          {/* Inter-city detail */}
          {ride.source === 'citytocity' && ride.detail && (
            <div className="modal-section">
              <h3 className="modal-section-title"><Hash size={16} /> Additional Details</h3>
              <p style={{ color: 'var(--text-secondary)', margin: 0 }}>{ride.detail}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ─── Main Page ────────────────────────────────────────────────────────────────

export const Rides: React.FC = () => {
  const [rides, setRides] = useState<Ride[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterType>('all');
  const [period, setPeriod] = useState<TimePeriod>('all');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [selectedRide, setSelectedRide] = useState<Ride | null>(null);

  const loadFirestoreRides = useCallback(async (): Promise<Ride[]> => {
    const result: Ride[] = [];
    try {
      const snap = await getDocs(query(collection(db, 'rides'), orderBy('time', 'desc')));
      snap.forEach(d => result.push({ id: d.id, source: 'firestore', ...d.data() } as Ride));
    } catch {
      try {
        const snap = await getDocs(collection(db, 'rides'));
        snap.forEach(d => result.push({ id: d.id, source: 'firestore', ...d.data() } as Ride));
      } catch { /* silent */ }
    }
    return result;
  }, []);

  const loadCitytocityRides = useCallback(async (): Promise<Ride[]> => {
    const result: Ride[] = [];
    try {
      const snap = await getDocs(collection(db, 'citytocity'));
      snap.forEach(d => result.push({ id: d.id, source: 'citytocity', ...d.data() } as Ride));
    } catch { /* silent */ }
    return result;
  }, []);

  useEffect(() => {
    let mounted = true;
    const rtdbRef = ref(rtdb, 'rides');

    const handleRtdb = (snapshot: unknown) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const snap = snapshot as any;
      const rtdbRides: Ride[] = [];
      if (snap && snap.exists()) {
        snap.forEach((child: { key: string; val: () => object }) => {
          rtdbRides.push({ id: child.key, source: 'rtdb', ...child.val() } as Ride);
        });
      }
      if (!mounted) return;
      Promise.all([loadFirestoreRides(), loadCitytocityRides()]).then(([fsRides, c2cRides]) => {
        if (!mounted) return;
        const idSet = new Set<string>();
        const merged: Ride[] = [];
        for (const r of [...rtdbRides, ...fsRides, ...c2cRides]) {
          if (!idSet.has(r.id)) {
            idSet.add(r.id);
            merged.push(r);
          }
        }
        merged.sort((a, b) => {
          const ta = getTimestamp(a.time)?.getTime() ?? 0;
          const tb = getTimestamp(b.time)?.getTime() ?? 0;
          return tb - ta;
        });
        setRides(merged);
        setLoading(false);
      });
    };

    onValue(rtdbRef, handleRtdb);
    return () => {
      mounted = false;
      off(rtdbRef, 'value', handleRtdb);
    };
  }, [loadFirestoreRides, loadCitytocityRides]);

  const periodStart = getPeriodStart(period);
  const periodRides = rides.filter(r => {
    if (period === 'all') return true;
    const d = getTimestamp(r.time);
    const tMs = d ? d.getTime() : 0;
    if (period === 'custom') {
      if (!customStartDate || !customEndDate) return true;
      const start = new Date(customStartDate).getTime();
      const end = new Date(customEndDate);
      end.setHours(23, 59, 59, 999);
      return tMs >= start && tMs <= end.getTime();
    }
    return tMs >= periodStart;
  });

  const counts = {
    all: periodRides.length,
    active: periodRides.filter(r => isActive(normalizeStatus(r.status))).length,
    pending: periodRides.filter(r => isPending(normalizeStatus(r.status))).length,
    completed: periodRides.filter(r => isCompleted(normalizeStatus(r.status))).length,
    cancelled: periodRides.filter(r => isCancelled(normalizeStatus(r.status))).length,
  };

  const filteredRides = filter === 'all' ? periodRides : periodRides.filter(r => {
    const s = normalizeStatus(r.status);
    if (filter === 'active') return isActive(s);
    if (filter === 'pending') return isPending(s);
    if (filter === 'completed') return isCompleted(s);
    if (filter === 'cancelled') return isCancelled(s);
    return true;
  });

  const periods: { key: TimePeriod; label: string }[] = [
    { key: 'today', label: 'Today' },
    { key: 'week', label: 'This Week' },
    { key: 'month', label: 'This Month' },
    { key: 'year', label: 'This Year' },
    { key: 'all', label: 'All Time' },
    { key: 'custom', label: 'Custom' },
  ];

  const filterCards: { key: FilterType; label: string; count: number; color: string; icon: React.ReactNode }[] = [
    { key: 'all',       label: 'All Rides',      count: counts.all,       color: 'var(--accent-blue)',    icon: <Navigation size={22} /> },
    { key: 'active',    label: 'Active',          count: counts.active,    color: '#22d3ee',              icon: <Activity size={22} /> },
    { key: 'pending',   label: 'Pending',         count: counts.pending,   color: 'var(--accent-orange)', icon: <Clock size={22} /> },
    { key: 'completed', label: 'Completed',       count: counts.completed, color: 'var(--accent-green)',  icon: <CheckCircle size={22} /> },
    { key: 'cancelled', label: 'Cancelled',       count: counts.cancelled, color: 'var(--accent-red)',    icon: <XCircle size={22} /> },
  ];

  return (
    <div className="rides-page">
      <div className="dashboard-header" style={{ textAlign: 'left', marginBottom: '2rem' }}>
        <h1>Rides Management</h1>
        <p>Real-time aggregated view across Realtime Database &amp; Firestore</p>
      </div>

      {/* Time Period Filter */}
      <div className="pay-period-bar" style={{ marginBottom: '1.5rem' }}>
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

      {/* Filter Cards */}
      <div className="rides-filter-grid">
        {filterCards.map(card => (
          <button
            key={card.key}
            className={`rides-stat-card ${filter === card.key ? 'selected' : ''}`}
            style={{ '--card-color': card.color } as React.CSSProperties}
            onClick={() => setFilter(card.key)}
          >
            <div className="rsc-icon">{card.icon}</div>
            <div className="rsc-body">
              <div className="rsc-count">
                {loading ? <span className="loading-pulse" style={{ height: '1.6rem', width: '2.5rem', display: 'inline-block' }} /> : card.count}
              </div>
              <div className="rsc-label">{card.label}</div>
            </div>
            {filter === card.key && <div className="rsc-active-bar" />}
          </button>
        ))}
      </div>

      {/* Table Header */}
      <div className="rides-table-header">
        <span className="rides-table-title">
          <MapPin size={18} />
          {filter === 'all' ? 'All Rides' : `${filter.charAt(0).toUpperCase() + filter.slice(1)} Rides`}
          <span className="rides-count-badge">{filteredRides.length}</span>
        </span>
        {filter !== 'all' && (
          <button className="clear-filter-btn" onClick={() => setFilter('all')}>
            <X size={14} /> Clear filter
          </button>
        )}
      </div>

      {/* Content */}
      {loading ? (
        <div className="rides-loading">
          <Loader size={32} className="spin" />
          <p>Loading rides from all sources…</p>
        </div>
      ) : filteredRides.length === 0 ? (
        <div className="rides-empty">
          <AlertCircle size={40} style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }} />
          <p>No {filter !== 'all' ? filter : ''} rides found.</p>
        </div>
      ) : (
        <div className="rides-table-wrapper">
          <table className="rides-table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Status</th>
                <th>Route</th>
                <th>Fare</th>
                <th>Distance</th>
                <th>Time</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filteredRides.map(ride => (
                <tr key={ride.id} className="ride-row" onClick={() => setSelectedRide(ride)}>
                  <td><TypeBadge type={getRideType(ride)} /></td>
                  <td><StatusPill status={ride.status || 'unknown'} /></td>
                  <td>
                    <div className="route-cell">
                      <span className="route-pickup">
                        <span className="dot green-dot" />
                        {getPickupText(ride.pickup).slice(0, 28)}{getPickupText(ride.pickup).length > 28 ? '…' : ''}
                      </span>
                      <span className="route-arrow">→</span>
                      <span className="route-dropoff">
                        <span className="dot red-dot" />
                        {getDropoffText(ride.dropoff).slice(0, 28)}{getDropoffText(ride.dropoff).length > 28 ? '…' : ''}
                      </span>
                    </div>
                  </td>
                  <td className="cell-fare">Rs. {ride.price ?? '—'}</td>
                  <td className="cell-dim">{ride.distance ?? '—'}</td>
                  <td className="cell-dim">{formatTime(ride.time)}</td>
                  <td><ChevronRight size={16} style={{ color: 'var(--text-secondary)' }} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedRide && (
        <RideDetailModal ride={selectedRide} onClose={() => setSelectedRide(null)} />
      )}
    </div>
  );
};

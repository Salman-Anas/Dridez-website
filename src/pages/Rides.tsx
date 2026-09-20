import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { collection, getDocs, doc, getDoc } from 'firebase/firestore';
import { ref, onValue, off } from 'firebase/database';
import { db, rtdb } from '../firebase';
import { RideChat } from '../components/RideChat';
import {
  cabtypeLabel, cabtypeCategory, formatPKR, classifyRide, variantAppliesTo,
  RIDE_VEHICLE_FILTERS, RIDE_VARIANT_FILTERS,
  type RideVehicle, type RideVariant,
} from '../utils/rideTaxonomy';
import {
  Navigation, Clock, CheckCircle, XCircle, AlertCircle,
  Car, Truck, Bike, MapPin, X, User, Phone, Shield,
  Package, Calendar, ChevronRight, Loader, Globe,
  Activity, Hash, Filter, Snowflake, MessageSquare,
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
  /** Written alongside cabtype so rides can be grouped without parsing keys. */
  rideCategory?: string;
  acOption?: string | null;
  status?: string;
  price?: number;
  distance?: string | number;
  duration?: string | number;
  /** Legacy serialised Timestamp; newer rides carry the *At fields below. */
  time?: number | string | { seconds: number };
  createdAt?: number | { seconds: number };
  acceptedAt?: number;
  completedAt?: number;
  cancelledAt?: number;
  cancelledBy?: string;
  /** Locale date string kept on Firestore ride history for display only. */
  date?: string;
  commission?: number;
  commissionRate?: number;
  items?: string;
  when?: string;
  freightSize?: string;
  receiver?: string;
  passengers?: number | string;
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
type VehicleFilter = RideVehicle | 'all';
type VariantFilter = RideVariant | 'all';

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

/** One timestamp value, whichever of the many shapes it arrives in. */
const toMs = (v: unknown): number => {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return v > 1e12 ? v : v * 1000;
  if (typeof v === 'string') { const t = Date.parse(v); return Number.isNaN(t) ? 0 : t; }
  if (typeof v === 'object') {
    const o = v as { seconds?: number; toDate?: () => Date };
    if (typeof o.toDate === 'function') return o.toDate().getTime();
    if (typeof o.seconds === 'number') return o.seconds * 1000;
  }
  return 0;
};

/**
 * When a ride happened. Live RTDB rides only have `createdAt`; Firestore
 * history carries `completedAt` or `cancelledAt`; city-to-city has `createdAt`
 * with a legacy `time` Timestamp on older documents. Reading only `time` — as
 * this page used to — left almost every ride at epoch zero, which sank them all
 * to the bottom of the list and hid them from every period filter.
 */
const rideMs = (ride: Ride): number =>
  toMs(ride.completedAt) || toMs(ride.cancelledAt) || toMs(ride.createdAt) ||
  toMs(ride.acceptedAt) || toMs(ride.time) || toMs(ride.date);

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

const formatTime = (ride: Ride): string => {
  const ms = rideMs(ride);
  if (!ms) return '—';
  return new Date(ms).toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' });
};

const normalizeStatus = (status?: string): string => (status || 'unknown').toLowerCase();

// Status spellings are exact in the app — `inprogress` and `started` for a live
// in-city trip, `accepted` and `ontrip` for city-to-city.
const isActive = (s: string) => ['inprogress', 'ongoing', 'started', 'active', 'accepted', 'ontrip'].includes(s);
const isPending = (s: string) => ['pending', 'searching', 'waiting'].includes(s);
const isCompleted = (s: string) => ['completed', 'finished', 'done'].includes(s);
const isCancelled = (s: string) => ['cancelled', 'canceled', 'rejected'].includes(s);

/**
 * The ride's cabtype key, or 'intercity' for a city-to-city request. Substring
 * matching is not safe against the current keys — "mini_nonac" contains "ac" —
 * so the key is resolved through the shared taxonomy instead.
 */
const getRideType = (ride: Ride): string => {
  if (ride.source === 'citytocity') return 'intercity';
  return (ride.cabtype || ride.rideCategory || '').toLowerCase().trim();
};

const isFreightRide = (ride: Ride): boolean =>
  ride.items != null || ride.freightSize != null || cabtypeCategory(getRideType(ride)) === 'freight';

// ─── Sub-components ───────────────────────────────────────────────────────────

/** Coloured per ride category, labelled from the taxonomy so both the current
 *  cabtypes and the legacy keys in historical rides read correctly. */
const TypeBadge: React.FC<{ type: string }> = ({ type }) => {
  const map: Record<string, { color: string; icon: React.ReactNode }> = {
    mini:          { color: '#8b5cf6', icon: <Car size={11} /> },
    comfort:       { color: '#3b82f6', icon: <Car size={11} /> },
    car_delivery:  { color: '#10b981', icon: <Package size={11} /> },
    rickshaw:      { color: '#ec4899', icon: <Truck size={11} /> },
    bike:          { color: '#f59e0b', icon: <Bike size={11} /> },
    bike_delivery: { color: '#14b8a6', icon: <Package size={11} /> },
    freight:       { color: '#ef4444', icon: <Truck size={11} /> },
    intercity:     { color: '#10b981', icon: <Globe size={11} /> },
    unknown:       { color: '#64748b', icon: <Car size={11} /> },
  };
  const key = type === 'intercity' ? 'intercity' : cabtypeCategory(type) ?? 'unknown';
  const config = map[key];
  const label = type === 'intercity' ? 'Inter-City' : cabtypeLabel(type);
  return (
    <span className="ride-type-badge" style={{ '--badge-color': config.color } as React.CSSProperties}>
      {config.icon} {label}
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

/** The AC / Non-AC / Delivery answer, shown next to the type. */
const VariantChip: React.FC<{ variant: RideVariant | null }> = ({ variant }) => {
  if (!variant) return null;
  if (variant === 'delivery') {
    return <span className="ride-variant-chip variant-delivery"><Package size={10} /> Delivery</span>;
  }
  if (variant === 'ac') {
    return <span className="ride-variant-chip variant-ac"><Snowflake size={10} /> AC</span>;
  }
  return <span className="ride-variant-chip variant-nonac">Non AC</span>;
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
  const { variant } = classifyRide(ride);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-drawer" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title-row">
            <TypeBadge type={rideType} />
            <VariantChip variant={variant} />
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
              <div className="detail-item"><span className="di-label">Fare</span><span className="di-value">{ride.price != null ? formatPKR(Number(ride.price)) : '—'}</span></div>
              <div className="detail-item"><span className="di-label">Distance</span><span className="di-value">{ride.distance ?? '—'}</span></div>
              <div className="detail-item"><span className="di-label">Duration</span><span className="di-value">{ride.duration ?? '—'}</span></div>
              <div className="detail-item"><span className="di-label">Time</span><span className="di-value">{formatTime(ride)}</span></div>
              <div className="detail-item">
                <span className="di-label">Ride Type</span>
                <span className="di-value">{rideType === 'intercity' ? 'Inter-City' : cabtypeLabel(rideType)}</span>
              </div>
              <div className="detail-item">
                <span className="di-label">AC / Delivery</span>
                <span className="di-value">
                  {variant === 'ac' ? 'AC' : variant === 'nonac' ? 'Non AC' : variant === 'delivery' ? 'Delivery' : 'Not applicable'}
                </span>
              </div>
              {ride.commission != null && (
                <div className="detail-item">
                  <span className="di-label">Commission</span>
                  <span className="di-value">
                    {formatPKR(ride.commission)}
                    {ride.commissionRate != null && ` · ${(ride.commissionRate * 100).toFixed(1)}%`}
                  </span>
                </div>
              )}
              {ride.cancelledBy && (
                <div className="detail-item"><span className="di-label">Cancelled By</span><span className="di-value">{ride.cancelledBy}</span></div>
              )}
              {ride.source === 'citytocity' && ride.passengers != null && (
                <div className="detail-item"><span className="di-label">Passengers</span><span className="di-value">{String(ride.passengers)}</span></div>
              )}
              <div className="detail-item"><span className="di-label">Source</span><span className="di-value">{ride.source === 'rtdb' ? 'Realtime DB' : ride.source === 'citytocity' ? 'Inter-City' : 'Firestore'}</span></div>
              <div className="detail-item" style={{ gridColumn: '1 / -1' }}><span className="di-label">Ride ID</span><span className="di-value mono">{ride.id}</span></div>
            </div>
          </div>

          {/* Delivery / freight payload */}
          {(freight || variant === 'delivery') && (
            <div className="modal-section">
              <h3 className="modal-section-title"><Package size={16} /> Package Details</h3>
              <div className="modal-details-grid">
                {ride.freightSize && <div className="detail-item"><span className="di-label">Payload Size</span><span className="di-value">{ride.freightSize}</span></div>}
                {ride.items && <div className="detail-item" style={{ gridColumn: '1 / -1' }}><span className="di-label">Items</span><span className="di-value">{ride.items}</span></div>}
                {ride.detail && <div className="detail-item" style={{ gridColumn: '1 / -1' }}><span className="di-label">Description</span><span className="di-value">{ride.detail}</span></div>}
                {ride.when && <div className="detail-item"><span className="di-label">Scheduled For</span><span className="di-value"><Calendar size={13} style={{ display: 'inline', marginRight: 4 }} />{ride.when}</span></div>}
                {ride.receiver && <div className="detail-item" style={{ gridColumn: '1 / -1' }}><span className="di-label">Receiver</span><span className="di-value">{ride.receiver}</span></div>}
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

          {/* Trip chat — rider ↔ driver, live from the Realtime Database */}
          <div className="modal-section">
            <h3 className="modal-section-title"><MessageSquare size={16} /> Trip Chat</h3>
            <RideChat rideId={ride.id} riderUid={ride.rider} driverUid={ride.driver} />
          </div>

          {/* Inter-city detail */}
          {ride.source === 'citytocity' && ride.detail && !freight && variant !== 'delivery' && (
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
  const [vehicle, setVehicle] = useState<VehicleFilter>('all');
  const [variant, setVariant] = useState<VariantFilter>('all');
  const [period, setPeriod] = useState<TimePeriod>('all');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [selectedRide, setSelectedRide] = useState<Ride | null>(null);

  const loadFirestoreRides = useCallback(async (): Promise<Ride[]> => {
    const result: Ride[] = [];
    try {
      const snap = await getDocs(collection(db, 'rides'));
      snap.forEach(d => result.push({ id: d.id, source: 'firestore', ...d.data() } as Ride));
    } catch { /* silent */ }
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
        merged.sort((a, b) => rideMs(b) - rideMs(a));
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

  // ── Filtering ──────────────────────────────────────────────────────────────
  // The four axes are applied in stages so each filter row can show a count of
  // what selecting it would actually yield, given everything else chosen.

  const periodStart = getPeriodStart(period);

  const periodRides = useMemo(() => rides.filter(r => {
    if (period === 'all') return true;
    const tMs = rideMs(r);
    if (period === 'custom') {
      if (!customStartDate || !customEndDate) return true;
      const start = new Date(customStartDate).getTime();
      const end = new Date(customEndDate);
      end.setHours(23, 59, 59, 999);
      return tMs >= start && tMs <= end.getTime();
    }
    return tMs >= periodStart;
  }), [rides, period, periodStart, customStartDate, customEndDate]);

  const matchesStatus = useCallback((r: Ride) => {
    if (filter === 'all') return true;
    const s = normalizeStatus(r.status);
    if (filter === 'active') return isActive(s);
    if (filter === 'pending') return isPending(s);
    if (filter === 'completed') return isCompleted(s);
    if (filter === 'cancelled') return isCancelled(s);
    return true;
  }, [filter]);

  const counts = useMemo(() => ({
    all: periodRides.length,
    active: periodRides.filter(r => isActive(normalizeStatus(r.status))).length,
    pending: periodRides.filter(r => isPending(normalizeStatus(r.status))).length,
    completed: periodRides.filter(r => isCompleted(normalizeStatus(r.status))).length,
    cancelled: periodRides.filter(r => isCancelled(normalizeStatus(r.status))).length,
  }), [periodRides]);

  /** Everything the two type filters choose from: period + status applied. */
  const typePool = useMemo(
    () => periodRides.filter(matchesStatus),
    [periodRides, matchesStatus],
  );

  const classified = useMemo(
    () => typePool.map(r => ({ ride: r, cls: classifyRide(r) })),
    [typePool],
  );

  /** Vehicle counts reflect the variant already chosen, and vice versa. */
  const vehicleCounts = useMemo(() => {
    const c: Record<string, number> = { all: 0 };
    for (const { cls } of classified) {
      if (variant !== 'all' && cls.variant !== variant) continue;
      c.all += 1;
      c[cls.vehicle] = (c[cls.vehicle] || 0) + 1;
    }
    return c;
  }, [classified, variant]);

  const variantCounts = useMemo(() => {
    const c: Record<string, number> = { all: 0 };
    for (const { cls } of classified) {
      if (vehicle !== 'all' && cls.vehicle !== vehicle) continue;
      c.all += 1;
      if (cls.variant) c[cls.variant] = (c[cls.variant] || 0) + 1;
    }
    return c;
  }, [classified, vehicle]);

  const filteredRides = useMemo(
    () => classified
      .filter(({ cls }) => (vehicle === 'all' || cls.vehicle === vehicle))
      .filter(({ cls }) => (variant === 'all' || cls.variant === variant))
      .map(({ ride }) => ride),
    [classified, vehicle, variant],
  );

  const typeFiltersActive = vehicle !== 'all' || variant !== 'all';

  const clearAll = () => { setFilter('all'); setVehicle('all'); setVariant('all'); };

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

  /** "Mini · AC rides", "Delivery rides" — what the table is actually showing. */
  const tableTitle = (() => {
    const v = vehicle === 'all' ? null : RIDE_VEHICLE_FILTERS.find(o => o.id === vehicle)?.label;
    const a = variant === 'all' ? null : RIDE_VARIANT_FILTERS.find(o => o.id === variant)?.label;
    const status = filter === 'all' ? '' : `${filter.charAt(0).toUpperCase()}${filter.slice(1)} `;
    const type = [v, a].filter(Boolean).join(' · ');
    return type ? `${status}${type} rides` : `${status || 'All '}Rides`;
  })();

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

      {/* Status filter cards */}
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

      {/* Ride type — the vehicle the rider asked for */}
      <div className="ride-filter-block">
        <div className="ride-filter-label"><Car size={14} /> Ride type</div>
        <div className="dv-filter-row">
          <button
            className={`dv-filter-pill ${vehicle === 'all' ? 'active' : ''}`}
            onClick={() => setVehicle('all')}
          >
            All types
            <span className="dv-pill-count">{vehicleCounts.all || 0}</span>
          </button>
          {RIDE_VEHICLE_FILTERS.map(o => (
            <button
              key={o.id}
              className={`dv-filter-pill ${vehicle === o.id ? 'active' : ''}`}
              onClick={() => setVehicle(vehicle === o.id ? 'all' : o.id)}
              title={o.hint}
            >
              {o.label}
              <span className="dv-pill-count">{vehicleCounts[o.id] || 0}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Second axis — the AC answer, or a delivery instead of a passenger */}
      <div className="ride-filter-block">
        <div className="ride-filter-label"><Snowflake size={14} /> AC &amp; delivery</div>
        <div className="dv-filter-row">
          <button
            className={`dv-filter-pill ${variant === 'all' ? 'active' : ''}`}
            onClick={() => setVariant('all')}
          >
            Any
            <span className="dv-pill-count">{variantCounts.all || 0}</span>
          </button>
          {RIDE_VARIANT_FILTERS.map(o => {
            // A rickshaw is never asked about AC and a bike never carries a
            // passenger in an AC cabin — offering those combinations would only
            // ever return nothing.
            const applies = variantAppliesTo(o, vehicle);
            return (
              <button
                key={o.id}
                className={`dv-filter-pill ${variant === o.id ? 'active' : ''}`}
                onClick={() => setVariant(variant === o.id ? 'all' : o.id)}
                disabled={!applies}
                title={applies ? o.hint : `${o.label} does not apply to ${RIDE_VEHICLE_FILTERS.find(v => v.id === vehicle)?.label ?? 'this type'}`}
              >
                {o.label}
                <span className="dv-pill-count">{variantCounts[o.id] || 0}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Table Header */}
      <div className="rides-table-header">
        <span className="rides-table-title">
          <MapPin size={18} />
          {tableTitle}
          <span className="rides-count-badge">{filteredRides.length}</span>
        </span>
        {(filter !== 'all' || typeFiltersActive) && (
          <button className="clear-filter-btn" onClick={clearAll}>
            <X size={14} /> Clear filters
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
          <p>No rides match these filters.</p>
          {(filter !== 'all' || typeFiltersActive) && (
            <button className="clear-filter-btn" onClick={clearAll}>
              <X size={14} /> Clear filters
            </button>
          )}
        </div>
      ) : (
        <div className="rides-table-wrapper">
          <table className="rides-table">
            <thead>
              <tr>
                <th>Type</th>
                <th>AC / Delivery</th>
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
                  <td>
                    {classifyRide(ride).variant
                      ? <VariantChip variant={classifyRide(ride).variant} />
                      : <span className="cell-dim">—</span>}
                  </td>
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
                  <td className="cell-fare">{ride.price != null ? formatPKR(Number(ride.price)) : '—'}</td>
                  <td className="cell-dim">{ride.distance ?? '—'}</td>
                  <td className="cell-dim">{formatTime(ride)}</td>
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

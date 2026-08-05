import React, { useEffect, useState } from 'react';
import { collection, getDocs, doc, updateDoc, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import {
  CheckCircle, X, Car, Truck, Phone, Hash, Shield, ShieldAlert,
  Image as ImageIcon, Star, Navigation, Clock, XCircle,
  DollarSign, TrendingUp, Loader, ChevronRight, Search,
  CreditCard, Calendar, FileText, Activity, MapPin
} from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Driver {
  id: string;
  userid?: string;
  fullName?: string;
  phoneNumber?: string;
  carMake?: string;
  carModel?: string;
  carYear?: string;
  carPlate?: string;
  driversLicense?: string;
  driversLicenseExpiration?: string;
  cnicNum?: string;
  cnicExp?: string;
  freight?: boolean;
  driver?: string;
  carImg?: string;
  cnicImg?: string;
  licenseImg?: string;
  isVerified?: boolean;
}

interface RideRecord {
  id: string;
  status?: string;
  pickup?: unknown;   // Firebase shape varies
  dropoff?: unknown;
  price?: unknown;
  distance?: unknown;
  time?: unknown;
  cabtype?: string;
  rider?: string;
}

interface RatingRecord {
  rating?: number;
  review?: string;
  rider?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Pull lat/lng numbers from ANY Firebase value — handles:
 * - Firestore GeoPoint class instances (.latitude/.longitude on prototype)
 * - plain objects with any common key name
 * - string-encoded numbers
 */
const getCoordPair = (o: Record<string, unknown>): { lat: number; lng: number } | null => {
  // Firestore GeoPoint: constructor name is 'GeoPoint', has .latitude/.longitude
  const ctorName = (o as { constructor?: { name?: string } }).constructor?.name;
  if (ctorName === 'GeoPoint') {
    const lat = (o as unknown as { latitude: number }).latitude;
    const lng = (o as unknown as { longitude: number }).longitude;
    if (typeof lat === 'number' && typeof lng === 'number') return { lat, lng };
  }
  // Also try toJSON() which GeoPoint exposes
  if (typeof (o as { toJSON?: () => unknown }).toJSON === 'function') {
    const j = (o as { toJSON: () => unknown }).toJSON() as Record<string, unknown>;
    const lat = typeof j['latitude'] === 'number' ? j['latitude'] as number : NaN;
    const lng = typeof j['longitude'] === 'number' ? j['longitude'] as number : NaN;
    if (!isNaN(lat) && !isNaN(lng)) return { lat, lng };
  }
  // Plain-object key pairs
  const pairs: [string, string][] = [
    ['lat', 'lng'], ['lat', 'long'], ['latitude', 'longitude'],
    ['_lat', '_long'], ['Lat', 'Lng'], ['Latitude', 'Longitude'],
  ];
  for (const [lk, lgk] of pairs) {
    const rawLat = o[lk];
    const rawLng = o[lgk];
    const lat = typeof rawLat === 'number' ? rawLat : parseFloat(String(rawLat ?? ''));
    const lng = typeof rawLng === 'number' ? rawLng : parseFloat(String(rawLng ?? ''));
    if (!isNaN(lat) && !isNaN(lng)) return { lat, lng };
  }
  return null;
};

/** Extract a readable string from any Firebase location value. */
const extractLocation = (loc: unknown): string => {
  if (!loc) return 'N/A';
  if (typeof loc === 'string') return loc.trim() || 'N/A';
  if (typeof loc !== 'object') return 'N/A';
  const o = loc as Record<string, unknown>;
  // Text fields
  const textKeys = ['address', 'name', 'place', 'location', 'description', 'title', 'area', 'label', 'placeName', 'place_name', 'formattedAddress', 'formatted_address'];
  for (const k of textKeys) {
    const v = o[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  // Coordinates
  const coords = getCoordPair(o);
  if (coords) return `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`;
  // Unknown — log ALL own + prototype keys so the shape is visible
  const allKeys = [...Object.keys(o), ...Object.getOwnPropertyNames(Object.getPrototypeOf(o) ?? {})];
  console.warn('[location] N/A — shape unknown. Constructor:', (o as { constructor?: { name?: string } }).constructor?.name, '| Keys:', allKeys, '| Value:', o);
  return 'N/A';
};

/** Extract {lat, lng} from any Firebase location value, or null. */
const extractCoords = (loc: unknown): { lat: number; lng: number } | null => {
  if (!loc || typeof loc !== 'object') return null;
  return getCoordPair(loc as Record<string, unknown>);
};

const toNum = (v: unknown): number => { const n = Number(v); return isNaN(n) ? 0 : n; };

const fmtTime = (t: unknown): string => {
  if (!t) return '—';
  let d: Date;
  if (typeof t === 'number') d = new Date(t > 1e12 ? t : t * 1000);
  else if (typeof t === 'string') d = new Date(t);
  else if (typeof t === 'object' && t !== null && 'seconds' in t) d = new Date((t as { seconds: number }).seconds * 1000);
  else return '—';
  return d.toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' });
};

const isCompleted = (s?: string) => ['completed', 'finished', 'done'].includes((s || '').toLowerCase());
const isCancelled = (s?: string) => ['cancelled', 'canceled', 'rejected'].includes((s || '').toLowerCase());
const isActive    = (s?: string) => ['ongoing', 'started', 'active', 'accepted'].includes((s || '').toLowerCase());
const isPending   = (s?: string) => ['pending', 'searching', 'waiting'].includes((s || '').toLowerCase());

// ─── Sub-components ───────────────────────────────────────────────────────────

const StatusPill: React.FC<{ status?: string }> = ({ status }) => {
  const s = (status || '').toLowerCase();
  let cls = 'ride-status-pill';
  if (isActive(s)) cls += ' pill-active';
  else if (isPending(s)) cls += ' pill-pending';
  else if (isCompleted(s)) cls += ' pill-completed';
  else if (isCancelled(s)) cls += ' pill-cancelled';
  else cls += ' pill-unknown';
  const label = status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Unknown';
  return <span className={cls}>{label}</span>;
};

const PhotoThumb: React.FC<{ src?: string; label: string }> = ({ src, label }) => {
  const [err, setErr] = useState(false);
  if (!src || err) {
    return (
      <div className="dv-photo-box dv-photo-empty">
        <ImageIcon size={20} />
        <span>{label}</span>
      </div>
    );
  }
  return (
    <a href={src} target="_blank" rel="noopener noreferrer" className="dv-photo-box">
      <img src={src} alt={label} onError={() => setErr(true)} referrerPolicy="no-referrer" />
      <span>{label}</span>
    </a>
  );
};

const StarRating: React.FC<{ value: number; max?: number }> = ({ value, max = 5 }) => (
  <div style={{ display: 'flex', gap: 2 }}>
    {Array.from({ length: max }).map((_, i) => (
      <Star
        key={i}
        size={14}
        fill={i < Math.round(value) ? 'var(--accent-orange)' : 'none'}
        color={i < Math.round(value) ? 'var(--accent-orange)' : 'var(--border-color)'}
      />
    ))}
  </div>
);

// ─── Driver Detail Drawer ─────────────────────────────────────────────────────

const DriverDrawer: React.FC<{ driver: Driver; onClose: () => void; onVerify: (id: string) => void }> = ({ driver, onClose, onVerify }) => {
  const [rides, setRides] = useState<RideRecord[]>([]);
  const [ratings, setRatings] = useState<RatingRecord[]>([]);
  const [loadingRides, setLoadingRides] = useState(true);
  const [loadingRatings, setLoadingRatings] = useState(true);
  const [verifying, setVerifying] = useState(false);

  const uid = driver.userid || driver.id;

  useEffect(() => {
    // Fetch driver's rides from Firestore
    const fetchRides = async () => {
      setLoadingRides(true);
      try {
        const q = query(collection(db, 'rides'), where('driver', '==', uid));
        const snap = await getDocs(q);
        const list: RideRecord[] = [];
        snap.forEach(d => list.push({ id: d.id, ...d.data() } as RideRecord));
        // Debug: log the first ride's pickup shape so we can see what Firebase returns
        if (list.length > 0) {
          console.log('[DriverDrawer] first ride pickup:', list[0].pickup, '| dropoff:', list[0].dropoff);
        }
        list.sort((a, b) => {
          const ta = typeof a.time === 'number' ? a.time
            : typeof a.time === 'object' && a.time && 'seconds' in a.time ? (a.time as { seconds: number }).seconds * 1000 : 0;
          const tb = typeof b.time === 'number' ? b.time
            : typeof b.time === 'object' && b.time && 'seconds' in b.time ? (b.time as { seconds: number }).seconds * 1000 : 0;
          return tb - ta;
        });
        setRides(list);
      } catch { setRides([]); }
      finally { setLoadingRides(false); }
    };

    // Fetch driver's ratings
    const fetchRatings = async () => {
      setLoadingRatings(true);
      try {
        const q = query(collection(db, 'ratings'), where('driver', '==', uid));
        const snap = await getDocs(q);
        const list: RatingRecord[] = [];
        snap.forEach(d => list.push(d.data() as RatingRecord));
        setRatings(list);
      } catch { setRatings([]); }
      finally { setLoadingRatings(false); }
    };

    fetchRides();
    fetchRatings();
  }, [uid]);

  const completedRides = rides.filter(r => isCompleted(r.status));
  const cancelledRides = rides.filter(r => isCancelled(r.status));
  const totalEarnings  = completedRides.reduce((s, r) => s + toNum(r.price), 0);
  const avgFare        = completedRides.length > 0 ? Math.round(totalEarnings / completedRides.length) : 0;
  const avgRating      = ratings.length > 0
    ? ratings.reduce((s, r) => s + (r.rating || 0), 0) / ratings.length
    : null;

  const handleVerify = async () => {
    setVerifying(true);
    await onVerify(driver.id);
    setVerifying(false);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-drawer dv-drawer" onClick={e => e.stopPropagation()}>

        {/* ── Header ── */}
        <div className="modal-header dv-header">
          <div className="dv-header-left">
            <div className="dv-avatar">
              {driver.freight ? <Truck size={22} /> : <Car size={22} />}
            </div>
            <div>
              <div className="dv-name">{driver.fullName || 'Unknown Driver'}</div>
              <div className="dv-phone"><Phone size={12} /> {driver.phoneNumber || '—'}</div>
            </div>
            <span className={`status-badge ${driver.isVerified ? 'status-verified' : 'status-unverified'}`}>
              {driver.isVerified ? 'Verified' : 'Pending'}
            </span>
          </div>
          <button className="modal-close-btn" onClick={onClose}><X size={20} /></button>
        </div>

        <div className="modal-body">

          {/* ── Earnings Summary ── */}
          <div className="modal-section">
            <h3 className="modal-section-title"><TrendingUp size={15} /> Earnings Overview</h3>
            {loadingRides ? (
              <div className="loading-row"><Loader size={14} className="spin" /> Loading…</div>
            ) : (
              <div className="user-stats-row">
                <div className="user-stat-box" style={{ '--stat-color': 'var(--accent-green)' } as React.CSSProperties}>
                  <DollarSign size={18} />
                  <div className="usb-val">Rs. {totalEarnings.toLocaleString()}</div>
                  <div className="usb-label">Total Earned</div>
                </div>
                <div className="user-stat-box" style={{ '--stat-color': 'var(--accent-purple)' } as React.CSSProperties}>
                  <TrendingUp size={18} />
                  <div className="usb-val">Rs. {avgFare.toLocaleString()}</div>
                  <div className="usb-label">Avg Fare</div>
                </div>
                <div className="user-stat-box" style={{ '--stat-color': 'var(--accent-blue)' } as React.CSSProperties}>
                  <Navigation size={18} />
                  <div className="usb-val">{rides.length}</div>
                  <div className="usb-label">Total Rides</div>
                </div>
                <div className="user-stat-box" style={{ '--stat-color': 'var(--accent-green)' } as React.CSSProperties}>
                  <CheckCircle size={18} />
                  <div className="usb-val">{completedRides.length}</div>
                  <div className="usb-label">Completed</div>
                </div>
                <div className="user-stat-box" style={{ '--stat-color': 'var(--accent-red)' } as React.CSSProperties}>
                  <XCircle size={18} />
                  <div className="usb-val">{cancelledRides.length}</div>
                  <div className="usb-label">Cancelled</div>
                </div>
                {avgRating !== null && (
                  <div className="user-stat-box" style={{ '--stat-color': 'var(--accent-orange)' } as React.CSSProperties}>
                    <Star size={18} />
                    <div className="usb-val">{avgRating.toFixed(1)}</div>
                    <div className="usb-label">Avg Rating</div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Profile ── */}
          <div className="modal-section">
            <h3 className="modal-section-title"><FileText size={15} /> Profile &amp; Documents</h3>
            <div className="modal-details-grid">
              <div className="detail-item"><span className="di-label"><Hash size={11} /> UID</span><span className="di-value mono">{uid}</span></div>
              <div className="detail-item"><span className="di-label"><CreditCard size={11} /> CNIC</span><span className="di-value">{driver.cnicNum || '—'}</span></div>
              <div className="detail-item"><span className="di-label"><Calendar size={11} /> CNIC Exp.</span><span className="di-value">{driver.cnicExp || '—'}</span></div>
              <div className="detail-item"><span className="di-label"><FileText size={11} /> License No.</span><span className="di-value">{driver.driversLicense || '—'}</span></div>
              <div className="detail-item"><span className="di-label"><Calendar size={11} /> Lic. Exp.</span><span className="di-value">{driver.driversLicenseExpiration || '—'}</span></div>
              <div className="detail-item">
                <span className="di-label"><Truck size={11} /> Freight Driver</span>
                <span className={`di-value ${driver.freight ? 'text-green' : ''}`}>{driver.freight ? 'Yes' : 'No'}</span>
              </div>
              <div className="detail-item">
                <span className="di-label"><Shield size={11} /> Verified</span>
                <span className={`di-value ${driver.isVerified ? 'text-green' : 'text-orange'}`}>{driver.isVerified ? 'Yes' : 'Pending'}</span>
              </div>
            </div>
          </div>

          {/* ── Vehicle ── */}
          <div className="modal-section">
            <h3 className="modal-section-title"><Car size={15} /> Vehicle &amp; Documents</h3>
            <div className="modal-details-grid" style={{ marginBottom: '1rem' }}>
              <div className="detail-item"><span className="di-label">Make</span><span className="di-value">{driver.carMake || '—'}</span></div>
              <div className="detail-item"><span className="di-label">Model</span><span className="di-value">{driver.carModel || '—'}</span></div>
              <div className="detail-item"><span className="di-label">Year</span><span className="di-value">{driver.carYear || '—'}</span></div>
              <div className="detail-item"><span className="di-label">Plate</span><span className="di-value">{driver.carPlate || '—'}</span></div>
            </div>
            <div className="dv-photo-row">
              <PhotoThumb src={driver.carImg}     label="Vehicle" />
              <PhotoThumb src={driver.licenseImg} label="License" />
              <PhotoThumb src={driver.cnicImg}    label="CNIC" />
            </div>
          </div>

          {/* ── Ratings ── */}
          {!loadingRatings && ratings.length > 0 && (
            <div className="modal-section">
              <h3 className="modal-section-title"><Star size={15} /> Ratings ({ratings.length})</h3>
              <div className="dv-ratings-list">
                {ratings.slice(0, 10).map((r, i) => (
                  <div key={i} className="dv-rating-row">
                    <StarRating value={r.rating || 0} />
                    <span className="dv-rating-review">{r.review || '—'}</span>
                  </div>
                ))}
                {ratings.length > 10 && (
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', margin: '0.5rem 0 0' }}>
                    +{ratings.length - 10} more ratings
                  </p>
                )}
              </div>
            </div>
          )}

          {/* ── Ride History ── */}
          <div className="modal-section">
            <h3 className="modal-section-title"><Activity size={15} /> Ride History</h3>
            {loadingRides ? (
              <div className="loading-row" style={{ justifyContent: 'center', padding: '1.5rem 0' }}>
                <Loader size={18} className="spin" /> Loading rides…
              </div>
            ) : rides.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--text-secondary)' }}>
                <Navigation size={28} style={{ opacity: 0.3 }} />
                <p style={{ margin: '0.5rem 0 0' }}>No rides found for this driver.</p>
              </div>
            ) : (
              <div className="ride-history-list">
                {rides.map(ride => {
                  const pickupCoords  = extractCoords(ride.pickup);
                  const dropoffCoords = extractCoords(ride.dropoff);
                  const pickupText    = extractLocation(ride.pickup);
                  const dropoffText   = extractLocation(ride.dropoff);
                  return (
                  <div key={ride.id} className="ride-history-item">
                    <div className="rhi-left">
                      <div className="rhi-route">
                        <span className="dot green-dot" />
                        <span className="rhi-addr">{pickupText.slice(0, 34)}{pickupText.length > 34 ? '…' : ''}</span>
                        {pickupCoords && (
                          <a href={`geo:${pickupCoords.lat},${pickupCoords.lng}?q=${pickupCoords.lat},${pickupCoords.lng}(Pickup)`} className="rhi-map-btn" title={`Open in Maps: ${pickupCoords.lat.toFixed(5)}, ${pickupCoords.lng.toFixed(5)}`}>
                            <MapPin size={12} />
                          </a>
                        )}
                      </div>
                      <div className="rhi-route">
                        <span className="dot red-dot" />
                        <span className="rhi-addr">{dropoffText.slice(0, 34)}{dropoffText.length > 34 ? '…' : ''}</span>
                        {dropoffCoords && (
                          <a href={`geo:${dropoffCoords.lat},${dropoffCoords.lng}?q=${dropoffCoords.lat},${dropoffCoords.lng}(Dropoff)`} className="rhi-map-btn" title={`Open in Maps: ${dropoffCoords.lat.toFixed(5)}, ${dropoffCoords.lng.toFixed(5)}`}>
                            <MapPin size={12} />
                          </a>
                        )}
                      </div>
                      <div className="rhi-time"><Clock size={11} /> {fmtTime(ride.time)}{ride.distance ? <span className="rhi-dist"> · {String(ride.distance)}</span> : ''}</div>
                    </div>
                    <div className="rhi-right">
                      <StatusPill status={ride.status} />
                      <div className="rhi-price">Rs. {toNum(ride.price) || '—'}</div>
                    </div>
                  </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── Verify Button ── */}
          {!driver.isVerified && (
            <button
              className="dv-verify-btn"
              onClick={handleVerify}
              disabled={verifying}
            >
              {verifying
                ? <><Loader size={16} className="spin" /> Verifying…</>
                : <><CheckCircle size={16} /> Approve &amp; Verify Driver</>}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// ─── Driver Card (list item) ──────────────────────────────────────────────────

const DriverCard: React.FC<{ driver: Driver; onClick: () => void }> = ({ driver, onClick }) => {
  const initials = (driver.fullName || 'D')
    .split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

  return (
    <div className="dv-card" onClick={onClick}>
      {/* Avatar */}
      <div className={`dv-card-avatar ${driver.freight ? 'freight' : ''}`}>
        {initials}
      </div>

      {/* Info */}
      <div className="dv-card-body">
        <div className="dv-card-name">{driver.fullName || 'Unknown Driver'}</div>
        <div className="dv-card-phone"><Phone size={11} /> {driver.phoneNumber || '—'}</div>
        <div className="dv-card-tags">
          <span className="dv-vehicle-chip">
            <Car size={11} /> {driver.carMake || '—'} {driver.carModel || '—'} · {driver.carPlate || '—'}
          </span>
          {driver.freight && (
            <span className="dv-freight-chip"><Truck size={11} /> Freight</span>
          )}
        </div>
      </div>

      {/* Badge */}
      <div className="dv-card-right">
        <span className={`status-badge ${driver.isVerified ? 'status-verified' : 'status-unverified'}`} style={{ fontSize: '0.7rem' }}>
          {driver.isVerified ? <><ShieldAlert size={10} /> Verified</> : <><ShieldAlert size={10} /> Pending</>}
        </span>
        <ChevronRight size={16} style={{ color: 'var(--text-secondary)', marginTop: '0.4rem' }} />
      </div>
    </div>
  );
};

// ─── Main Page ────────────────────────────────────────────────────────────────

export const Drivers: React.FC = () => {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Driver | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'verified' | 'unverified' | 'freight'>('all');

  useEffect(() => {
    const fetchDrivers = async () => {
      setLoading(true);
      try {
        const snap = await getDocs(collection(db, 'driverProfileRequests'));
        const list: Driver[] = [];
        snap.forEach(d => list.push({ id: d.id, ...d.data() } as Driver));
        setDrivers(list);
      } catch (e) { console.error(e); }
      finally { setLoading(false); }
    };
    fetchDrivers();
  }, []);

  const handleVerify = async (driverId: string) => {
    try {
      await updateDoc(doc(db, 'driverProfileRequests', driverId), { isVerified: true });
      setDrivers(prev => prev.map(d => d.id === driverId ? { ...d, isVerified: true } : d));
      setSelected(prev => prev?.id === driverId ? { ...prev, isVerified: true } : prev);
    } catch (e) { console.error(e); alert('Verification failed.'); }
  };

  const filtered = drivers.filter(d => {
    const q = search.toLowerCase();
    const matchSearch = !q
      || (d.fullName || '').toLowerCase().includes(q)
      || (d.phoneNumber || '').includes(q)
      || (d.carPlate || '').toLowerCase().includes(q);
    const matchFilter =
      filter === 'all' ? true :
      filter === 'verified' ? !!d.isVerified :
      filter === 'unverified' ? !d.isVerified :
      filter === 'freight' ? !!d.freight : true;
    return matchSearch && matchFilter;
  });

  const counts = {
    all: drivers.length,
    verified: drivers.filter(d => d.isVerified).length,
    unverified: drivers.filter(d => !d.isVerified).length,
    freight: drivers.filter(d => d.freight).length,
  };

  return (
    <div>
      <div className="dashboard-header" style={{ textAlign: 'left', marginBottom: '1.5rem' }}>
        <h1>Drivers</h1>
        <p>Click any driver to view full profile, earnings, ride history &amp; ratings</p>
      </div>

      {/* Filter pills */}
      <div className="dv-filter-row">
        {(['all', 'verified', 'unverified', 'freight'] as const).map(f => (
          <button
            key={f}
            className={`dv-filter-pill ${filter === f ? 'active' : ''}`}
            onClick={() => setFilter(f)}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
            <span className="dv-pill-count">{counts[f]}</span>
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="users-search-bar" style={{ marginBottom: '1.5rem' }}>
        <Search size={16} style={{ color: 'var(--text-secondary)' }} />
        <input
          className="users-search-input"
          placeholder="Search by name, phone or plate…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {search && (
          <button onClick={() => setSearch('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', display: 'flex' }}>
            <X size={15} />
          </button>
        )}
      </div>

      {/* List */}
      {loading ? (
        <div className="rides-loading"><Loader size={28} className="spin" /><p>Loading drivers…</p></div>
      ) : (
        <div className="dv-list">
          {filtered.map(driver => (
            <DriverCard key={driver.id} driver={driver} onClick={() => setSelected(driver)} />
          ))}
          {filtered.length === 0 && (
            <p style={{ color: 'var(--text-secondary)' }}>No drivers match your filter.</p>
          )}
        </div>
      )}

      {/* Drawer */}
      {selected && (
        <DriverDrawer
          driver={selected}
          onClose={() => setSelected(null)}
          onVerify={handleVerify}
        />
      )}
    </div>
  );
};

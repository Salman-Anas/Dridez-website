import React, { useEffect, useState } from 'react';
import {
  collection, getDocs, getDoc, doc, query, where,
  writeBatch, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import {
  getStatus, getVehicleType, getVehicle, getSeats, isFreight,
  getCompany, getModel, getVariant, getEngineCc, getVehicleTitle,
  getLicenceImg, getRegistrationImg, getCnicImg, getVehicleImages,
  getDocumentCount, getUid,
  STATUS_LABEL, VEHICLE_TYPE_LABEL,
  type DriverApplicationFields, type AppStatus, type VehicleType,
} from '../utils/driverSchema';
import {
  VEHICLE_FILTERS, matchesVehicleFilter, getServedCabtypes, vehicleTierLabel,
  cabtypeLabel, isBookableCabtype, formatPKR,
} from '../utils/rideTaxonomy';
import {
  CheckCircle, X, Car, Truck, Bike, Bus, Phone, Hash, Shield, ShieldCheck, ShieldX,
  Image as ImageIcon, Images, Star, Navigation, Clock, XCircle, Mail,
  DollarSign, TrendingUp, Loader, ChevronRight, Search, Armchair, Gauge,
  CreditCard, Calendar, FileText, Activity, MapPin, IdCard, UserCheck,
  Info, ArrowUpDown, Undo2, MessageSquareWarning, Radio, AlertTriangle, Snowflake,
} from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

type FireTime = number | string | { seconds: number } | null | undefined;

interface Driver extends DriverApplicationFields {
  id: string;
  submittedAt?: FireTime;
  /** Legacy static flag on the request document — set to "yes" by the app. */
  driver?: string;
}

/** The `users/{uid}` account the application belongs to. */
interface UserAccount {
  id: string;
  name?: string;
  phone?: string;
  email?: string;
  cnic?: string;
  idCardFrontUrl?: string;
  idCardBackUrl?: string;
  verificationStatus?: string;
  driver?: boolean;
  driverApplicationStatus?: string;
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

const toMs = (t: FireTime): number => {
  if (!t) return 0;
  if (typeof t === 'number') return t > 1e12 ? t : t * 1000;
  if (typeof t === 'string') { const d = Date.parse(t); return isNaN(d) ? 0 : d; }
  if (typeof t === 'object' && 'seconds' in t) return t.seconds * 1000;
  return 0;
};

const fmtTime = (t: unknown): string => {
  const ms = toMs(t as FireTime);
  if (!ms) return '—';
  return new Date(ms).toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' });
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

/** Review-status badge for a driver application. */
const AppStatusBadge: React.FC<{ status: AppStatus; small?: boolean }> = ({ status, small }) => {
  const icon = status === 'approved' ? <ShieldCheck size={small ? 10 : 12} />
    : status === 'rejected' ? <ShieldX size={small ? 10 : 12} />
    : <Clock size={small ? 10 : 12} />;
  return (
    <span className={`verify-badge vs-${status === 'approved' ? 'verified' : status}`}
          style={small ? { fontSize: '0.7rem' } : undefined}>
      {icon} {STATUS_LABEL[status]}
    </span>
  );
};

const VehicleIcon: React.FC<{ type: VehicleType; size?: number }> = ({ type, size = 16 }) => {
  if (type === 'bike') return <Bike size={size} />;
  if (type === 'freight') return <Truck size={size} />;
  if (type === 'hiace') return <Bus size={size} />;
  if (type === 'rickshaw') return <Truck size={size} />;
  return <Car size={size} />;
};

/**
 * The cabtypes this driver's feed receives. A car driver also serves car
 * deliveries and a bike driver bike deliveries — same vehicle, package instead
 * of a person. A driver with no vehicle type matches nothing and silently
 * receives no work at all, which is invisible anywhere else in the portal.
 */
const ServedTypes: React.FC<{ served: string[]; compact?: boolean }> = ({ served, compact }) => {
  if (served.length === 0) {
    return (
      <span className="dv-serves-none" title="This driver matches no ride requests and sees an empty feed">
        <AlertTriangle size={11} /> Receives no requests
      </span>
    );
  }
  return (
    <span className={`dv-serves${compact ? ' dv-serves-compact' : ''}`}>
      {!compact && <Radio size={11} />}
      {served.map(key => (
        <span
          key={key}
          className={`dv-serves-chip${isBookableCabtype(key) ? '' : ' dv-serves-chip-warn'}`}
          title={isBookableCabtype(key)
            ? `Receives ${cabtypeLabel(key)} requests`
            : `"${key}" is not one of the nine rider-facing ride types — no rider can request it`}
        >
          {cabtypeLabel(key)}
        </span>
      ))}
    </span>
  );
};

const Detail: React.FC<{
  icon?: React.ReactNode; label: string; value?: React.ReactNode; mono?: boolean; full?: boolean;
}> = ({ icon, label, value, mono, full }) => (
  <div className="detail-item" style={full ? { gridColumn: '1 / -1' } : undefined}>
    <span className="di-label">{icon} {label}</span>
    <span className={`di-value${mono ? ' mono' : ''}`}>
      {value === 0 || value ? value : '—'}
    </span>
  </div>
);

/** Document thumbnail — click opens the full-size lightbox so it can be read. */
const DocThumb: React.FC<{ src?: string; label: string; onOpen: (src: string) => void }> = ({ src, label, onOpen }) => {
  const [err, setErr] = useState(false);
  if (!src || err) {
    return (
      <div className="dv-photo-box dv-photo-empty">
        <ImageIcon size={20} />
        <span>{label} — not uploaded</span>
      </div>
    );
  }
  return (
    <button type="button" className="dv-photo-box id-photo-box" onClick={() => onOpen(src)} title={`View ${label} full size`}>
      <img src={src} alt={label} onError={() => setErr(true)} referrerPolicy="no-referrer" />
      <span>{label}</span>
    </button>
  );
};

const Lightbox: React.FC<{ src: string; onClose: () => void }> = ({ src, onClose }) => (
  <div className="lightbox-overlay" onClick={onClose}>
    <button className="lightbox-close" onClick={onClose}><X size={22} /></button>
    <img src={src} alt="Document" className="lightbox-img" onClick={e => e.stopPropagation()} referrerPolicy="no-referrer" />
    <a href={src} target="_blank" rel="noopener noreferrer" className="lightbox-link" onClick={e => e.stopPropagation()}>
      Open original in new tab
    </a>
  </div>
);

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

interface Decision {
  status: AppStatus;
  rejectionReason?: string;
}

const DriverDrawer: React.FC<{
  driver: Driver;
  onClose: () => void;
  onDecide: (driver: Driver, decision: Decision) => Promise<void>;
}> = ({ driver, onClose, onDecide }) => {
  const [rides, setRides] = useState<RideRecord[]>([]);
  const [ratings, setRatings] = useState<RatingRecord[]>([]);
  const [account, setAccount] = useState<UserAccount | null>(null);
  const [loadingRides, setLoadingRides] = useState(true);
  const [loadingRatings, setLoadingRatings] = useState(true);
  const [loadingAccount, setLoadingAccount] = useState(true);
  const [working, setWorking] = useState<AppStatus | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState(driver.rejectionReason || '');

  const uid = getUid(driver, driver.id);
  const status = getStatus(driver);
  const vehicleType = getVehicleType(driver);
  const vehicle = getVehicle(driver);
  const served = getServedCabtypes(vehicle);
  const seats = getSeats(driver);
  const licenceImg = getLicenceImg(driver);
  const registrationImg = getRegistrationImg(driver);
  const cnicImg = getCnicImg(driver);
  const vehicleImages = getVehicleImages(driver);
  const hasDocs = getDocumentCount(driver) > 0;

  useEffect(() => {
    // Load the account the application belongs to, so the reviewer can check
    // the licence and registration are in the same person's name.
    const fetchAccount = async () => {
      setLoadingAccount(true);
      try {
        const snap = await getDoc(doc(db, 'users', uid));
        setAccount(snap.exists() ? { id: snap.id, ...snap.data() } as UserAccount : null);
      } catch (e) { console.error('[drivers] user load failed', e); setAccount(null); }
      finally { setLoadingAccount(false); }
    };

    // Fetch driver's rides from Firestore
    const fetchRides = async () => {
      setLoadingRides(true);
      try {
        const q = query(collection(db, 'rides'), where('driver', '==', uid));
        const snap = await getDocs(q);
        const list: RideRecord[] = [];
        snap.forEach(d => list.push({ id: d.id, ...d.data() } as RideRecord));
        list.sort((a, b) => toMs(b.time as FireTime) - toMs(a.time as FireTime));
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

    fetchAccount();
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

  // A licence in someone else's name is the thing this review exists to catch,
  // so surface any disagreement between the application and the account.
  const norm = (s?: string) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const nameMismatch = Boolean(
    account && norm(account.name) && norm(driver.fullName) && norm(account.name) !== norm(driver.fullName)
  );
  const cnicMismatch = Boolean(
    account && account.cnic && driver.cnicNum &&
    account.cnic.replace(/\D/g, '') !== driver.cnicNum.replace(/\D/g, '')
  );

  const decide = async (next: AppStatus, rejectionReason?: string) => {
    setWorking(next);
    try {
      await onDecide(driver, { status: next, rejectionReason });
      if (next !== 'rejected') setRejecting(false);
    } finally { setWorking(null); }
  };

  const submitRejection = () => {
    if (!reason.trim()) return;
    decide('rejected', reason.trim());
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-drawer dv-drawer" onClick={e => e.stopPropagation()}>

        {/* ── Header ── */}
        <div className="modal-header dv-header">
          <div className="dv-header-left">
            <div className="dv-avatar">
              <VehicleIcon type={vehicleType} size={22} />
            </div>
            <div>
              <div className="dv-name">{driver.fullName || account?.name || 'Unknown Driver'}</div>
              <div className="dv-phone"><Phone size={12} /> {driver.phoneNumber || account?.phone || '—'}</div>
            </div>
            <AppStatusBadge status={status} />
          </div>
          <button className="modal-close-btn" onClick={onClose}><X size={20} /></button>
        </div>

        <div className="modal-body">

          {/* ── Rejection reason currently shown to the driver ── */}
          {status === 'rejected' && driver.rejectionReason && (
            <div className="dv-reason-callout">
              <MessageSquareWarning size={15} />
              <div>
                <strong>Rejected — reason shown to the driver</strong>
                <p>{driver.rejectionReason}</p>
              </div>
            </div>
          )}

          {/* ── Linked account ── */}
          <div className="modal-section">
            <h3 className="modal-section-title"><UserCheck size={15} /> Account Holder</h3>
            {loadingAccount ? (
              <div className="loading-row"><Loader size={14} className="spin" /> Loading account…</div>
            ) : !account ? (
              <p className="verify-hint">
                <Info size={12} /> No <span className="mono">users/{uid}</span> document — the account may have been deleted.
              </p>
            ) : (
              <>
                {(nameMismatch || cnicMismatch) && (
                  <p className="verify-hint dv-mismatch">
                    <Info size={12} />
                    {nameMismatch && cnicMismatch
                      ? 'Name and CNIC on the application differ from the account.'
                      : nameMismatch
                        ? 'Name on the application differs from the account name.'
                        : 'CNIC on the application differs from the account CNIC.'}
                  </p>
                )}
                <div className="modal-details-grid" style={{ marginBottom: '1rem' }}>
                  <Detail icon={<Hash size={11} />} label="UID" value={uid} mono />
                  <Detail icon={<UserCheck size={11} />} label="Account Name" value={account.name} />
                  <Detail icon={<Phone size={11} />} label="Account Phone" value={account.phone} />
                  <Detail icon={<Mail size={11} />} label="Account Email" value={account.email || driver.email} />
                  <Detail icon={<CreditCard size={11} />} label="Account CNIC" value={account.cnic} mono />
                  <Detail icon={<Shield size={11} />} label="Driver Mode" value={
                    <span className={account.driver ? 'text-green' : 'text-orange'}>
                      {account.driver ? 'Unlocked' : 'Locked'}
                    </span>
                  } />
                </div>
                <div className="dv-photo-row">
                  <DocThumb src={account.idCardFrontUrl} label="ID Card — Front" onOpen={setLightbox} />
                  <DocThumb src={account.idCardBackUrl}  label="ID Card — Back"  onOpen={setLightbox} />
                </div>
              </>
            )}
          </div>

          {/* ── Vehicle ── */}
          <div className="modal-section">
            <h3 className="modal-section-title"><Car size={15} /> Vehicle</h3>
            <div className="modal-details-grid">
              <Detail icon={<VehicleIcon type={vehicleType} size={11} />} label="Vehicle Type"
                      value={VEHICLE_TYPE_LABEL[vehicleType]} />
              {vehicleType === 'car' && (
                <>
                  <Detail icon={<Star size={11} />} label="Class"
                          value={vehicle.carClass === 'mini' ? 'Mini'
                               : vehicle.carClass === 'comfort' ? 'Comfort' : undefined} />
                  <Detail icon={<Snowflake size={11} />} label="AC"
                          value={vehicle.acOption === 'ac' ? 'AC'
                               : vehicle.acOption === 'nonac' ? 'Non AC' : undefined} />
                </>
              )}
              <Detail icon={<Armchair size={11} />} label="Seats"
                      value={seats === null ? (vehicleType === 'bike' ? 'N/A (bike)' : undefined) : seats} />
              <Detail icon={<Car size={11} />} label="Company" value={getCompany(driver)} />
              <Detail icon={<Car size={11} />} label="Model" value={getModel(driver)} />
              <Detail icon={<Car size={11} />} label="Variant" value={getVariant(driver)} />
              <Detail icon={<Gauge size={11} />} label="Engine (cc)" value={getEngineCc(driver)} />
              <Detail icon={<Hash size={11} />} label="Number Plate" value={driver.carPlate} mono />
              {driver.carYear && (
                <Detail icon={<Calendar size={11} />} label="Year" value={driver.carYear} />
              )}
              <Detail icon={<Truck size={11} />} label="Freight" value={
                <span className={isFreight(driver) ? 'text-green' : ''}>{isFreight(driver) ? 'Yes' : 'No'}</span>
              } />
              <Detail icon={<Radio size={11} />} label="Ride Types Received" full
                      value={<ServedTypes served={served} />} />
            </div>
            {vehicle.normalised && (
              <p className="verify-hint">
                <Info size={12} /> Submitted before the AC question existed — the tier above was
                read back from the old <span className="mono">carClass</span> value.
              </p>
            )}
            {vehicleType === 'car' && !vehicle.carClass && (
              <p className="verify-hint dv-mismatch">
                <AlertTriangle size={12} /> No car tier on this application, so the driver only ever
                receives car deliveries — never a passenger request.
              </p>
            )}
          </div>

          {/* ── Documents ── */}
          <div className="modal-section">
            <h3 className="modal-section-title"><FileText size={15} /> Documents</h3>
            {!hasDocs && (
              <p className="verify-hint"><Info size={12} /> No documents were uploaded with this application.</p>
            )}

            <h4 className="dv-doc-group">Driving Licence</h4>
            <div className="dv-photo-row">
              <DocThumb src={licenceImg} label="Driving Licence" onOpen={setLightbox} />
              {cnicImg && <DocThumb src={cnicImg} label="CNIC (legacy upload)" onOpen={setLightbox} />}
            </div>
            {(driver.driversLicense || driver.driversLicenseExpiration) && (
              <div className="modal-details-grid" style={{ marginTop: '0.75rem' }}>
                <Detail icon={<IdCard size={11} />} label="Licence No." value={driver.driversLicense} mono />
                <Detail icon={<Calendar size={11} />} label="Licence Expiry" value={driver.driversLicenseExpiration} />
              </div>
            )}

            <h4 className="dv-doc-group"><Images size={12} /> Vehicle Photos ({vehicleImages.length})</h4>
            <div className="dv-photo-row">
              {vehicleImages.length === 0
                ? <DocThumb label="Vehicle photo" onOpen={setLightbox} />
                : vehicleImages.map((src, i) => (
                    <DocThumb key={src} src={src} label={`Vehicle ${i + 1} of ${vehicleImages.length}`} onOpen={setLightbox} />
                  ))}
            </div>

            <h4 className="dv-doc-group">Registration / Ownership Proof</h4>
            <div className="dv-photo-row">
              <DocThumb src={registrationImg} label="Registration Proof" onOpen={setLightbox} />
            </div>
          </div>

          {/* ── Application details ── */}
          <div className="modal-section">
            <h3 className="modal-section-title"><FileText size={15} /> Application</h3>
            <div className="modal-details-grid">
              <Detail icon={<UserCheck size={11} />} label="Applicant Name" value={driver.fullName} />
              <Detail icon={<Phone size={11} />} label="Phone" value={driver.phoneNumber} />
              <Detail icon={<Mail size={11} />} label="Email" value={driver.email} />
              <Detail icon={<CreditCard size={11} />} label="CNIC" value={driver.cnicNum} mono />
              {driver.cnicExp && <Detail icon={<Calendar size={11} />} label="CNIC Expiry" value={driver.cnicExp} />}
              <Detail icon={<Clock size={11} />} label="Submitted" value={driver.submittedAt ? fmtTime(driver.submittedAt) : undefined} />
              <Detail icon={<Shield size={11} />} label="Status" value={STATUS_LABEL[status]} />
            </div>
          </div>

          {/* ── Earnings Summary ── */}
          <div className="modal-section">
            <h3 className="modal-section-title"><TrendingUp size={15} /> Earnings Overview</h3>
            {loadingRides ? (
              <div className="loading-row"><Loader size={14} className="spin" /> Loading…</div>
            ) : (
              <div className="user-stats-row">
                <div className="user-stat-box" style={{ '--stat-color': 'var(--accent-green)' } as React.CSSProperties}>
                  <DollarSign size={18} />
                  <div className="usb-val">{formatPKR(totalEarnings)}</div>
                  <div className="usb-label">Total Earned</div>
                </div>
                <div className="user-stat-box" style={{ '--stat-color': 'var(--accent-purple)' } as React.CSSProperties}>
                  <TrendingUp size={18} />
                  <div className="usb-val">{formatPKR(avgFare)}</div>
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
                      <div className="rhi-price">{toNum(ride.price) ? formatPKR(toNum(ride.price)) : '—'}</div>
                    </div>
                  </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── Review actions ── */}
          {rejecting ? (
            <div className="dv-reject-form">
              <label className="dv-reject-label" htmlFor="dv-reason">
                Rejection reason <span className="required">*</span>
              </label>
              <p className="verify-hint" style={{ margin: '0 0 0.5rem' }}>
                <Info size={12} /> The driver sees this text in the app and can fix the problem and resubmit.
              </p>
              <textarea
                id="dv-reason"
                className="form-input form-textarea"
                rows={3}
                placeholder="e.g. The registration photo is blurred — please re-upload a clear picture showing the owner's name."
                value={reason}
                onChange={e => setReason(e.target.value)}
                autoFocus
              />
              <div className="verify-action-bar" style={{ marginTop: '0.75rem' }}>
                <button className="dv-reject-btn" onClick={submitRejection} disabled={!reason.trim() || working !== null}>
                  {working === 'rejected'
                    ? <><Loader size={16} className="spin" /> Rejecting…</>
                    : <><ShieldX size={16} /> Confirm Rejection</>}
                </button>
                <button className="dv-revoke-btn" onClick={() => setRejecting(false)} disabled={working !== null}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="verify-action-bar">
                {status !== 'approved' && (
                  <button className="dv-verify-btn" onClick={() => decide('approved')} disabled={working !== null}>
                    {working === 'approved'
                      ? <><Loader size={16} className="spin" /> Approving…</>
                      : <><CheckCircle size={16} /> Approve &amp; Unlock Driver Mode</>}
                  </button>
                )}
                {status !== 'rejected' && (
                  <button className="dv-reject-btn" onClick={() => { setReason(driver.rejectionReason || ''); setRejecting(true); }} disabled={working !== null}>
                    <ShieldX size={16} /> Reject…
                  </button>
                )}
                {status !== 'pending' && (
                  <button className="dv-revoke-btn" onClick={() => decide('pending')} disabled={working !== null}>
                    {working === 'pending'
                      ? <><Loader size={16} className="spin" /> Reverting…</>
                      : <><Undo2 size={16} /> Move Back to Pending</>}
                  </button>
                )}
              </div>
              {status !== 'approved' && (
                <p className="verify-hint" style={{ justifyContent: 'center' }}>
                  <Info size={12} /> Approving sets the request to <span className="mono">approved</span> and <span className="mono">users/{uid}.driver = true</span>.
                </p>
              )}
            </>
          )}
        </div>

        {lightbox && <Lightbox src={lightbox} onClose={() => setLightbox(null)} />}
      </div>
    </div>
  );
};

// ─── Driver Card (list item) ──────────────────────────────────────────────────

const DriverCard: React.FC<{ driver: Driver; onClick: () => void }> = ({ driver, onClick }) => {
  const initials = (driver.fullName || 'D')
    .split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const status = getStatus(driver);
  const vehicleType = getVehicleType(driver);
  const vehicle = getVehicle(driver);
  const served = getServedCabtypes(vehicle);
  const title = getVehicleTitle(driver);

  return (
    <div className="dv-card" onClick={onClick}>
      {/* Avatar */}
      <div className={`dv-card-avatar ${isFreight(driver) ? 'freight' : ''}`}>
        {initials}
      </div>

      {/* Info */}
      <div className="dv-card-body">
        <div className="dv-card-name">{driver.fullName || 'Unknown Driver'}</div>
        <div className="dv-card-phone"><Phone size={11} /> {driver.phoneNumber || '—'}</div>
        <div className="dv-card-tags">
          <span className="dv-vehicle-chip">
            <VehicleIcon type={vehicleType} size={11} />
            {vehicleTierLabel(vehicle)}
            {title ? ` · ${title}` : ''}
            {driver.carPlate ? ` · ${driver.carPlate}` : ''}
          </span>
          {isFreight(driver) && vehicleType !== 'freight' && (
            <span className="dv-freight-chip"><Truck size={11} /> Freight</span>
          )}
        </div>
        <ServedTypes served={served} compact />
      </div>

      {/* Badge */}
      <div className="dv-card-right">
        <AppStatusBadge status={status} small />
        <ChevronRight size={16} style={{ color: 'var(--text-secondary)', marginTop: '0.4rem' }} />
      </div>
    </div>
  );
};

// ─── Main Page ────────────────────────────────────────────────────────────────

type StatusFilter = 'all' | AppStatus;
/** 'all', 'none' (no vehicle type at all), or a VEHICLE_FILTERS option id. */
type TypeFilter = string;
type SortKey = 'newest' | 'oldest' | 'name' | 'type';

const SORT_LABEL: Record<SortKey, string> = {
  newest: 'Newest first',
  oldest: 'Oldest first',
  name: 'Name (A–Z)',
  type: 'Vehicle type',
};

export const Drivers: React.FC = () => {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Driver | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [sort, setSort] = useState<SortKey>('newest');

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

  /**
   * A decision has to land on BOTH documents: the app's drawer reads
   * `users/{uid}.driver` to unlock driver mode while this portal reads the
   * request's `status` — write only one and the driver stays locked out of an
   * approved account. The batch keeps the two from drifting apart.
   */
  const handleDecide = async (driver: Driver, { status, rejectionReason }: Decision) => {
    const uid = getUid(driver, driver.id);
    try {
      const batch = writeBatch(db);

      batch.update(doc(db, 'driverProfileRequests', driver.id), {
        status,
        rejectionReason: status === 'rejected' ? (rejectionReason || '') : '',
        // legacy flag kept in sync so older clients and the dashboard counters
        // keep working while records still carry the old schema
        isVerified: status === 'approved',
        reviewedAt: serverTimestamp(),
        reviewedBy: 'Admin',
      });

      // merge-set rather than update: a missing user document must not abort the
      // batch and leave the two records disagreeing
      batch.set(doc(db, 'users', uid), {
        driver: status === 'approved',
        driverApplicationStatus: status,
        driverStatusUpdatedAt: serverTimestamp(),
      }, { merge: true });

      await batch.commit();

      const patch: Partial<Driver> = {
        status,
        rejectionReason: status === 'rejected' ? (rejectionReason || '') : '',
        isVerified: status === 'approved',
      };
      setDrivers(prev => prev.map(d => d.id === driver.id ? { ...d, ...patch } : d));
      setSelected(prev => prev?.id === driver.id ? { ...prev, ...patch } : prev);
    } catch (e) {
      console.error(e);
      alert('Could not update the application. Neither document was changed — please retry.');
    }
  };

  const statusCounts: Record<StatusFilter, number> = {
    all: drivers.length,
    pending: drivers.filter(d => getStatus(d) === 'pending').length,
    approved: drivers.filter(d => getStatus(d) === 'approved').length,
    rejected: drivers.filter(d => getStatus(d) === 'rejected').length,
  };

  // Counted against the normalised vehicle so legacy records land in the same
  // bucket the filter puts them in.
  const typeCounts = drivers.reduce((acc, d) => {
    const v = getVehicle(d);
    const option = VEHICLE_FILTERS.find(o => matchesVehicleFilter(v, o));
    const id = option ? option.id : v.vehicleType === 'car' ? 'car_untiered' : 'none';
    acc[id] = (acc[id] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  const unmatchedCount = (typeCounts['none'] || 0) + (typeCounts['car_untiered'] || 0);

  const filtered = drivers.filter(d => {
    const q = search.toLowerCase().trim();
    const matchSearch = !q
      || (d.fullName || '').toLowerCase().includes(q)
      || (d.phoneNumber || '').includes(q)
      || (d.email || '').toLowerCase().includes(q)
      || (d.cnicNum || '').includes(q)
      || (d.carPlate || '').toLowerCase().includes(q)
      || getVehicleTitle(d).toLowerCase().includes(q);
    const matchStatus = statusFilter === 'all' || getStatus(d) === statusFilter;
    const vehicle = getVehicle(d);
    const option = VEHICLE_FILTERS.find(o => o.id === typeFilter);
    const matchType =
      typeFilter === 'all' ? true
      : typeFilter === 'none' ? getServedCabtypes(vehicle).length === 0
      : typeFilter === 'car_untiered' ? vehicle.vehicleType === 'car' && !vehicle.carClass
      // both buckets at once: nobody here can be sent a passenger request
      : typeFilter === 'no_feed' ? getServedCabtypes(vehicle).length === 0
          || (vehicle.vehicleType === 'car' && !vehicle.carClass)
      : option ? matchesVehicleFilter(vehicle, option)
      : true;
    return matchSearch && matchStatus && matchType;
  });

  const sorted = [...filtered].sort((a, b) => {
    if (sort === 'name') return (a.fullName || '').localeCompare(b.fullName || '');
    if (sort === 'type') {
      const t = vehicleTierLabel(getVehicle(a)).localeCompare(vehicleTierLabel(getVehicle(b)));
      return t !== 0 ? t : (a.fullName || '').localeCompare(b.fullName || '');
    }
    // legacy records have no submittedAt and sort to the bottom of "newest"
    const diff = toMs(a.submittedAt) - toMs(b.submittedAt);
    return sort === 'oldest' ? diff : -diff;
  });

  return (
    <div>
      <div className="dashboard-header" style={{ textAlign: 'left', marginBottom: '1.5rem' }}>
        <h1>Driver Applications</h1>
        <p>Review each vehicle and its documents against the account holder's ID, then approve or reject</p>
      </div>

      {/* Status filter pills */}
      <div className="dv-filter-row">
        {(['all', 'pending', 'approved', 'rejected'] as StatusFilter[]).map(f => (
          <button
            key={f}
            className={`dv-filter-pill ${statusFilter === f ? 'active' : ''}`}
            onClick={() => setStatusFilter(f)}
          >
            {f === 'all' ? 'All' : STATUS_LABEL[f]}
            <span className="dv-pill-count">{statusCounts[f]}</span>
          </button>
        ))}
      </div>

      {/* Vehicle type + sort */}
      <div className="dv-control-row">
        <label className="dv-select-wrap">
          <Car size={14} />
          <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
            <option value="all">All vehicle types ({drivers.length})</option>
            {VEHICLE_FILTERS.map(o => (
              <option key={o.id} value={o.id}>{o.label} ({typeCounts[o.id] || 0})</option>
            ))}
            {typeCounts['car_untiered'] > 0 && (
              <option value="car_untiered">Car · tier not set ({typeCounts['car_untiered']})</option>
            )}
            {typeCounts['none'] > 0 && (
              <option value="none">No vehicle type ({typeCounts['none']})</option>
            )}
            {unmatchedCount > 0 && (
              <option value="no_feed">No passenger requests ({unmatchedCount})</option>
            )}
          </select>
        </label>
        <label className="dv-select-wrap">
          <ArrowUpDown size={14} />
          <select value={sort} onChange={e => setSort(e.target.value as SortKey)}>
            {(Object.keys(SORT_LABEL) as SortKey[]).map(k => (
              <option key={k} value={k}>{SORT_LABEL[k]}</option>
            ))}
          </select>
        </label>
      </div>

      {/* Drivers whose vehicle answers leave them matching nothing get no work
          at all, and nothing else in the portal makes that visible. */}
      {unmatchedCount > 0 && typeFilter === 'all' && (
        <div className="dv-feed-warning">
          <AlertTriangle size={15} />
          <span>
            {unmatchedCount} {unmatchedCount === 1 ? 'driver receives' : 'drivers receive'} no
            passenger requests — no vehicle type, or a car with no tier set.
          </span>
          <button
            className="dv-feed-warning-btn"
            onClick={() => setTypeFilter('no_feed')}
          >
            Show them
          </button>
        </div>
      )}

      {/* Search */}
      <div className="users-search-bar" style={{ marginBottom: '1.5rem' }}>
        <Search size={16} style={{ color: 'var(--text-secondary)' }} />
        <input
          className="users-search-input"
          placeholder="Search by name, phone, email, CNIC, plate or vehicle…"
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
        <div className="rides-loading"><Loader size={28} className="spin" /><p>Loading applications…</p></div>
      ) : (
        <div className="dv-list">
          {sorted.map(driver => (
            <DriverCard key={driver.id} driver={driver} onClick={() => setSelected(driver)} />
          ))}
          {sorted.length === 0 && (
            <p style={{ color: 'var(--text-secondary)' }}>No applications match your filter.</p>
          )}
        </div>
      )}

      {/* Drawer */}
      {selected && (
        <DriverDrawer
          // keyed so switching applications resets the rejection form and
          // in-flight review state instead of carrying them over
          key={selected.id}
          driver={selected}
          onClose={() => setSelected(null)}
          onDecide={handleDecide}
        />
      )}
    </div>
  );
};

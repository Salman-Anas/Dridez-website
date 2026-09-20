import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  collection, getDocs, query, where, doc, updateDoc,
  orderBy, limit, serverTimestamp
} from 'firebase/firestore';
import { db } from '../firebase';
import { formatPKR } from '../utils/rideTaxonomy';
import { useAdminLabel } from '../utils/adminAuthContext';
import {
  getPlatform, getVerification, platformLabel,
  type Platform, type Verification,
} from '../utils/userSchema';
import {
  User, Smartphone, Shield, ShieldCheck, ShieldAlert, ShieldX, X, Navigation,
  CheckCircle, XCircle, Clock, Activity, DollarSign, Mail, Phone,
  Loader, ChevronRight, MapPin, Hash, CreditCard, Calendar, LogIn,
  Search, Monitor, RotateCcw, UserCheck, Info
} from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

type FireTime = number | string | { seconds: number } | null | undefined;

interface UserProfile {
  id: string;
  uid?: string;
  name?: string;
  phone?: string;
  email?: string;
  emailVerified?: boolean;
  cnic?: string;
  address?: string;
  accountType?: string;
  verificationStatus?: string;
  verificationSubmitted?: boolean;
  devicePlatform?: string;
  devicePlatformVersion?: string;
  lastLoginPlatform?: string;
  lastLoginDevice?: string;
  lastLoginAt?: FireTime;
  createdAt?: FireTime;
  detailsSubmittedAt?: FireTime;
  loginCount?: number;
  /** Legacy fields kept so older documents still render correctly. */
  os?: string;
  isVerified?: boolean;
}

interface LoginRecord {
  id: string;
  at?: FireTime;
  event?: string;
  method?: string;
  platform?: string;
  osVersion?: string;
  appVersion?: string;
  device?: string;
  brand?: string;
  model?: string;
  manufacturer?: string;
}

interface RideRecord {
  id: string;
  status?: string;
  pickup?: unknown;   // Firebase shape varies
  dropoff?: unknown;
  price?: unknown;
  distance?: unknown;
  time?: FireTime;
  cabtype?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Pull lat/lng from ANY Firebase location value.
 * Handles Firestore GeoPoint class instances whose props live on the prototype.
 */
const getCoordPair = (o: Record<string, unknown>): { lat: number; lng: number } | null => {
  // Firestore GeoPoint: constructor is 'GeoPoint', exposes .latitude / .longitude
  if ((o as { constructor?: { name?: string } }).constructor?.name === 'GeoPoint') {
    const lat = (o as unknown as { latitude: number }).latitude;
    const lng = (o as unknown as { longitude: number }).longitude;
    if (typeof lat === 'number' && typeof lng === 'number') return { lat, lng };
  }
  // toJSON() that GeoPoint exposes
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
    const lat = typeof o[lk] === 'number' ? o[lk] as number : parseFloat(String(o[lk] ?? ''));
    const lng = typeof o[lgk] === 'number' ? o[lgk] as number : parseFloat(String(o[lgk] ?? ''));
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
  // Coordinates (GeoPoint-aware)
  const coords = getCoordPair(o);
  if (coords) return `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`;
  // Unknown — log all keys including prototype so shape is visible in DevTools
  const allKeys = [...Object.keys(o), ...Object.getOwnPropertyNames(Object.getPrototypeOf(o) ?? {})];
  console.warn('[location] N/A — unknown shape. Constructor:', (o as { constructor?: { name?: string } }).constructor?.name, '| Keys:', allKeys, '| Value:', o);
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

const fmtTime = (t: FireTime): string => {
  const ms = toMs(t);
  if (!ms) return '—';
  return new Date(ms).toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' });
};

/** "3 days ago" style label next to an absolute timestamp. */
const fmtRelative = (t: FireTime): string => {
  const ms = toMs(t);
  if (!ms) return '';
  const diff = Date.now() - ms;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.round(days / 30)}mo ago`;
};

/** Format a raw 13-digit CNIC as 00000-0000000-0. */
const fmtCnic = (cnic?: string): string => {
  const digits = (cnic || '').replace(/\D/g, '');
  if (digits.length !== 13) return cnic || '—';
  return `${digits.slice(0, 5)}-${digits.slice(5, 12)}-${digits.slice(12)}`;
};

// ─── Verification badge styling ──────────────────────────────────────────────

const VERIFY_META: Record<Verification, { label: string; cls: string; Icon: typeof Shield }> = {
  verified:   { label: 'Verified',   cls: 'vs-verified',   Icon: ShieldCheck },
  pending:    { label: 'Pending',    cls: 'vs-pending',    Icon: Clock },
  rejected:   { label: 'Rejected',   cls: 'vs-rejected',   Icon: ShieldX },
  unverified: { label: 'Unverified', cls: 'vs-unverified', Icon: ShieldAlert },
};

const isCompleted = (s?: string) => ['completed', 'finished', 'done'].includes((s || '').toLowerCase());
const isCancelled = (s?: string) => ['cancelled', 'canceled', 'rejected'].includes((s || '').toLowerCase());
const isActive    = (s?: string) => ['ongoing', 'started', 'active', 'accepted'].includes((s || '').toLowerCase());
const isPending   = (s?: string) => ['pending', 'searching', 'waiting'].includes((s || '').toLowerCase());

// ─── Small presentational pieces ─────────────────────────────────────────────

const StatusPill: React.FC<{ status?: string }> = ({ status }) => {
  const s = (status || 'unknown').toLowerCase();
  let cls = 'ride-status-pill';
  if (isActive(s)) cls += ' pill-active';
  else if (isPending(s)) cls += ' pill-pending';
  else if (isCompleted(s)) cls += ' pill-completed';
  else if (isCancelled(s)) cls += ' pill-cancelled';
  else cls += ' pill-unknown';
  const label = status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Unknown';
  return <span className={cls}>{label}</span>;
};

const PlatformBadge: React.FC<{ platform: Platform }> = ({ platform }) => (
  <span className={`platform-badge pb-${platform}`}>
    <Smartphone size={11} /> {platformLabel(platform)}
  </span>
);

const VerifyBadge: React.FC<{ state: Verification; small?: boolean }> = ({ state, small }) => {
  const { label, cls, Icon } = VERIFY_META[state];
  return (
    <span className={`verify-badge ${cls}${small ? ' vb-sm' : ''}`}>
      <Icon size={small ? 10 : 12} /> {label}
    </span>
  );
};

/** One labelled field inside the details grid. */
const Detail: React.FC<{
  icon?: React.ReactNode; label: string; value?: React.ReactNode; mono?: boolean; full?: boolean;
}> = ({ icon, label, value, mono, full }) => (
  <div className="detail-item" style={full ? { gridColumn: '1 / -1' } : undefined}>
    <span className="di-label">{icon} {label}</span>
    <span className={`di-value${mono ? ' mono' : ''}`}>{value || '—'}</span>
  </div>
);

// ─── User Detail Drawer ──────────────────────────────────────────────────────

const UserHistoryDrawer: React.FC<{
  user: UserProfile;
  onClose: () => void;
  onSetStatus: (id: string, status: Verification) => Promise<void>;
}> = ({ user, onClose, onSetStatus }) => {
  const [rides, setRides] = useState<RideRecord[]>([]);
  const [logins, setLogins] = useState<LoginRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingLogins, setLoadingLogins] = useState(true);
  const [working, setWorking] = useState<Verification | null>(null);

  const uid = user.uid || user.id;
  const platform = getPlatform(user);
  const verification = getVerification(user);

  useEffect(() => {
    const fetchRides = async () => {
      setLoading(true);
      try {
        const q = query(collection(db, 'rides'), where('rider', '==', uid));
        const snap = await getDocs(q);
        const list: RideRecord[] = [];
        snap.forEach(d => list.push({ id: d.id, ...d.data() } as RideRecord));
        list.sort((a, b) => toMs(b.time) - toMs(a.time));
        setRides(list);
      } catch {
        setRides([]);
      } finally {
        setLoading(false);
      }
    };
    fetchRides();
  }, [uid]);

  // loginHistory lives as a subcollection under the user document
  useEffect(() => {
    const fetchLogins = async () => {
      setLoadingLogins(true);
      try {
        const ref = collection(db, 'users', user.id, 'loginHistory');
        let list: LoginRecord[] = [];
        try {
          const snap = await getDocs(query(ref, orderBy('at', 'desc'), limit(30)));
          snap.forEach(d => list.push({ id: d.id, ...d.data() } as LoginRecord));
        } catch {
          // Documents missing the `at` field are skipped by orderBy — fall back to a plain read
          const snap = await getDocs(ref);
          snap.forEach(d => list.push({ id: d.id, ...d.data() } as LoginRecord));
          list.sort((a, b) => toMs(b.at) - toMs(a.at));
          list = list.slice(0, 30);
        }
        setLogins(list);
      } catch {
        setLogins([]);
      } finally {
        setLoadingLogins(false);
      }
    };
    fetchLogins();
  }, [user.id]);

  const totalSpending = rides
    .filter(r => isCompleted(r.status))
    .reduce((sum, r) => sum + toNum(r.price), 0);

  const completedCount = rides.filter(r => isCompleted(r.status)).length;
  const cancelledCount = rides.filter(r => isCancelled(r.status)).length;

  const hasApplied = Boolean(user.verificationSubmitted);

  const act = async (status: Verification) => {
    setWorking(status);
    await onSetStatus(user.id, status);
    setWorking(null);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-drawer" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="modal-header">
          <div className="modal-title-row">
            <div className="user-avatar-lg">
              {(user.name || 'U').charAt(0).toUpperCase()}
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: '1.1rem', color: 'var(--text-primary)' }}>{user.name || 'Unnamed User'}</div>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{user.phone || '—'}</div>
              <div className="user-card-meta" style={{ marginTop: '0.35rem' }}>
                <PlatformBadge platform={platform} />
                <VerifyBadge state={verification} small />
              </div>
            </div>
          </div>
          <button className="modal-close-btn" onClick={onClose}><X size={20} /></button>
        </div>

        <div className="modal-body">
          {/* ── Identity & verification details ── */}
          <div className="modal-section">
            <h3 className="modal-section-title"><CreditCard size={16} /> Verification Details</h3>
            <div className="modal-details-grid">
              <Detail icon={<CreditCard size={11} />} label="CNIC" value={fmtCnic(user.cnic)} mono />
              <Detail icon={<Phone size={11} />} label="Phone" value={user.phone} />
              <Detail icon={<MapPin size={11} />} label="Address" value={user.address} full />
              <Detail
                icon={<Calendar size={11} />}
                label="Details Submitted"
                value={user.detailsSubmittedAt ? fmtTime(user.detailsSubmittedAt) : 'Not submitted'}
                full
              />
            </div>
            {!hasApplied && (
              <p className="verify-hint"><Info size={12} /> This user has not applied for verification yet — CNIC, address &amp; phone are still missing.</p>
            )}
          </div>

          {/* ── Account ── */}
          <div className="modal-section">
            <h3 className="modal-section-title"><User size={16} /> Account</h3>
            <div className="modal-details-grid">
              <Detail icon={<User size={11} />} label="Full Name" value={user.name} />
              <Detail icon={<Phone size={11} />} label="Phone" value={user.phone} />
              <Detail
                icon={<Mail size={11} />}
                label="Email"
                full
                value={user.email ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                    {user.email}
                    <span className={user.emailVerified ? 'text-green' : 'text-orange'} style={{ fontSize: '0.72rem', fontWeight: 600 }}>
                      {user.emailVerified ? '✓ verified' : '! unverified'}
                    </span>
                  </span>
                ) : undefined}
              />
              <Detail icon={<UserCheck size={11} />} label="Account Type" value={user.accountType} />
              <Detail
                icon={<Shield size={11} />}
                label="Verification"
                value={<VerifyBadge state={verification} small />}
              />
              <Detail
                icon={<Calendar size={11} />}
                label="Registered"
                value={user.createdAt ? `${fmtTime(user.createdAt)} (${fmtRelative(user.createdAt)})` : undefined}
                full
              />
              <Detail icon={<Hash size={11} />} label="UID" value={uid} mono full />
            </div>
          </div>

          {/* ── Device & sessions ── */}
          <div className="modal-section">
            <h3 className="modal-section-title"><Smartphone size={16} /> Device &amp; Sessions</h3>
            <div className="modal-details-grid">
              <Detail icon={<Smartphone size={11} />} label="Platform" value={<PlatformBadge platform={platform} />} />
              <Detail icon={<Hash size={11} />} label="Platform Version" value={user.devicePlatformVersion} />
              <Detail icon={<Monitor size={11} />} label="Last Login Device" value={user.lastLoginDevice} />
              <Detail icon={<LogIn size={11} />} label="Login Count" value={user.loginCount != null ? String(user.loginCount) : undefined} />
              <Detail
                icon={<Clock size={11} />}
                label="Last Login"
                value={user.lastLoginAt ? `${fmtTime(user.lastLoginAt)} (${fmtRelative(user.lastLoginAt)})` : undefined}
                full
              />
            </div>
          </div>

          {/* ── Login history (subcollection) ── */}
          <div className="modal-section">
            <h3 className="modal-section-title"><LogIn size={16} /> Login History</h3>
            {loadingLogins ? (
              <div className="loading-row"><Loader size={14} className="spin" /> Loading sessions…</div>
            ) : logins.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '1.2rem 0', color: 'var(--text-secondary)' }}>
                <LogIn size={26} style={{ opacity: 0.3 }} />
                <p style={{ margin: '0.4rem 0 0' }}>No login history recorded.</p>
              </div>
            ) : (
              <div className="login-history-list">
                {logins.map(l => {
                  const lp = (l.platform || '').toLowerCase().includes('ios') ? 'ios'
                    : (l.platform || '').toLowerCase().includes('android') ? 'android' : 'unknown';
                  return (
                    <div key={l.id} className="login-row">
                      <div className={`login-row-icon lr-${lp}`}><Smartphone size={14} /></div>
                      <div className="login-row-body">
                        <div className="login-row-top">
                          <span className="login-event">{l.event || 'login'}</span>
                          {l.method && <span className="login-method">{l.method.replace(/_/g, ' ')}</span>}
                        </div>
                        <div className="login-row-sub">
                          {l.device || [l.manufacturer, l.model].filter(Boolean).join(' ') || 'Unknown device'}
                          {l.platform ? ` · ${platformLabel(lp)}` : ''}
                          {l.osVersion ? ` ${l.osVersion}` : ''}
                          {l.appVersion ? ` · app v${l.appVersion}` : ''}
                        </div>
                      </div>
                      <div className="login-row-time">
                        <span>{fmtTime(l.at)}</span>
                        <span className="lr-rel">{fmtRelative(l.at)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── Spending summary ── */}
          <div className="modal-section">
            <h3 className="modal-section-title"><DollarSign size={16} /> Spending Summary</h3>
            {loading ? (
              <div className="loading-row"><Loader size={14} className="spin" /> Calculating…</div>
            ) : (
              <div className="user-stats-row">
                <div className="user-stat-box" style={{ '--stat-color': 'var(--accent-blue)' } as React.CSSProperties}>
                  <Navigation size={18} />
                  <div className="usb-val">{rides.length}</div>
                  <div className="usb-label">Total Rides</div>
                </div>
                <div className="user-stat-box" style={{ '--stat-color': 'var(--accent-green)' } as React.CSSProperties}>
                  <CheckCircle size={18} />
                  <div className="usb-val">{completedCount}</div>
                  <div className="usb-label">Completed</div>
                </div>
                <div className="user-stat-box" style={{ '--stat-color': 'var(--accent-red)' } as React.CSSProperties}>
                  <XCircle size={18} />
                  <div className="usb-val">{cancelledCount}</div>
                  <div className="usb-label">Cancelled</div>
                </div>
                <div className="user-stat-box total-spend" style={{ '--stat-color': 'var(--accent-purple)' } as React.CSSProperties}>
                  <DollarSign size={18} />
                  <div className="usb-val">{formatPKR(totalSpending)}</div>
                  <div className="usb-label">Total Spent</div>
                </div>
              </div>
            )}
          </div>

          {/* ── Ride history ── */}
          <div className="modal-section">
            <h3 className="modal-section-title"><Activity size={16} /> Ride History</h3>
            {loading ? (
              <div className="loading-row" style={{ justifyContent: 'center', padding: '2rem 0' }}>
                <Loader size={20} className="spin" />
                <span>Loading rides…</span>
              </div>
            ) : rides.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '2rem 0', color: 'var(--text-secondary)' }}>
                <Navigation size={32} style={{ opacity: 0.3, marginBottom: '0.5rem' }} />
                <p style={{ margin: 0 }}>No rides found for this user.</p>
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
                        <span className="rhi-addr">{pickupText.slice(0, 35)}{pickupText.length > 35 ? '…' : ''}</span>
                        {pickupCoords && (
                          <a href={`geo:${pickupCoords.lat},${pickupCoords.lng}?q=${pickupCoords.lat},${pickupCoords.lng}(Pickup)`} className="rhi-map-btn" title={`Open in Maps: ${pickupCoords.lat.toFixed(5)}, ${pickupCoords.lng.toFixed(5)}`}>
                            <MapPin size={12} />
                          </a>
                        )}
                      </div>
                      <div className="rhi-route">
                        <span className="dot red-dot" />
                        <span className="rhi-addr">{dropoffText.slice(0, 35)}{dropoffText.length > 35 ? '…' : ''}</span>
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

          {/* ── Verification actions ── */}
          <div className="verify-action-bar">
            {verification === 'verified' ? (
              <button className="dv-revoke-btn" onClick={() => act('unverified')} disabled={working !== null}>
                {working === 'unverified'
                  ? <><Loader size={16} className="spin" /> Revoking…</>
                  : <><RotateCcw size={16} /> Revoke Verification</>}
              </button>
            ) : hasApplied ? (
              <>
                <button className="dv-verify-btn" onClick={() => act('verified')} disabled={working !== null}>
                  {working === 'verified'
                    ? <><Loader size={16} className="spin" /> Verifying…</>
                    : <><ShieldCheck size={16} /> Approve &amp; Verify User</>}
                </button>
                {verification !== 'rejected' && (
                  <button className="dv-reject-btn" onClick={() => act('rejected')} disabled={working !== null}>
                    {working === 'rejected'
                      ? <><Loader size={16} className="spin" /> Rejecting…</>
                      : <><ShieldX size={16} /> Reject</>}
                  </button>
                )}
              </>
            ) : (
              <p className="verify-hint" style={{ justifyContent: 'center' }}>
                <Info size={12} /> This user hasn&apos;t applied for verification yet — nothing to approve.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── Main Page ────────────────────────────────────────────────────────────────

type Filter = 'all' | 'android' | 'ios' | 'verified' | 'pending' | 'unverified';

const FILTER_LABEL: Record<Filter, string> = {
  all: 'All', android: 'Android', ios: 'iOS', verified: 'Verified', pending: 'Pending', unverified: 'Unverified',
};

export const Users: React.FC = () => {
  // Recorded as `verifiedBy` so a decision can be traced to the admin who made it.
  const adminLabel = useAdminLabel();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null);
  const [search, setSearch] = useState('');
  // Dashboard stat cards deep-link here as /users?filter=android etc.
  const [searchParams, setSearchParams] = useSearchParams();
  const paramFilter = searchParams.get('filter') as Filter | null;
  const filter: Filter = paramFilter && paramFilter in FILTER_LABEL ? paramFilter : 'all';
  const setFilter = (f: Filter) =>
    setSearchParams(f === 'all' ? {} : { filter: f }, { replace: true });

  useEffect(() => {
    const fetchUsers = async () => {
      setLoading(true);
      try {
        const snap = await getDocs(collection(db, 'users'));
        const list: UserProfile[] = [];
        snap.forEach(d => list.push({ id: d.id, ...d.data() } as UserProfile));
        // newest registrations first
        list.sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt));
        setUsers(list);
      } catch { /* silent */ }
      finally { setLoading(false); }
    };
    fetchUsers();
  }, []);

  const handleSetStatus = async (userId: string, status: Verification) => {
    try {
      await updateDoc(doc(db, 'users', userId), {
        verificationStatus: status,
        // legacy flag kept in sync so older clients keep working
        isVerified: status === 'verified',
        verificationUpdatedAt: serverTimestamp(),
        verifiedBy: adminLabel,
      });
      const patch = { verificationStatus: status, isVerified: status === 'verified' };
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, ...patch } : u));
      setSelectedUser(prev => prev?.id === userId ? { ...prev, ...patch } : prev);
    } catch (e) {
      console.error(e);
      alert('Could not update verification status.');
    }
  };

  const counts = {
    all: users.length,
    android: users.filter(u => getPlatform(u) === 'android').length,
    ios: users.filter(u => getPlatform(u) === 'ios').length,
    verified: users.filter(u => getVerification(u) === 'verified').length,
    pending: users.filter(u => getVerification(u) === 'pending').length,
    unverified: users.filter(u => getVerification(u) !== 'verified').length,
  };

  const filtered = users.filter(u => {
    const q = search.toLowerCase().trim();
    const matchSearch = !q
      || (u.name || '').toLowerCase().includes(q)
      || (u.phone || '').includes(q)
      || (u.email || '').toLowerCase().includes(q)
      || (u.cnic || '').includes(q)
      || (u.uid || u.id).toLowerCase().includes(q);
    const matchFilter =
      filter === 'all' ? true :
      filter === 'android' ? getPlatform(u) === 'android' :
      filter === 'ios' ? getPlatform(u) === 'ios' :
      filter === 'verified' ? getVerification(u) === 'verified' :
      filter === 'pending' ? getVerification(u) === 'pending' :
      getVerification(u) !== 'verified';
    return matchSearch && matchFilter;
  });

  return (
    <div>
      <div className="dashboard-header" style={{ textAlign: 'left', marginBottom: '1.5rem' }}>
        <h1>Users</h1>
        <p>Click any user to review their full profile, ID documents, login history &amp; spending — then verify them</p>
      </div>

      {/* Filter pills */}
      <div className="dv-filter-row">
        {(Object.keys(FILTER_LABEL) as Filter[]).map(f => (
          <button
            key={f}
            className={`dv-filter-pill ${filter === f ? 'active' : ''}`}
            onClick={() => setFilter(f)}
          >
            {FILTER_LABEL[f]}
            <span className="dv-pill-count">{counts[f]}</span>
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="users-search-bar">
        <Search size={16} style={{ color: 'var(--text-secondary)' }} />
        <input
          type="text"
          placeholder="Search by name, phone, email, CNIC or UID…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="users-search-input"
        />
        {search && (
          <button onClick={() => setSearch('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', display: 'flex' }}>
            <X size={16} />
          </button>
        )}
      </div>

      {loading ? (
        <div className="rides-loading">
          <Loader size={28} className="spin" />
          <p>Loading users…</p>
        </div>
      ) : (
        <div className="users-grid">
          {filtered.map(user => {
            const platform = getPlatform(user);
            const verification = getVerification(user);
            return (
              <div key={user.id} className="user-card" onClick={() => setSelectedUser(user)}>
                <div className="user-avatar">{(user.name || 'U').charAt(0).toUpperCase()}</div>
                <div className="user-card-info">
                  <div className="user-card-name">{user.name || 'Unnamed User'}</div>
                  <div className="user-card-phone">{user.phone || 'No phone'}</div>
                  {user.email && <div className="user-card-email">{user.email}</div>}
                  <div className="user-card-meta">
                    <PlatformBadge platform={platform} />
                    <VerifyBadge state={verification} small />
                    {user.loginCount != null && (
                      <span className="user-os-badge"><LogIn size={10} /> {user.loginCount}</span>
                    )}
                  </div>
                </div>
                <ChevronRight size={16} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
              </div>
            );
          })}
          {filtered.length === 0 && (
            <p style={{ color: 'var(--text-secondary)', gridColumn: '1/-1' }}>
              {search ? 'No users match your search.' : 'No users found.'}
            </p>
          )}
        </div>
      )}

      {selectedUser && (
        <UserHistoryDrawer
          user={selectedUser}
          onClose={() => setSelectedUser(null)}
          onSetStatus={handleSetStatus}
        />
      )}
    </div>
  );
};

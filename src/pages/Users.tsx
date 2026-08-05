import React, { useEffect, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import {
  User, Smartphone, Shield, ShieldAlert, X, Navigation,
  CheckCircle, XCircle, Clock, Activity, DollarSign,
  Loader, ChevronRight, MapPin, Hash
} from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface UserProfile {
  id: string;
  uid?: string;
  name?: string;
  phone?: string;
  os?: string;
  isVerified?: boolean;
}

interface RideRecord {
  id: string;
  status?: string;
  pickup?: unknown;   // Firebase shape varies
  dropoff?: unknown;
  price?: unknown;
  distance?: unknown;
  time?: number | string | { seconds: number };
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

const fmtTime = (t: RideRecord['time']): string => {
  if (!t) return '—';
  let d: Date;
  if (typeof t === 'number') d = new Date(t > 1e12 ? t : t * 1000);
  else if (typeof t === 'string') d = new Date(t);
  else if (typeof t === 'object' && 'seconds' in t) d = new Date(t.seconds * 1000);
  else return '—';
  return d.toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' });
};

const isCompleted = (s?: string) => ['completed', 'finished', 'done'].includes((s || '').toLowerCase());
const isCancelled = (s?: string) => ['cancelled', 'canceled', 'rejected'].includes((s || '').toLowerCase());
const isActive    = (s?: string) => ['ongoing', 'started', 'active', 'accepted'].includes((s || '').toLowerCase());
const isPending   = (s?: string) => ['pending', 'searching', 'waiting'].includes((s || '').toLowerCase());

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

// ─── User History Drawer ─────────────────────────────────────────────────────

const UserHistoryDrawer: React.FC<{ user: UserProfile; onClose: () => void }> = ({ user, onClose }) => {
  const [rides, setRides] = useState<RideRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const uid = user.uid || user.id;

  useEffect(() => {
    const fetchRides = async () => {
      setLoading(true);
      try {
        const q = query(collection(db, 'rides'), where('rider', '==', uid));
        const snap = await getDocs(q);
        const list: RideRecord[] = [];
        snap.forEach(d => list.push({ id: d.id, ...d.data() } as RideRecord));
        // Debug: log first ride's pickup to DevTools so we can see the real Firebase shape
        if (list.length > 0) {
          console.log('[UserHistoryDrawer] first ride pickup:', list[0].pickup, '| dropoff:', list[0].dropoff);
        }
        // sort newest first
        list.sort((a, b) => {
          const ta = typeof a.time === 'number' ? a.time : typeof a.time === 'object' && a.time && 'seconds' in a.time ? a.time.seconds * 1000 : 0;
          const tb = typeof b.time === 'number' ? b.time : typeof b.time === 'object' && b.time && 'seconds' in b.time ? b.time.seconds * 1000 : 0;
          return tb - ta;
        });
        setRides(list);
      } catch {
        setRides([]);
      } finally {
        setLoading(false);
      }
    };
    fetchRides();
  }, [uid]);

  const totalSpending = rides
    .filter(r => isCompleted(r.status))
    .reduce((sum, r) => sum + toNum(r.price), 0);

  const completedCount = rides.filter(r => isCompleted(r.status)).length;
  const cancelledCount = rides.filter(r => isCancelled(r.status)).length;

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
            </div>
          </div>
          <button className="modal-close-btn" onClick={onClose}><X size={20} /></button>
        </div>

        <div className="modal-body">
          {/* User Info */}
          <div className="modal-section">
            <h3 className="modal-section-title"><User size={16} /> Profile</h3>
            <div className="modal-details-grid">
              <div className="detail-item">
                <span className="di-label"><Smartphone size={11} /> OS</span>
                <span className="di-value">{user.os || '—'}</span>
              </div>
              <div className="detail-item">
                <span className="di-label"><Shield size={11} /> Verified</span>
                <span className={`di-value ${user.isVerified ? 'text-green' : 'text-orange'}`}>
                  {user.isVerified ? 'Yes' : 'No'}
                </span>
              </div>
              <div className="detail-item" style={{ gridColumn: '1 / -1' }}>
                <span className="di-label"><Hash size={11} /> UID</span>
                <span className="di-value mono">{uid}</span>
              </div>
            </div>
          </div>

          {/* Spending Summary */}
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
                  <div className="usb-val">Rs. {totalSpending.toLocaleString()}</div>
                  <div className="usb-label">Total Spent</div>
                </div>
              </div>
            )}
          </div>

          {/* Ride History */}
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
                      <div className="rhi-price">Rs. {toNum(ride.price) || '—'}</div>
                    </div>
                  </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── Main Page ────────────────────────────────────────────────────────────────

export const Users: React.FC = () => {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    const fetchUsers = async () => {
      setLoading(true);
      try {
        const snap = await getDocs(collection(db, 'users'));
        const list: UserProfile[] = [];
        snap.forEach(d => list.push({ id: d.id, ...d.data() } as UserProfile));
        setUsers(list);
      } catch { /* silent */ }
      finally { setLoading(false); }
    };
    fetchUsers();
  }, []);

  const filtered = users.filter(u => {
    const q = search.toLowerCase();
    return !q || (u.name || '').toLowerCase().includes(q) || (u.phone || '').includes(q);
  });

  return (
    <div>
      <div className="dashboard-header" style={{ textAlign: 'left', marginBottom: '2rem' }}>
        <h1>Users</h1>
        <p>Click any user to see their ride history and total spending</p>
      </div>

      {/* Search */}
      <div className="users-search-bar">
        <MapPin size={16} style={{ color: 'var(--text-secondary)' }} />
        <input
          type="text"
          placeholder="Search by name or phone…"
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
          {filtered.map(user => (
            <div key={user.id} className="user-card" onClick={() => setSelectedUser(user)}>
              <div className="user-avatar">{(user.name || 'U').charAt(0).toUpperCase()}</div>
              <div className="user-card-info">
                <div className="user-card-name">{user.name || 'Unnamed User'}</div>
                <div className="user-card-phone">{user.phone || 'No phone'}</div>
                <div className="user-card-meta">
                  <span className="user-os-badge">
                    <Smartphone size={11} /> {user.os || 'Unknown'}
                  </span>
                  <span className={`status-badge ${user.isVerified ? 'status-verified' : 'status-unverified'}`} style={{ fontSize: '0.7rem', padding: '0.2rem 0.6rem' }}>
                    {user.isVerified ? <><ShieldAlert size={10} /> Verified</> : <><ShieldAlert size={10} /> Unverified</>}
                  </span>
                </div>
              </div>
              <ChevronRight size={16} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
            </div>
          ))}
          {filtered.length === 0 && (
            <p style={{ color: 'var(--text-secondary)', gridColumn: '1/-1' }}>
              {search ? 'No users match your search.' : 'No users found.'}
            </p>
          )}
        </div>
      )}

      {selectedUser && (
        <UserHistoryDrawer user={selectedUser} onClose={() => setSelectedUser(null)} />
      )}
    </div>
  );
};



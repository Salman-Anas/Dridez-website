import React, { useEffect, useState } from 'react';
import { collection, getDocs, getCountFromServer, query, where } from 'firebase/firestore';
import { ref, onValue, off } from 'firebase/database';
import { db, rtdb } from '../firebase';
import { StatCard } from './StatCard';
import {
  Users, Smartphone, ShieldCheck, ShieldAlert,
  Car, Bike, Truck, Navigation, CheckCircle, XCircle,
  Clock, Globe, DollarSign, TrendingUp,
  MessageSquare, AlertCircle, Activity, CalendarCheck
} from 'lucide-react';

// ─── Status helpers (mirrors Rides.tsx) ──────────────────────────────────────

const ACTIVE_STATUSES    = ['ongoing', 'started', 'active', 'accepted'];
const PENDING_STATUSES   = ['pending', 'searching', 'waiting'];
const COMPLETED_STATUSES = ['completed', 'finished', 'done'];
const CANCELLED_STATUSES = ['cancelled', 'canceled', 'rejected'];

const toStatus = (s?: string) => (s || '').toLowerCase();

const isActive    = (s?: string) => ACTIVE_STATUSES.includes(toStatus(s));
const isPending   = (s?: string) => PENDING_STATUSES.includes(toStatus(s));
const isCompleted = (s?: string) => COMPLETED_STATUSES.includes(toStatus(s));
const isCancelled = (s?: string) => CANCELLED_STATUSES.includes(toStatus(s));

// ─── Timestamp resolver (same logic as Rides.tsx) ───────────────────────────

const toMs = (t: unknown): number => {
  if (!t) return 0;
  if (typeof t === 'number') return t > 1e12 ? t : t * 1000;
  if (typeof t === 'string') { const d = Date.parse(t); return isNaN(d) ? 0 : d; }
  if (typeof t === 'object' && t !== null && 'seconds' in t) return (t as { seconds: number }).seconds * 1000;
  return 0;
};

// ─── Types ───────────────────────────────────────────────────────────────────

interface RideDoc {
  status?: string;
  price?: unknown;   // Firebase may return as string — always read via toNum()
  time?: unknown;
}

/** Safely coerce any Firebase value to a real number (prevents string concatenation). */
const toNum = (v: unknown): number => { const n = Number(v); return isNaN(n) ? 0 : n; };

interface StatsState {
  users: {
    total: number | null;
    android: number | null;
    ios: number | null;
    verified: number | null;
    unverified: number | null;
  };
  drivers: {
    total: number | null;
    verified: number | null;
    unverified: number | null;
    freight: number | null;
    nonFreight: number | null;
  };
  trips: {
    total: number | null;
    active: number | null;
    pending: number | null;
    completed: number | null;
    cancelled: number | null;
    today: number | null;
    intercity: number | null;
    revenue: number | null;
    avgFare: number | null;
  };
  complaints: {
    total: number | null;
    open: number | null;
    closed: number | null;
  };
}

const initialState: StatsState = {
  users:     { total: null, android: null, ios: null, verified: null, unverified: null },
  drivers:   { total: null, verified: null, unverified: null, freight: null, nonFreight: null },
  trips:     { total: null, active: null, pending: null, completed: null, cancelled: null, today: null, intercity: null, revenue: null, avgFare: null },
  complaints:{ total: null, open: null, closed: null },
};

// ─── Component ───────────────────────────────────────────────────────────────

export const Dashboard: React.FC = () => {
  const [stats, setStats] = useState<StatsState>(initialState);

  useEffect(() => {
    let mounted = true;

    // ── 1. Users (Firestore getCountFromServer – cheapest path) ──────────────
    const fetchUsers = async () => {
      try {
        const ref = collection(db, 'users');
        const [total, android, ios, verified, unverified] = await Promise.all([
          getCountFromServer(ref),
          getCountFromServer(query(ref, where('os', '==', 'android'))),
          getCountFromServer(query(ref, where('os', '==', 'ios'))),
          getCountFromServer(query(ref, where('isVerified', '==', true))),
          getCountFromServer(query(ref, where('isVerified', '==', false))),
        ]);
        if (!mounted) return;
        setStats(p => ({
          ...p,
          users: {
            total:      total.data().count,
            android:    android.data().count,
            ios:        ios.data().count,
            verified:   verified.data().count,
            unverified: unverified.data().count,
          }
        }));
      } catch (e) { console.warn('Users stats error', e); }
    };

    // ── 2. Drivers (Firestore – use schema-correct fields) ───────────────────
    // Schema: isVerified (boolean), freight (boolean), driver (string)
    const fetchDrivers = async () => {
      try {
        const ref = collection(db, 'driverProfileRequests');
        const [total, verified, unverified, freightYes] = await Promise.all([
          getCountFromServer(ref),
          getCountFromServer(query(ref, where('isVerified', '==', true))),
          getCountFromServer(query(ref, where('isVerified', '==', false))),
          getCountFromServer(query(ref, where('freight', '==', true))),
        ]);
        if (!mounted) return;
        const tot = total.data().count;
        const frgt = freightYes.data().count;
        setStats(p => ({
          ...p,
          drivers: {
            total:      tot,
            verified:   verified.data().count,
            unverified: unverified.data().count,
            freight:    frgt,
            nonFreight: Math.max(0, tot - frgt),
          }
        }));
      } catch (e) { console.warn('Drivers stats error', e); }
    };

    // ── 3. Trips – fetch ALL docs from Firestore + RTDB, count in JS ─────────
    // This gives full accuracy across all status variants and allows date filter.
    const fetchTrips = async () => {
      try {
        // Firestore rides
        const fsSnap = await getDocs(collection(db, 'rides'));
        const fsRides: RideDoc[] = [];
        fsSnap.forEach(d => fsRides.push(d.data() as RideDoc));

        // Firestore citytocity
        let c2cRides: RideDoc[] = [];
        try {
          const c2cSnap = await getDocs(collection(db, 'citytocity'));
          c2cSnap.forEach(d => c2cRides.push(d.data() as RideDoc));
        } catch { /* collection may not exist */ }

        const allFirestore = [...fsRides, ...c2cRides];

        // RTDB rides (one-time read merged with Firestore result)
        const rtdbRef = ref(rtdb, 'rides');
        onValue(rtdbRef, (snap) => {
          if (!mounted) return;
          const rtdbRides: RideDoc[] = [];
          if (snap && snap.exists()) {
            snap.forEach((child) => {
              rtdbRides.push(child.val() as RideDoc);
            });
          }

          // Merge: Firestore IDs already de-duped internally;
          // RTDB rides are the live ones — include both for active/pending counts.
          // For completed/cancelled/revenue we rely on Firestore only (RTDB clears them).
          const allRides = [...rtdbRides, ...allFirestore];

          // Today boundaries
          const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
          const todayMs = startOfToday.getTime();

          const active    = allRides.filter(r => isActive(r.status)).length;
          const pending   = allRides.filter(r => isPending(r.status)).length;
          const completed = allFirestore.filter(r => isCompleted(r.status)).length;
          const cancelled = allFirestore.filter(r => isCancelled(r.status)).length;
          const today     = allFirestore.filter(r => toMs(r.time) >= todayMs).length;
          const completedRides = allFirestore.filter(r => isCompleted(r.status));
          const revenue   = completedRides.reduce((sum, r) => sum + toNum(r.price), 0);
          const avgFare   = completedRides.length > 0 ? Math.round(revenue / completedRides.length) : 0;

          setStats(p => ({
            ...p,
            trips: {
              total:     allRides.length,
              active,
              pending,
              completed,
              cancelled,
              today,
              intercity: c2cRides.length,
              revenue,
              avgFare,
            }
          }));

          // Remove the RTDB listener after first read (we don't need live updates here)
          off(rtdbRef, 'value');
        }, { onlyOnce: true });

      } catch (e) { console.warn('Trips stats error', e); }
    };

    // ── 4. Complaints ────────────────────────────────────────────────────────
    const fetchComplaints = async () => {
      try {
        const ref = collection(db, 'tickets');
        const [total, open, closed] = await Promise.all([
          getCountFromServer(ref),
          getCountFromServer(query(ref, where('status', '==', 'open'))),
          getCountFromServer(query(ref, where('status', '==', 'closed'))),
        ]);
        if (!mounted) return;
        setStats(p => ({
          ...p,
          complaints: {
            total:  total.data().count,
            open:   open.data().count,
            closed: closed.data().count,
          }
        }));
      } catch (e) { console.warn('Complaints stats error', e); }
    };

    // Run all fetches concurrently
    Promise.all([fetchUsers(), fetchDrivers(), fetchTrips(), fetchComplaints()]);

    return () => { mounted = false; };
  }, []);

  return (
    <div className="dashboard-container">
      <div className="dashboard-header">
        <h1>Admin Dashboard</h1>
        <p>Live statistics aggregated from Realtime Database &amp; Firestore</p>
      </div>

      {/* ── Users ─────────────────────────────────────────────────────── */}
      <div className="stat-section">
        <h2 className="section-title"><Users size={20} /> Users Overview</h2>
        <div className="stats-grid">
          <StatCard title="Total Customers"  value={stats.users.total}      icon={<Users />}       color="var(--accent-blue)" />
          <StatCard title="Android Users"    value={stats.users.android}    icon={<Smartphone />}  color="var(--accent-green)" />
          <StatCard title="iOS Users"        value={stats.users.ios}        icon={<Smartphone />}  color="var(--accent-purple)" />
          <StatCard title="Verified Users"   value={stats.users.verified}   icon={<ShieldCheck />} color="var(--accent-green)" />
          <StatCard title="Unverified Users" value={stats.users.unverified} icon={<ShieldAlert />} color="var(--accent-orange)" />
        </div>
      </div>

      {/* ── Drivers ───────────────────────────────────────────────────── */}
      <div className="stat-section">
        <h2 className="section-title"><Car size={20} /> Drivers Overview</h2>
        <div className="stats-grid">
          <StatCard title="Total Drivers"       value={stats.drivers.total}      icon={<Car />}        color="var(--accent-purple)" />
          <StatCard title="Verified Drivers"    value={stats.drivers.verified}   icon={<ShieldCheck />}color="var(--accent-green)" />
          <StatCard title="Unverified Drivers"  value={stats.drivers.unverified} icon={<ShieldAlert />}color="var(--accent-orange)" />
          <StatCard title="Freight-Enabled"     value={stats.drivers.freight}    icon={<Truck />}      color="var(--accent-red)" />
          <StatCard title="Standard Drivers"    value={stats.drivers.nonFreight} icon={<Bike />}       color="var(--accent-blue)" />
        </div>
      </div>

      {/* ── Trips ─────────────────────────────────────────────────────── */}
      <div className="stat-section">
        <h2 className="section-title"><Navigation size={20} /> Trips Overview</h2>
        <div className="stats-grid">
          <StatCard title="Total Rides"       value={stats.trips.total}     icon={<Navigation />}   color="var(--accent-blue)" />
          <StatCard title="Active Right Now"  value={stats.trips.active}    icon={<Activity />}     color="var(--accent-cyan)" />
          <StatCard title="Pending / Queued"  value={stats.trips.pending}   icon={<Clock />}        color="var(--accent-orange)" />
          <StatCard title="Completed Rides"   value={stats.trips.completed} icon={<CheckCircle />}  color="var(--accent-green)" />
          <StatCard title="Cancelled Rides"   value={stats.trips.cancelled} icon={<XCircle />}      color="var(--accent-red)" />
          <StatCard title="Today's Rides"     value={stats.trips.today}     icon={<CalendarCheck />}color="var(--accent-purple)" />
          <StatCard title="Inter-City Trips"  value={stats.trips.intercity} icon={<Globe />}        color="var(--accent-cyan)" />
          <StatCard
            title="Total Revenue (Completed)"
            value={stats.trips.revenue !== null ? `Rs. ${stats.trips.revenue.toLocaleString()}` : null}
            icon={<DollarSign />}
            color="var(--accent-green)"
          />
        </div>
      </div>

      {/* ── Revenue breakdown (quick ratio) ───────────────────────────── */}
      {stats.trips.completed !== null && stats.trips.total !== null && stats.trips.total > 0 && (
        <div className="stat-section">
          <h2 className="section-title"><TrendingUp size={20} /> Ride Performance</h2>
          <div className="stats-grid">
            <StatCard
              title="Completion Rate"
              value={`${((stats.trips.completed / Math.max(1, stats.trips.total - (stats.trips.active ?? 0) - (stats.trips.pending ?? 0))) * 100).toFixed(1)}%`}
              icon={<TrendingUp />}
              color="var(--accent-green)"
            />
            <StatCard
              title="Cancellation Rate"
              value={`${((stats.trips.cancelled ?? 0) / Math.max(1, stats.trips.total - (stats.trips.active ?? 0) - (stats.trips.pending ?? 0)) * 100).toFixed(1)}%`}
              icon={<XCircle />}
              color="var(--accent-red)"
            />
            <StatCard
              title="Avg Fare (Completed)"
              value={stats.trips.avgFare !== null && stats.trips.avgFare > 0
                ? `Rs. ${stats.trips.avgFare.toLocaleString()}`
                : null}
              icon={<DollarSign />}
              color="var(--accent-purple)"
            />
          </div>
        </div>
      )}

      {/* ── Complaints ────────────────────────────────────────────────── */}
      <div className="stat-section">
        <h2 className="section-title"><MessageSquare size={20} /> Support &amp; Feedback</h2>
        <div className="stats-grid">
          <StatCard title="Total Tickets"  value={stats.complaints.total}  icon={<AlertCircle />}  color="var(--accent-red)" />
          <StatCard title="Open Tickets"   value={stats.complaints.open}   icon={<AlertCircle />}  color="var(--accent-orange)" />
          <StatCard title="Closed Tickets" value={stats.complaints.closed} icon={<CheckCircle />}  color="var(--accent-green)" />
        </div>
      </div>

    </div>
  );
};



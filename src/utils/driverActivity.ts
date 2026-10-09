// ─── Live driver activity ────────────────────────────────────────────────────
// Who is online and who is on a ride right now, read live:
//   • online  — RTDB `drivers_online/{uid}`, published every 30 s while the
//               driver is online. The app keeps counting a driver for 30
//               minutes after their last update (so they still get nearby
//               requests after closing the app), and so does this.
//   • on ride — RTDB `rides/{rideId}` with a driver and status `inprogress`
//               (heading to pickup) or `started` (rider on board), plus
//               city-to-city `citytocity` docs with status `ontrip`.
// See dridez/schema.md §3.8 and §4.

import { useEffect, useMemo, useState } from 'react';
import { onValue, ref } from 'firebase/database';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db, rtdb } from '../firebase';
import { toMs } from './firebaseValues';

/** Matches the app's ONLINE_AFTER_CLOSE_MS. */
export const ONLINE_WINDOW_MS = 30 * 60 * 1000;

export interface OnlinePresence {
  updatedAt: number;
  busy: boolean;
  latitude?: number;
  longitude?: number;
  cabTypes: string[];
}

export interface LiveRide {
  id: string;
  source: 'in_city' | 'city_to_city';
  status: string;
  cabtype?: string;
  pickup?: unknown;
  dropoff?: unknown;
  price?: unknown;
  /** When the current leg began — accepted, started or picked up. */
  since: number;
}

/** In-city statuses where the driver is committed to a rider. */
const IN_CITY_ACTIVE = new Set(['inprogress', 'in_progress', 'started']);

export const LIVE_RIDE_STATUS_LABEL: Record<string, string> = {
  inprogress: 'Heading to pickup',
  in_progress: 'Heading to pickup',
  started: 'Rider on board',
  ontrip: 'City-to-city trip under way',
};

export interface DriverActivity {
  /** Drivers whose last presence update is inside the 30-minute window. */
  online: Map<string, OnlinePresence>;
  onRide: Map<string, LiveRide>;
  loading: boolean;
  error: string;
}

export const useDriverActivity = (): DriverActivity => {
  const [presence, setPresence] = useState<Map<string, OnlinePresence>>(new Map());
  const [inCity, setInCity] = useState<Map<string, LiveRide>>(new Map());
  const [cityRides, setCityRides] = useState<Map<string, LiveRide>>(new Map());
  const [pending, setPending] = useState({ presence: true, inCity: true, city: true });
  const [error, setError] = useState('');
  // Presence ages out without any write, so re-check against the clock.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const fail = (what: string) => (e: Error) => {
      console.error(`[activity] ${what}`, e);
      setError(`Could not read ${what} — confirm your account carries the admin claim.`);
    };

    const offPresence = onValue(ref(rtdb, 'drivers_online'), snap => {
      const next = new Map<string, OnlinePresence>();
      snap.forEach(child => {
        const v = (child.val() ?? {}) as Record<string, unknown>;
        const types = v.cabTypes && typeof v.cabTypes === 'object'
          ? Object.keys(v.cabTypes as object).filter(k => (v.cabTypes as Record<string, unknown>)[k])
          : [];
        next.set(child.key as string, {
          updatedAt: toMs(v.updatedAt),
          busy: v.busy === true,
          latitude: typeof v.latitude === 'number' ? v.latitude : undefined,
          longitude: typeof v.longitude === 'number' ? v.longitude : undefined,
          cabTypes: types,
        });
      });
      setPresence(next);
      setPending(p => ({ ...p, presence: false }));
    }, e => { fail('drivers_online')(e); setPending(p => ({ ...p, presence: false })); });

    const offRides = onValue(ref(rtdb, 'rides'), snap => {
      const next = new Map<string, LiveRide>();
      snap.forEach(child => {
        const r = (child.val() ?? {}) as Record<string, unknown>;
        const status = String(r.status ?? '').toLowerCase().trim();
        const driver = typeof r.driver === 'string' ? r.driver : '';
        if (!driver || !IN_CITY_ACTIVE.has(status)) return;
        next.set(driver, {
          id: child.key as string,
          source: 'in_city',
          status,
          cabtype: typeof r.cabtype === 'string' ? r.cabtype : undefined,
          pickup: r.pickup,
          dropoff: r.dropoff,
          price: r.price,
          since: toMs(r.startedAt) || toMs(r.acceptedAt) || toMs(r.createdAt),
        });
      });
      setInCity(next);
      setPending(p => ({ ...p, inCity: false }));
    }, e => { fail('live rides')(e); setPending(p => ({ ...p, inCity: false })); });

    const offCity = onSnapshot(
      query(collection(db, 'citytocity'), where('status', '==', 'ontrip')),
      snap => {
        const next = new Map<string, LiveRide>();
        snap.forEach(d => {
          const r = d.data();
          if (typeof r.driver !== 'string' || !r.driver) return;
          next.set(r.driver, {
            id: d.id,
            source: 'city_to_city',
            status: 'ontrip',
            cabtype: typeof r.cabtype === 'string' ? r.cabtype : undefined,
            pickup: r.pickup,
            dropoff: r.dropoff,
            price: r.price,
            since: toMs(r.pickedUpAt) || toMs(r.acceptedAt),
          });
        });
        setCityRides(next);
        setPending(p => ({ ...p, city: false }));
      },
      e => { fail('city-to-city trips')(e); setPending(p => ({ ...p, city: false })); },
    );

    return () => { offPresence(); offRides(); offCity(); };
  }, []);

  const online = useMemo(() => {
    const live = new Map<string, OnlinePresence>();
    for (const [uid, p] of presence) {
      if (p.updatedAt && now - p.updatedAt < ONLINE_WINDOW_MS) live.set(uid, p);
    }
    return live;
  }, [presence, now]);

  // An in-city ride wins if, somehow, a driver shows up in both.
  const onRide = useMemo(() => new Map([...cityRides, ...inCity]), [cityRides, inCity]);

  return {
    online,
    onRide,
    loading: pending.presence || pending.inCity || pending.city,
    error,
  };
};

/** "3 min ago" — for presence and ride timestamps. */
export const timeAgo = (ms: number, now = Date.now()): string => {
  if (!ms) return '—';
  const mins = Math.max(0, Math.round((now - ms) / 60_000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.floor(mins / 60);
  return `${h} h ${mins % 60} min ago`;
};

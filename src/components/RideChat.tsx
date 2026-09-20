import React, { useEffect, useMemo, useState } from 'react';
import { ref, onValue, off } from 'firebase/database';
import { rtdb } from '../firebase';
import { Loader, MessageSquare, AlertCircle } from 'lucide-react';

// ─── Trip chat ───────────────────────────────────────────────────────────────
// `rides_driver_chat/{rideId}/{timestampMs}` in the Realtime Database, keyed by
// the millisecond the message was sent. The same node serves in-city trips
// (keyed by the RTDB ride id) and city-to-city trips (keyed by the citytocity
// document id), so one component covers both.
//
// `senderRole` is only on newer messages. Older ones carry just a `sender` uid,
// so the rider and driver uids from the ride are passed in to place those.

interface ChatMessage {
  key: string;
  msg: string;
  sender?: string;
  senderRole?: string;
  timestamp?: number;
}

type Side = 'rider' | 'driver' | 'unknown';

interface Props {
  rideId: string;
  riderUid?: string;
  driverUid?: string;
}

const formatStamp = (ms: number): string =>
  new Date(ms).toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' });

/** Millis from the node key, falling back to the message's own timestamp. */
const messageMs = (m: ChatMessage): number => {
  const fromKey = Number(m.key);
  if (Number.isFinite(fromKey) && fromKey > 1e12) return fromKey;
  return typeof m.timestamp === 'number' ? m.timestamp : 0;
};

export const RideChat: React.FC<Props> = ({ rideId, riderUid, driverUid }) => {
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setMessages(null);
    setError('');
    const node = ref(rtdb, `rides_driver_chat/${rideId}`);

    const handle = (snapshot: unknown) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const snap = snapshot as any;
      const rows: ChatMessage[] = [];
      if (snap && snap.exists()) {
        snap.forEach((child: { key: string; val: () => unknown }) => {
          const v = (child.val() || {}) as Omit<ChatMessage, 'key'>;
          rows.push({ key: child.key, ...v });
        });
      }
      rows.sort((a, b) => messageMs(a) - messageMs(b));
      setMessages(rows);
    };

    const handleError = () => {
      setError('Chat could not be read from the Realtime Database.');
      setMessages([]);
    };

    onValue(node, handle, handleError);
    return () => { off(node, 'value', handle); };
  }, [rideId]);

  const sideOf = useMemo(() => (m: ChatMessage): Side => {
    const role = (m.senderRole || '').toLowerCase().trim();
    if (role === 'rider' || role === 'driver') return role;
    if (m.sender && driverUid && m.sender === driverUid) return 'driver';
    if (m.sender && riderUid && m.sender === riderUid) return 'rider';
    return 'unknown';
  }, [riderUid, driverUid]);

  if (error) {
    return (
      <div className="chat-empty">
        <AlertCircle size={18} /> <span>{error}</span>
      </div>
    );
  }

  if (messages === null) {
    return (
      <div className="loading-row"><Loader size={16} className="spin" /> Loading chat…</div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="chat-empty">
        <MessageSquare size={18} />
        <span>
          No messages on this trip. Chat is deleted along with the live ride once the trip ends,
          so a completed ride often has none left.
        </span>
      </div>
    );
  }

  return (
    <div className="chat-thread">
      {messages.map(m => {
        const side = sideOf(m);
        const ms = messageMs(m);
        return (
          <div key={m.key} className={`chat-row chat-row-${side}`}>
            <div className="chat-bubble">
              <div className="chat-sender">
                {side === 'rider' ? 'Rider' : side === 'driver' ? 'Driver' : 'Unknown sender'}
              </div>
              <div className="chat-text">{m.msg || <em>empty message</em>}</div>
              <div className="chat-time">{ms ? formatStamp(ms) : '—'}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

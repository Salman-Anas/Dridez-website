// ─── Support chat ─────────────────────────────────────────────────────────────
// One live conversation per account: `supportChats/{uid}` holds the summary
// the inbox sorts and badges by, `supportChats/{uid}/messages` the messages.
// The app writes `sender: "user"`, the portal `sender: "admin"`; a message
// from the portal reaches the user's phone through the app's
// onSupportMessageCreated Cloud Function. Each send writes the message and
// the summary in one batch so the two never disagree. See dridez/schema.md
// §3.17 for the full contract.

import {
  collection, doc, increment, limit, onSnapshot, orderBy, query,
  serverTimestamp, updateDoc, writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase';

/** The longest message either side may send. Mirrored in the app and rules. */
export const MAX_MESSAGE = 2000;
const MAX_PREVIEW = 200;
const INBOX_SIZE = 300;
const HISTORY = 300;

export interface SupportThread {
  uid: string;
  name?: string;
  phone?: string;
  lastMessage?: string;
  lastSender?: 'user' | 'admin';
  lastAt?: unknown;
  /** Messages from the user the team hasn't opened yet. */
  unreadByAdmin?: number;
  /** Replies from the team the user hasn't opened yet. */
  unreadByUser?: number;
}

export interface SupportMessage {
  id: string;
  text: string;
  sender: 'user' | 'admin';
  at: number;
  /** Which admin sent it — portal-only audit trail; the app ignores it. */
  adminLabel?: string;
  pending: boolean;
}

/** Firestore Timestamp, epoch millis or nothing → epoch millis (0 if unknown). */
export const toMs = (v: unknown): number => {
  if (!v) return 0;
  if (typeof v === 'number') return v;
  const o = v as { toMillis?: () => number; seconds?: number };
  if (typeof o.toMillis === 'function') return o.toMillis();
  if (typeof o.seconds === 'number') return o.seconds * 1000;
  return 0;
};

/** "14:05" today, "Yesterday", or "12 Nov" — for the inbox. */
export const shortWhen = (ms: number): string => {
  if (!ms) return '';
  const d = new Date(ms);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' });
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-PK', { day: 'numeric', month: 'short' });
};

/** "12 Nov 2026, 14:05" — under each message. */
export const fullWhen = (ms: number): string =>
  ms ? new Date(ms).toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' }) : '';

/** Every conversation, most recent first, live. */
export const watchInbox = (
  onChange: (threads: SupportThread[]) => void,
  onError: (message: string) => void,
): (() => void) =>
  onSnapshot(
    query(collection(db, 'supportChats'), orderBy('lastAt', 'desc'), limit(INBOX_SIZE)),
    snap => onChange(snap.docs.map(d => ({ ...(d.data() as Omit<SupportThread, 'uid'>), uid: d.id }))),
    err => { console.error(err); onError('Conversations could not be loaded. Confirm your account carries the admin claim.'); },
  );

/** One conversation's messages, oldest first, live. */
export const watchMessages = (
  uid: string,
  onChange: (messages: SupportMessage[]) => void,
  onError: (message: string) => void,
): (() => void) =>
  onSnapshot(
    query(collection(db, 'supportChats', uid, 'messages'), orderBy('at', 'desc'), limit(HISTORY)),
    { includeMetadataChanges: true },
    snap => onChange(
      snap.docs
        .map(d => {
          const data = d.data({ serverTimestamps: 'estimate' }) as Record<string, unknown>;
          return {
            id: d.id,
            text: String(data.text ?? ''),
            sender: data.sender === 'admin' ? 'admin' : 'user',
            at: toMs(data.at) || Date.now(),
            adminLabel: typeof data.adminLabel === 'string' ? data.adminLabel : undefined,
            pending: d.metadata.hasPendingWrites,
          } as SupportMessage;
        })
        .reverse(),
    ),
    err => { console.error(err); onError('Messages could not be loaded.'); },
  );

/**
 * Sends a reply (or the first message of a new conversation). `name` and
 * `phone` keep the inbox readable for conversations the team starts.
 */
export const sendAdminMessage = async (args: {
  uid: string;
  text: string;
  adminUid: string;
  adminLabel: string;
  name?: string;
  phone?: string;
}): Promise<void> => {
  const text = args.text.trim();
  if (!text) throw new Error('Write a message first.');
  if (text.length > MAX_MESSAGE) throw new Error(`Keep messages to ${MAX_MESSAGE} characters.`);

  const thread = doc(db, 'supportChats', args.uid);
  const batch = writeBatch(db);
  batch.set(doc(collection(thread, 'messages')), {
    text,
    sender: 'admin',
    uid: args.adminUid,
    adminLabel: args.adminLabel,
    at: serverTimestamp(),
  });
  batch.set(thread, {
    uid: args.uid,
    ...(args.name ? { name: args.name } : {}),
    ...(args.phone ? { phone: args.phone } : {}),
    lastMessage: text.slice(0, MAX_PREVIEW),
    lastSender: 'admin',
    lastAt: serverTimestamp(),
    unreadByUser: increment(1),
    // Replying means the team has read everything before it.
    unreadByAdmin: 0,
  }, { merge: true });
  await batch.commit();
};

/** Clears the inbox badge for a conversation the team has opened. */
export const markReadByAdmin = (uid: string): Promise<void> =>
  updateDoc(doc(db, 'supportChats', uid), { unreadByAdmin: 0 });

/** Who a bulk message goes to, and what the inbox should call them. */
export interface ChatRecipient {
  uid: string;
  name?: string;
  phone?: string;
}

/** People per batch: two writes each, well inside Firestore's 500. */
const BULK_CHUNK = 200;

/**
 * The same message to many people at once: everyone, a segment, or a picked
 * list. Each person gets it in their own conversation, exactly as if an admin
 * had replied there, so it reaches them as a push and their replies come back
 * to the inbox. Unlike a reply it leaves `unreadByAdmin` alone: messaging
 * everyone must not mark their unanswered messages as read.
 *
 * Batches go out one after another; if one fails, the error says how many
 * people already got the message. Returns how many conversations it reached.
 */
export const sendBulkAdminMessage = async (args: {
  recipients: ChatRecipient[];
  text: string;
  adminUid: string;
  adminLabel: string;
  onProgress?: (done: number, total: number) => void;
}): Promise<number> => {
  const text = args.text.trim();
  if (!text) throw new Error('Write a message first.');
  if (text.length > MAX_MESSAGE) throw new Error(`Keep messages to ${MAX_MESSAGE} characters.`);
  const people = [...new Map(args.recipients.filter(r => r.uid).map(r => [r.uid, r])).values()];
  if (!people.length) throw new Error('Nobody matches this choice.');

  let done = 0;
  for (let i = 0; i < people.length; i += BULK_CHUNK) {
    const batch = writeBatch(db);
    for (const p of people.slice(i, i + BULK_CHUNK)) {
      const thread = doc(db, 'supportChats', p.uid);
      batch.set(doc(collection(thread, 'messages')), {
        text,
        sender: 'admin',
        uid: args.adminUid,
        adminLabel: args.adminLabel,
        at: serverTimestamp(),
      });
      batch.set(thread, {
        uid: p.uid,
        ...(p.name ? { name: p.name } : {}),
        ...(p.phone ? { phone: p.phone } : {}),
        lastMessage: text.slice(0, MAX_PREVIEW),
        lastSender: 'admin',
        lastAt: serverTimestamp(),
        unreadByUser: increment(1),
      }, { merge: true });
    }
    try {
      await batch.commit();
    } catch (e) {
      const why = e instanceof Error ? e.message : 'unknown error';
      throw new Error(done
        ? `Sent to ${done} of ${people.length}, then stopped: ${why}`
        : `The message could not be sent: ${why}`);
    }
    done = Math.min(people.length, i + BULK_CHUNK);
    args.onProgress?.(done, people.length);
  }
  return done;
};

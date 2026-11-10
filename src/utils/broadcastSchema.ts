// ─── Notifications sent from the portal ──────────────────────────────────────
// The Users and Drivers pages can notify everyone, the verified, the
// unverified, or people picked one by one. The portal resolves that choice to
// uids here, against the same lists it shows, and writes one
// `broadcasts/{id}` document; the app's `onBroadcastCreated` Cloud Function
// sends it and writes progress back. See dridez/schema.md §3.16.

import {
  collection, doc, limit, onSnapshot, orderBy, query, serverTimestamp, setDoc,
} from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { db, storage } from '../firebase';

export const MAX_TITLE = 65;
export const MAX_BODY = 240;
export const MAX_RECIPIENTS = 20000;
/** Images are shrunk to this before upload; the phone downloads them. */
const IMAGE_MAX_EDGE = 1024;
const IMAGE_MAX_INPUT_BYTES = 10 * 1024 * 1024;

export type BroadcastScope = 'users' | 'drivers';
export type Segment = 'all' | 'verified' | 'unverified' | 'selected';
export type BroadcastStatus = 'queued' | 'sending' | 'sent' | 'failed';

/** Someone who can be notified. */
export interface Recipient {
  uid: string;
  name: string;
  phone: string;
  verified: boolean;
}

export interface Broadcast {
  id: string;
  title?: string;
  body?: string;
  imageUrl?: string;
  uids?: string[];
  audience?: { scope?: BroadcastScope; segment?: Segment; label?: string };
  status?: BroadcastStatus;
  phones?: number;
  error?: string;
  createdBy?: string;
  createdAt?: unknown;
  finishedAt?: unknown;
}

/** A deleted account keeps a stub user document; it is never notified. */
export const isDeletedAccount = (u: { deleted?: unknown; suspendedBy?: unknown }): boolean =>
  u.deleted === true || u.suspendedBy === 'deleted';

export const resolveAudience = (
  recipients: Recipient[],
  segment: Segment,
  selected: ReadonlySet<string>,
): string[] => {
  const pick = (r: Recipient) => {
    switch (segment) {
      case 'all': return true;
      case 'verified': return r.verified;
      case 'unverified': return !r.verified;
      default: return selected.has(r.uid);
    }
  };
  return [...new Set(recipients.filter(pick).map(r => r.uid))];
};

/** Shrinks a picked image to a JPEG no larger than IMAGE_MAX_EDGE on a side. */
const prepareImage = async (file: File): Promise<Blob> => {
  if (!file.type.startsWith('image/')) throw new Error('Pick an image file (JPG or PNG).');
  if (file.size > IMAGE_MAX_INPUT_BYTES) throw new Error('That image is over 10 MB.');
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, IMAGE_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser could not read the image.');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  if (!blob) throw new Error('This browser could not prepare the image.');
  return blob;
};

/**
 * Uploads the image (if any) and queues the broadcast. Returns its id; the
 * Cloud Function takes it from "queued" to "sent" or "failed".
 */
export const sendBroadcast = async (args: {
  scope: BroadcastScope;
  segment: Segment;
  label: string;
  uids: string[];
  title: string;
  body: string;
  image: File | null;
  adminLabel: string;
}): Promise<string> => {
  const title = args.title.trim();
  const body = args.body.trim();
  if (!title) throw new Error('Add a title.');
  if (!body) throw new Error('Add a message.');
  if (title.length > MAX_TITLE) throw new Error(`Keep the title to ${MAX_TITLE} characters.`);
  if (body.length > MAX_BODY) throw new Error(`Keep the message to ${MAX_BODY} characters.`);
  if (!args.uids.length) throw new Error('Nobody matches this choice.');
  if (args.uids.length > MAX_RECIPIENTS) throw new Error(`At most ${MAX_RECIPIENTS} people at once.`);

  const ref_ = doc(collection(db, 'broadcasts'));
  let imageUrl: string | undefined;
  if (args.image) {
    const blob = await prepareImage(args.image);
    const imageRef = ref(storage, `broadcasts/${ref_.id}/image.jpg`);
    await uploadBytes(imageRef, blob, { contentType: 'image/jpeg' });
    imageUrl = await getDownloadURL(imageRef);
    // Phones fetch the image themselves, so the server only accepts https.
    if (!imageUrl.startsWith('https://')) {
      throw new Error('The image uploaded, but its link isn\'t https, so phones can\'t load it. Send without the image.');
    }
  }

  await setDoc(ref_, {
    title,
    body,
    ...(imageUrl ? { imageUrl } : {}),
    uids: args.uids,
    audience: { scope: args.scope, segment: args.segment, label: args.label },
    status: 'queued',
    createdBy: args.adminLabel,
    createdAt: serverTimestamp(),
  });
  return ref_.id;
};

/** The latest broadcasts for one page, live. Filtered here: no composite index. */
export const watchBroadcasts = (
  scope: BroadcastScope,
  onChange: (list: Broadcast[]) => void,
  onError: (message: string) => void,
): (() => void) =>
  onSnapshot(
    query(collection(db, 'broadcasts'), orderBy('createdAt', 'desc'), limit(30)),
    snap => onChange(
      snap.docs
        .map(d => ({ id: d.id, ...(d.data() as Omit<Broadcast, 'id'>) }))
        .filter(b => b.audience?.scope === scope)
        .slice(0, 6),
    ),
    err => { console.error(err); onError('Recent notifications could not be loaded.'); },
  );

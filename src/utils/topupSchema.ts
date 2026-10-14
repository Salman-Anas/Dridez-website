// ─── Driver bank-transfer top-ups ────────────────────────────────────────────
// A driver pays into `config/paymentAccount`, then files a
// `topupRequests/{autoId}` with the amount and a receipt photo, through the
// `requestTopup` Cloud Function. Small top-ups from a trusted driver are
// credited by that function at once ("auto_credited"); the portal then either
// verifies them or reverses them — taking the money back and marking the
// driver unauthentic. Everything else arrives "pending", and the portal
// approves it — crediting the wallet and writing a `topup` ledger entry in the
// same transaction — or rejects it with a reason the driver sees in the app.
// Field names and status spellings are matched exactly by the app and the
// security rules; see dridez/schema.md §3.4.1 and §3.4.2.

import {
  collection, deleteField, doc, runTransaction, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import { toNum } from './firebaseValues';

// ─── config/paymentAccount ───────────────────────────────────────────────────

export interface PaymentAccount {
  bankName: string;
  accountTitle: string;
  /** Always a string, so leading zeros survive. */
  accountNumber: string;
  iban: string;
  note: string;
}

export const EMPTY_PAYMENT_ACCOUNT: PaymentAccount = {
  bankName: '', accountTitle: '', accountNumber: '', iban: '', note: '',
};

export const PAYMENT_ACCOUNT_DOC = doc(db, 'config', 'paymentAccount');

const str = (v: unknown): string =>
  typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';

export const readPaymentAccount = (data: Record<string, unknown> | undefined): PaymentAccount => ({
  bankName: str(data?.bankName),
  accountTitle: str(data?.accountTitle),
  accountNumber: str(data?.accountNumber),
  iban: str(data?.iban),
  note: str(data?.note),
});

/** With neither an account number nor an IBAN the app refuses top-ups. */
export const paymentAccountUsable = (a: PaymentAccount): boolean =>
  Boolean(a.accountNumber.trim() || a.iban.trim());

// ─── topupRequests ───────────────────────────────────────────────────────────

export type TopupStatus = 'pending' | 'auto_credited' | 'approved' | 'rejected' | 'reversed' | 'unknown';

export const TOPUP_STATUS_LABEL: Record<TopupStatus, string> = {
  pending: 'Pending',
  auto_credited: 'Added instantly — verify',
  approved: 'Approved',
  rejected: 'Rejected',
  reversed: 'Reversed',
  unknown: 'Unknown',
};

/** Why the server left a request for a person, from `reviewReason`. */
export const REVIEW_REASON_LABEL: Record<string, string> = {
  over_limit: 'Above the driver\'s safe limit',
  previous_unverified: 'An earlier payment wasn\'t verified yet',
  unauthentic: 'Driver is marked unauthentic',
};

export interface TopupRequest {
  id: string;
  driver?: string;
  amount?: unknown;
  currency?: string;
  proofUrl?: string;
  proofPath?: string;
  paidTo?: Partial<Record<'bankName' | 'accountTitle' | 'accountNumber' | 'iban', unknown>>;
  status?: string;
  createdAt?: unknown;
  creditedAmount?: unknown;
  reviewedBy?: string;
  reviewedAt?: unknown;
  rejectionReason?: string;
  reviewReason?: string;
  autoCredited?: boolean;
  creditedAt?: unknown;
  safeLimitBefore?: unknown;
  safeLimitAfter?: unknown;
  reversalReason?: string;
}

const STATUSES: TopupStatus[] = ['pending', 'auto_credited', 'approved', 'rejected', 'reversed'];

/**
 * Anything unrecognised is 'unknown' and read-only — never 'pending', which
 * would let an instant top-up be approved (credited) a second time.
 */
export const topupStatus = (r: TopupRequest): TopupStatus => {
  if (r.status === undefined || r.status === null) {
    // No status at all: the oldest, hand-made records — unless something says
    // money already moved, in which case nobody may approve it again.
    return r.autoCredited || r.creditedAt ? 'unknown' : 'pending';
  }
  const s = (typeof r.status === 'string' ? r.status : '').toLowerCase().trim() as TopupStatus;
  return STATUSES.includes(s) ? s : 'unknown';
};

const ALREADY_MESSAGE: Record<TopupStatus, string> = {
  pending: 'This request is still waiting for a manual approval.',
  auto_credited: 'This request was already credited instantly — verify or reverse it instead.',
  approved: 'This request has already been approved.',
  rejected: 'This request has already been rejected.',
  reversed: 'This request has already been reversed.',
  unknown: 'This request has a status the portal doesn\'t recognise, so it is read-only.',
};

/** Thrown when a request was reviewed elsewhere between load and click. */
export class TopupAlreadyReviewedError extends Error {
  status: TopupStatus;
  constructor(status: TopupStatus) {
    super(`${ALREADY_MESSAGE[status]} Nothing was changed.`);
    this.status = status;
  }
}

/**
 * Approve: one transaction that re-checks the request is still pending, adds
 * `creditedAmount` to the wallet, writes the `topup` ledger entry and closes
 * the request. The balance increase sends the driver the "PKR X added" push.
 */
export const approveTopup = async (
  requestId: string,
  creditedAmount: number,
  adminLabel: string,
): Promise<number> => {
  if (!(creditedAmount > 0)) throw new Error('The credited amount must be greater than zero.');

  const requestRef = doc(db, 'topupRequests', requestId);
  return runTransaction(db, async tx => {
    const reqSnap = await tx.get(requestRef);
    if (!reqSnap.exists()) throw new Error('This request no longer exists.');
    const req = reqSnap.data() as Omit<TopupRequest, 'id'>;
    const status = topupStatus({ id: requestId, ...req });
    if (status !== 'pending') throw new TopupAlreadyReviewedError(status);
    if (!req.driver) throw new Error('The request has no driver uid.');

    const walletRef = doc(db, 'wallets', req.driver);
    const walletSnap = await tx.get(walletRef);
    // The app creates the wallet the first time the driver opens the driver
    // side; the portal never creates one.
    if (!walletSnap.exists()) {
      throw new Error('This driver has no wallet yet, so there is nothing to credit.');
    }

    const balanceAfter = toNum(walletSnap.data().balance) + creditedAmount;
    const entryRef = doc(collection(db, 'wallets', req.driver, 'entries'));

    tx.update(walletRef, { balance: balanceAfter, updatedAt: serverTimestamp() });
    tx.set(entryRef, {
      type: 'topup',
      amount: creditedAmount,
      method: 'bank_transfer',
      reference: requestId,
      by: adminLabel,
      balanceAfter,
      at: serverTimestamp(),
    });
    tx.update(requestRef, {
      status: 'approved',
      creditedAmount,
      reviewedBy: adminLabel,
      reviewedAt: serverTimestamp(),
    });
    return balanceAfter;
  });
};

/** Reject: status and reason only — the wallet is not touched. */
export const rejectTopup = async (
  requestId: string,
  reason: string,
  adminLabel: string,
): Promise<void> => {
  const rejectionReason = reason.trim();
  if (!rejectionReason) throw new Error('Give the driver a reason.');

  const requestRef = doc(db, 'topupRequests', requestId);
  await runTransaction(db, async tx => {
    const snap = await tx.get(requestRef);
    if (!snap.exists()) throw new Error('This request no longer exists.');
    const status = topupStatus({ id: requestId, ...(snap.data() as Omit<TopupRequest, 'id'>) });
    if (status !== 'pending') throw new TopupAlreadyReviewedError(status);
    tx.update(requestRef, {
      status: 'rejected',
      rejectionReason,
      reviewedBy: adminLabel,
      reviewedAt: serverTimestamp(),
    });
  });
};

/** Verify an instant top-up: it checked out. The money is already credited. */
export const verifyTopup = async (requestId: string, adminLabel: string): Promise<void> => {
  const requestRef = doc(db, 'topupRequests', requestId);
  await runTransaction(db, async tx => {
    const snap = await tx.get(requestRef);
    if (!snap.exists()) throw new Error('This request no longer exists.');
    const status = topupStatus({ id: requestId, ...(snap.data() as Omit<TopupRequest, 'id'>) });
    if (status !== 'auto_credited') throw new TopupAlreadyReviewedError(status);
    tx.update(requestRef, {
      status: 'approved',
      reviewedBy: adminLabel,
      reviewedAt: serverTimestamp(),
    });
  });
};

/**
 * Reverse an instant top-up that didn't check out: take the credited amount
 * back out of the wallet (the balance may go negative), undo the safe-limit
 * growth it earned, mark the driver unauthentic, and tell them why. Returns
 * the balance afterwards.
 */
export const reverseTopup = async (
  requestId: string,
  reason: string,
  adminLabel: string,
): Promise<number> => {
  const reversalReason = reason.trim();
  if (!reversalReason) throw new Error('Give the driver a reason.');

  const requestRef = doc(db, 'topupRequests', requestId);
  return runTransaction(db, async tx => {
    const reqSnap = await tx.get(requestRef);
    if (!reqSnap.exists()) throw new Error('This request no longer exists.');
    const req = reqSnap.data() as Omit<TopupRequest, 'id'>;
    const status = topupStatus({ id: requestId, ...req });
    if (status !== 'auto_credited') throw new TopupAlreadyReviewedError(status);
    if (!req.driver) throw new Error('The request has no driver uid.');

    const amount = toNum(req.creditedAmount) || toNum(req.amount);
    if (!(amount > 0)) throw new Error('The request records no credited amount to take back.');
    const walletRef = doc(db, 'wallets', req.driver);
    const walletSnap = await tx.get(walletRef);
    if (!walletSnap.exists()) throw new Error('This driver has no wallet.');

    const balanceAfter = toNum(walletSnap.data().balance) - amount;
    const safeLimitBefore = toNum(req.safeLimitBefore);
    const entryRef = doc(collection(db, 'wallets', req.driver, 'entries'));

    tx.update(walletRef, {
      balance: balanceAfter,
      authentic: false,
      unauthenticReason: reversalReason,
      unauthenticAt: serverTimestamp(),
      ...(safeLimitBefore > 0 ? { safeLimit: safeLimitBefore } : {}),
      updatedAt: serverTimestamp(),
    });
    tx.set(entryRef, {
      type: 'topup_reversal',
      amount: -amount,
      reference: requestId,
      by: adminLabel,
      reason: reversalReason,
      balanceAfter,
      at: serverTimestamp(),
    });
    tx.update(requestRef, {
      status: 'reversed',
      reversalReason,
      reviewedBy: adminLabel,
      reviewedAt: serverTimestamp(),
    });
    return balanceAfter;
  });
};

// ─── per-driver top-up trust (wallets/{uid}) ─────────────────────────────────

export const DEFAULT_MIN_TOPUP = 200;
export const DEFAULT_SAFE_LIMIT = 1000;

export interface TopupTrust {
  minTopup: number;
  safeLimit: number;
  authentic: boolean;
  unauthenticReason: string;
  unauthenticAt: unknown;
}

export const readTopupTrust = (wallet: Record<string, unknown> | undefined): TopupTrust => {
  const pos = (v: unknown, d: number) => (toNum(v) > 0 ? toNum(v) : d);
  return {
    minTopup: pos(wallet?.minTopup, DEFAULT_MIN_TOPUP),
    safeLimit: pos(wallet?.safeLimit, DEFAULT_SAFE_LIMIT),
    authentic: wallet?.authentic !== false,
    unauthenticReason: typeof wallet?.unauthenticReason === 'string' ? wallet.unauthenticReason : '',
    unauthenticAt: wallet?.unauthenticAt,
  };
};

/** A whole number of rupees above zero, or an error message. */
export const trustAmountError = (v: number, what: string): string | null =>
  Number.isInteger(v) && v > 0 ? null : `${what} must be a whole number of rupees above zero.`;

/**
 * Save a driver's minimum, safe limit and authentic flag. Only the fields
 * passed are written, so a safe limit the server raised while the admin was
 * editing something else isn't put back. The rule `safeLimit >= minTopup` is
 * checked against the wallet as it stands inside the transaction. Turning
 * `authentic` back on clears the unauthentic reason and date.
 */
export const saveTopupTrust = async (
  driverUid: string,
  changes: Partial<Pick<TopupTrust, 'minTopup' | 'safeLimit' | 'authentic'>>,
): Promise<void> => {
  if (changes.minTopup !== undefined) {
    const e = trustAmountError(changes.minTopup, 'The minimum top-up');
    if (e) throw new Error(e);
  }
  if (changes.safeLimit !== undefined) {
    const e = trustAmountError(changes.safeLimit, 'The safe limit');
    if (e) throw new Error(e);
  }
  const walletRef = doc(db, 'wallets', driverUid);
  await runTransaction(db, async tx => {
    const snap = await tx.get(walletRef);
    if (!snap.exists()) throw new Error('This driver has no wallet yet, so there is nothing to save to.');
    const current = readTopupTrust(snap.data());
    const minTopup = changes.minTopup ?? current.minTopup;
    const safeLimit = changes.safeLimit ?? current.safeLimit;
    if (safeLimit < minTopup) {
      throw new Error(`The safe limit (${safeLimit}) can't be below the minimum top-up (${minTopup}).`);
    }
    tx.update(walletRef, {
      ...(changes.minTopup !== undefined ? { minTopup: changes.minTopup } : {}),
      ...(changes.safeLimit !== undefined ? { safeLimit: changes.safeLimit } : {}),
      ...(changes.authentic !== undefined ? { authentic: changes.authentic } : {}),
      ...(changes.authentic === true ? { unauthenticReason: deleteField(), unauthenticAt: deleteField() } : {}),
      updatedAt: serverTimestamp(),
    });
  });
};

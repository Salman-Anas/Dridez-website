// ─── Driver bank-transfer top-ups ────────────────────────────────────────────
// A driver pays into `config/paymentAccount`, then files a
// `topupRequests/{autoId}` with the amount and a receipt photo. The portal
// approves it — crediting the wallet and writing a `topup` ledger entry in the
// same transaction — or rejects it with a reason the driver sees in the app.
// Field names and status spellings are matched exactly by the app and the
// security rules; see dridez/schema.md §3.4.1 and §3.4.2.

import {
  collection, doc, runTransaction, serverTimestamp,
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

export type TopupStatus = 'pending' | 'approved' | 'rejected';

export const TOPUP_STATUS_LABEL: Record<TopupStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
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
}

export const topupStatus = (r: TopupRequest): TopupStatus => {
  const s = (r.status || '').toLowerCase().trim();
  return s === 'approved' || s === 'rejected' ? s : 'pending';
};

/** Thrown when a request was reviewed elsewhere between load and click. */
export class TopupAlreadyReviewedError extends Error {
  status: string;
  constructor(status: string) {
    super(`This request has already been ${status}.`);
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
    // The app creates the wallet, with its opening credit, the first time the
    // driver opens the driver side. Creating one here would skip that credit.
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

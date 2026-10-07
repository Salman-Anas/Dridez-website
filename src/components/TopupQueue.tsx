import React, { useEffect, useMemo, useState } from 'react';
import { getDownloadURL, ref } from 'firebase/storage';
import { storage } from '../firebase';
import { formatPKR } from '../utils/rideTaxonomy';
import { toMs, toNum, formatDateTime } from '../utils/firebaseValues';
import { useAdminLabel } from '../utils/adminAuthContext';
import {
  approveTopup, rejectTopup, topupStatus,
  TOPUP_STATUS_LABEL, type TopupRequest, type TopupStatus,
} from '../utils/topupSchema';
import {
  Receipt, CheckCircle, XCircle, Loader, AlertCircle, X, ImageOff, Info, Clock,
} from 'lucide-react';

/** What the queue needs to know about a driver to make a decision. */
export interface TopupDriverInfo {
  name: string;
  phone: string;
  balance: number;
  hasWallet: boolean;
}

type Tab = TopupStatus | 'all';

const TAB_LABEL: Record<Tab, string> = {
  pending: 'Awaiting verification',
  approved: 'Approved',
  rejected: 'Rejected',
  all: 'All',
};

// ─── Receipt thumbnail ───────────────────────────────────────────────────────

/** Older requests may carry only the Storage path, so resolve it if needed. */
const useReceiptUrl = (req: TopupRequest): { url: string | null; failed: boolean } => {
  const [resolved, setResolved] = useState<{ path: string; url: string | null; failed: boolean } | null>(null);
  const path = !req.proofUrl && req.proofPath ? req.proofPath : null;

  useEffect(() => {
    if (!path) return;
    let live = true;
    getDownloadURL(ref(storage, path))
      .then(url => { if (live) setResolved({ path, url, failed: false }); })
      .catch(() => { if (live) setResolved({ path, url: null, failed: true }); });
    return () => { live = false; };
  }, [path]);

  if (req.proofUrl) return { url: req.proofUrl, failed: false };
  if (!path) return { url: null, failed: true };
  if (resolved?.path === path) return { url: resolved.url, failed: resolved.failed };
  return { url: null, failed: false };
};

const ReceiptThumb: React.FC<{ req: TopupRequest; onOpen: (url: string) => void }> = ({ req, onOpen }) => {
  const { url, failed } = useReceiptUrl(req);
  const [broken, setBroken] = useState(false);

  if (url && !broken) {
    return (
      <button className="tq-receipt" onClick={() => onOpen(url)} title="View receipt">
        <img src={url} alt="Payment receipt" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
      </button>
    );
  }
  return (
    <div className="tq-receipt tq-receipt-empty">
      {failed || broken ? <><ImageOff size={18} /><span>No receipt</span></> : <Loader size={16} className="spin" />}
    </div>
  );
};

// ─── One request ─────────────────────────────────────────────────────────────

interface RowProps {
  req: TopupRequest;
  driver: TopupDriverInfo | undefined;
  onOpenReceipt: (url: string) => void;
  onReviewed: (msg: string) => void;
}

const TopupRow: React.FC<RowProps> = ({ req, driver, onOpenReceipt, onReviewed }) => {
  const adminLabel = useAdminLabel();
  const status = topupStatus(req);
  const amount = toNum(req.amount);
  const credited = toNum(req.creditedAmount);

  const [mode, setMode] = useState<'idle' | 'approve' | 'reject'>('idle');
  const [creditDraft, setCreditDraft] = useState(String(amount || ''));
  const [reason, setReason] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');

  const creditValue = Number(creditDraft);
  const creditValid = Number.isFinite(creditValue) && creditValue > 0;

  const fail = (e: unknown) => {
    console.error(e);
    setError(e instanceof Error ? e.message : 'The update failed. Nothing was changed.');
  };

  const approve = async () => {
    if (!creditValid) { setError('Enter the amount to credit.'); return; }
    setWorking(true);
    setError('');
    try {
      const balanceAfter = await approveTopup(req.id, creditValue, adminLabel);
      onReviewed(`${formatPKR(creditValue)} credited to ${driver?.name ?? 'the driver'} — balance now ${formatPKR(balanceAfter)}`);
      setMode('idle');
    } catch (e) {
      fail(e);
    } finally {
      setWorking(false);
    }
  };

  const reject = async () => {
    setWorking(true);
    setError('');
    try {
      await rejectTopup(req.id, reason, adminLabel);
      onReviewed(`Top-up from ${driver?.name ?? 'the driver'} rejected`);
      setMode('idle');
    } catch (e) {
      fail(e);
    } finally {
      setWorking(false);
    }
  };

  const paidTo = req.paidTo ?? {};
  const paidToText = [paidTo.bankName, paidTo.accountNumber || paidTo.iban]
    .map(v => (v === undefined || v === null ? '' : String(v)))
    .filter(Boolean)
    .join(' · ');

  return (
    <div className={`tq-row tq-row-${status}`}>
      <ReceiptThumb req={req} onOpen={onOpenReceipt} />

      <div className="tq-main">
        <div className="tq-driver">
          <strong>{driver?.name ?? `Driver ${(req.driver || '').slice(0, 8)}…`}</strong>
          <span className={`tq-status tq-status-${status}`}>{TOPUP_STATUS_LABEL[status]}</span>
        </div>
        <div className="tq-meta">
          {driver?.phone && <span>{driver.phone}</span>}
          <span><Clock size={11} /> {formatDateTime(req.createdAt)}</span>
          {driver && (
            <span>
              Balance {driver.hasWallet ? formatPKR(driver.balance) : '— no wallet'}
            </span>
          )}
        </div>
        {paidToText && <div className="tq-meta"><span>Paid to {paidToText}</span></div>}

        {status === 'approved' && (
          <div className="tq-meta">
            <span className="text-green">Credited {formatPKR(credited)}</span>
            {credited > 0 && credited !== amount && <span>(claimed {formatPKR(amount)})</span>}
            <span>by {req.reviewedBy || '—'} · {formatDateTime(req.reviewedAt)}</span>
          </div>
        )}
        {status === 'rejected' && (
          <div className="tq-meta">
            <span className="tq-reason">“{req.rejectionReason || 'No reason recorded'}”</span>
            <span>by {req.reviewedBy || '—'} · {formatDateTime(req.reviewedAt)}</span>
          </div>
        )}

        {mode === 'approve' && (
          <div className="tq-form">
            <label className="tq-form-label">Amount to credit — check it matches the receipt</label>
            <div className="tq-form-row">
              <div className="rate-input-wrap tq-input-wrap">
                <span className="rate-input-prefix">PKR</span>
                <input
                  className="rate-input"
                  type="number"
                  min="0"
                  step="1"
                  value={creditDraft}
                  onChange={e => { setCreditDraft(e.target.value); setError(''); }}
                  onKeyDown={e => { if (e.key === 'Enter') void approve(); if (e.key === 'Escape') setMode('idle'); }}
                  autoFocus
                />
              </div>
              <button className="tq-btn tq-btn-approve" onClick={() => { void approve(); }} disabled={working || !creditValid}>
                {working ? <Loader size={15} className="spin" /> : <CheckCircle size={15} />}
                {working ? 'Crediting…' : 'Confirm & credit wallet'}
              </button>
              <button className="tq-btn tq-btn-ghost" onClick={() => setMode('idle')} disabled={working}>Cancel</button>
            </div>
            {creditValid && amount > 0 && creditValue !== amount && (
              <p className="verify-hint" style={{ margin: 0 }}>
                <Info size={12} /> Differs from the {formatPKR(amount)} the driver claimed.
              </p>
            )}
            {driver?.hasWallet && creditValid && (
              <p className="verify-hint" style={{ margin: 0 }}>
                <Info size={12} /> Balance will go from {formatPKR(driver.balance)} to {formatPKR(driver.balance + creditValue)}; the driver gets a push.
              </p>
            )}
          </div>
        )}

        {mode === 'reject' && (
          <div className="tq-form">
            <label className="tq-form-label">Reason <span className="required">*</span> — the driver sees this in the app</label>
            <textarea
              className="form-input form-textarea"
              rows={2}
              placeholder="e.g. The receipt doesn't show a transfer to our account — please upload the bank's confirmation screen."
              value={reason}
              onChange={e => { setReason(e.target.value); setError(''); }}
              autoFocus
            />
            <div className="tq-form-row">
              <button className="tq-btn tq-btn-reject" onClick={() => { void reject(); }} disabled={working || !reason.trim()}>
                {working ? <Loader size={15} className="spin" /> : <XCircle size={15} />}
                {working ? 'Rejecting…' : 'Confirm rejection'}
              </button>
              <button className="tq-btn tq-btn-ghost" onClick={() => setMode('idle')} disabled={working}>Cancel</button>
            </div>
          </div>
        )}

        {error && <div className="rate-error"><AlertCircle size={13} /> {error}</div>}
      </div>

      <div className="tq-side">
        <div className="tq-amount">{formatPKR(amount)}</div>
        <div className="tq-amount-sub">claimed</div>
        {status === 'pending' && mode === 'idle' && (
          <div className="tq-actions">
            <button
              className="tq-btn tq-btn-approve"
              onClick={() => { setCreditDraft(String(amount || '')); setError(''); setMode('approve'); }}
              disabled={driver !== undefined && !driver.hasWallet}
              title={driver !== undefined && !driver.hasWallet ? 'This driver has no wallet to credit' : 'Verify the payment and credit the wallet'}
            >
              <CheckCircle size={15} /> Verify
            </button>
            <button className="tq-btn tq-btn-reject" onClick={() => { setError(''); setMode('reject'); }}>
              <XCircle size={15} /> Reject
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Queue ───────────────────────────────────────────────────────────────────

interface QueueProps {
  requests: TopupRequest[];
  loading: boolean;
  error: string;
  drivers: Map<string, TopupDriverInfo>;
  onReviewed: () => void;
}

export const TopupQueue: React.FC<QueueProps> = ({ requests, loading, error, drivers, onReviewed }) => {
  const [tab, setTab] = useState<Tab>('pending');
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const counts = useMemo(() => {
    const c: Record<Tab, number> = { pending: 0, approved: 0, rejected: 0, all: requests.length };
    for (const r of requests) c[topupStatus(r)] += 1;
    return c;
  }, [requests]);

  const visible = useMemo(() => {
    const list = tab === 'all' ? requests : requests.filter(r => topupStatus(r) === tab);
    // Pending: oldest first, so nobody waits past the "one working day" promise.
    return [...list].sort((a, b) => tab === 'pending'
      ? toMs(a.createdAt) - toMs(b.createdAt)
      : toMs(b.reviewedAt ?? b.createdAt) - toMs(a.reviewedAt ?? a.createdAt));
  }, [requests, tab]);

  const handleReviewed = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4500);
    onReviewed();
  };

  return (
    <div className="stat-section tq-section">
      <h2 className="section-title">
        <Receipt size={22} />
        <span>Payment Verification</span>
        <span className="rate-badge-title" style={counts.pending
          ? { background: 'rgba(217, 119, 6, 0.12)', color: 'var(--accent-orange)' }
          : undefined}
        >
          {counts.pending} awaiting
        </span>
      </h2>

      <div className="dv-filter-row" style={{ marginBottom: '1rem' }}>
        {(Object.keys(TAB_LABEL) as Tab[]).map(t => (
          <button key={t} className={`dv-filter-pill ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
            {TAB_LABEL[t]}
            <span className="dv-pill-count">{counts[t]}</span>
          </button>
        ))}
      </div>

      {toast && (
        <div className="rate-status rate-status-ok" style={{ marginBottom: '0.75rem' }}>
          <CheckCircle size={13} /><span>{toast}</span>
        </div>
      )}

      {error ? (
        <div className="rate-alert rate-alert-error">
          <AlertCircle size={20} />
          <div><strong>Top-up requests could not be loaded</strong><p>{error}</p></div>
        </div>
      ) : loading ? (
        <div className="pa-loading"><Loader size={16} className="spin" /> Loading top-up requests…</div>
      ) : visible.length === 0 ? (
        <p className="modal-no-data">
          {tab === 'pending'
            ? 'No payments are waiting to be verified.'
            : `No ${tab === 'all' ? '' : TAB_LABEL[tab].toLowerCase() + ' '}top-up requests.`}
        </p>
      ) : (
        <div className="tq-list">
          {visible.map(r => (
            <TopupRow
              key={r.id}
              req={r}
              driver={r.driver ? drivers.get(r.driver) : undefined}
              onOpenReceipt={setLightbox}
              onReviewed={handleReviewed}
            />
          ))}
        </div>
      )}

      {lightbox && (
        <div className="lightbox-overlay" onClick={() => setLightbox(null)}>
          <button className="lightbox-close" onClick={() => setLightbox(null)}><X size={22} /></button>
          <img src={lightbox} alt="Payment receipt" className="lightbox-img" onClick={e => e.stopPropagation()} referrerPolicy="no-referrer" />
          <a href={lightbox} target="_blank" rel="noopener noreferrer" className="lightbox-link" onClick={e => e.stopPropagation()}>
            Open original in new tab
          </a>
        </div>
      )}
    </div>
  );
};

export default TopupQueue;

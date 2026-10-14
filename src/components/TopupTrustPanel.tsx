import React, { useEffect, useRef, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { formatPKR } from '../utils/rideTaxonomy';
import { formatDateTime } from '../utils/firebaseValues';
import {
  readTopupTrust, saveTopupTrust, trustAmountError, DEFAULT_MIN_TOPUP, DEFAULT_SAFE_LIMIT,
  type TopupTrust,
} from '../utils/topupSchema';
import { AlertCircle, CheckCircle, Info, Loader, ShieldCheck, ShieldAlert, Save } from 'lucide-react';

type Baseline = Pick<TopupTrust, 'minTopup' | 'safeLimit' | 'authentic'>;

/**
 * A driver's top-up trust settings on `wallets/{uid}`: the minimum top-up,
 * the safe limit (largest top-up the `requestTopup` function credits
 * instantly) and whether the driver is authentic. Kept live, since the safe
 * limit grows on its own after every instant top-up. See dridez/schema.md §3.3.
 */
export const TopupTrustPanel: React.FC<{
  uid: string;
  /** Called with every live reading of the wallet's settings. */
  onTrust?: (trust: TopupTrust) => void;
}> = ({ uid, onTrust }) => {
  // undefined: still loading; null: no wallet document.
  const [trust, setTrust] = useState<TopupTrust | null | undefined>(undefined);
  const [minDraft, setMinDraft] = useState('');
  const [limitDraft, setLimitDraft] = useState('');
  const [authenticDraft, setAuthenticDraft] = useState(true);
  const [dirty, setDirtyState] = useState(false);
  const dirtyRef = useRef(false);
  const setDirty = (d: boolean) => { dirtyRef.current = d; setDirtyState(d); };
  // What the inputs were filled from, so a save writes only what the admin
  // actually changed.
  const baseline = useRef<Baseline | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const onTrustRef = useRef(onTrust);
  useEffect(() => { onTrustRef.current = onTrust; });

  useEffect(() => {
    return onSnapshot(
      doc(db, 'wallets', uid),
      snap => {
        if (!snap.exists()) { setTrust(null); return; }
        const t = readTopupTrust(snap.data());
        setTrust(t);
        onTrustRef.current?.(t);
        // Don't overwrite what the admin is in the middle of typing.
        if (!dirtyRef.current) {
          baseline.current = { minTopup: t.minTopup, safeLimit: t.safeLimit, authentic: t.authentic };
          setMinDraft(String(t.minTopup));
          setLimitDraft(String(t.safeLimit));
          setAuthenticDraft(t.authentic);
        }
      },
      err => {
        console.error(err);
        setError('Could not read this wallet.');
        setTrust(prev => (prev === undefined ? null : prev));
      },
    );
  }, [uid]);

  const edit = (fn: () => void) => { fn(); setDirty(true); setSaved(false); setError(''); };

  const minValue = Number(minDraft);
  const limitValue = Number(limitDraft);
  const validation =
    trustAmountError(minValue, 'The minimum top-up')
    ?? trustAmountError(limitValue, 'The safe limit')
    ?? (limitValue < minValue ? 'The safe limit can\'t be below the minimum top-up.' : null);

  const save = async () => {
    const base = baseline.current;
    if (validation || !base) return;
    setSaving(true);
    setError('');
    try {
      await saveTopupTrust(uid, {
        ...(minValue !== base.minTopup ? { minTopup: minValue } : {}),
        ...(limitValue !== base.safeLimit ? { safeLimit: limitValue } : {}),
        ...(authenticDraft !== base.authentic ? { authentic: authenticDraft } : {}),
      });
      setDirty(false);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Saving failed. Nothing was changed.');
    } finally {
      setSaving(false);
    }
  };

  const discard = () => {
    setDirty(false);
    setError('');
    if (trust) {
      baseline.current = { minTopup: trust.minTopup, safeLimit: trust.safeLimit, authentic: trust.authentic };
      setMinDraft(String(trust.minTopup));
      setLimitDraft(String(trust.safeLimit));
      setAuthenticDraft(trust.authentic);
    }
  };

  if (trust === undefined) {
    return <div className="pa-loading"><Loader size={16} className="spin" /> Loading top-up settings…</div>;
  }
  if (trust === null) {
    return (
      <p className="modal-no-data" style={{ marginTop: '1rem' }}>
        {error || 'This driver has no wallet yet, so there are no top-up settings to change. The app creates the wallet the first time they open the driver side.'}
      </p>
    );
  }

  const base = baseline.current;
  const movedWhileEditing = dirty && base && (
    trust.safeLimit !== base.safeLimit || trust.minTopup !== base.minTopup || trust.authentic !== base.authentic
  );

  return (
    <div style={{ marginTop: '1rem' }}>
      <div className={`rate-status ${trust.authentic ? 'rate-status-ok' : 'rate-status-error'}`}>
        {trust.authentic ? <ShieldCheck size={13} /> : <ShieldAlert size={13} />}
        <span>
          {trust.authentic
            ? `Authentic — top-ups from ${formatPKR(trust.minTopup)} up to ${formatPKR(trust.safeLimit)} are added instantly and checked afterwards.`
            : <>
                Unauthentic — every top-up waits for manual verification.
                {trust.unauthenticReason && <> Reason: “{trust.unauthenticReason}”</>}
                {trust.unauthenticAt ? <> · since {formatDateTime(trust.unauthenticAt)}</> : null}
              </>}
        </span>
      </div>

      <div className="modal-details-grid" style={{ marginTop: '0.75rem' }}>
        <div className="detail-item">
          <span className="di-label">Minimum top-up (default {formatPKR(DEFAULT_MIN_TOPUP)})</span>
          <div className="rate-input-wrap">
            <span className="rate-input-prefix">PKR</span>
            <input
              className="rate-input" type="number" min="1" step="1"
              value={minDraft}
              onChange={e => edit(() => setMinDraft(e.target.value))}
            />
          </div>
        </div>
        <div className="detail-item">
          <span className="di-label">Safe limit (default {formatPKR(DEFAULT_SAFE_LIMIT)})</span>
          <div className="rate-input-wrap">
            <span className="rate-input-prefix">PKR</span>
            <input
              className="rate-input" type="number" min="1" step="1"
              value={limitDraft}
              onChange={e => edit(() => setLimitDraft(e.target.value))}
            />
          </div>
        </div>
        <div className="detail-item" style={{ gridColumn: '1 / -1' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={authenticDraft}
              onChange={e => edit(() => setAuthenticDraft(e.target.checked))}
            />
            <span>Authentic driver (allow instant top-ups)</span>
          </label>
          {!trust.authentic && authenticDraft && (
            <span className="verify-hint" style={{ margin: '0.35rem 0 0' }}>
              <Info size={12} /> Saving clears the unauthentic reason and date.
            </span>
          )}
        </div>
      </div>

      <p className="verify-hint" style={{ margin: '0.5rem 0 0' }}>
        <Info size={12} /> The server raises the safe limit by 20% of every instant top-up.
      </p>
      {movedWhileEditing && (
        <div className="rate-status rate-status-warn" style={{ marginTop: '0.5rem' }}>
          <AlertCircle size={13} />
          <span>
            The wallet changed while you were editing (now: minimum {formatPKR(trust.minTopup)}, safe
            limit {formatPKR(trust.safeLimit)}, {trust.authentic ? 'authentic' : 'unauthentic'}). Saving
            writes only the fields you changed.
          </span>
        </div>
      )}

      <div className="tq-form-row" style={{ marginTop: '0.75rem' }}>
        <button className="tq-btn tq-btn-approve" onClick={() => { void save(); }} disabled={!dirty || saving || Boolean(validation)}>
          {saving ? <Loader size={15} className="spin" /> : <Save size={15} />}
          {saving ? 'Saving…' : 'Save top-up settings'}
        </button>
        {dirty && !saving && <button className="tq-btn tq-btn-ghost" onClick={discard}>Discard</button>}
        {saved && <span style={{ color: 'var(--accent-green)', display: 'inline-flex', alignItems: 'center', gap: 4 }}><CheckCircle size={13} /> Saved</span>}
      </div>
      {dirty && validation && <div className="rate-error"><AlertCircle size={13} /> {validation}</div>}
      {error && <div className="rate-error"><AlertCircle size={13} /> {error}</div>}
    </div>
  );
};

export default TopupTrustPanel;

import React, { useEffect, useState } from 'react';
import { onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import {
  EMPTY_PAYMENT_ACCOUNT, PAYMENT_ACCOUNT_DOC, paymentAccountUsable, readPaymentAccount,
  type PaymentAccount,
} from '../utils/topupSchema';
import { useAdminLabel } from '../utils/adminAuthContext';
import {
  Landmark, Edit3, Check, X, Loader, AlertTriangle, AlertCircle, CheckCircle,
} from 'lucide-react';

const FIELDS: { key: keyof PaymentAccount; label: string; placeholder: string; required?: boolean; wide?: boolean }[] = [
  { key: 'bankName',      label: 'Bank / wallet',  placeholder: 'e.g. Meezan Bank or JazzCash', required: true },
  { key: 'accountTitle',  label: 'Account title',  placeholder: 'Name on the account', required: true },
  { key: 'accountNumber', label: 'Account number', placeholder: 'e.g. 01234567890123' },
  { key: 'iban',          label: 'IBAN',           placeholder: 'Optional — e.g. PK36MEZN0001234567890123' },
  { key: 'note',          label: 'Note to drivers', placeholder: 'Optional — e.g. Put your phone number in the reference', wide: true },
];

/**
 * `config/paymentAccount` — the account drivers are shown on the app's
 * *Add balance* screen and pay their top-ups into.
 */
export const PaymentAccountPanel: React.FC = () => {
  const adminLabel = useAdminLabel();
  const [account, setAccount] = useState<PaymentAccount>(EMPTY_PAYMENT_ACCOUNT);
  const [exists, setExists] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<PaymentAccount>(EMPTY_PAYMENT_ACCOUNT);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => onSnapshot(
    PAYMENT_ACCOUNT_DOC,
    snap => {
      setExists(snap.exists());
      setAccount(readPaymentAccount(snap.data()));
      setLoadError('');
      setLoading(false);
    },
    err => {
      console.error(err);
      setLoadError('Could not read config/paymentAccount.');
      setLoading(false);
    },
  ), []);

  const startEdit = () => {
    setDraft(account);
    setError('');
    setSaved(false);
    setEditing(true);
  };

  const save = async () => {
    const clean: PaymentAccount = {
      bankName: draft.bankName.trim(),
      accountTitle: draft.accountTitle.trim(),
      // Spaces and dashes are how people copy numbers, not part of them.
      accountNumber: draft.accountNumber.replace(/[\s-]/g, ''),
      iban: draft.iban.replace(/\s/g, '').toUpperCase(),
      note: draft.note.trim(),
    };
    if (!clean.bankName || !clean.accountTitle) {
      setError('Bank name and account title are required.');
      return;
    }
    if (!paymentAccountUsable(clean)) {
      setError('Enter an account number or an IBAN — without either, drivers cannot submit a top-up.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      // A full overwrite, so a cleared optional field is removed rather than
      // left behind with its old value.
      const data: Record<string, unknown> = {
        bankName: clean.bankName,
        accountTitle: clean.accountTitle,
        updatedAt: serverTimestamp(),
        updatedBy: adminLabel,
      };
      if (clean.accountNumber) data.accountNumber = clean.accountNumber;
      if (clean.iban) data.iban = clean.iban;
      if (clean.note) data.note = clean.note;
      await setDoc(PAYMENT_ACCOUNT_DOC, data);
      setEditing(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 4000);
    } catch (e) {
      console.error(e);
      setError('Saving failed. Confirm your account carries the admin claim and try again.');
    } finally {
      setSaving(false);
    }
  };

  const usable = paymentAccountUsable(account);

  return (
    <div className={`pa-panel ${!loading && !usable ? 'pa-panel-missing' : ''}`}>
      <div className="pa-head">
        <div className="pa-title">
          <span className="pa-icon"><Landmark size={20} /></span>
          <div>
            <strong>Bank account for driver top-ups</strong>
            <span>Shown to drivers on the app's <em>Add balance</em> screen · <span className="mono">config/paymentAccount</span></span>
          </div>
        </div>
        {!editing && !loading && (
          <button className="rate-edit-btn" onClick={startEdit}>
            <Edit3 size={14} /> {exists ? 'Edit account' : 'Set account'}
          </button>
        )}
      </div>

      {loading ? (
        <div className="pa-loading"><Loader size={16} className="spin" /> Loading…</div>
      ) : loadError ? (
        <div className="rate-status rate-status-error"><AlertTriangle size={13} /><span>{loadError}</span></div>
      ) : editing ? (
        <div className="pa-form">
          <div className="pa-form-grid">
            {FIELDS.map(f => (
              <label key={f.key} className={`pa-field ${f.wide ? 'pa-field-wide' : ''}`}>
                <span>{f.label}{f.required && <span className="required"> *</span>}</span>
                <input
                  className="form-input"
                  value={draft[f.key]}
                  placeholder={f.placeholder}
                  onChange={e => { setDraft(d => ({ ...d, [f.key]: e.target.value })); setError(''); }}
                  onKeyDown={e => { if (e.key === 'Escape') setEditing(false); }}
                  inputMode={f.key === 'accountNumber' ? 'numeric' : undefined}
                />
              </label>
            ))}
          </div>
          <p className="verify-hint" style={{ margin: 0 }}>
            <AlertCircle size={12} /> Enter at least an account number or an IBAN. Changes reach drivers immediately —
            requests already filed keep the account they were paid to.
          </p>
          {error && <div className="rate-error"><AlertCircle size={13} /> {error}</div>}
          <div className="rate-edit-actions">
            <button className="rate-save-btn" onClick={() => { void save(); }} disabled={saving}>
              {saving ? <Loader size={14} className="spin" /> : <Check size={15} />}
              {saving ? 'Saving…' : 'Save account'}
            </button>
            <button className="rate-cancel-btn" onClick={() => setEditing(false)} disabled={saving}>
              <X size={14} /> Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          {!usable && (
            <div className="rate-status rate-status-error">
              <AlertTriangle size={13} />
              <span>
                No account number or IBAN is set — the app tells drivers payment details are
                unavailable and will not accept a top-up request.
              </span>
            </div>
          )}
          {(exists || usable) && (
            <div className="pa-details">
              <div><span>Bank</span><strong>{account.bankName || '—'}</strong></div>
              <div><span>Title</span><strong>{account.accountTitle || '—'}</strong></div>
              <div><span>Account no.</span><strong className="mono">{account.accountNumber || '—'}</strong></div>
              <div><span>IBAN</span><strong className="mono">{account.iban || '—'}</strong></div>
              {account.note && <div className="pa-field-wide"><span>Note</span><strong>{account.note}</strong></div>}
            </div>
          )}
          {saved && (
            <div className="rate-status rate-status-ok"><CheckCircle size={13} /><span>Saved — drivers now see this account.</span></div>
          )}
        </>
      )}
    </div>
  );
};

export default PaymentAccountPanel;

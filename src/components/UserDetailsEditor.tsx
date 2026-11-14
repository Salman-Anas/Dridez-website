import React, { useState } from 'react';
import { AlertCircle, Loader, Save, UserPen, X } from 'lucide-react';
import {
  detailsOf, saveUserDetails, type UserDetails, type UserDetailsSource,
} from '../utils/userDetailsSchema';

/**
 * Lets an admin correct a user's name, ID name, phone, CNIC and address
 * (schema §3.1). Opens over the user's drawer; `onSaved` gets the fields that
 * were written so the page can update its list without a reload.
 */
export const UserDetailsEditor: React.FC<{
  uid: string;
  user: UserDetailsSource & { email?: string };
  onClose: () => void;
  onSaved: (changes: Partial<UserDetails> & { name?: string }) => void;
}> = ({ uid, user, onClose, onSaved }) => {
  const [form, setForm] = useState<UserDetails>(() => detailsOf(user));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const field = (key: keyof UserDetails) => ({
    id: `ue-${key}`,
    value: form[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setError(null);
      setForm(f => ({ ...f, [key]: e.target.value }));
    },
    disabled: saving,
  });

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const changes = await saveUserDetails(uid, user, form);
      if (Object.keys(changes).length) onSaved(changes);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the details.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={() => { if (!saving) onClose(); }}>
      <form
        className="modal-drawer nt-drawer ue-drawer"
        role="dialog" aria-modal="true" aria-labelledby="ue-title"
        onClick={e => e.stopPropagation()}
        onSubmit={e => { e.preventDefault(); void save(); }}
      >
        <div className="modal-header nt-header">
          <div className="nt-header-title">
            <span className="nt-header-icon"><UserPen size={15} /></span>
            <h2 id="ue-title">Edit details</h2>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} disabled={saving} aria-label="Close"><X size={16} /></button>
        </div>

        <div className="modal-body nt-body">
          <section className="nt-block">
            <div className="ue-row">
              <div>
                <label className="nt-label" htmlFor="ue-firstName">First name</label>
                <input className="form-input" autoComplete="off" {...field('firstName')} />
              </div>
              <div>
                <label className="nt-label" htmlFor="ue-lastName">Last name</label>
                <input className="form-input" autoComplete="off" {...field('lastName')} />
              </div>
            </div>
            <label className="nt-label ue-gap" htmlFor="ue-verifiedName">Name on ID</label>
            <input className="form-input" autoComplete="off" {...field('verifiedName')} />
            <p className="nt-hint">As printed on the CNIC.</p>
          </section>

          <section className="nt-block">
            <label className="nt-label" htmlFor="ue-phone">Phone</label>
            <input className="form-input" inputMode="tel" placeholder="03XXXXXXXXX" maxLength={13} autoComplete="off" {...field('phone')} />
            <p className="nt-hint">Users can&apos;t change this in the app, so fix it here when they ask.</p>
            <label className="nt-label ue-gap" htmlFor="ue-cnic">CNIC</label>
            <input className="form-input" inputMode="numeric" placeholder="13 digits, no dashes" maxLength={15} autoComplete="off" {...field('cnic')} />
            <label className="nt-label ue-gap" htmlFor="ue-address">Address</label>
            <textarea className="form-input form-textarea" rows={3} {...field('address')} />
          </section>

          <section className="nt-block">
            <span className="nt-label">Email</span>
            <div className="ue-readonly">{user.email || '—'}</div>
            <p className="nt-hint">
              The email is their sign-in address, so it can&apos;t be changed here.
              Saving doesn&apos;t change their verification status.
            </p>
          </section>
        </div>

        <div className="nt-footer">
          {error && <div className="rate-error"><AlertCircle size={13} /> {error}</div>}
          <button type="submit" className="nt-send" disabled={saving}>
            {saving ? <Loader size={15} className="spin" /> : <Save size={15} />}
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>
    </div>
  );
};

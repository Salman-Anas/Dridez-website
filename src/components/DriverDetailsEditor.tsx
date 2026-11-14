import React, { useState } from 'react';
import { AlertCircle, Loader, Save, UserPen, X } from 'lucide-react';
import {
  driverDetailsOf, saveDriverDetails, SEAT_RANGE,
  type DriverAccountSource, type DriverDetails, type DriverDetailsChanges,
} from '../utils/driverDetailsSchema';
import { getVehicleType, VEHICLE_TYPE_LABEL, type DriverApplicationFields } from '../utils/driverSchema';

/**
 * Lets an admin correct a driver's name, phone, CNIC, vehicle and ownership
 * details (schema §3.1, §3.2). `onSaved` gets what was written to each
 * document so the page can update without a reload.
 */
export const DriverDetailsEditor: React.FC<{
  uid: string;
  appId: string;
  app: DriverApplicationFields;
  account: DriverAccountSource | null;
  onClose: () => void;
  onSaved: (changes: DriverDetailsChanges) => void;
}> = ({ uid, appId, app, account, onClose, onSaved }) => {
  const [form, setForm] = useState<DriverDetails>(() => driverDetailsOf(app, account));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const vehicleType = getVehicleType(app);
  const seatRange = SEAT_RANGE[vehicleType];

  const set = <K extends keyof DriverDetails>(key: K, value: DriverDetails[K]) => {
    setError(null);
    setForm(f => ({ ...f, [key]: value }));
  };
  const field = (key: keyof DriverDetails) => ({
    id: `de-${key}`,
    value: form[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => set(key, e.target.value as never),
    disabled: saving,
    autoComplete: 'off',
  });

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const changes = await saveDriverDetails({ uid, appId, app, account, form });
      if (Object.keys(changes.account).length || Object.keys(changes.application).length) onSaved(changes);
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
        role="dialog" aria-modal="true" aria-labelledby="de-title"
        onClick={e => e.stopPropagation()}
        onSubmit={e => { e.preventDefault(); void save(); }}
      >
        <div className="modal-header nt-header">
          <div className="nt-header-title">
            <span className="nt-header-icon"><UserPen size={15} /></span>
            <h2 id="de-title">Edit driver details</h2>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} disabled={saving} aria-label="Close"><X size={16} /></button>
        </div>

        <div className="modal-body nt-body">
          <section className="nt-block">
            <h3 className="nt-label">Driver</h3>
            <div className="ue-row">
              <div>
                <label className="nt-label" htmlFor="de-firstName">First name</label>
                <input className="form-input" {...field('firstName')} />
              </div>
              <div>
                <label className="nt-label" htmlFor="de-lastName">Last name</label>
                <input className="form-input" {...field('lastName')} />
              </div>
            </div>
            <div className="ue-row ue-gap">
              <div>
                <label className="nt-label" htmlFor="de-phone">Phone</label>
                <input className="form-input" inputMode="tel" placeholder="03XXXXXXXXX" maxLength={13} {...field('phone')} />
              </div>
              <div>
                <label className="nt-label" htmlFor="de-cnic">CNIC</label>
                <input className="form-input" inputMode="numeric" placeholder="13 digits" maxLength={15} {...field('cnic')} />
              </div>
            </div>
            <p className="nt-hint">{account ? 'Saved on the account and on the application.' : 'There is no account document, so only the application is updated.'}</p>
          </section>

          <section className="nt-block">
            <h3 className="nt-label">Vehicle <em>· {VEHICLE_TYPE_LABEL[vehicleType]}</em></h3>
            {vehicleType === 'car' && (
              <>
                <div className="nt-kinds" role="radiogroup" aria-label="Car class">
                  {(['mini', 'comfort'] as const).map(c => (
                    <button
                      key={c} type="button" role="radio" aria-checked={form.carClass === c}
                      className={`nt-kind ${form.carClass === c ? 'active' : ''}`}
                      onClick={() => set('carClass', c)} disabled={saving}
                    >
                      {c === 'mini' ? 'Mini' : 'Comfort'}
                    </button>
                  ))}
                </div>
                <p className="nt-hint">The car class decides which fares they&apos;re offered, from the moment you save.</p>
              </>
            )}
            <div className="ue-row ue-gap">
              <div>
                <label className="nt-label" htmlFor="de-company">Company</label>
                <input className="form-input" {...field('company')} />
              </div>
              <div>
                <label className="nt-label" htmlFor="de-model">Model</label>
                <input className="form-input" {...field('model')} />
              </div>
            </div>
            <div className="ue-row ue-gap">
              <div>
                <label className="nt-label" htmlFor="de-variant">Variant</label>
                <input className="form-input" {...field('variant')} />
              </div>
              <div>
                <label className="nt-label" htmlFor="de-engineCc">Engine (cc)</label>
                <input className="form-input" inputMode="numeric" maxLength={4} {...field('engineCc')} />
              </div>
            </div>
            <div className="ue-row ue-gap">
              <div>
                <label className="nt-label" htmlFor="de-plate">Number plate</label>
                <input className="form-input ue-upper" {...field('plate')} />
              </div>
              {seatRange && (
                <div>
                  <label className="nt-label" htmlFor="de-seats">Seats <em>({seatRange.min}–{seatRange.max})</em></label>
                  <input className="form-input" inputMode="numeric" maxLength={1} {...field('seats')} />
                </div>
              )}
            </div>
          </section>

          <section className="nt-block">
            <h3 className="nt-label">Ownership</h3>
            <div className="nt-kinds" role="radiogroup" aria-label="Who owns the vehicle">
              {([['owner', 'Owns it'], ['driver', 'Drives for the owner']] as const).map(([key, label]) => (
                <button
                  key={key} type="button" role="radio" aria-checked={form.ownership === key}
                  className={`nt-kind ${form.ownership === key ? 'active' : ''}`}
                  onClick={() => set('ownership', key)} disabled={saving}
                >
                  {label}
                </button>
              ))}
            </div>
            {form.ownership === '' && <p className="nt-hint">Not asked on this older application.</p>}
            {form.ownership === 'driver' && (
              <div className="ue-row ue-gap">
                <div>
                  <label className="nt-label" htmlFor="de-ownerName">Owner&apos;s name</label>
                  <input className="form-input" {...field('ownerName')} />
                </div>
                <div>
                  <label className="nt-label" htmlFor="de-ownerCnic">Owner&apos;s CNIC</label>
                  <input className="form-input" inputMode="numeric" placeholder="13 digits" maxLength={15} {...field('ownerCnic')} />
                </div>
              </div>
            )}
            <p className="nt-hint">
              The vehicle type and documents can&apos;t be changed here; a different vehicle needs a new application.
              Saving doesn&apos;t change the review status.
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

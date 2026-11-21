import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  collection, deleteDoc, doc, getDocs, serverTimestamp, setDoc, writeBatch,
} from 'firebase/firestore';
import {
  AlertCircle, CheckCircle, Copy, Globe2, Loader, MapPin, Plus, RefreshCw, Save, Search,
  Trash2, Undo2, X,
} from 'lucide-react';

import { db } from '../firebase';
import { useAdminLabel } from '../utils/adminAuthContext';
import {
  CITY_TYPES, DISTRICTS, NATIONAL_ZONE, PROVINCES, SEAT_SHARE, VEHICLE_TYPES,
  cleanRule, copyRule, emptyRule, fareForRule, parseCommission, roundFare,
  type FareRule, type FareZoneDoc,
} from '../utils/fareZones';

/* ─── Helpers ──────────────────────────────────────────────────────────────── */

const zoneName = (id: string): string =>
  id === NATIONAL_ZONE ? 'National (all districts)' : DISTRICTS.find(d => d.id === id)?.name ?? id;

const pkr = (n: number) => 'PKR ' + Math.round(n).toLocaleString();

/** What's being edited: each type either has its own rule or follows the national one. */
interface Draft {
  vehicles: Record<string, FareRule | null>;
  cityToCity: Record<string, FareRule | null>;
  /** Percent as typed ("10"), '' for "follow national". */
  commission: string;
  ctcCommission: string;
}

function toDraft(d: FareZoneDoc | undefined): Draft {
  const vehicles: Record<string, FareRule | null> = {};
  for (const v of VEHICLE_TYPES) vehicles[v.key] = cleanRule(d?.vehicles?.[v.key]);
  const cityToCity: Record<string, FareRule | null> = {};
  for (const c of CITY_TYPES) cityToCity[c.key] = cleanRule(d?.cityToCity?.[c.key]);
  const pct = (v: unknown) => {
    const r = parseCommission(v);
    return r == null ? '' : String(Math.round(r * 10000) / 100);
  };
  return { vehicles, cityToCity, commission: pct(d?.commission), ctcCommission: pct(d?.ctcCommission) };
}

/** The document to store for a draft — only the types with a price of their own. */
function fromDraft(id: string, draft: Draft): Record<string, unknown> {
  const pick = (m: Record<string, FareRule | null>) => {
    const out: Record<string, FareRule> = {};
    for (const [k, r] of Object.entries(m)) {
      const clean = r && cleanRule(r);
      if (clean) out[k] = clean;
    }
    return out;
  };
  const district = DISTRICTS.find(d => d.id === id);
  const fraction = (pct: string) => {
    const n = Number(pct);
    return pct.trim() && Number.isFinite(n) && n > 0 && n < 100 ? Math.round(n * 100) / 10000 : null;
  };
  return {
    name: district?.name ?? 'National',
    province: district?.province ?? '',
    vehicles: pick(draft.vehicles),
    cityToCity: pick(draft.cityToCity),
    commission: fraction(draft.commission),
    ctcCommission: fraction(draft.ctcCommission),
  };
}

/** What's wrong with a draft, if anything — checked before it's saved. */
function problems(draft: Draft): string[] {
  const out: string[] = [];
  const check = (label: string, r: FareRule | null) => {
    if (!r) return;
    if (!cleanRule(r)) out.push(`${label}: enter a base fare or a per-km rate`);
    const seen = new Set<number>();
    for (const s of r.steps) {
      if (!(s.fromKm > 0)) out.push(`${label}: every rate change needs a distance above 0 km`);
      if (s.fromKm > 0 && s.fromKm <= r.thresholdKm) out.push(`${label}: a rate change at ${s.fromKm} km is inside the base-fare distance (${r.thresholdKm} km)`);
      if (seen.has(s.fromKm)) out.push(`${label}: two rate changes at ${s.fromKm} km`);
      seen.add(s.fromKm);
    }
  };
  for (const v of VEHICLE_TYPES) check(v.label, draft.vehicles[v.key]);
  for (const c of CITY_TYPES) check(`City to city · ${c.label}`, draft.cityToCity[c.key]);
  for (const [label, pct] of [['In-city commission', draft.commission], ['City-to-city commission', draft.ctcCommission]]) {
    const n = Number(pct);
    if (pct.trim() && !(Number.isFinite(n) && n > 0 && n < 100)) out.push(`${label}: enter a percentage between 0 and 100`);
  }
  return out;
}

/* ─── Number input ─────────────────────────────────────────────────────────── */

const NumField: React.FC<{
  label: string; value: number; suffix?: string; prefix?: string; disabled?: boolean; onChange: (n: number) => void;
}> = ({ label, value, suffix, prefix, disabled, onChange }) => (
  <label className="fz-field">
    <span className="fz-field-label">{label}</span>
    <span className="fz-input-wrap">
      {prefix && <span className="fz-affix">{prefix}</span>}
      <input
        type="number"
        min="0"
        step="any"
        className="fz-input"
        value={value ? String(value) : ''}
        placeholder="0"
        disabled={disabled}
        onChange={e => onChange(Math.max(0, Number(e.target.value) || 0))}
      />
      {suffix && <span className="fz-affix">{suffix}</span>}
    </span>
  </label>
);

/* ─── One rule (vehicle or city-to-city) ───────────────────────────────────── */

const RuleEditor: React.FC<{
  label: string;
  hint?: string;
  rule: FareRule | null;
  /** What applies when this zone has no rule of its own (the national one). */
  inherited: FareRule | null;
  isNational: boolean;
  allowSteps: boolean;
  examples: number[];
  onChange: (r: FareRule | null) => void;
}> = ({ label, hint, rule, inherited, isNational, allowSteps, examples, onChange }) => {
  const own = rule != null;
  const shown = rule ?? inherited ?? emptyRule();
  const set = (patch: Partial<FareRule>) => onChange({ ...(rule ?? emptyRule()), ...patch });
  const effective = cleanRule(shown);

  return (
    <div className={`fz-rule ${own ? 'fz-rule-own' : 'fz-rule-inherited'}`}>
      <div className="fz-rule-head">
        <div>
          <div className="fz-rule-title">{label}</div>
          {hint && <div className="fz-rule-hint">{hint}</div>}
        </div>
        {!isNational && (
          <label className="fz-toggle">
            <input
              type="checkbox"
              checked={own}
              onChange={e => onChange(e.target.checked ? copyRule(inherited ?? emptyRule()) : null)}
            />
            <span>{own ? 'Own price' : 'Uses national price'}</span>
          </label>
        )}
      </div>

      <div className="fz-rule-fields">
        <NumField label="Base fare" prefix="PKR" value={shown.base} disabled={!isNational && !own} onChange={n => set({ base: n })} />
        <NumField label="Base fare covers up to" suffix="km" value={shown.thresholdKm} disabled={!isNational && !own} onChange={n => set({ thresholdKm: n })} />
        <NumField label="Then per km" prefix="PKR" suffix="/km" value={shown.perKm} disabled={!isNational && !own} onChange={n => set({ perKm: n })} />
      </div>

      {allowSteps && (
        <div className="fz-steps">
          {shown.steps.map((s, i) => (
            <div className="fz-step" key={i}>
              <span className="fz-step-label">From</span>
              <NumField label="" suffix="km" value={s.fromKm} disabled={!isNational && !own}
                onChange={n => set({ steps: shown.steps.map((x, j) => (j === i ? { ...x, fromKm: n } : x)) })} />
              <span className="fz-step-label">charge</span>
              <NumField label="" prefix="PKR" suffix="/km" value={s.perKm} disabled={!isNational && !own}
                onChange={n => set({ steps: shown.steps.map((x, j) => (j === i ? { ...x, perKm: n } : x)) })} />
              {(isNational || own) && (
                <button className="fz-icon-btn" title="Remove this rate change"
                  onClick={() => set({ steps: shown.steps.filter((_, j) => j !== i) })}>
                  <X size={14} />
                </button>
              )}
            </div>
          ))}
          {(isNational || own) && (
            <button
              className="fz-link-btn"
              onClick={() => {
                const last = shown.steps.length ? shown.steps[shown.steps.length - 1].fromKm : shown.thresholdKm;
                set({ steps: [...shown.steps, { fromKm: (last || 0) + 100, perKm: shown.perKm }] });
              }}
            >
              <Plus size={14} /> Add rate change
            </button>
          )}
        </div>
      )}

      <div className="fz-examples">
        {effective
          ? examples.map(km => (
              <span key={km} className="fz-example">{km} km ≈ <strong>{pkr(roundFare(fareForRule(effective, km)))}</strong></span>
            ))
          : <span className="fz-example fz-example-none">
              {isNational ? 'Not set — the app uses the old rate from Settings' : 'No price'}
            </span>}
      </div>
    </div>
  );
};

/* ─── Shared seats (worked out, not set) ───────────────────────────────────── */

const SharingTable: React.FC<{ privateRule: FareRule | null; examples: number[] }> = ({ privateRule, examples }) => {
  const rule = privateRule && cleanRule(privateRule);
  return (
    <div className="fz-rule fz-rule-inherited fz-sharing">
      <div className="fz-rule-head">
        <div>
          <div className="fz-rule-title">Sharing</div>
          <div className="fz-rule-hint">set automatically from the private car fare</div>
        </div>
      </div>
      {rule ? (
        <table className="fz-share-table">
          <thead>
            <tr>
              <th>Seats</th>
              {examples.map(km => <th key={km}>{km} km</th>)}
            </tr>
          </thead>
          <tbody>
            {SEAT_SHARE.map(({ seats, share }) => (
              <tr key={seats}>
                <td>{seats === 4 ? '4 (full car)' : seats} · {Math.round(share * 100)}%</td>
                {examples.map(km => <td key={km}>{pkr(roundFare(fareForRule(rule, km) * share))}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="fz-examples"><span className="fz-example fz-example-none">Set the private car fare first</span></div>
      )}
    </div>
  );
};

/* ─── Apply-to dialog ──────────────────────────────────────────────────────── */

const ApplyDialog: React.FC<{
  source: string;
  onCancel: () => void;
  onApply: (ids: string[]) => void;
  busy: boolean;
}> = ({ source, onCancel, onApply, busy }) => {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [q, setQ] = useState('');
  const toggle = (id: string) => setPicked(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const shown = DISTRICTS.filter(d => d.id !== source && d.name.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="fz-modal-backdrop" onClick={onCancel}>
      <div className="fz-modal" onClick={e => e.stopPropagation()}>
        <div className="fz-modal-head">
          <h3>Apply these prices to other districts</h3>
          <button className="fz-icon-btn" onClick={onCancel}><X size={16} /></button>
        </div>
        <p className="fz-modal-note">
          The chosen districts get exactly the prices shown for <strong>{zoneName(source)}</strong>,
          replacing whatever they have now.
        </p>
        <div className="fz-search"><Search size={15} /><input placeholder="Search districts" value={q} onChange={e => setQ(e.target.value)} /></div>
        <div className="fz-modal-list">
          {PROVINCES.map(p => {
            const inP = shown.filter(d => d.province === p);
            if (!inP.length) return null;
            const all = inP.every(d => picked.has(d.id));
            return (
              <div key={p} className="fz-modal-group">
                <label className="fz-modal-province">
                  <input type="checkbox" checked={all} onChange={() => setPicked(prev => {
                    const next = new Set(prev);
                    for (const d of inP) { if (all) next.delete(d.id); else next.add(d.id); }
                    return next;
                  })} />
                  {p} <span className="fz-count">{inP.length}</span>
                </label>
                <div className="fz-modal-districts">
                  {inP.map(d => (
                    <label key={d.id} className="fz-modal-district">
                      <input type="checkbox" checked={picked.has(d.id)} onChange={() => toggle(d.id)} /> {d.name}
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <div className="fz-modal-actions">
          <button className="fz-btn" onClick={onCancel}>Cancel</button>
          <button className="fz-btn fz-btn-primary" disabled={!picked.size || busy} onClick={() => onApply(Array.from(picked))}>
            {busy ? <Loader size={14} className="spin" /> : <Copy size={14} />}
            Apply to {picked.size} {picked.size === 1 ? 'district' : 'districts'}
          </button>
        </div>
      </div>
    </div>
  );
};

/* ─── Page ─────────────────────────────────────────────────────────────────── */

export const Fares: React.FC = () => {
  const by = useAdminLabel();
  const [zones, setZones] = useState<Record<string, FareZoneDoc>>({});
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string>(NATIONAL_ZONE);
  const [draft, setDraft] = useState<Draft>(() => toDraft(undefined));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [applying, setApplying] = useState(false);
  const [showApply, setShowApply] = useState(false);
  const [search, setSearch] = useState('');
  const [copyFrom, setCopyFrom] = useState('');
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  const showToast = (type: 'success' | 'error', msg: string) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 4500);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const snap = await getDocs(collection(db, 'fareZones'));
      const next: Record<string, FareZoneDoc> = {};
      snap.forEach(d => { next[d.id] = d.data() as FareZoneDoc; });
      setZones(next);
    } catch (e) {
      console.error(e);
      showToast('error', 'Could not load fares');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Opening a zone (or reloading) shows what's stored for it.
  useEffect(() => {
    setDraft(toDraft(zones[selected]));
    setDirty(false);
  }, [selected, zones]);

  const isNational = selected === NATIONAL_ZONE;
  const national = useMemo(() => toDraft(zones[NATIONAL_ZONE]), [zones]);
  const issues = problems(draft);

  const edit = (fn: (d: Draft) => Draft) => { setDraft(d => fn(d)); setDirty(true); };

  const open = (id: string) => {
    if (dirty && !window.confirm('You have unsaved changes. Discard them?')) return;
    setSelected(id);
    setCopyFrom('');
  };

  const save = async () => {
    if (issues.length) return;
    setSaving(true);
    try {
      // The whole document is replaced, so a price switched back to
      // "national" is really removed.
      const data = { ...fromDraft(selected, draft), updatedAt: serverTimestamp(), updatedBy: by };
      await setDoc(doc(db, 'fareZones', selected), data);
      setZones(prev => ({ ...prev, [selected]: data as FareZoneDoc }));
      setDirty(false);
      showToast('success', `${zoneName(selected)} saved`);
    } catch (e) {
      console.error(e);
      showToast('error', 'Saving failed. Try again.');
    } finally {
      setSaving(false);
    }
  };

  const resetToNational = async () => {
    if (!window.confirm(`Remove all of ${zoneName(selected)}'s own prices? It will use the national prices.`)) return;
    setSaving(true);
    try {
      await deleteDoc(doc(db, 'fareZones', selected));
      setZones(prev => { const next = { ...prev }; delete next[selected]; return next; });
      showToast('success', `${zoneName(selected)} now uses the national prices`);
    } catch (e) {
      console.error(e);
      showToast('error', 'That failed. Try again.');
    } finally {
      setSaving(false);
    }
  };

  /** Copy another zone's prices into this one — still to be saved. */
  const doCopyFrom = (source: string) => {
    if (!source) return;
    const from = toDraft(zones[source]);
    if (source !== NATIONAL_ZONE) {
      // A district only stores what differs; whatever it leaves to the
      // national price is copied as the national price.
      for (const v of VEHICLE_TYPES) from.vehicles[v.key] ??= national.vehicles[v.key];
      for (const c of CITY_TYPES) from.cityToCity[c.key] ??= national.cityToCity[c.key];
      from.commission ||= national.commission;
      from.ctcCommission ||= national.ctcCommission;
    }
    edit(() => from);
    setCopyFrom('');
    showToast('success', `Copied ${zoneName(source)}'s prices — check them and Save`);
  };

  const applyTo = async (ids: string[]) => {
    if (issues.length) return;
    setApplying(true);
    try {
      const batch = writeBatch(db);
      const stamp = { updatedAt: serverTimestamp(), updatedBy: by };
      const written: Record<string, FareZoneDoc> = {};
      for (const id of ids) {
        const data = { ...fromDraft(id, draft), ...stamp };
        batch.set(doc(db, 'fareZones', id), data);
        written[id] = data as FareZoneDoc;
      }
      await batch.commit();
      setZones(prev => ({ ...prev, ...written }));
      setShowApply(false);
      showToast('success', `Prices applied to ${ids.length} ${ids.length === 1 ? 'district' : 'districts'}`);
    } catch (e) {
      console.error(e);
      showToast('error', 'Applying failed. Try again.');
    } finally {
      setApplying(false);
    }
  };

  const customCount = Object.keys(zones).filter(id => id !== NATIONAL_ZONE).length;
  const listed = DISTRICTS.filter(d =>
    !search.trim() || d.name.toLowerCase().includes(search.toLowerCase()) || d.province.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="fz-page">
      {toast && (
        <div className={`settings-toast ${toast.type === 'success' ? 'toast-success' : 'toast-error'}`}>
          {toast.type === 'success' ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
          <span>{toast.msg}</span>
        </div>
      )}

      <div className="fz-top">
        <div>
          <h1>District fares</h1>
          <p>
            Every ride is priced by the district it starts in. Set the national fare once; give a district its
            own price only where it should differ. {customCount} of {DISTRICTS.length} districts have their own prices.
          </p>
        </div>
        <button className="fz-btn" onClick={() => { void load(); }} disabled={loading}>
          <RefreshCw size={15} className={loading ? 'spin' : ''} /> Reload
        </button>
      </div>

      <div className="fz-layout">
        {/* ── District list ── */}
        <aside className="fz-list">
          <button className={`fz-zone fz-zone-national ${isNational ? 'fz-zone-active' : ''}`} onClick={() => open(NATIONAL_ZONE)}>
            <Globe2 size={16} />
            <span className="fz-zone-name">National</span>
            <span className="fz-zone-tag">all districts</span>
          </button>
          <div className="fz-search"><Search size={15} /><input placeholder="Search districts" value={search} onChange={e => setSearch(e.target.value)} /></div>
          <div className="fz-list-scroll">
            {PROVINCES.map(p => {
              const inP = listed.filter(d => d.province === p);
              if (!inP.length) return null;
              return (
                <div key={p}>
                  <div className="fz-province">{p}</div>
                  {inP.map(d => (
                    <button key={d.id} className={`fz-zone ${selected === d.id ? 'fz-zone-active' : ''}`} onClick={() => open(d.id)}>
                      <MapPin size={14} />
                      <span className="fz-zone-name">{d.name}</span>
                      {zones[d.id] && <span className="fz-zone-tag fz-zone-custom">Custom</span>}
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        </aside>

        {/* ── Editor ── */}
        <section className="fz-editor">
          {loading ? (
            <div className="settings-loading"><Loader size={30} className="spin" /> <span>Loading fares…</span></div>
          ) : (
            <>
              <div className="fz-editor-head">
                <div>
                  <h2>{zoneName(selected)}</h2>
                  <p>
                    {isNational
                      ? 'The fare every district uses unless it has its own.'
                      : `${DISTRICTS.find(d => d.id === selected)?.province ?? ''} · ${selected} · ` +
                        (zones[selected] ? 'has its own prices' : 'uses the national prices')}
                  </p>
                </div>
                <div className="fz-actions">
                  <select className="fz-select" value={copyFrom} onChange={e => doCopyFrom(e.target.value)}>
                    <option value="">Copy prices from…</option>
                    {selected !== NATIONAL_ZONE && <option value={NATIONAL_ZONE}>National</option>}
                    {DISTRICTS.filter(d => d.id !== selected && zones[d.id]).map(d => (
                      <option key={d.id} value={d.id}>{d.name} ({d.province})</option>
                    ))}
                  </select>
                  <button className="fz-btn" onClick={() => setShowApply(true)} disabled={!!issues.length}>
                    <Copy size={14} /> Apply to districts…
                  </button>
                  {!isNational && zones[selected] && (
                    <button className="fz-btn fz-btn-danger" onClick={() => { void resetToNational(); }} disabled={saving}>
                      <Trash2 size={14} /> Use national
                    </button>
                  )}
                  {dirty && (
                    <button className="fz-btn" onClick={() => { setDraft(toDraft(zones[selected])); setDirty(false); }}>
                      <Undo2 size={14} /> Discard
                    </button>
                  )}
                  <button className="fz-btn fz-btn-primary" onClick={() => { void save(); }} disabled={!dirty || saving || !!issues.length}>
                    {saving ? <Loader size={14} className="spin" /> : <Save size={14} />} Save
                  </button>
                </div>
              </div>

              {issues.length > 0 && (
                <div className="rate-alert rate-alert-error">
                  <AlertCircle size={18} />
                  <div><strong>Fix before saving</strong><p>{issues.join(' · ')}</p></div>
                </div>
              )}

              <h3 className="fz-section">In-city vehicles</h3>
              <p className="fz-section-note">
                The passenger pays the base fare for any trip up to the base-fare distance, then the per-km rate for
                every km after it. Shown fares are rounded to the nearest 10, as in the app.
              </p>
              <div className="fz-rules">
                {VEHICLE_TYPES.map(v => (
                  <RuleEditor
                    key={v.key}
                    label={v.label}
                    rule={draft.vehicles[v.key]}
                    inherited={isNational ? null : national.vehicles[v.key]}
                    isNational={isNational}
                    allowSteps={false}
                    examples={[3, 5, 10, 20]}
                    onChange={r => edit(d => ({ ...d, vehicles: { ...d.vehicles, [v.key]: r } }))}
                  />
                ))}
              </div>

              <h3 className="fz-section">City to city</h3>
              <p className="fz-section-note">
                Base fare up to the base-fare distance, then the per-km rate. Add a rate change for each distance where
                the per-km rate changes — e.g. PKR 35/km after the base, PKR 30/km from 150 km, PKR 25/km from 250 km.
                Only the full car is priced here: shared seats are a share of it — 1 seat 45%, 2 seats 70%, 3 seats 90%,
                4 seats the full car — for passengers' shared requests and for seats on trips drivers post.
              </p>
              <div className="fz-rules">
                {CITY_TYPES.map(c => (
                  <RuleEditor
                    key={c.key}
                    label={c.label}
                    hint={c.hint}
                    rule={draft.cityToCity[c.key]}
                    inherited={isNational ? null : national.cityToCity[c.key]}
                    isNational={isNational}
                    allowSteps
                    examples={[100, 250, 400, 800]}
                    onChange={r => edit(d => ({ ...d, cityToCity: { ...d.cityToCity, [c.key]: r } }))}
                  />
                ))}
                <SharingTable
                  privateRule={draft.cityToCity.private ?? (isNational ? null : national.cityToCity.private)}
                  examples={[100, 250, 400]}
                />
              </div>

              <h3 className="fz-section">Commission</h3>
              <p className="fz-section-note">
                {isNational
                  ? 'Taken from the driver on each completed ride. Leave empty to keep the commission set in Settings.'
                  : 'Leave empty to use the national commission.'}
              </p>
              <div className="fz-rule-fields fz-commission">
                <NumField label={`In-city${!isNational && national.commission ? ` (national ${national.commission}%)` : ''}`}
                  suffix="%" value={Number(draft.commission) || 0}
                  onChange={n => edit(d => ({ ...d, commission: n ? String(n) : '' }))} />
                <NumField label={`City to city${!isNational && national.ctcCommission ? ` (national ${national.ctcCommission}%)` : ''}`}
                  suffix="%" value={Number(draft.ctcCommission) || 0}
                  onChange={n => edit(d => ({ ...d, ctcCommission: n ? String(n) : '' }))} />
              </div>
            </>
          )}
        </section>
      </div>

      {showApply && (
        <ApplyDialog source={selected} busy={applying} onCancel={() => setShowApply(false)} onApply={ids => { void applyTo(ids); }} />
      )}
    </div>
  );
};

export default Fares;

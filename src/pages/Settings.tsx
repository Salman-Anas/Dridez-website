import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { doc, getDoc, setDoc, updateDoc, deleteField } from 'firebase/firestore';
import { db } from '../firebase';
import {
  CABTYPES, RATE_GROUP_LABEL, RATE_FALLBACK_CHAIN, LEGACY_RATE_KEYS,
  CANONICAL_RATE_KEYS, COMMISSION_KEYS, COMMISSION_META, COMMISSION_CHAIN,
  resolveRate, resolveCommission, parseRate, formatPKR, computeFare, FARE_BASE,
  rateKeyImpact, buildRateCleanupPlan,
  type CabtypeMeta, type CommissionKey, type RateGroup, type RatesMap,
} from '../utils/rideTaxonomy';
import {
  Car, Truck, Package, Percent, Bike, Snowflake,
  RefreshCw, CheckCircle, AlertCircle, AlertTriangle, Loader,
  Edit3, X, DollarSign, Check, Trash2, ArrowUpFromLine, ShieldCheck,
} from 'lucide-react';

// ─── Card presentation per cabtype ───────────────────────────────────────────

interface CardStyle { icon: React.ReactNode; color: string; }

const GROUP_ICON: Record<RateGroup, React.ReactNode> = {
  cars: <Car size={22} />,
  delivery: <Package size={22} />,
  other: <Bike size={22} />,
};

const cardStyle = (meta: CabtypeMeta): CardStyle => {
  switch (meta.category) {
    case 'mini':          return { icon: <Car size={24} />, color: '#8b5cf6' };
    case 'comfort':       return { icon: <Car size={24} />, color: '#3b82f6' };
    case 'car_delivery':  return { icon: <Package size={24} />, color: '#10b981' };
    case 'rickshaw':      return { icon: <Truck size={24} />, color: '#ec4899' };
    case 'bike':          return { icon: <Bike size={24} />, color: '#f59e0b' };
    case 'bike_delivery': return { icon: <Package size={24} />, color: '#14b8a6' };
    default:              return { icon: <DollarSign size={24} />, color: '#64748b' };
  }
};

const EXAMPLE_KM = 5;

// ─── Shared inline editor ────────────────────────────────────────────────────

interface EditorProps {
  /** Raw current value straight from the document (may be number or string). */
  value: unknown;
  saving: boolean;
  prefix?: string;
  suffix?: string;
  step?: string;
  /** Percentages are stored as decimals; everything else is a plain rate. */
  isPercent?: boolean;
  onCancel: () => void;
  onSave: (n: number) => void;
}

const RateEditor: React.FC<EditorProps> = ({
  value, saving, prefix = 'PKR', suffix = '/ km', step = '5', isPercent, onCancel, onSave,
}) => {
  const initial = () => {
    const n = parseRate(value);
    if (n === null) return '';
    return isPercent ? String(n <= 1 ? n * 100 : n) : String(n);
  };
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState('');

  const handleSave = () => {
    const raw = draft.trim();
    if (!raw) { setError('Enter a rate — an empty value breaks fares for this type'); return; }
    const n = Number(raw);
    if (!Number.isFinite(n)) { setError('Enter a valid number'); return; }
    if (n <= 0) { setError('Rate must be greater than zero'); return; }
    if (isPercent && n >= 100) { setError('Commission must be below 100%'); return; }
    setError('');
    onSave(isPercent ? n / 100 : n);
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSave();
    if (e.key === 'Escape') onCancel();
  };

  return (
    <div className="rate-edit-row">
      <div className="rate-input-wrap">
        {prefix && <span className="rate-input-prefix">{prefix}</span>}
        <input
          className="rate-input"
          type="number"
          step={step}
          min="0"
          value={draft}
          onChange={e => { setDraft(e.target.value); setError(''); }}
          onKeyDown={handleKey}
          autoFocus
        />
        {suffix && <span className="rate-input-suffix">{suffix}</span>}
      </div>
      {error && <div className="rate-error"><AlertCircle size={13} /> {error}</div>}
      <div className="rate-edit-actions">
        <button className="rate-save-btn" onClick={handleSave} disabled={saving}>
          {saving ? <Loader size={14} className="spin" /> : <Check size={15} />}
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button className="rate-cancel-btn" onClick={onCancel}>
          <X size={14} /> Cancel
        </button>
      </div>
    </div>
  );
};

// ─── Cabtype rate card ───────────────────────────────────────────────────────

interface CabtypeCardProps {
  meta: CabtypeMeta;
  rates: RatesMap;
  editing: boolean;
  saving: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: (n: number) => void;
}

const CabtypeRateCard: React.FC<CabtypeCardProps> = ({
  meta, rates, editing, saving, onEdit, onCancel, onSave,
}) => {
  const style = cardStyle(meta);
  const resolved = resolveRate(rates, meta.key);
  const ownValue = parseRate(rates[meta.key]);

  const cardClass = [
    'rate-card',
    editing ? 'rate-card-editing' : '',
    resolved.missing ? 'rate-card-broken' : '',
    !resolved.missing && resolved.fromFallback ? 'rate-card-fallback' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={cardClass} style={{ '--rate-color': style.color } as React.CSSProperties}>
      <div className="rate-card-header">
        <div className="rate-card-icon" style={{ background: `${style.color}15`, color: style.color }}>
          {style.icon}
        </div>
        <span className="rate-card-tag">
          {meta.acOption === 'ac' && <Snowflake size={11} style={{ marginRight: 4 }} />}
          {RATE_GROUP_LABEL[meta.group]}
        </span>
      </div>

      <div className="rate-card-body">
        <div className="rate-card-label">{meta.label}</div>
        <div className="rate-card-key mono">{meta.key}</div>

        {editing ? (
          <RateEditor value={rates[meta.key]} saving={saving} onCancel={onCancel} onSave={onSave} />
        ) : (
          <>
            <div className="rate-display-row">
              <div className="rate-value-wrap">
                <span className="rate-value" style={{ color: resolved.missing ? 'var(--accent-red)' : style.color }}>
                  {resolved.value !== null ? formatPKR(resolved.value, { decimals: 2 }) : 'No rate'}
                </span>
                <span className="rate-value-unit">
                  {resolved.value !== null
                    ? `/ km · ${EXAMPLE_KM} km ≈ ${formatPKR(computeFare(resolved.value, EXAMPLE_KM), { decimals: 2 })}`
                    : 'riders cannot book this type'}
                </span>
              </div>
              <button className="rate-edit-btn" onClick={onEdit} title={`Set the ${meta.key} rate`}>
                <Edit3 size={14} /> {ownValue !== null ? 'Edit Rate' : 'Set Rate'}
              </button>
            </div>

            {/* What the app will actually do with this key */}
            {resolved.missing ? (
              <div className="rate-status rate-status-error">
                <AlertTriangle size={13} />
                <span>
                  Nothing set anywhere in <span className="mono">{RATE_FALLBACK_CHAIN[meta.key].join(' → ')}</span> —
                  the app shows no fare and the rider cannot book this type.
                </span>
              </div>
            ) : resolved.fromFallback ? (
              <div className="rate-status rate-status-warn">
                <AlertCircle size={13} />
                <span>
                  not set — borrowing <span className="mono">{resolved.sourceKey}</span> = {resolved.value}
                </span>
              </div>
            ) : (
              <div className="rate-status rate-status-ok">
                <CheckCircle size={13} /> <span>set directly on <span className="mono">{meta.key}</span></span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

// ─── Commission card ─────────────────────────────────────────────────────────

interface CommissionCardProps {
  ckey: CommissionKey;
  rates: RatesMap;
  editing: boolean;
  saving: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: (n: number) => void;
}

const CommissionCard: React.FC<CommissionCardProps> = ({
  ckey, rates, editing, saving, onEdit, onCancel, onSave,
}) => {
  const meta = COMMISSION_META[ckey];
  const resolved = resolveCommission(rates, ckey);
  const own = rates[ckey] !== undefined;
  const color = ckey === 'comission' ? '#f97316' : '#ec4899';

  return (
    <div
      className={`rate-card ${editing ? 'rate-card-editing' : ''} ${resolved.missing ? 'rate-card-broken' : ''}`}
      style={{ '--rate-color': color } as React.CSSProperties}
    >
      <div className="rate-card-header">
        <div className="rate-card-icon" style={{ background: `${color}15`, color }}><Percent size={24} /></div>
        <span className="rate-card-tag">Commission</span>
      </div>
      <div className="rate-card-body">
        <div className="rate-card-label">{meta.label}</div>
        <div className="rate-card-key mono">{ckey}</div>
        <div className="rate-card-desc">{meta.description}</div>

        {editing ? (
          <RateEditor
            value={rates[ckey] ?? resolved.value}
            saving={saving}
            isPercent
            prefix=""
            suffix="%"
            step="1"
            onCancel={onCancel}
            onSave={onSave}
          />
        ) : (
          <>
            <div className="rate-display-row">
              <div className="rate-value-wrap">
                <span className="rate-value" style={{ color: resolved.missing ? 'var(--accent-red)' : color }}>
                  {resolved.value !== null ? `${(resolved.value * 100).toFixed(1)}%` : 'Not set'}
                </span>
                <span className="rate-value-unit">
                  {resolved.value !== null ? 'of the fare' : 'drivers cannot offer or complete rides'}
                </span>
              </div>
              <button className="rate-edit-btn" onClick={onEdit}>
                <Edit3 size={14} /> {own ? 'Edit' : 'Set'}
              </button>
            </div>

            {resolved.missing ? (
              <div className="rate-status rate-status-error">
                <AlertTriangle size={13} />
                <span>
                  Nothing set in <span className="mono">{COMMISSION_CHAIN[ckey].join(' → ')}</span>. The app
                  has no hard-coded default — drivers are blocked until this is fixed.
                </span>
              </div>
            ) : resolved.fromFallback ? (
              <div className="rate-status rate-status-warn">
                <AlertCircle size={13} />
                <span>reading the older key <span className="mono">{resolved.sourceKey}</span></span>
              </div>
            ) : (
              <div className="rate-status rate-status-ok">
                <CheckCircle size={13} /> <span>set directly on <span className="mono">{ckey}</span></span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

// ─── Legacy key card ─────────────────────────────────────────────────────────

interface LegacyCardProps {
  fieldKey: string;
  reason: string;
  value: unknown;
  rates: RatesMap;
  deleting: boolean;
  onDelete: () => void;
}

const LegacyKeyCard: React.FC<LegacyCardProps> = ({
  fieldKey, reason, value, rates, deleting, onDelete,
}) => {
  const impact = rateKeyImpact(rates, fieldKey);
  const n = parseRate(value);

  return (
    <div className={`rate-card legacy-card ${impact.safe ? '' : 'legacy-card-load-bearing'}`}>
      <div className="rate-card-header">
        <div className="rate-card-key mono legacy-card-key">{fieldKey}</div>
        <span className="rate-card-tag legacy-tag">Legacy</span>
      </div>
      <div className="rate-card-body">
        <div className="legacy-value">
          {n !== null ? n : String(value)}
          <span className="legacy-value-raw">stored as {typeof value}</span>
        </div>
        <div className="rate-card-desc">{reason}</div>

        {impact.safe ? (
          <div className="rate-status rate-status-ok">
            <ShieldCheck size={13} /> <span>Nothing reads this — safe to delete.</span>
          </div>
        ) : (
          <div className="rate-status rate-status-warn">
            <ArrowUpFromLine size={13} />
            <span>
              {impact.promotions.map(p => p.label).join(', ')}{' '}
              {impact.promotions.length === 1 ? 'is' : 'are'} priced from this key. Deleting copies
              the value onto {impact.promotions.length === 1 ? 'its own key' : 'their own keys'} first,
              so nothing changes price.
            </span>
          </div>
        )}

        <button className="legacy-delete-btn" onClick={onDelete} disabled={deleting}>
          {deleting ? <Loader size={14} className="spin" /> : <Trash2 size={14} />}
          {deleting ? 'Deleting…' : impact.safe ? 'Delete key' : 'Promote & delete'}
        </button>
      </div>
    </div>
  );
};

// ─── Main Settings Page Component ────────────────────────────────────────────

/** Keys the portal understands, so anything else can be surfaced as custom. */
const KNOWN_KEYS = new Set<string>([
  ...CANONICAL_RATE_KEYS,
  ...LEGACY_RATE_KEYS.map(k => k.key),
]);

export const Settings: React.FC = () => {
  const [rates, setRates] = useState<RatesMap>({});
  const [loading, setLoading] = useState(true);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [confirmingCleanup, setConfirmingCleanup] = useState(false);
  const [cleaningUp, setCleaningUp] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  const showToast = (type: 'success' | 'error', msg: string) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 4500);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const snap = await getDoc(doc(db, 'rates', 'rates'));
      setRates(snap.exists() ? (snap.data() as RatesMap) : {});
    } catch (e) {
      console.error(e);
      showToast('error', 'Failed to load pricing rates');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  /** How to empty the document of legacy keys without moving a single price. */
  const plan = useMemo(() => buildRateCleanupPlan(rates), [rates]);

  /**
   * The document has held both numbers and numeric strings over its life. A key
   * keeps whatever type it already has; anything written fresh is written as a
   * number, which is what the current app expects and what the remaining
   * canonical keys already use.
   */
  const encode = (key: string, n: number): number | string =>
    typeof rates[key] === 'string' ? String(n) : n;

  const handleSave = async (key: string, n: number) => {
    setSavingKey(key);
    try {
      const encoded = encode(key, n);
      // merge so unrelated keys are never dropped from the document
      await setDoc(doc(db, 'rates', 'rates'), { [key]: encoded }, { merge: true });
      setRates(prev => ({ ...prev, [key]: encoded }));
      setEditingKey(null);
      showToast('success', `${key} saved`);
    } catch (e) {
      console.error(e);
      showToast('error', 'Database synchronization failed. Try again.');
    } finally {
      setSavingKey(null);
    }
  };

  /**
   * Remove one legacy key. Anything currently priced through it has that price
   * written onto its own canonical key in the same update, so the two never
   * land separately and no fare is ever momentarily unset.
   */
  const handleDeleteLegacy = async (key: string) => {
    const impact = rateKeyImpact(rates, key);
    setDeletingKey(key);
    try {
      const patch: Record<string, unknown> = { [key]: deleteField() };
      for (const p of impact.promotions) patch[p.target] = p.value;

      await updateDoc(doc(db, 'rates', 'rates'), patch);

      setRates(prev => {
        const next = { ...prev };
        delete next[key];
        for (const p of impact.promotions) next[p.target] = p.value;
        return next;
      });
      showToast(
        'success',
        impact.promotions.length
          ? `${key} deleted — ${impact.promotions.map(p => p.target).join(', ')} kept at the same price`
          : `${key} deleted`,
      );
    } catch (e) {
      console.error(e);
      showToast('error', `Could not delete ${key}. Nothing was changed.`);
    } finally {
      setDeletingKey(null);
    }
  };

  /** Remove every legacy key at once, promoting first, in one atomic update. */
  const handleCleanupAll = async () => {
    setCleaningUp(true);
    try {
      const patch: Record<string, unknown> = {};
      for (const p of plan.promotions) patch[p.target] = p.value;
      for (const key of plan.deletions) patch[key] = deleteField();

      await updateDoc(doc(db, 'rates', 'rates'), patch);

      setRates(prev => {
        const next = { ...prev };
        for (const p of plan.promotions) next[p.target] = p.value;
        for (const key of plan.deletions) delete next[key];
        return next;
      });
      setConfirmingCleanup(false);
      showToast('success', `${plan.deletions.length} legacy keys deleted. Every price is unchanged.`);
    } catch (e) {
      console.error(e);
      showToast('error', 'Cleanup failed. The document was not modified.');
    } finally {
      setCleaningUp(false);
    }
  };

  const groups: RateGroup[] = ['cars', 'delivery', 'other'];
  const broken = CABTYPES.filter(c => resolveRate(rates, c.key).missing);
  const fallbacks = CABTYPES.filter(c => {
    const r = resolveRate(rates, c.key);
    return !r.missing && r.fromFallback;
  });

  const legacyPresent = useMemo(
    () => LEGACY_RATE_KEYS.filter(k => rates[k.key] !== undefined),
    [rates],
  );
  const extraKeys = Object.keys(rates).filter(k => !KNOWN_KEYS.has(k));

  const cardProps = (key: string) => ({
    editing: editingKey === key,
    saving: savingKey === key,
    onEdit: () => setEditingKey(key),
    onCancel: () => setEditingKey(null),
    onSave: (n: number) => void handleSave(key, n),
  });

  return (
    <div className="settings-page">
      {toast && (
        <div className={`settings-toast ${toast.type === 'success' ? 'toast-success' : 'toast-error'}`}>
          {toast.type === 'success' ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
          <span>{toast.msg}</span>
        </div>
      )}

      <div className="dashboard-header settings-top-bar">
        <div>
          <h1>Platform Settings &amp; Pricing</h1>
          <p>Per-kilometer rates for the eight ride types the app offers — fare = rate × km + {FARE_BASE}</p>
        </div>
        <button
          className="pay-view-all-btn settings-refresh"
          onClick={() => { void load(); }}
          disabled={loading}
          title="Refresh rates from Firestore"
        >
          <RefreshCw size={17} className={loading ? 'spin' : ''} />
          <span>{loading ? 'Syncing...' : 'Sync Database'}</span>
        </button>
      </div>

      {loading ? (
        <div className="settings-loading">
          <Loader size={34} className="spin" style={{ color: 'var(--accent-blue)' }} />
          <span>Fetching live tariff configurations...</span>
        </div>
      ) : (
        <>
          {/* Anything unbookable is the first thing an admin needs to see */}
          {broken.length > 0 && (
            <div className="rate-alert rate-alert-error">
              <AlertTriangle size={20} />
              <div>
                <strong>{broken.length} ride {broken.length === 1 ? 'type has' : 'types have'} no
                  usable rate</strong>
                <p>
                  {broken.map(b => b.label).join(', ')} — the app shows no fare and riders cannot
                  book {broken.length === 1 ? 'it' : 'them'}.
                </p>
              </div>
            </div>
          )}
          {fallbacks.length > 0 && (
            <div className="rate-alert rate-alert-warn">
              <AlertCircle size={20} />
              <div>
                <strong>{fallbacks.length} ride {fallbacks.length === 1 ? 'type is' : 'types are'} priced
                  by fallback</strong>
                <p>
                  {fallbacks.map(f => f.label).join(', ')} — charging a rate borrowed from an older
                  key. Deleting the legacy keys below copies each of these onto its own key first.
                </p>
              </div>
            </div>
          )}

          {/* Sections: the eight current cabtypes */}
          {groups.map(group => {
            const metas = CABTYPES.filter(c => c.group === group);
            return (
              <div className="stat-section" key={group}>
                <h2 className="section-title">
                  {GROUP_ICON[group]}
                  <span>{RATE_GROUP_LABEL[group]}</span>
                  <span className="rate-badge-title">Per-Kilometer Rates</span>
                </h2>
                <div className="rate-cards-grid">
                  {metas.map(meta => (
                    <CabtypeRateCard
                      key={meta.key}
                      meta={meta}
                      rates={rates}
                      {...cardProps(meta.key)}
                    />
                  ))}
                </div>
              </div>
            );
          })}

          {/* Commission — the two keys the app charges drivers on */}
          <div className="stat-section">
            <h2 className="section-title">
              <Percent size={22} />
              <span>Platform Commission</span>
              <span className="rate-badge-title" style={{ background: 'rgba(249, 115, 22, 0.12)', color: 'var(--accent-orange)' }}>
                Revenue Share
              </span>
            </h2>
            <div className="rate-cards-grid">
              {COMMISSION_KEYS.map(ck => (
                <CommissionCard key={ck} ckey={ck} rates={rates} {...cardProps(ck)} />
              ))}
            </div>
          </div>

          {/* Legacy keys — to be removed from the document */}
          <div className="stat-section">
            <h2 className="section-title">
              <Trash2 size={22} />
              <span>Legacy Values</span>
              <span className="rate-badge-title" style={{ background: 'rgba(220, 38, 38, 0.12)', color: 'var(--accent-red)' }}>
                {legacyPresent.length} in the document
              </span>
            </h2>

            {legacyPresent.length === 0 ? (
              <div className="rate-alert rate-alert-ok">
                <ShieldCheck size={20} />
                <div>
                  <strong>No legacy values left</strong>
                  <p>
                    <span className="mono">rates/rates</span> holds only the keys the current app
                    reads. Nothing here needs cleaning up.
                  </p>
                </div>
              </div>
            ) : (
              <>
                <div className="legacy-intro">
                  <p>
                    Keys written by app versions that no longer exist. They are not edited here
                    any more — they are removed. Several still sit in a live fallback chain, so a
                    ride type with no rate of its own may be priced entirely from one of them:
                    deleting such a key writes its value onto the canonical key in the{' '}
                    <strong>same update</strong>, so no fare ever changes and no fare is ever
                    momentarily unset.
                  </p>
                </div>

                {/* One action for the whole document */}
                <div className={`legacy-plan ${plan.wouldBreak.length ? 'legacy-plan-blocked' : ''}`}>
                  <div className="legacy-plan-head">
                    <div>
                      <strong>Delete all {plan.deletions.length} legacy keys</strong>
                      <p>
                        {plan.promotions.length > 0
                          ? `${plan.promotions.length} ${plan.promotions.length === 1 ? 'price is' : 'prices are'} written onto their own key first, then all ${plan.deletions.length} keys are removed — one atomic update.`
                          : 'Nothing is priced through them, so they can simply be removed.'}
                      </p>
                    </div>
                    {!confirmingCleanup && (
                      <button
                        className="legacy-cleanup-btn"
                        onClick={() => setConfirmingCleanup(true)}
                        disabled={plan.wouldBreak.length > 0}
                      >
                        <Trash2 size={15} /> Review &amp; delete all
                      </button>
                    )}
                  </div>

                  {plan.wouldBreak.length > 0 && (
                    <div className="rate-status rate-status-error" style={{ marginTop: '0.75rem' }}>
                      <AlertTriangle size={13} />
                      <span>
                        Blocked: <span className="mono">{plan.wouldBreak.join(', ')}</span> would be
                        left with no value. Set {plan.wouldBreak.length === 1 ? 'it' : 'them'}{' '}
                        explicitly above first.
                      </span>
                    </div>
                  )}

                  {confirmingCleanup && (
                    <div className="legacy-confirm">
                      {plan.promotions.length > 0 && (
                        <div className="legacy-confirm-block">
                          <h4><ArrowUpFromLine size={14} /> Written first — prices preserved</h4>
                          <ul>
                            {plan.promotions.map(p => (
                              <li key={p.target}>
                                <span className="mono">{p.target}</span> ={' '}
                                <strong>{p.isCommission ? `${(p.value * 100).toFixed(1)}%` : p.value}</strong>
                                <span className="legacy-confirm-note">({p.label})</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      <div className="legacy-confirm-block">
                        <h4><Trash2 size={14} /> Deleted permanently</h4>
                        <ul>
                          {plan.deletions.map(k => (
                            <li key={k}>
                              <span className="mono">{k}</span>
                              <span className="legacy-confirm-note">
                                currently {String(rates[k])}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>

                      {plan.alreadyBroken.length > 0 && (
                        <div className="rate-status rate-status-warn">
                          <AlertCircle size={13} />
                          <span>
                            <span className="mono">{plan.alreadyBroken.join(', ')}</span> already
                            {plan.alreadyBroken.length === 1 ? ' has' : ' have'} no value at all.
                            This cleanup neither causes nor fixes that.
                          </span>
                        </div>
                      )}

                      <p className="legacy-confirm-warn">
                        <AlertTriangle size={14} /> Deleting fields from{' '}
                        <span className="mono">rates/rates</span> cannot be undone from the portal.
                      </p>

                      <div className="rate-edit-actions">
                        <button
                          className="legacy-cleanup-btn danger"
                          onClick={() => { void handleCleanupAll(); }}
                          disabled={cleaningUp}
                        >
                          {cleaningUp ? <Loader size={14} className="spin" /> : <Trash2 size={15} />}
                          {cleaningUp ? 'Deleting…' : `Delete ${plan.deletions.length} keys`}
                        </button>
                        <button className="rate-cancel-btn" onClick={() => setConfirmingCleanup(false)}>
                          <X size={14} /> Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <div className="rate-cards-grid">
                  {legacyPresent.map(k => (
                    <LegacyKeyCard
                      key={k.key}
                      fieldKey={k.key}
                      reason={k.reason}
                      value={rates[k.key]}
                      rates={rates}
                      deleting={deletingKey === k.key}
                      onDelete={() => { void handleDeleteLegacy(k.key); }}
                    />
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Keys in the document the portal does not recognise */}
          {extraKeys.length > 0 && (
            <div className="stat-section">
              <h2 className="section-title">
                <DollarSign size={22} />
                <span>Unrecognised Keys</span>
                <span className="rate-badge-title" style={{ background: 'rgba(100, 116, 139, 0.12)', color: '#64748b' }}>
                  {extraKeys.length}
                </span>
              </h2>
              <p className="legacy-intro">
                Present in <span className="mono">rates/rates</span> but neither a current key nor a
                known legacy one. They are listed rather than deleted, because nothing here can tell
                whether some app build still reads them.
              </p>
              <div className="rate-cards-grid">
                {extraKeys.map(k => (
                  <div className="rate-card legacy-card" key={k}>
                    <div className="rate-card-header">
                      <div className="rate-card-key mono legacy-card-key">{k}</div>
                      <span className="rate-card-tag">Unknown</span>
                    </div>
                    <div className="rate-card-body">
                      <div className="legacy-value">{String(rates[k])}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="settings-note-box">
            <div className="snb-icon"><AlertCircle size={22} /></div>
            <div className="snb-text">
              <strong>How the app prices a ride:</strong> fare = <strong>rate × distance in km + {FARE_BASE}</strong>.
              When a ride type's own key is unset the app walks a fallback chain and takes the first
              key with a value above zero — the card shows which key each price is actually coming
              from. Commission is stored as a decimal multiplier (<strong>0.1</strong> ={' '}
              <strong>10%</strong>); enter whole percentages and the portal converts.{' '}
              <strong>Note the spelling:</strong> the in-city commission key is{' '}
              <span className="mono">comission</span>, with one “m” — the app matches it exactly.
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default Settings;

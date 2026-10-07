import React, { useEffect, useState, useCallback } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import {
  CABTYPES, RATE_GROUP_LABEL, RATE_FALLBACK_CHAIN, LEGACY_RATE_KEYS,
  CANONICAL_RATE_KEYS, COMMISSION_KEYS, COMMISSION_META, COMMISSION_CHAIN,
  resolveRate, resolveCommission, parseRate, formatPKR, FARE_BASE,
  baseFareKey, resolveBaseFare, quotedFare,
  type CabtypeMeta, type CommissionKey, type RateGroup, type RatesMap,
} from '../utils/rideTaxonomy';
import {
  Car, Truck, Package, Percent, Bike, Snowflake,
  RefreshCw, CheckCircle, AlertCircle, AlertTriangle, Loader,
  Edit3, X, DollarSign, Check, Flag,
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
  /** Base fares accept 0, which the app reads as "no minimum". */
  allowZero?: boolean;
  onCancel: () => void;
  onSave: (n: number) => void;
}

const RateEditor: React.FC<EditorProps> = ({
  value, saving, prefix = 'PKR', suffix = '/ km', step = '5', isPercent, allowZero, onCancel, onSave,
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
    if (!raw) {
      setError(allowZero ? 'Enter an amount — 0 for no minimum' : 'Enter a rate — an empty value breaks fares for this type');
      return;
    }
    const n = Number(raw);
    if (!Number.isFinite(n)) { setError('Enter a valid number'); return; }
    if (allowZero ? n < 0 : n <= 0) {
      setError(allowZero ? 'Cannot be negative — use 0 for no minimum' : 'Rate must be greater than zero');
      return;
    }
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
  baseEditing: boolean;
  baseSaving: boolean;
  onBaseEdit: () => void;
  onBaseSave: (n: number) => void;
}

const CabtypeRateCard: React.FC<CabtypeCardProps> = ({
  meta, rates, editing, saving, onEdit, onCancel, onSave,
  baseEditing, baseSaving, onBaseEdit, onBaseSave,
}) => {
  const style = cardStyle(meta);
  const resolved = resolveRate(rates, meta.key);
  const ownValue = parseRate(rates[meta.key]);
  const baseKey = baseFareKey(meta.key);
  const baseFare = resolveBaseFare(rates, meta.key);
  // Trips shorter than this are charged the base fare rather than per km.
  const minimumUpToKm = resolved.value !== null && baseFare > FARE_BASE
    ? (baseFare - FARE_BASE) / resolved.value
    : 0;

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
                    ? `/ km · ${EXAMPLE_KM} km ≈ ${formatPKR(quotedFare(resolved.value, EXAMPLE_KM, baseFare), { decimals: 2 })}`
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

        {/* Base (minimum) fare — its own key, no fallbacks */}
        <div className="rate-base">
          <div className="rate-base-head">
            <span className="rate-base-label"><Flag size={13} /> Base fare</span>
            <span className="rate-card-key mono">{baseKey}</span>
          </div>
          {baseEditing ? (
            <RateEditor
              value={rates[baseKey]}
              saving={baseSaving}
              suffix="minimum"
              step="10"
              allowZero
              onCancel={onCancel}
              onSave={onBaseSave}
            />
          ) : (
            <div className="rate-display-row">
              <div className="rate-value-wrap">
                <span className="rate-base-value" style={{ color: baseFare ? style.color : 'var(--text-secondary)' }}>
                  {baseFare ? formatPKR(baseFare) : 'No minimum'}
                </span>
                <span className="rate-value-unit">
                  {!baseFare
                    ? 'every trip is charged per km'
                    : minimumUpToKm > 0
                      ? `trips up to ~${minimumUpToKm.toFixed(1)} km are charged this`
                      : 'the least a rider is charged for this type'}
                </span>
              </div>
              <button className="rate-edit-btn" onClick={onBaseEdit} title={`Set the ${baseKey} minimum fare`}>
                <Edit3 size={14} /> {rates[baseKey] !== undefined ? 'Edit' : 'Set'}
              </button>
            </div>
          )}
        </div>
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

  const groups: RateGroup[] = ['cars', 'delivery', 'other'];
  const broken = CABTYPES.filter(c => resolveRate(rates, c.key).missing);
  const fallbacks = CABTYPES.filter(c => {
    const r = resolveRate(rates, c.key);
    return !r.missing && r.fromFallback;
  });

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
          <p>Per-km rates and base fares for the eight ride types — fare = max(rate × km + {FARE_BASE}, base fare)</p>
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
                  key. Set a rate on the card to price {fallbacks.length === 1 ? 'it' : 'them'} directly.
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
                  <span className="rate-badge-title">Per-km Rates &amp; Base Fares</span>
                </h2>
                <div className="rate-cards-grid">
                  {metas.map(meta => (
                    <CabtypeRateCard
                      key={meta.key}
                      meta={meta}
                      rates={rates}
                      {...cardProps(meta.key)}
                      baseEditing={editingKey === baseFareKey(meta.key)}
                      baseSaving={savingKey === baseFareKey(meta.key)}
                      onBaseEdit={() => setEditingKey(baseFareKey(meta.key))}
                      onBaseSave={(n: number) => void handleSave(baseFareKey(meta.key), n)}
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
              <strong>How the app prices a ride:</strong> fare = <strong>rate × distance in km + {FARE_BASE}</strong>,
              raised to the type's <strong>base fare</strong> if it comes out lower — riders also cannot offer
              a custom fare below it. Base fares have no fallbacks; <strong>0</strong> or unset means no minimum.
              When a ride type's own per-km key is unset the app walks a fallback chain and takes the first
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

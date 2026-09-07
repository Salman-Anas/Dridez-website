import React, { useEffect, useState, useCallback } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import {
  CABTYPES, RATE_GROUP_LABEL, RATE_FALLBACK_CHAIN, LEGACY_RATE_KEYS,
  resolveRate, parseRate, formatPKR, computeFare, FARE_BASE,
  type CabtypeMeta, type RateGroup, type RatesMap,
} from '../utils/rideTaxonomy';
import {
  Car, Truck, Globe, Package, Percent, Bike, Snowflake,
  RefreshCw, CheckCircle, AlertCircle, AlertTriangle, Loader,
  Edit3, X, DollarSign, Check, Archive, ChevronDown,
} from 'lucide-react';

// ─── Card presentation per cabtype ───────────────────────────────────────────

interface CardStyle { icon: React.ReactNode; color: string; }

const GROUP_ICON: Record<RateGroup, React.ReactNode> = {
  cars: <Car size={22} />,
  delivery: <Package size={22} />,
  other: <Bike size={22} />,
  freight: <Truck size={22} />,
};

const cardStyle = (meta: CabtypeMeta): CardStyle => {
  switch (meta.category) {
    case 'mini':          return { icon: <Car size={24} />, color: '#8b5cf6' };
    case 'comfort':       return { icon: <Car size={24} />, color: '#3b82f6' };
    case 'car_delivery':  return { icon: <Package size={24} />, color: '#10b981' };
    case 'rickshaw':      return { icon: <Truck size={24} />, color: '#ec4899' };
    case 'bike':          return { icon: <Bike size={24} />, color: '#f59e0b' };
    case 'bike_delivery': return { icon: <Package size={24} />, color: '#14b8a6' };
    case 'freight':       return { icon: <Truck size={24} />, color: '#ef4444' };
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
    return isPercent ? String(n * 100) : String(n);
  };
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState('');

  const handleSave = () => {
    const raw = draft.trim();
    if (!raw) { setError('Enter a rate — an empty value breaks fares for this type'); return; }
    const n = Number(raw);
    if (!Number.isFinite(n)) { setError('Enter a valid number'); return; }
    if (n <= 0) { setError('Rate must be greater than zero'); return; }
    if (isPercent && n > 100) { setError('Percentage cannot exceed 100%'); return; }
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
  // freight reads rates["freight"] directly on the booking screen — there is
  // nothing behind it to fall back to
  const noFallback = RATE_FALLBACK_CHAIN[meta.key].length === 1;

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
                  {noFallback
                    ? <><strong>{meta.key}</strong> is unset and has no fallback — {meta.label} fares
                        break entirely and the rider sees no price.</>
                    : <>Nothing set anywhere in <span className="mono">{RATE_FALLBACK_CHAIN[meta.key].join(' → ')}</span> —
                        the app shows no fare and the rider cannot book this type.</>}
                </span>
              </div>
            ) : resolved.fromFallback ? (
              <div className="rate-status rate-status-warn">
                <AlertCircle size={13} />
                <span>
                  not set — using <span className="mono">{resolved.sourceKey}</span> = {resolved.value}
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

// ─── Plain rate card (legacy, intercity and unrecognised keys) ───────────────

interface PlainCardProps {
  fieldKey: string;
  label: string;
  description: string;
  value: unknown;
  color: string;
  icon: React.ReactNode;
  tag: string;
  editing: boolean;
  saving: boolean;
  isPercent?: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: (n: number) => void;
}

const PlainRateCard: React.FC<PlainCardProps> = ({
  fieldKey, label, description, value, color, icon, tag,
  editing, saving, isPercent, onEdit, onCancel, onSave,
}) => {
  const n = parseRate(value);
  const display = n === null
    ? 'Not set'
    : isPercent ? `${(n * 100).toFixed(0)}%` : formatPKR(n, { decimals: 2 });

  return (
    <div className={`rate-card ${editing ? 'rate-card-editing' : ''}`} style={{ '--rate-color': color } as React.CSSProperties}>
      <div className="rate-card-header">
        <div className="rate-card-icon" style={{ background: `${color}15`, color }}>{icon}</div>
        <span className="rate-card-tag">{tag}</span>
      </div>
      <div className="rate-card-body">
        <div className="rate-card-label">{label}</div>
        <div className="rate-card-key mono">{fieldKey}</div>
        <div className="rate-card-desc">{description}</div>
        {editing ? (
          <RateEditor
            value={value}
            saving={saving}
            isPercent={isPercent}
            prefix={isPercent ? '' : 'PKR'}
            suffix={isPercent ? '%' : '/ km'}
            step={isPercent ? '1' : '5'}
            onCancel={onCancel}
            onSave={onSave}
          />
        ) : (
          <div className="rate-display-row">
            <div className="rate-value-wrap">
              <span className="rate-value" style={{ color: n === null ? 'var(--text-secondary)' : color }}>{display}</span>
              {!isPercent && n !== null && <span className="rate-value-unit">/ km</span>}
              {isPercent && <span className="rate-value-unit">of fare total</span>}
            </div>
            <button className="rate-edit-btn" onClick={onEdit}>
              <Edit3 size={14} /> {n === null ? 'Set Rate' : 'Edit Rate'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Main Settings Page Component ────────────────────────────────────────────

/** Keys the portal understands, so anything else can be surfaced as custom. */
const KNOWN_KEYS = new Set<string>([
  ...CABTYPES.map(c => c.key),
  ...LEGACY_RATE_KEYS,
  'city-to-city',
  'comission',
]);

const LEGACY_DESCRIPTION: Record<string, string> = {
  mini: 'Old single Mini rate. Falls back for mini_ac, mini_nonac and rickshaw.',
  regular: 'Old non-AC sedan rate. Falls back for comfort_nonac and mini_nonac.',
  ac: 'Old AC sedan rate. Falls back for comfort_ac and mini_ac.',
  comfort: 'Tier-wide Comfort rate. Falls back for comfort_ac and comfort_nonac.',
  deliver: 'Old delivery rate. Falls back for car_delivery and bike_delivery.',
  delivery: 'Alternate spelling of the old delivery rate. Falls back for car_delivery.',
};

export const Settings: React.FC = () => {
  const [rates, setRates] = useState<RatesMap>({});
  const [loading, setLoading] = useState(true);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [showLegacy, setShowLegacy] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  const showToast = (type: 'success' | 'error', msg: string) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3500);
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

  useEffect(() => { load(); }, [load]);

  /**
   * The document has held both numbers and numeric strings over its life, and
   * app builds still installed on real phones read the legacy keys directly —
   * so a key keeps whatever type it already has rather than being silently
   * converted underneath those builds.
   */
  const encode = (key: string, n: number): number | string => {
    const current = rates[key];
    if (typeof current === 'string') return String(n);
    if (current === undefined && (LEGACY_RATE_KEYS as readonly string[]).includes(key)) return String(n);
    return n;
  };

  const handleSave = async (key: string, n: number) => {
    setSavingKey(key);
    try {
      const encoded = encode(key, n);
      // merge so unrelated keys — including every legacy key an older build
      // still reads — are never dropped from the document
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

  const groups: RateGroup[] = ['cars', 'delivery', 'other', 'freight'];
  const broken = CABTYPES.filter(c => resolveRate(rates, c.key).missing);
  const fallbacks = CABTYPES.filter(c => {
    const r = resolveRate(rates, c.key);
    return !r.missing && r.fromFallback;
  });
  const legacyPresent = (LEGACY_RATE_KEYS as readonly string[]).filter(k => rates[k] !== undefined);
  const extraKeys = Object.keys(rates).filter(k => !KNOWN_KEYS.has(k));

  const cardProps = (key: string) => ({
    editing: editingKey === key,
    saving: savingKey === key,
    onEdit: () => setEditingKey(key),
    onCancel: () => setEditingKey(null),
    onSave: (n: number) => handleSave(key, n),
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
          <p>Per-kilometer rates for the nine ride types the app offers — fare = rate × km + {FARE_BASE}</p>
        </div>
        <button
          className="pay-view-all-btn settings-refresh"
          onClick={load}
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
                  key. Set each one explicitly to control its price.
                </p>
              </div>
            </div>
          )}

          {/* Sections 1–4: the nine current cabtypes */}
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

          {/* Intercity + commission — not cabtypes, but still live settings */}
          <div className="stat-section">
            <h2 className="section-title">
              <Percent size={22} />
              <span>Intercity &amp; Platform Fees</span>
              <span className="rate-badge-title" style={{ background: 'rgba(249, 115, 22, 0.12)', color: 'var(--accent-orange)' }}>
                Other
              </span>
            </h2>
            <div className="rate-cards-grid">
              <PlainRateCard
                fieldKey="city-to-city"
                label="City-to-City"
                description="Long-distance tariff for trips across city boundaries."
                value={rates['city-to-city']}
                color="#ec4899"
                icon={<Globe size={24} />}
                tag="Intercity"
                {...cardProps('city-to-city')}
              />
              <PlainRateCard
                fieldKey="comission"
                label="Platform Commission"
                description="Percentage retained by the platform from each completed trip. Stored as a decimal (0.1 = 10%); enter a whole percentage."
                value={rates['comission']}
                color="#f97316"
                icon={<Percent size={24} />}
                tag="Revenue Share"
                isPercent
                {...cardProps('comission')}
              />
            </div>
          </div>

          {/* Legacy keys — kept, never deleted */}
          {legacyPresent.length > 0 && (
            <div className="stat-section">
              <button
                className="rate-legacy-toggle"
                onClick={() => setShowLegacy(v => !v)}
                aria-expanded={showLegacy}
              >
                <Archive size={18} />
                <span>Legacy (older app versions)</span>
                <span className="rate-badge-title" style={{ background: 'rgba(100, 116, 139, 0.12)', color: '#64748b' }}>
                  {legacyPresent.length} {legacyPresent.length === 1 ? 'key' : 'keys'}
                </span>
                <ChevronDown size={18} className={`rate-legacy-chevron${showLegacy ? ' open' : ''}`} />
              </button>
              {showLegacy && (
                <>
                  <p className="rate-legacy-note">
                    Current app builds do not read these keys — they price from the nine keys above.
                    App versions still installed on real phones do read them directly, and several
                    act as fallbacks for unset current keys, so they are kept and editable rather
                    than deleted or renamed.
                  </p>
                  <div className="rate-cards-grid">
                    {legacyPresent.map(k => (
                      <PlainRateCard
                        key={k}
                        fieldKey={k}
                        label={k}
                        description={LEGACY_DESCRIPTION[k] || 'Legacy per-kilometer rate.'}
                        value={rates[k]}
                        color="#64748b"
                        icon={<Archive size={24} />}
                        tag="Legacy"
                        {...cardProps(k)}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Keys in the document the portal does not recognise */}
          {extraKeys.length > 0 && (
            <div className="stat-section">
              <h2 className="section-title">
                <DollarSign size={22} />
                <span>Additional Configurations</span>
                <span className="rate-badge-title" style={{ background: 'rgba(100, 116, 139, 0.12)', color: '#64748b' }}>
                  Custom Keys
                </span>
              </h2>
              <div className="rate-cards-grid">
                {extraKeys.map(k => (
                  <PlainRateCard
                    key={k}
                    fieldKey={k}
                    label={k}
                    description="Key present in the rates document that the portal does not recognise."
                    value={rates[k]}
                    color="#64748b"
                    icon={<DollarSign size={24} />}
                    tag="Custom Field"
                    {...cardProps(k)}
                  />
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
              from. <strong>Freight is the exception:</strong> the freight booking screen reads
              <span className="mono"> freight </span> directly with no fallback, so leaving it unset
              breaks freight fares outright. Commission is stored as a decimal multiplier
              (<strong>0.1</strong> = <strong>10%</strong>); enter whole percentages and the portal
              converts.
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default Settings;

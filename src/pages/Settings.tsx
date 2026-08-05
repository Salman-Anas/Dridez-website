import React, { useEffect, useState, useCallback } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import {
  Car, Truck, Globe, Package, Percent,
  RefreshCw, CheckCircle, AlertCircle, Loader,
  Edit3, X, DollarSign, Zap, Check
} from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface RatesDoc {
  ac?: string;
  'city-to-city'?: string;
  comission?: string;
  deliver?: string;
  freight?: string;
  mini?: string;
  regular?: string;
  [key: string]: string | undefined;
}

interface RateField {
  key: string;
  label: string;
  tag: string;
  description: string;
  icon: React.ReactNode;
  color: string;
  prefix: string;
  suffix: string;
  unitLabel: string;
  isPercent?: boolean;
}

// ─── Rate field meta ──────────────────────────────────────────────────────────

const RATE_FIELDS: RateField[] = [
  {
    key: 'regular',
    label: 'Regular Ride',
    tag: 'Standard',
    description: 'Base per-kilometer fare applied to standard commuter car rides.',
    icon: <Car size={24} />,
    color: '#3b82f6',
    prefix: 'Rs.',
    suffix: '/ km',
    unitLabel: '/ km',
  },
  {
    key: 'mini',
    label: 'Mini Ride',
    tag: 'Economy',
    description: 'Budget-friendly per-kilometer tariff for compact vehicles and city trips.',
    icon: <Car size={24} />,
    color: '#8b5cf6',
    prefix: 'Rs.',
    suffix: '/ km',
    unitLabel: '/ km',
  },
  {
    key: 'ac',
    label: 'AC / Premium',
    tag: 'Comfort',
    description: 'Premium fare rates for air-conditioned and high-comfort fleet rides.',
    icon: <Zap size={24} />,
    color: '#06b6d4',
    prefix: 'Rs.',
    suffix: '/ km',
    unitLabel: '/ km',
  },
  {
    key: 'freight',
    label: 'Freight & Cargo',
    tag: 'Logistics',
    description: 'Heavy transport and logistics haulage per-kilometer pricing rate.',
    icon: <Truck size={24} />,
    color: '#f59e0b',
    prefix: 'Rs.',
    suffix: '/ km',
    unitLabel: '/ km',
  },
  {
    key: 'deliver',
    label: 'Package Delivery',
    tag: 'Courier',
    description: 'Point-to-point courier and express parcel delivery rates per kilometer.',
    icon: <Package size={24} />,
    color: '#10b981',
    prefix: 'Rs.',
    suffix: '/ km',
    unitLabel: '/ km',
  },
  {
    key: 'city-to-city',
    label: 'City-to-City',
    tag: 'Intercity',
    description: 'Long-distance travel tariff for trips across municipal or city boundaries.',
    icon: <Globe size={24} />,
    color: '#ec4899',
    prefix: 'Rs.',
    suffix: '/ km',
    unitLabel: '/ km',
  },
  {
    key: 'comission',
    label: 'Platform Commission',
    tag: 'Revenue Share',
    description: 'Percentage cut retained by the platform from each successfully completed trip.',
    icon: <Percent size={24} />,
    color: '#f97316',
    prefix: '',
    suffix: '%',
    unitLabel: 'of fare total',
    isPercent: true,
  },
];

// ─── Rate Card Component ──────────────────────────────────────────────────────

interface RateCardProps {
  field: RateField;
  value: string;
  editing: boolean;
  saving: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: (val: string) => void;
}

const RateCard: React.FC<RateCardProps> = ({
  field, value, editing, saving, onEdit, onCancel, onSave,
}) => {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState('');

  // Sync draft when value changes from outside
  useEffect(() => {
    if (!editing) {
      setDraft(field.isPercent ? (parseFloat(value || '0') * 100).toString() : value);
    }
  }, [value, editing, field.isPercent]);

  const displayValue = field.isPercent
    ? `${(parseFloat(value || '0') * 100).toFixed(0)}%`
    : `Rs. ${value || '0'}`;

  const handleSave = () => {
    const n = parseFloat(draft);
    if (isNaN(n) || n < 0) {
      setError('Enter a valid positive number');
      return;
    }
    if (field.isPercent && n > 100) {
      setError('Percentage cannot exceed 100%');
      return;
    }
    setError('');
    // If percent, convert integer percentage (e.g. 10) back to decimal string (0.1) for Firestore
    const toSave = field.isPercent ? (n / 100).toString() : draft.trim();
    onSave(toSave);
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSave();
    if (e.key === 'Escape') {
      setDraft(field.isPercent ? (parseFloat(value || '0') * 100).toString() : value);
      setError('');
      onCancel();
    }
  };

  return (
    <div
      className={`rate-card ${editing ? 'rate-card-editing' : ''}`}
      style={{ '--rate-color': field.color } as React.CSSProperties}
    >
      {/* Header icon & Tag */}
      <div className="rate-card-header">
        <div className="rate-card-icon" style={{ background: `${field.color}15`, color: field.color }}>
          {field.icon}
        </div>
        <span className="rate-card-tag">{field.tag}</span>
      </div>

      {/* Body Content */}
      <div className="rate-card-body">
        <div className="rate-card-label">{field.label}</div>
        <div className="rate-card-desc">{field.description}</div>

        {editing ? (
          <div className="rate-edit-row">
            <div className="rate-input-wrap">
              {field.prefix && <span className="rate-input-prefix">{field.prefix}</span>}
              <input
                className="rate-input"
                type="number"
                step={field.isPercent ? '1' : '5'}
                min="0"
                value={draft}
                onChange={e => { setDraft(e.target.value); setError(''); }}
                onKeyDown={handleKey}
                autoFocus
              />
              {field.suffix && <span className="rate-input-suffix">{field.suffix}</span>}
            </div>
            {error && <div className="rate-error"><AlertCircle size={13} /> {error}</div>}
            <div className="rate-edit-actions">
              <button className="rate-save-btn" onClick={handleSave} disabled={saving}>
                {saving ? <Loader size={14} className="spin" /> : <Check size={15} />}
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button
                className="rate-cancel-btn"
                onClick={() => {
                  setDraft(field.isPercent ? (parseFloat(value || '0') * 100).toString() : value);
                  setError('');
                  onCancel();
                }}
              >
                <X size={14} /> Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="rate-display-row">
            <div className="rate-value-wrap">
              <span className="rate-value" style={{ color: field.color }}>{displayValue}</span>
              <span className="rate-value-unit">{field.unitLabel}</span>
            </div>
            <button className="rate-edit-btn" onClick={onEdit} title="Modify pricing rate">
              <Edit3 size={14} /> Edit Rate
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Unknown / Custom Rate Card ───────────────────────────────────────────────

const UnknownRateCard: React.FC<{
  fieldKey: string;
  value: string;
  editing: boolean;
  saving: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: (v: string) => void;
}> = ({ fieldKey, value, editing, saving, onEdit, onCancel, onSave }) => {
  const [draft, setDraft] = useState(value);
  useEffect(() => { if (!editing) setDraft(value); }, [value, editing]);
  
  const handleSave = () => { onSave(draft.trim()); };

  return (
    <div className={`rate-card ${editing ? 'rate-card-editing' : ''}`} style={{ '--rate-color': '#64748b' } as React.CSSProperties}>
      <div className="rate-card-header">
        <div className="rate-card-icon" style={{ background: 'rgba(100,116,139,0.12)', color: '#64748b' }}>
          <DollarSign size={24} />
        </div>
        <span className="rate-card-tag">Custom Field</span>
      </div>
      <div className="rate-card-body">
        <div className="rate-card-label" style={{ textTransform: 'capitalize' }}>{fieldKey}</div>
        <div className="rate-card-desc">Additional database price parameter.</div>
        {editing ? (
          <div className="rate-edit-row">
            <div className="rate-input-wrap">
              <span className="rate-input-prefix">Rs.</span>
              <input
                className="rate-input"
                value={draft}
                onChange={e => setDraft(e.target.value)}
                autoFocus
              />
            </div>
            <div className="rate-edit-actions">
              <button className="rate-save-btn" onClick={handleSave} disabled={saving}>
                {saving ? <Loader size={14} className="spin" /> : <Check size={15} />}
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button className="rate-cancel-btn" onClick={() => { setDraft(value); onCancel(); }}>
                <X size={14} /> Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="rate-display-row">
            <div className="rate-value-wrap">
              <span className="rate-value" style={{ color: '#64748b' }}>Rs. {value || '0'}</span>
            </div>
            <button className="rate-edit-btn" onClick={onEdit}><Edit3 size={14} /> Edit Rate</button>
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Main Settings Page Component ─────────────────────────────────────────────

export const Settings: React.FC = () => {
  const [rates, setRates] = useState<RatesDoc>({});
  const [loading, setLoading] = useState(true);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  const showToast = (type: 'success' | 'error', msg: string) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3500);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const snap = await getDoc(doc(db, 'rates', 'rates'));
      if (snap.exists()) {
        setRates(snap.data() as RatesDoc);
      }
    } catch (e) {
      console.error(e);
      showToast('error', 'Failed to load pricing rates');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSave = async (key: string, value: string) => {
    setSavingKey(key);
    try {
      await setDoc(doc(db, 'rates', 'rates'), { [key]: value }, { merge: true });
      setRates(prev => ({ ...prev, [key]: value }));
      setEditingKey(null);
      showToast('success', `${key.toUpperCase()} configuration saved successfully`);
    } catch (e) {
      console.error(e);
      showToast('error', 'Database synchronization failed. Try again.');
    } finally {
      setSavingKey(null);
    }
  };

  const vehicleFields = RATE_FIELDS.filter(f => !f.isPercent);
  const commissionFields = RATE_FIELDS.filter(f => f.isPercent);
  const knownKeys = new Set(RATE_FIELDS.map(f => f.key));
  const extraKeys = Object.keys(rates).filter(k => !knownKeys.has(k));

  return (
    <div className="settings-page">
      {/* Notification Toast */}
      {toast && (
        <div className={`settings-toast ${toast.type === 'success' ? 'toast-success' : 'toast-error'}`}>
          {toast.type === 'success' ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
          <span>{toast.msg}</span>
        </div>
      )}

      {/* Page Header (matching portal dashboard style) */}
      <div className="dashboard-header settings-top-bar">
        <div>
          <h1>Platform Settings & Pricing</h1>
          <p>Configure live per-kilometer tariffs for rides, deliveries, and revenue share</p>
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
          {/* Section 1: Vehicle & Trip Pricing */}
          <div className="stat-section">
            <h2 className="section-title">
              <Car size={22} />
              <span>Vehicle & Trip Tariffs</span>
              <span className="rate-badge-title">Per-Kilometer Rates</span>
            </h2>
            <div className="rate-cards-grid">
              {vehicleFields.map(field => (
                <RateCard
                  key={field.key}
                  field={field}
                  value={rates[field.key] ?? ''}
                  editing={editingKey === field.key}
                  saving={savingKey === field.key}
                  onEdit={() => setEditingKey(field.key)}
                  onCancel={() => setEditingKey(null)}
                  onSave={val => handleSave(field.key, val)}
                />
              ))}
            </div>
          </div>

          {/* Section 2: Platform Revenue Share */}
          <div className="stat-section">
            <h2 className="section-title">
              <Percent size={22} />
              <span>Revenue & Platform Fees</span>
              <span className="rate-badge-title" style={{ background: 'rgba(249, 115, 22, 0.12)', color: 'var(--accent-orange)' }}>Commission</span>
            </h2>
            <div className="rate-cards-grid">
              {commissionFields.map(field => (
                <RateCard
                  key={field.key}
                  field={field}
                  value={rates[field.key] ?? ''}
                  editing={editingKey === field.key}
                  saving={savingKey === field.key}
                  onEdit={() => setEditingKey(field.key)}
                  onCancel={() => setEditingKey(null)}
                  onSave={val => handleSave(field.key, val)}
                />
              ))}
            </div>
          </div>

          {/* Section 3: Extra / Custom Database Fields (if any arise in Firestore) */}
          {extraKeys.length > 0 && (
            <div className="stat-section">
              <h2 className="section-title">
                <DollarSign size={22} />
                <span>Additional Configurations</span>
                <span className="rate-badge-title" style={{ background: 'rgba(100, 116, 139, 0.12)', color: '#64748b' }}>Custom Keys</span>
              </h2>
              <div className="rate-cards-grid">
                {extraKeys.map(k => (
                  <UnknownRateCard
                    key={k}
                    fieldKey={k}
                    value={rates[k] ?? ''}
                    editing={editingKey === k}
                    saving={savingKey === k}
                    onEdit={() => setEditingKey(k)}
                    onCancel={() => setEditingKey(null)}
                    onSave={val => handleSave(k, val)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* System Advisory Callout Box */}
          <div className="settings-note-box">
            <div className="snb-icon">
              <AlertCircle size={22} />
            </div>
            <div className="snb-text">
              <strong>Database Storage Architecture Note:</strong> In Firestore, platform commission is maintained as a decimal multiplier (e.g. <strong>0.1</strong> representing <strong>10%</strong>). When editing above, you can conveniently input standard whole percentage values (e.g. <strong>10</strong>) and the platform will automatically format and synchronize the decimal representation to the backend.
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default Settings;

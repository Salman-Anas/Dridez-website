import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  addDoc, collection, deleteDoc, doc, onSnapshot, serverTimestamp, updateDoc,
} from 'firebase/firestore';
import {
  AlertCircle, ArrowLeft, Check, ChartSpline, ClipboardPaste, Loader, MapPin,
  Pencil, Plus, RotateCcw, Save, Scissors, Trash2, X,
} from 'lucide-react';
import { db } from '../firebase';
import { formatPKR } from '../utils/rideTaxonomy';
import {
  EMPTY_CURVE, TEST_RATES_COLLECTION, curveFare, curveSegments, newPointId, parsePointLines,
  parseRegion, summarizeError,
  type FareCurve, type PointError, type TestPoint, type TestRegion,
} from '../utils/testRatesSchema';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const regionRef = (id: string) => doc(db, TEST_RATES_COLLECTION, id);

/** Firestore refuses `undefined`, so an empty label is left out entirely. */
const storedPoint = ({ id, distance, rate, label }: TestPoint) =>
  ({ id, distance, rate, ...(label ? { label } : {}) });

const savePoints = (regionId: string, points: TestPoint[]) =>
  updateDoc(regionRef(regionId), { points: points.map(storedPoint), updatedAt: serverTimestamp() });

const hasCurve = (c: FareCurve) => c.minFare > 0 || c.perKm > 0 || c.cuts.some(k => k.perKm > 0);

const num = (n: number, decimals = 2) =>
  n.toLocaleString('en-PK', { maximumFractionDigits: decimals });

/** PKR with paise only when the amount has them: 240, but 234.60. */
const pkr = (n: number) => formatPKR(n, { decimals: Math.abs(n - Math.round(n)) < 0.005 ? 0 : 2 });

const signedPKR = (n: number) => {
  const r = Math.round(n * 100) / 100;
  return `${r > 0 ? '+' : r < 0 ? '−' : ''}${pkr(Math.abs(r))}`;
};

const signedPct = (p: number | null) =>
  p === null ? '—' : `${p > 0 ? '+' : p < 0 ? '−' : ''}${num(Math.abs(p) * 100, 1)}%`;

/** A non-negative number from an input, or null. */
const parseField = (s: string): number | null => {
  if (s.trim() === '') return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/** The curve as one line per stretch, e.g. "2.5 – 100 km  + 38 / km  (from 170)". */
const CurveFormula: React.FC<{ curve: FareCurve }> = ({ curve }) => (
  <ul className="gr-formula mono">
    {curve.threshold > 0 && (
      <li><span>0 – {num(curve.threshold)} km</span><span>{num(curve.minFare)} flat</span></li>
    )}
    {curveSegments(curve).map(g => (
      <li key={g.fromKm}>
        <span>{num(g.fromKm)}{g.toKm === Infinity ? '+ km' : ` – ${num(g.toKm)} km`}</span>
        <span>+ {num(g.perKm)} / km <em>from {num(g.fareAtStart)}</em></span>
      </li>
    ))}
  </ul>
);

/** A 1-2-5 step that splits `span` into about `target` intervals. */
const niceStep = (span: number, target: number) => {
  const raw = span / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
};

const ticks = (max: number, step: number) =>
  Array.from({ length: Math.round(max / step) + 1 }, (_, i) => +(i * step).toFixed(6));

// ─── Chart ────────────────────────────────────────────────────────────────────

type Hover = { kind: 'point'; row: PointError } | { kind: 'x'; distance: number } | null;

const FareChart: React.FC<{ rows: PointError[]; curve: FareCurve; showCurve: boolean }> = ({ rows, curve, showCurve }) => {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  const [hover, setHover] = useState<Hover>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(280, Math.floor(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const narrow = width < 520;
  const height = narrow ? 280 : 380;
  const m = { top: 18, right: 18, bottom: 46, left: narrow ? 52 : 64 };
  const pw = width - m.left - m.right;
  const ph = height - m.top - m.bottom;

  const segments = curveSegments(curve);
  const maxD = Math.max(1, curve.threshold, ...segments.map(g => g.fromKm), ...rows.map(r => r.point.distance)) * 1.05;
  const xStep = niceStep(maxD, narrow ? 4 : 8);
  const xMax = Math.ceil(maxD / xStep) * xStep;
  const maxY = Math.max(
    1,
    ...rows.map(r => r.point.rate),
    ...(showCurve ? [curve.minFare, curveFare(curve, xMax)] : []),
  ) * 1.05;
  const yStep = niceStep(maxY, narrow ? 4 : 6);
  const yMax = Math.ceil(maxY / yStep) * yStep;

  const sx = (d: number) => m.left + (d / xMax) * pw;
  const sy = (v: number) => m.top + ph - (v / yMax) * ph;

  // A straight line between each place the slope changes.
  const curvePath = [0, curve.threshold, ...segments.map(g => g.fromKm), xMax]
    .filter(d => d <= xMax)
    .map((d, i) => `${i ? 'L' : 'M'}${sx(d)},${sy(curveFare(curve, d))}`)
    .join(' ');

  // Dashed markers at the threshold and at every cut.
  const markers = [
    ...(curve.threshold > 0 ? [{ km: curve.threshold, label: `threshold ${num(curve.threshold)} km` }] : []),
    ...segments.slice(1).map(g => ({ km: g.fromKm, label: `cut ${num(g.fromKm)} km` })),
  ];

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - box.left;
    const py = e.clientY - box.top;
    let best: PointError | null = null;
    let bestDist = 24;
    for (const r of rows) {
      const d = Math.hypot(sx(r.point.distance) - px, sy(r.point.rate) - py);
      if (d <= bestDist) { best = r; bestDist = d; }
    }
    if (best) setHover({ kind: 'point', row: best });
    else if (showCurve && px >= m.left && px <= m.left + pw && py >= m.top && py <= m.top + ph) {
      setHover({ kind: 'x', distance: ((px - m.left) / pw) * xMax });
    } else setHover(null);
  };

  // Tooltip anchor in chart pixels; flipped left near the right edge.
  let tip: { x: number; y: number; body: React.ReactNode } | null = null;
  if (hover?.kind === 'point') {
    const { point, ours, diff, pct } = hover.row;
    tip = {
      x: sx(point.distance), y: sy(point.rate),
      body: (
        <>
          <div className="gr-tip-head">{num(point.distance)} km{point.label ? ` · ${point.label}` : ''}</div>
          <div className="gr-tip-row"><span className="gr-key gr-key-dot" /><strong>{pkr(point.rate)}</strong><span>test rate</span></div>
          {showCurve && <>
            <div className="gr-tip-row"><span className="gr-key gr-key-line" /><strong>{pkr(ours)}</strong><span>our curve</span></div>
            <div className="gr-tip-row"><span className="gr-key" /><strong>{signedPKR(diff)}</strong><span>{signedPct(pct)} {diff >= 0 ? 'over' : 'under'}</span></div>
          </>}
        </>
      ),
    };
  } else if (hover?.kind === 'x') {
    const fare = curveFare(curve, hover.distance);
    const seg = hover.distance > curve.threshold ? segments.find(g => hover.distance <= g.toKm) : undefined;
    tip = {
      x: sx(hover.distance), y: sy(fare),
      body: (
        <>
          <div className="gr-tip-head">{num(hover.distance, 1)} km</div>
          <div className="gr-tip-row"><span className="gr-key gr-key-line" /><strong>{pkr(fare)}</strong><span>our curve</span></div>
          <div className="gr-tip-row"><span className="gr-key" /><span>{seg ? `${pkr(seg.perKm)} / km here` : 'min fare here'}</span></div>
        </>
      ),
    };
  }

  return (
    <div className="gr-chart" ref={wrapRef}>
      <div className="gr-legend">
        <span><span className="gr-key gr-key-dot" /> Test rates</span>
        {showCurve && <span><span className="gr-key gr-key-line" /> Our curve</span>}
        {showCurve && rows.length > 0 && <span><span className="gr-key gr-key-gap" /> Gap between them</span>}
      </div>

      <svg
        width={width}
        height={height}
        role="img"
        aria-label="Test rates plotted by distance, with the fare curve"
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        {/* Grid and axes */}
        {ticks(yMax, yStep).map(v => (
          <g key={`y${v}`}>
            <line x1={m.left} x2={m.left + pw} y1={sy(v)} y2={sy(v)} className={v === 0 ? 'gr-axis' : 'gr-grid'} />
            <text x={m.left - 8} y={sy(v)} className="gr-tick" textAnchor="end" dominantBaseline="middle">{num(v, 0)}</text>
          </g>
        ))}
        {ticks(xMax, xStep).map(d => (
          <text key={`x${d}`} x={sx(d)} y={m.top + ph + 18} className="gr-tick" textAnchor="middle">{num(d, 1)}</text>
        ))}
        <text x={m.left + pw / 2} y={height - 6} className="gr-axis-title" textAnchor="middle">Distance (km)</text>
        <text
          transform={`translate(14 ${m.top + ph / 2}) rotate(-90)`}
          className="gr-axis-title"
          textAnchor="middle"
        >Fare (PKR)</text>

        {showCurve && markers.map((mk, i) => {
          const flip = sx(mk.km) > m.left + pw - 90;
          return (
            <g key={`mk${mk.km}`}>
              <line x1={sx(mk.km)} x2={sx(mk.km)} y1={m.top} y2={m.top + ph} className="gr-threshold" />
              <text
                x={sx(mk.km) + (flip ? -6 : 6)}
                y={m.top + 12 + (i % 2) * 14}
                textAnchor={flip ? 'end' : 'start'}
                className="gr-tick"
              >{mk.label}</text>
            </g>
          );
        })}

        {/* How far each test rate sits from the curve */}
        {showCurve && rows.map(r => (
          <line
            key={`gap${r.point.id}`}
            x1={sx(r.point.distance)} x2={sx(r.point.distance)}
            y1={sy(r.point.rate)} y2={sy(r.ours)}
            className="gr-gap"
          />
        ))}

        {showCurve && <path d={curvePath} className="gr-curve" />}

        {hover?.kind === 'x' && (
          <g>
            <line x1={sx(hover.distance)} x2={sx(hover.distance)} y1={m.top} y2={m.top + ph} className="gr-crosshair" />
            <circle cx={sx(hover.distance)} cy={sy(curveFare(curve, hover.distance))} r={4.5} className="gr-curve-dot" />
          </g>
        )}

        {rows.map(r => (
          <circle
            key={r.point.id}
            cx={sx(r.point.distance)}
            cy={sy(r.point.rate)}
            r={hover?.kind === 'point' && hover.row.point.id === r.point.id ? 7 : 5}
            className="gr-dot"
            tabIndex={0}
            aria-label={`${num(r.point.distance)} km, ${pkr(r.point.rate)}`}
            onFocus={() => setHover({ kind: 'point', row: r })}
            onBlur={() => setHover(null)}
          />
        ))}
      </svg>

      {rows.length === 0 && (
        <div className="gr-chart-empty">Add a test rate below to plot it</div>
      )}

      {tip && (
        <div
          className="gr-tip"
          style={{
            left: tip.x > width - 210 ? undefined : tip.x + 14,
            right: tip.x > width - 210 ? width - tip.x + 14 : undefined,
            top: Math.max(0, Math.min(tip.y - 20, height - 110)) + 30,
          }}
        >
          {tip.body}
        </div>
      )}
    </div>
  );
};

// ─── Region detail ────────────────────────────────────────────────────────────

type BaseKey = 'minFare' | 'threshold' | 'perKm';

const CURVE_FIELDS: { key: BaseKey; label: string; unit: string; hint: string }[] = [
  { key: 'minFare', label: 'Min fare', unit: 'PKR', hint: 'Charged for any trip up to the threshold' },
  { key: 'threshold', label: 'Threshold', unit: 'km', hint: 'Distance below which the min fare is charged' },
  { key: 'perKm', label: 'Per km rate', unit: 'PKR / km', hint: 'Charged on each km above the threshold' },
];

interface CutDraft { key: string; fromKm: string; perKm: string }

type CurveDraft = Record<BaseKey, string> & { cuts: CutDraft[] };

const blank = (n: number) => (n ? String(n) : '');

const toDraft = (c: FareCurve): CurveDraft => ({
  minFare: blank(c.minFare),
  threshold: blank(c.threshold),
  perKm: blank(c.perKm),
  cuts: c.cuts.map(k => ({ key: newPointId(), fromKm: String(k.fromKm), perKm: blank(k.perKm) })),
});

/** Compares curves by value, cut order included. */
const curveKey = (c: FareCurve) => JSON.stringify([c.minFare, c.threshold, c.perKm, c.cuts.map(k => [k.fromKm, k.perKm])]);

const RegionView: React.FC<{ region: TestRegion; onBack: () => void }> = ({ region, onBack }) => {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // ── Name
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(region.name);

  const rename = async () => {
    const name = nameDraft.trim();
    if (!name || name === region.name) { setRenaming(false); return; }
    setBusy(true);
    try {
      await updateDoc(regionRef(region.id), { name, updatedAt: serverTimestamp() });
      setRenaming(false);
    } catch (e) { setError(`Could not rename: ${(e as Error).message}`); }
    finally { setBusy(false); }
  };

  const removeRegion = async () => {
    if (!window.confirm(`Delete "${region.name}" and its ${region.points.length} test rates? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await deleteDoc(regionRef(region.id));
      onBack();
    } catch (e) { setError(`Could not delete: ${(e as Error).message}`); setBusy(false); }
  };

  // ── Curve: edited live on the chart, written only on Save
  const savedKey = curveKey(region.curve);
  const [draft, setDraft] = useState<CurveDraft>(() => toDraft(region.curve));
  // eslint-disable-next-line react-hooks/exhaustive-deps -- savedKey stands for region.curve
  useEffect(() => { setDraft(toDraft(region.curve)); }, [region.id, savedKey]);
  const [focusCut, setFocusCut] = useState<string | null>(null);

  const base = {
    minFare: parseField(draft.minFare || '0'),
    threshold: parseField(draft.threshold || '0'),
    perKm: parseField(draft.perKm || '0'),
  };
  const baseValid = base.minFare !== null && base.threshold !== null && base.perKm !== null;

  // A cut that can't be placed yet is left off the chart and blocks saving.
  const cutErrors: Record<string, { field: 'fromKm' | 'perKm'; msg: string } | null> = {};
  const seenKm = new Set<number>();
  for (const k of draft.cuts) {
    const fromKm = parseField(k.fromKm);
    const fromMsg =
      k.fromKm.trim() === '' ? 'Enter the km this cut starts at'
      : fromKm === null ? 'Enter a number, 0 or more'
      : base.threshold !== null && fromKm <= base.threshold ? `Must start after the threshold (${num(base.threshold)} km)`
      : seenKm.has(fromKm) ? 'Another cut already starts here'
      : null;
    cutErrors[k.key] = fromMsg ? { field: 'fromKm', msg: fromMsg }
      : parseField(k.perKm || '0') === null ? { field: 'perKm', msg: 'Enter a per km rate, 0 or more' }
      : null;
    if (fromKm !== null) seenKm.add(fromKm);
  }
  const cutsValid = draft.cuts.every(k => !cutErrors[k.key]);

  const curve: FareCurve = baseValid
    ? {
      minFare: base.minFare!, threshold: base.threshold!, perKm: base.perKm!,
      cuts: draft.cuts
        .filter(k => !cutErrors[k.key])
        .map(k => ({ fromKm: Number(k.fromKm), perKm: Number(k.perKm || 0) }))
        .sort((a, b) => a.fromKm - b.fromKm),
    }
    : region.curve;
  const changed = !baseValid || !cutsValid || curveKey(curve) !== savedKey;
  const canSave = baseValid && cutsValid && changed;
  const showCurve = hasCurve(curve);

  const addCut = () => {
    // Start from the rate of the last stretch so the new line is easy to tune.
    const last = draft.cuts.at(-1)?.perKm ?? draft.perKm;
    const key = newPointId();
    setDraft(d => ({ ...d, cuts: [...d.cuts, { key, fromKm: '', perKm: last }] }));
    setFocusCut(key);
  };
  const setCut = (key: string, patch: Partial<CutDraft>) =>
    setDraft(d => ({ ...d, cuts: d.cuts.map(k => (k.key === key ? { ...k, ...patch } : k)) }));
  const removeCut = (key: string) => setDraft(d => ({ ...d, cuts: d.cuts.filter(k => k.key !== key) }));

  const saveCurve = async () => {
    setBusy(true);
    try {
      await updateDoc(regionRef(region.id), { curve, updatedAt: serverTimestamp() });
    } catch (e) { setError(`Could not save the curve: ${(e as Error).message}`); }
    finally { setBusy(false); }
  };

  const summary = summarizeError(region.points, curve);

  // ── Adding test rates
  const [pasteMode, setPasteMode] = useState(false);
  const [newPoint, setNewPoint] = useState({ distance: '', rate: '', label: '' });
  const [pasteText, setPasteText] = useState('');
  const distanceInput = useRef<HTMLInputElement>(null);

  const addOne = async (e: React.FormEvent) => {
    e.preventDefault();
    const distance = parseField(newPoint.distance);
    const rate = parseField(newPoint.rate);
    if (distance === null || rate === null) { setError('Enter a distance and a rate, both 0 or more.'); return; }
    const label = newPoint.label.trim();
    setBusy(true);
    try {
      await savePoints(region.id, [...region.points, { id: newPointId(), distance, rate, ...(label ? { label } : {}) }]);
      setNewPoint(p => ({ distance: '', rate: '', label: p.label }));
      setError(null);
      distanceInput.current?.focus();
    } catch (err) { setError(`Could not add the rate: ${(err as Error).message}`); }
    finally { setBusy(false); }
  };

  const pasted = useMemo(() => parsePointLines(pasteText), [pasteText]);

  const addPasted = async () => {
    if (!pasted.points.length) return;
    setBusy(true);
    try {
      await savePoints(region.id, [...region.points, ...pasted.points.map(p => ({ ...p, id: newPointId() }))]);
      setPasteText('');
      setPasteMode(false);
      setError(null);
    } catch (err) { setError(`Could not add the rates: ${(err as Error).message}`); }
    finally { setBusy(false); }
  };

  // ── Editing and removing test rates
  const [editing, setEditing] = useState<{ id: string; distance: string; rate: string; label: string } | null>(null);

  const saveEdit = async () => {
    if (!editing) return;
    const distance = parseField(editing.distance);
    const rate = parseField(editing.rate);
    if (distance === null || rate === null) { setError('Enter a distance and a rate, both 0 or more.'); return; }
    const label = editing.label.trim();
    setBusy(true);
    try {
      await savePoints(region.id, region.points.map(p =>
        p.id === editing.id ? { id: p.id, distance, rate, ...(label ? { label } : {}) } : p));
      setEditing(null);
      setError(null);
    } catch (err) { setError(`Could not save the rate: ${(err as Error).message}`); }
    finally { setBusy(false); }
  };

  const removePoint = async (id: string) => {
    setBusy(true);
    try { await savePoints(region.id, region.points.filter(p => p.id !== id)); }
    catch (err) { setError(`Could not remove the rate: ${(err as Error).message}`); }
    finally { setBusy(false); }
  };

  const worst = summary.worst;

  return (
    <div className="gr-region">
      <div className="gr-region-head">
        <button className="gr-icon-btn" onClick={onBack} aria-label="Back to regions"><ArrowLeft size={18} /></button>
        {renaming ? (
          <form className="gr-rename" onSubmit={e => { e.preventDefault(); void rename(); }}>
            <input className="form-input" value={nameDraft} onChange={e => setNameDraft(e.target.value)} autoFocus maxLength={80} />
            <button className="gr-icon-btn" type="submit" disabled={busy} aria-label="Save name"><Check size={16} /></button>
            <button className="gr-icon-btn" type="button" onClick={() => { setRenaming(false); setNameDraft(region.name); }} aria-label="Cancel"><X size={16} /></button>
          </form>
        ) : (
          <h1>
            {region.name}
            <button className="gr-icon-btn gr-icon-btn-sm" onClick={() => { setNameDraft(region.name); setRenaming(true); }} aria-label="Rename region"><Pencil size={14} /></button>
          </h1>
        )}
        <button className="gr-danger-btn" onClick={() => { void removeRegion(); }} disabled={busy}>
          <Trash2 size={15} /> Delete region
        </button>
      </div>

      {error && (
        <div className="rate-alert rate-alert-error">
          <AlertCircle size={20} />
          <div><strong>Something went wrong</strong><p>{error}</p></div>
          <button className="gr-icon-btn gr-alert-close" onClick={() => setError(null)} aria-label="Dismiss"><X size={16} /></button>
        </div>
      )}

      <div className="gr-layout">
        <section className="gr-card gr-chart-card">
          <FareChart rows={summary.rows} curve={curve} showCurve={showCurve} />
        </section>

        <section className="gr-card gr-curve-card">
          <h2>Fare curve</h2>
          <div className="gr-curve-fields">
            {CURVE_FIELDS.map(f => {
              const bad = draft[f.key].trim() !== '' && parseField(draft[f.key]) === null;
              return (
                <label key={f.key} className="gr-field">
                  <span className="gr-field-label">{f.label} <em>{f.unit}</em></span>
                  <input
                    className={`form-input${bad ? ' gr-input-bad' : ''}`}
                    inputMode="decimal"
                    placeholder="0"
                    value={draft[f.key]}
                    onChange={e => setDraft(d => ({ ...d, [f.key]: e.target.value }))}
                  />
                  <span className="gr-field-hint">{bad ? 'Enter a number, 0 or more' : f.hint}</span>
                </label>
              );
            })}
          </div>
          {draft.cuts.length > 0 && (
            <div className="gr-cuts">
              {draft.cuts.map((k, i) => {
                const err = cutErrors[k.key];
                return (
                  <div key={k.key} className="gr-cut">
                    <div className="gr-cut-head">
                      <span><Scissors size={13} /> Cut {i + 1}</span>
                      <button className="gr-icon-btn gr-icon-btn-sm" onClick={() => removeCut(k.key)} aria-label={`Remove cut ${i + 1}`}><X size={14} /></button>
                    </div>
                    <div className="gr-cut-fields">
                      <label className="gr-field">
                        <span className="gr-field-label">From <em>km</em></span>
                        <input
                          className={`form-input${err?.field === 'fromKm' && k.fromKm.trim() !== '' ? ' gr-input-bad' : ''}`}
                          inputMode="decimal"
                          placeholder="e.g. 100"
                          value={k.fromKm}
                          autoFocus={focusCut === k.key}
                          onChange={e => setCut(k.key, { fromKm: e.target.value })}
                        />
                      </label>
                      <label className="gr-field">
                        <span className="gr-field-label">Rate <em>PKR / km</em></span>
                        <input
                          className={`form-input${err?.field === 'perKm' ? ' gr-input-bad' : ''}`}
                          inputMode="decimal"
                          placeholder="0"
                          value={k.perKm}
                          onChange={e => setCut(k.key, { perKm: e.target.value })}
                        />
                      </label>
                    </div>
                    <span className={`gr-field-hint${err && k.fromKm.trim() !== '' ? ' gr-hint-bad' : ''}`}>
                      {err?.msg ?? `From ${num(Number(k.fromKm))} km on, each km costs ${num(Number(k.perKm || 0))}`}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
          <CurveFormula curve={curve} />
          <div className="gr-curve-actions">
            <button className="page-head-btn" onClick={() => { void saveCurve(); }} disabled={!canSave || busy}>
              <Save size={15} /> {changed ? 'Save curve' : 'Saved'}
            </button>
            <button className="btn-secondary" onClick={addCut} disabled={!baseValid}>
              <Scissors size={14} /> Add cut
            </button>
            {changed && (
              <button className="btn-secondary" onClick={() => setDraft(toDraft(region.curve))}>
                <RotateCcw size={14} /> Revert
              </button>
            )}
          </div>
          {changed && (
            <p className="gr-muted">
              {cutsValid
                ? 'The chart and errors already show this curve; save it to keep it.'
                : 'Finish or remove the unfinished cut to save. The chart leaves it out until then.'}
            </p>
          )}
        </section>
      </div>

      {/* How far the curve is from the test rates */}
      <div className="gr-stats">
        {!showCurve || summary.rows.length === 0 ? (
          <p className="gr-muted">
            {summary.rows.length === 0
              ? 'Add test rates to compare them with the curve.'
              : 'Set a min fare or per km rate to compare the curve with the test rates.'}
          </p>
        ) : (
          <>
            <div className="gr-stat">
              <span>Average error</span>
              <strong>{formatPKR(summary.mae, { decimals: 1 })}</strong>
              <em>off per trip, either way</em>
            </div>
            <div className="gr-stat">
              <span>Average % error</span>
              <strong>{summary.mape === null ? '—' : `${num(summary.mape * 100, 1)}%`}</strong>
              <em>of the test rate</em>
            </div>
            <div className="gr-stat">
              <span>Overall lean</span>
              <strong>{signedPKR(summary.bias)}</strong>
              <em>{Math.abs(summary.bias) < 0.5 ? 'balanced' : summary.bias > 0 ? 'we charge more on average' : 'we charge less on average'}</em>
            </div>
            <div className="gr-stat">
              <span>RMS error</span>
              <strong>{formatPKR(summary.rmse, { decimals: 1 })}</strong>
              <em>weighs big misses more</em>
            </div>
            {worst && (
              <div className="gr-stat">
                <span>Biggest miss</span>
                <strong>{signedPKR(worst.diff)}</strong>
                <em>at {num(worst.point.distance)} km{worst.point.label ? ` · ${worst.point.label}` : ''}</em>
              </div>
            )}
          </>
        )}
      </div>

      <section className="gr-card">
        <div className="gr-points-head">
          <h2>Test rates <span className="gr-count">{region.points.length}</span></h2>
          <button className="btn-secondary" onClick={() => setPasteMode(p => !p)}>
            {pasteMode ? <><Plus size={14} /> Add one at a time</> : <><ClipboardPaste size={14} /> Paste a list</>}
          </button>
        </div>

        {pasteMode ? (
          <div className="gr-paste">
            <textarea
              className="form-input form-textarea"
              rows={6}
              placeholder={'One per line: distance, rate[, label]\n2, 150\n5.5, 320, Competitor A\n12\t610'}
              value={pasteText}
              onChange={e => setPasteText(e.target.value)}
            />
            <div className="gr-paste-foot">
              <span className="gr-muted">
                {pasted.points.length} ready to add
                {pasted.bad.length > 0 && <> · <span className="gr-warn">{pasted.bad.length} line{pasted.bad.length === 1 ? '' : 's'} not understood: {pasted.bad.slice(0, 3).join(' | ')}{pasted.bad.length > 3 ? ' …' : ''}</span></>}
              </span>
              <button className="page-head-btn" onClick={() => { void addPasted(); }} disabled={busy || !pasted.points.length}>
                <Plus size={15} /> Add {pasted.points.length || ''}
              </button>
            </div>
          </div>
        ) : (
          <form className="gr-add" onSubmit={e => { void addOne(e); }}>
            <label className="gr-field">
              <span className="gr-field-label">Distance <em>km</em></span>
              <input ref={distanceInput} className="form-input" inputMode="decimal" placeholder="e.g. 5" value={newPoint.distance}
                onChange={e => setNewPoint(p => ({ ...p, distance: e.target.value }))} />
            </label>
            <label className="gr-field">
              <span className="gr-field-label">Rate <em>PKR</em></span>
              <input className="form-input" inputMode="decimal" placeholder="e.g. 320" value={newPoint.rate}
                onChange={e => setNewPoint(p => ({ ...p, rate: e.target.value }))} />
            </label>
            <label className="gr-field gr-field-wide">
              <span className="gr-field-label">Label <em>optional</em></span>
              <input className="form-input" placeholder="Where it came from" maxLength={60} value={newPoint.label}
                onChange={e => setNewPoint(p => ({ ...p, label: e.target.value }))} />
            </label>
            <button className="page-head-btn gr-add-btn" type="submit" disabled={busy}>
              {busy ? <Loader size={15} className="spin" /> : <Plus size={15} />} Add
            </button>
          </form>
        )}

        {summary.rows.length > 0 && (
          <div className="gr-table-wrap">
            <table className="gr-table">
              <thead>
                <tr>
                  <th className="num">Distance</th>
                  <th className="num">Test rate</th>
                  <th className="num">Our curve</th>
                  <th className="num">Error</th>
                  <th className="num">Error %</th>
                  <th>Label</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {summary.rows.map(r => editing?.id === r.point.id ? (
                  <tr key={r.point.id} className="gr-editing">
                    <td><input className="form-input" inputMode="decimal" value={editing.distance} autoFocus
                      onChange={e => setEditing({ ...editing, distance: e.target.value })} /></td>
                    <td><input className="form-input" inputMode="decimal" value={editing.rate}
                      onChange={e => setEditing({ ...editing, rate: e.target.value })} /></td>
                    <td colSpan={3} />
                    <td><input className="form-input" value={editing.label} maxLength={60}
                      onChange={e => setEditing({ ...editing, label: e.target.value })}
                      onKeyDown={e => { if (e.key === 'Enter') void saveEdit(); }} /></td>
                    <td className="gr-row-actions">
                      <button className="gr-icon-btn" onClick={() => { void saveEdit(); }} disabled={busy} aria-label="Save"><Check size={15} /></button>
                      <button className="gr-icon-btn" onClick={() => setEditing(null)} aria-label="Cancel"><X size={15} /></button>
                    </td>
                  </tr>
                ) : (
                  <tr key={r.point.id}>
                    <td className="num">{num(r.point.distance)} km</td>
                    <td className="num">{pkr(r.point.rate)}</td>
                    <td className="num">{showCurve ? pkr(r.ours) : '—'}</td>
                    <td className="num">{showCurve ? signedPKR(r.diff) : '—'}</td>
                    <td className="num">{showCurve ? signedPct(r.pct) : '—'}</td>
                    <td className="gr-label">{r.point.label || <span className="gr-muted">—</span>}</td>
                    <td className="gr-row-actions">
                      <button className="gr-icon-btn" aria-label="Edit"
                        onClick={() => setEditing({ id: r.point.id, distance: String(r.point.distance), rate: String(r.point.rate), label: r.point.label ?? '' })}>
                        <Pencil size={14} />
                      </button>
                      <button className="gr-icon-btn" aria-label="Remove" disabled={busy} onClick={() => { void removePoint(r.point.id); }}>
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {showCurve && <p className="gr-muted gr-table-note">Error = our curve − test rate. Positive means the curve charges more.</p>}
          </div>
        )}
      </section>
    </div>
  );
};

// ─── Region list ──────────────────────────────────────────────────────────────

export const Graphs: React.FC = () => {
  const [regions, setRegions] = useState<TestRegion[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get('region');

  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => onSnapshot(
    collection(db, TEST_RATES_COLLECTION),
    snap => {
      setRegions(snap.docs
        .map(d => parseRegion(d.id, d.data()))
        .sort((a, b) => a.name.localeCompare(b.name)));
      setLoadError(null);
    },
    err => setLoadError(err.message),
  ), []);

  const select = (id: string | null) => setSearchParams(id ? { region: id } : {});

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    try {
      const ref = await addDoc(collection(db, TEST_RATES_COLLECTION), {
        name,
        points: [],
        curve: EMPTY_CURVE,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setNewName('');
      setAdding(false);
      select(ref.id);
    } catch (err) { setLoadError(`Could not create the region: ${(err as Error).message}`); }
    finally { setCreating(false); }
  };

  const selected = regions?.find(r => r.id === selectedId);

  if (selectedId && selected) {
    return <div className="gr-page"><RegionView key={selected.id} region={selected} onBack={() => select(null)} /></div>;
  }

  return (
    <div className="gr-page">
      <div className="page-head">
        <div>
          <h1>Graphs</h1>
          <p>
            Plot the fares seen in a region against distance, draw a fare curve through them, and see
            how far the curve is from each one. Nothing here changes the app's rates.
          </p>
        </div>
        <button className="page-head-btn" onClick={() => setAdding(true)}>
          <Plus size={16} /> New region
        </button>
      </div>

      {loadError && (
        <div className="rate-alert rate-alert-error">
          <AlertCircle size={20} />
          <div><strong>Test rates could not be loaded</strong><p>{loadError}</p></div>
        </div>
      )}

      {selectedId && regions && !selected && (
        <div className="rate-alert rate-alert-warn">
          <AlertCircle size={20} />
          <div><strong>That region no longer exists</strong><p>It may have been deleted. Pick another below.</p></div>
        </div>
      )}

      {adding && (
        <form className="gr-card gr-new-region" onSubmit={e => { void create(e); }}>
          <MapPin size={18} />
          <input
            className="form-input"
            placeholder="Region name, e.g. Lahore — Gulberg"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            autoFocus
            maxLength={80}
          />
          <button className="page-head-btn" type="submit" disabled={creating || !newName.trim()}>
            {creating ? <Loader size={15} className="spin" /> : <Plus size={15} />} Create
          </button>
          <button className="btn-secondary" type="button" onClick={() => { setAdding(false); setNewName(''); }}>Cancel</button>
        </form>
      )}

      {!regions ? (
        <div className="loading-row"><Loader size={16} className="spin" /> Loading regions…</div>
      ) : regions.length === 0 ? (
        !adding && (
          <div className="gr-empty">
            <ChartSpline size={40} />
            <h3>No regions yet</h3>
            <p>Create a region, add the fares you've seen there, then fit a curve to them.</p>
            <button className="page-head-btn" onClick={() => setAdding(true)}><Plus size={16} /> New region</button>
          </div>
        )
      ) : (
        <div className="gr-regions">
          {regions.map(r => {
            const s = summarizeError(r.points, r.curve);
            const curveSet = hasCurve(r.curve);
            const dists = r.points.map(p => p.distance);
            return (
              <button key={r.id} className="gr-card gr-region-card" onClick={() => select(r.id)}>
                <span className="gr-region-name"><MapPin size={15} /> {r.name}</span>
                <span className="gr-region-meta">
                  {r.points.length} test rate{r.points.length === 1 ? '' : 's'}
                  {dists.length > 0 && <> · {num(Math.min(...dists))}–{num(Math.max(...dists))} km</>}
                </span>
                <span className="gr-region-curve">
                  {curveSet
                    ? <>
                      Min {pkr(r.curve.minFare)} to {num(r.curve.threshold)} km, then {pkr(r.curve.perKm)}/km
                      {r.curve.cuts.length > 0 && <> · {r.curve.cuts.length} cut{r.curve.cuts.length === 1 ? '' : 's'}</>}
                    </>
                    : <span className="gr-muted">No curve yet</span>}
                </span>
                {curveSet && r.points.length > 0 && (
                  <span className="gr-region-error">
                    Average error <strong>{formatPKR(s.mae, { decimals: 1 })}</strong>
                    {s.mape !== null && <> · {num(s.mape * 100, 1)}%</>}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default Graphs;

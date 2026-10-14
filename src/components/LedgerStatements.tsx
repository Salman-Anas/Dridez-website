import React, { useEffect, useMemo, useState } from 'react';
import { formatPKR } from '../utils/rideTaxonomy';
import { formatDateTime } from '../utils/firebaseValues';
import {
  fetchDriverLedger, fetchRiderLedger, driverTotals, riderTotals, rowsInRange,
  ledgerRange, ledgerPeriodLabel, driverStatementSheets, riderSpendingSheets,
  LEDGER_PERIOD_LABEL, ENTRY_LABEL, TRIP_KIND_LABEL,
  type DriverLedger, type LedgerPeriod, type TripRow,
} from '../utils/ledgerSchema';
import { downloadWorkbook, exportFileName, type SheetSpec } from '../utils/excelExport';
import { AlertCircle, Calendar, Download, Loader } from 'lucide-react';

/** Rupees, with paisa only when there are any. */
const pkr = (n: number): string => formatPKR(n, { decimals: Number.isInteger(n) ? 0 : 2 });
const signedPkr = (n: number): string => (n > 0 ? `+${pkr(n)}` : n < 0 ? `−${pkr(-n)}` : pkr(0));

// ─── Period picker ───────────────────────────────────────────────────────────

const PERIODS = Object.keys(LEDGER_PERIOD_LABEL) as LedgerPeriod[];

interface PeriodState {
  period: LedgerPeriod;
  customStart: string;
  customEnd: string;
}

const usePeriod = () => {
  const [state, setState] = useState<PeriodState>({ period: '30d', customStart: '', customEnd: '' });
  const range = useMemo(
    () => ledgerRange(state.period, state.customStart, state.customEnd),
    [state.period, state.customStart, state.customEnd],
  );
  const label = ledgerPeriodLabel(state.period, state.customStart, state.customEnd);
  return { state, setState, range, label };
};

const PeriodPicker: React.FC<{
  state: PeriodState;
  onChange: (s: PeriodState) => void;
  children?: React.ReactNode;
}> = ({ state, onChange, children }) => (
  <div className="ls-toolbar">
    <div className="pay-period-tabs">
      {PERIODS.map(p => (
        <button
          key={p}
          className={`pay-period-tab ${state.period === p ? 'active' : ''}`}
          onClick={() => onChange({ ...state, period: p })}
        >
          <Calendar size={13} /> {LEDGER_PERIOD_LABEL[p]}
        </button>
      ))}
    </div>
    {state.period === 'custom' && (
      <div className="ls-dates">
        <input type="date" value={state.customStart} max={state.customEnd || undefined}
          onChange={e => onChange({ ...state, customStart: e.target.value })} />
        <span className="cell-dim">to</span>
        <input type="date" value={state.customEnd} min={state.customStart || undefined}
          onChange={e => onChange({ ...state, customEnd: e.target.value })} />
      </div>
    )}
    {children}
  </div>
);

const ExportButton: React.FC<{
  disabled: boolean;
  fileName: () => string;
  sheets: () => SheetSpec[];
}> = ({ disabled, fileName, sheets }) => {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const run = async () => {
    setWorking(true);
    setError('');
    try {
      await downloadWorkbook(fileName(), sheets());
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : 'The export failed.');
    } finally {
      setWorking(false);
    }
  };
  return (
    <span className="ls-export">
      <button className="pay-view-all-btn" onClick={() => { void run(); }} disabled={disabled || working}>
        {working ? <Loader size={15} className="spin" /> : <Download size={15} />}
        <span>{working ? 'Exporting…' : 'Export to Excel'}</span>
      </button>
      {error && <span className="rate-error"><AlertCircle size={13} /> {error}</span>}
    </span>
  );
};

const Total: React.FC<{ label: string; value: string; tone?: 'neg' | 'pos' }> = ({ label, value, tone }) => (
  <div className="ls-total">
    <span>{label}</span>
    <strong className={tone ? `ls-${tone}` : undefined}>{value}</strong>
  </div>
);

const TripsTable: React.FC<{ trips: TripRow[]; driverSide: boolean }> = ({ trips, driverSide }) => (
  <div className="da-mini-table-wrap ls-scroll">
    <table className="da-mini-table">
      <thead>
        <tr>
          <th>When</th><th>Type</th><th>Details</th><th>Route</th><th className="num">Fare</th>
          {driverSide && <><th className="num">Commission</th><th className="num">Net</th></>}
        </tr>
      </thead>
      <tbody>
        {trips.map(t => (
          <tr key={`${t.kind}_${t.id}`}>
            <td className="cell-dim">{formatDateTime(t.at)}</td>
            <td><span className="da-src">{TRIP_KIND_LABEL[t.kind]}</span></td>
            <td title={t.id}>{t.title}</td>
            <td className="cell-dim">{t.route || '—'}</td>
            <td className="num cell-fare">{pkr(t.fare)}</td>
            {driverSide && <>
              <td className="num cell-dim">{t.commission ? pkr(t.commission) : '—'}</td>
              <td className="num">{pkr(Math.round((t.fare - t.commission) * 100) / 100)}</td>
            </>}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

// ─── Driver statement ────────────────────────────────────────────────────────

export const DriverStatement: React.FC<{
  uid: string;
  name: string;
  phone: string;
  /** Current wallet balance, or null when there is no wallet. */
  balance: number | null;
}> = ({ uid, name, phone, balance }) => {
  const [loaded, setLoaded] = useState<{ uid: string; ledger: DriverLedger | null; error: string } | null>(null);
  const { state, setState, range, label } = usePeriod();

  useEffect(() => {
    let live = true;
    fetchDriverLedger(uid)
      .then(ledger => { if (live) setLoaded({ uid, ledger, error: '' }); })
      .catch(e => {
        console.error(e);
        if (live) setLoaded({ uid, ledger: null, error: 'The statement could not be loaded.' });
      });
    return () => { live = false; };
  }, [uid]);

  const ledger = loaded?.uid === uid ? loaded.ledger : null;
  const error = loaded?.uid === uid ? loaded.error : '';
  const wallet = useMemo(() => (ledger ? rowsInRange(ledger.wallet, range) : []), [ledger, range]);
  const trips = useMemo(() => (ledger ? rowsInRange(ledger.trips, range) : []), [ledger, range]);
  const totals = useMemo(() => (ledger ? driverTotals(ledger, range) : null), [ledger, range]);

  return (
    <div>
      <PeriodPicker state={state} onChange={setState}>
        <ExportButton
          disabled={!ledger || !totals}
          fileName={() => exportFileName('driver', name || uid)}
          sheets={() => driverStatementSheets({ name, phone, periodLabel: label, balance, totals: totals!, wallet, trips })}
        />
      </PeriodPicker>

      {error ? (
        <div className="rate-error"><AlertCircle size={13} /> {error}</div>
      ) : !ledger || !totals ? (
        <div className="pa-loading"><Loader size={16} className="spin" /> Reading the wallet ledger and trips…</div>
      ) : (
        <>
          <div className="ls-totals">
            <Total label="Earnings (fares)" value={pkr(totals.earnings)} />
            <Total label="Commission paid" value={pkr(totals.commission)} />
            <Total label="Net earnings" value={pkr(totals.net)} tone={totals.net < 0 ? 'neg' : 'pos'} />
            <Total label="Balance added" value={pkr(totals.added)} tone={totals.added < 0 ? 'neg' : undefined} />
            <Total label="Completed trips" value={String(totals.trips)} />
          </div>

          <div className="ls-subtitle">Wallet movements · {wallet.length}</div>
          {wallet.length === 0 ? (
            <p className="modal-no-data">No wallet movements in this period.</p>
          ) : (
            <div className="da-mini-table-wrap ls-scroll">
              <table className="da-mini-table">
                <thead>
                  <tr>
                    <th>When</th><th>Type</th><th>Details</th><th>Reference</th>
                    <th className="num">Amount</th><th className="num">Balance after</th>
                  </tr>
                </thead>
                <tbody>
                  {wallet.map(e => (
                    <tr key={e.id}>
                      <td className="cell-dim">{formatDateTime(e.at)}</td>
                      <td><span className="da-src">{ENTRY_LABEL[e.type]}</span></td>
                      <td className="cell-dim">{e.note || '—'}</td>
                      <td className="mono cell-dim">{e.reference || '—'}</td>
                      <td className={`num ${e.amount < 0 ? 'ls-neg' : 'ls-pos'}`}>{signedPkr(e.amount)}</td>
                      <td className="num cell-dim">{e.balanceAfter === null ? '—' : pkr(e.balanceAfter)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="ls-subtitle">Completed trips · {trips.length}</div>
          {trips.length === 0
            ? <p className="modal-no-data">No completed trips in this period.</p>
            : <TripsTable trips={trips} driverSide />}
          <p className="da-footnote">
            Commission paid is the wallet’s commission entries in the period, net of refunds; a trip’s
            own commission can be charged in a different period (seats are charged when booked).
          </p>
        </>
      )}
    </div>
  );
};

// ─── Rider spending ──────────────────────────────────────────────────────────

export const RiderSpending: React.FC<{ uid: string; name: string; phone: string }> = ({ uid, name, phone }) => {
  const [loaded, setLoaded] = useState<{ uid: string; trips: TripRow[] | null; error: string } | null>(null);
  const { state, setState, range, label } = usePeriod();

  useEffect(() => {
    let live = true;
    fetchRiderLedger(uid)
      .then(trips => { if (live) setLoaded({ uid, trips, error: '' }); })
      .catch(e => {
        console.error(e);
        if (live) setLoaded({ uid, trips: null, error: 'Spending could not be loaded.' });
      });
    return () => { live = false; };
  }, [uid]);

  const all = loaded?.uid === uid ? loaded.trips : null;
  const error = loaded?.uid === uid ? loaded.error : '';
  const trips = useMemo(() => (all ? rowsInRange(all, range) : []), [all, range]);
  const totals = useMemo(() => (all ? riderTotals(all, range) : null), [all, range]);

  return (
    <div>
      <PeriodPicker state={state} onChange={setState}>
        <ExportButton
          disabled={!all || !totals}
          fileName={() => exportFileName('rider', name || uid)}
          sheets={() => riderSpendingSheets({ name, phone, periodLabel: label, totals: totals!, trips })}
        />
      </PeriodPicker>

      {error ? (
        <div className="rate-error"><AlertCircle size={13} /> {error}</div>
      ) : !all || !totals ? (
        <div className="pa-loading"><Loader size={16} className="spin" /> Reading trips…</div>
      ) : (
        <>
          <div className="ls-totals">
            <Total label="Spent" value={pkr(totals.spent)} />
            <Total label="Completed trips" value={String(totals.trips)} />
            <Total label="Average fare" value={pkr(totals.average)} />
          </div>
          {trips.length === 0
            ? <p className="modal-no-data">No completed trips in this period.</p>
            : <TripsTable trips={trips} driverSide={false} />}
        </>
      )}
    </div>
  );
};

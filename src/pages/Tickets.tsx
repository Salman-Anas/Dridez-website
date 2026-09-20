import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  collection, doc, getDoc, getDocs, updateDoc, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import { useAdminLabel } from '../utils/adminAuthContext';
import {
  LifeBuoy, Search, X, Loader, RefreshCw, AlertCircle, CheckCircle,
  MessageSquare, Send, User, Phone, Mail, Clock, ImageIcon, Shield,
  Inbox, CircleDot, CheckCheck, ChevronRight,
} from 'lucide-react';

// ─── Ticket shape ────────────────────────────────────────────────────────────
// `tickets/{autoId}` — filed from the app's support screen. The app writes
// title, description, an optional screenshot, the filer's uid, the date and an
// initial status of "open". The portal writes `comment` (the reply the user
// reads in the app) and `status`. Both of those writes fire a push notification
// from the onTicketUpdated Cloud Function, so neither is written speculatively.

interface Ticket {
  id: string;
  title?: string;
  description?: string;
  image?: string;
  user?: string;
  date?: unknown;
  status?: string;
  comment?: string;
  /** Portal-written audit trail; the app ignores these. */
  commentBy?: string;
  commentAt?: unknown;
}

interface TicketUser {
  name?: string;
  phone?: string;
  email?: string;
  verificationStatus?: string;
  driver?: boolean;
}

/**
 * The three statuses the app and the schema agree on. The spellings are exact:
 * the Cloud Function echoes the value straight into the push notification the
 * user receives.
 */
const STATUSES = ['open', 'in progress', 'resolved'] as const;
type TicketStatus = (typeof STATUSES)[number];

type StatusFilter = 'all' | TicketStatus;

const STATUS_META: Record<TicketStatus, { label: string; color: string; icon: React.ReactNode }> = {
  'open':        { label: 'Open',        color: 'var(--accent-orange)', icon: <CircleDot size={22} /> },
  'in progress': { label: 'In Progress', color: 'var(--accent-cyan)',   icon: <Clock size={22} /> },
  'resolved':    { label: 'Resolved',    color: 'var(--accent-green)',  icon: <CheckCheck size={22} /> },
};

/** Anything the app has not set, or a spelling nobody recognises, reads as open. */
const normaliseStatus = (raw?: string): TicketStatus => {
  const s = (raw || '').toLowerCase().trim();
  if (s === 'resolved' || s === 'closed' || s === 'done') return 'resolved';
  if (s === 'in progress' || s === 'in_progress' || s === 'inprogress') return 'in progress';
  return 'open';
};

/** `date` is a Firestore Timestamp, but older tickets may carry epoch millis. */
const toMs = (v: unknown): number => {
  if (!v) return 0;
  if (typeof v === 'number') return v > 1e12 ? v : v * 1000;
  if (typeof v === 'string') { const t = Date.parse(v); return Number.isNaN(t) ? 0 : t; }
  if (typeof v === 'object') {
    const o = v as { seconds?: number; toDate?: () => Date };
    if (typeof o.toDate === 'function') return o.toDate().getTime();
    if (typeof o.seconds === 'number') return o.seconds * 1000;
  }
  return 0;
};

const formatDate = (v: unknown): string => {
  const ms = toMs(v);
  if (!ms) return '—';
  return new Date(ms).toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' });
};

const StatusPill: React.FC<{ status: TicketStatus }> = ({ status }) => (
  <span className={`tk-pill tk-pill-${status.replace(' ', '-')}`}>
    {STATUS_META[status].label}
  </span>
);

// ─── Detail drawer ───────────────────────────────────────────────────────────

interface DrawerProps {
  ticket: Ticket;
  onClose: () => void;
  onSaved: (patch: Partial<Ticket>) => void;
}

const TicketDrawer: React.FC<DrawerProps> = ({ ticket, onClose, onSaved }) => {
  const adminLabel = useAdminLabel();
  const [profile, setProfile] = useState<TicketUser | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [reply, setReply] = useState(ticket.comment || '');
  const [status, setStatus] = useState<TicketStatus>(normaliseStatus(ticket.status));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setReply(ticket.comment || '');
    setStatus(normaliseStatus(ticket.status));
    setError('');
    if (!ticket.user) { setProfile(null); return; }
    setLoadingProfile(true);
    getDoc(doc(db, 'users', ticket.user))
      .then(snap => setProfile(snap.exists() ? (snap.data() as TicketUser) : null))
      .catch(() => setProfile(null))
      .finally(() => setLoadingProfile(false));
  }, [ticket.id, ticket.user, ticket.comment, ticket.status]);

  const replyChanged = reply.trim() !== (ticket.comment || '').trim();
  const statusChanged = status !== normaliseStatus(ticket.status);
  const dirty = replyChanged || statusChanged;

  const save = async () => {
    if (!dirty) return;
    setSaving(true);
    setError('');
    try {
      // Only the fields that actually changed are written: the Cloud Function
      // sends the user a push for a changed comment and another for a changed
      // status, so rewriting an unchanged field would notify them for nothing.
      const patch: Record<string, unknown> = {};
      if (replyChanged) {
        patch.comment = reply.trim();
        patch.commentBy = adminLabel;
        patch.commentAt = serverTimestamp();
      }
      if (statusChanged) patch.status = status;

      await updateDoc(doc(db, 'tickets', ticket.id), patch);
      onSaved({
        ...(replyChanged ? { comment: reply.trim(), commentBy: adminLabel } : {}),
        ...(statusChanged ? { status } : {}),
      });
    } catch (e) {
      console.error(e);
      setError('Could not save. Check that your admin session is still valid and try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-drawer" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title-row">
            <StatusPill status={normaliseStatus(ticket.status)} />
            <span className="cell-dim">{formatDate(ticket.date)}</span>
          </div>
          <button className="modal-close-btn" onClick={onClose}><X size={20} /></button>
        </div>

        <div className="modal-body">
          <div className="modal-section">
            <h3 className="modal-section-title"><LifeBuoy size={16} /> Ticket</h3>
            <div className="tk-title">{ticket.title || 'Untitled ticket'}</div>
            <p className="tk-description">{ticket.description || 'No description was provided.'}</p>
            <div className="modal-details-grid" style={{ marginTop: '1rem' }}>
              <div className="detail-item" style={{ gridColumn: '1 / -1' }}>
                <span className="di-label">Ticket ID</span>
                <span className="di-value mono">{ticket.id}</span>
              </div>
            </div>
          </div>

          {ticket.image && (
            <div className="modal-section">
              <h3 className="modal-section-title"><ImageIcon size={16} /> Attached Screenshot</h3>
              <a href={ticket.image} target="_blank" rel="noopener noreferrer" className="tk-shot">
                <img src={ticket.image} alt="Screenshot attached to the ticket" />
              </a>
            </div>
          )}

          <div className="modal-section">
            <h3 className="modal-section-title"><User size={16} /> Filed By</h3>
            {!ticket.user ? (
              <p className="modal-no-data">No user uid on this ticket.</p>
            ) : loadingProfile ? (
              <div className="loading-row"><Loader size={16} className="spin" /> Loading user…</div>
            ) : profile ? (
              <div className="modal-details-grid">
                <div className="detail-item"><span className="di-label">Name</span><span className="di-value">{profile.name || '—'}</span></div>
                <div className="detail-item"><span className="di-label"><Phone size={12} /> Phone</span><span className="di-value">{profile.phone || '—'}</span></div>
                <div className="detail-item"><span className="di-label"><Mail size={12} /> Email</span><span className="di-value">{profile.email || '—'}</span></div>
                <div className="detail-item">
                  <span className="di-label"><Shield size={12} /> Verification</span>
                  <span className="di-value">{profile.verificationStatus || 'unverified'}{profile.driver ? ' · driver' : ''}</span>
                </div>
                <div className="detail-item" style={{ gridColumn: '1 / -1' }}>
                  <span className="di-label">UID</span><span className="di-value mono">{ticket.user}</span>
                </div>
              </div>
            ) : (
              <p className="modal-no-data">User profile not found (UID: {ticket.user.slice(0, 10)}…)</p>
            )}
          </div>

          <div className="modal-section">
            <h3 className="modal-section-title"><MessageSquare size={16} /> Support Reply</h3>
            <p className="tk-hint">
              Saving a reply shows it inside the ticket in the app and sends the user a
              “Support replied” push. Changing the status sends a second notification.
            </p>

            {ticket.comment && (
              <div className="tk-existing-reply">
                <strong>Currently shown to the user</strong>
                <p>{ticket.comment}</p>
                {ticket.commentBy && <span className="tk-reply-by">— {ticket.commentBy}</span>}
              </div>
            )}

            <textarea
              className="tk-reply-input"
              rows={5}
              placeholder="Write the reply the user will see in the app…"
              value={reply}
              onChange={e => { setReply(e.target.value); setError(''); }}
            />

            <div className="tk-status-row">
              <span className="di-label">Status</span>
              <div className="tk-status-choices">
                {STATUSES.map(s => (
                  <button
                    key={s}
                    className={`tk-status-choice${status === s ? ' active' : ''}`}
                    onClick={() => setStatus(s)}
                    type="button"
                  >
                    {STATUS_META[s].label}
                  </button>
                ))}
              </div>
            </div>

            {error && <div className="rate-error"><AlertCircle size={13} /> {error}</div>}

            <div className="tk-actions">
              <button className="rate-save-btn" onClick={() => { void save(); }} disabled={!dirty || saving}>
                {saving ? <Loader size={14} className="spin" /> : <Send size={14} />}
                {saving ? 'Saving…' : dirty ? 'Save & notify user' : 'No changes'}
              </button>
              <button className="rate-cancel-btn" onClick={onClose}>
                <X size={14} /> Close
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── Page ────────────────────────────────────────────────────────────────────

export const Tickets: React.FC = () => {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Ticket | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      // The collection has no guaranteed index on `date`, and legacy tickets
      // may lack the field entirely, so it is ordered client-side instead.
      const snap = await getDocs(collection(db, 'tickets'));
      const rows: Ticket[] = [];
      snap.forEach(d => rows.push({ id: d.id, ...(d.data() as Omit<Ticket, 'id'>) }));
      rows.sort((a, b) => toMs(b.date) - toMs(a.date));
      setTickets(rows);
    } catch (e) {
      console.error(e);
      setLoadError('Could not load tickets. Confirm your account carries the admin claim.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const counts = useMemo(() => {
    const c: Record<StatusFilter, number> = { all: tickets.length, 'open': 0, 'in progress': 0, 'resolved': 0 };
    for (const t of tickets) c[normaliseStatus(t.status)] += 1;
    return c;
  }, [tickets]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tickets.filter(t => {
      if (filter !== 'all' && normaliseStatus(t.status) !== filter) return false;
      if (!q) return true;
      return [t.title, t.description, t.comment, t.user, t.id]
        .some(v => (v || '').toString().toLowerCase().includes(q));
    });
  }, [tickets, filter, search]);

  const applyPatch = (id: string, patch: Partial<Ticket>) => {
    setTickets(prev => prev.map(t => (t.id === id ? { ...t, ...patch } : t)));
    setSelected(prev => (prev && prev.id === id ? { ...prev, ...patch } : prev));
    setToast('Ticket updated — the user has been notified.');
    setTimeout(() => setToast(null), 3500);
  };

  const cards: { key: StatusFilter; label: string; color: string; icon: React.ReactNode }[] = [
    { key: 'all', label: 'All Tickets', color: 'var(--accent-blue)', icon: <Inbox size={22} /> },
    ...STATUSES.map(s => ({ key: s as StatusFilter, label: STATUS_META[s].label, color: STATUS_META[s].color, icon: STATUS_META[s].icon })),
  ];

  return (
    <div className="rides-page">
      {toast && (
        <div className="settings-toast toast-success">
          <CheckCircle size={18} /><span>{toast}</span>
        </div>
      )}

      <div className="dashboard-header settings-top-bar">
        <div style={{ textAlign: 'left' }}>
          <h1>Support Tickets</h1>
          <p>Issues users have reported about the app or about another user’s behaviour</p>
        </div>
        <button className="pay-view-all-btn settings-refresh" onClick={() => { void load(); }} disabled={loading}>
          <RefreshCw size={17} className={loading ? 'spin' : ''} />
          <span>{loading ? 'Loading…' : 'Refresh'}</span>
        </button>
      </div>

      <div className="rides-filter-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        {cards.map(card => (
          <button
            key={card.key}
            className={`rides-stat-card ${filter === card.key ? 'selected' : ''}`}
            style={{ '--card-color': card.color } as React.CSSProperties}
            onClick={() => setFilter(card.key)}
          >
            <div className="rsc-icon">{card.icon}</div>
            <div className="rsc-body">
              <div className="rsc-count">
                {loading
                  ? <span className="loading-pulse" style={{ height: '1.6rem', width: '2.5rem', display: 'inline-block' }} />
                  : counts[card.key]}
              </div>
              <div className="rsc-label">{card.label}</div>
            </div>
            {filter === card.key && <div className="rsc-active-bar" />}
          </button>
        ))}
      </div>

      <div className="users-search-bar" style={{ marginBottom: '1.5rem' }}>
        <Search size={16} style={{ color: 'var(--text-secondary)' }} />
        <input
          className="users-search-input"
          placeholder="Search by title, description, reply, ticket id or user uid…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {search && (
          <button
            onClick={() => setSearch('')}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', display: 'flex' }}
          >
            <X size={15} />
          </button>
        )}
      </div>

      {loadError && (
        <div className="rate-alert rate-alert-error">
          <AlertCircle size={20} />
          <div><strong>Tickets could not be loaded</strong><p>{loadError}</p></div>
        </div>
      )}

      {loading ? (
        <div className="rides-loading">
          <Loader size={32} className="spin" />
          <p>Loading support tickets…</p>
        </div>
      ) : visible.length === 0 ? (
        <div className="rides-empty">
          <LifeBuoy size={40} style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }} />
          <p>
            {tickets.length === 0
              ? 'No support tickets have been filed yet.'
              : 'No tickets match this filter.'}
          </p>
        </div>
      ) : (
        <div className="rides-table-wrapper">
          <table className="rides-table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Title</th>
                <th>Reported</th>
                <th>Reply</th>
                <th>Filed</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visible.map(t => {
                const status = normaliseStatus(t.status);
                return (
                  <tr key={t.id} className="ride-row" onClick={() => setSelected(t)}>
                    <td><StatusPill status={status} /></td>
                    <td>
                      <div className="tk-cell-title">{t.title || 'Untitled ticket'}</div>
                      {t.image && <span className="tk-shot-flag"><ImageIcon size={11} /> screenshot</span>}
                    </td>
                    <td className="tk-cell-desc">
                      {(t.description || '—').slice(0, 90)}{(t.description || '').length > 90 ? '…' : ''}
                    </td>
                    <td>
                      {t.comment
                        ? <span className="tk-replied"><MessageSquare size={12} /> Replied</span>
                        : <span className="cell-dim">No reply yet</span>}
                    </td>
                    <td className="cell-dim">{formatDate(t.date)}</td>
                    <td><ChevronRight size={16} style={{ color: 'var(--text-secondary)' }} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <TicketDrawer
          ticket={selected}
          onClose={() => setSelected(null)}
          onSaved={patch => applyPatch(selected.id, patch)}
        />
      )}
    </div>
  );
};

export default Tickets;

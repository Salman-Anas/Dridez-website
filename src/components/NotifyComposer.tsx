import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAdminLabel } from '../utils/adminAuthContext';
import { formatDateTime } from '../utils/firebaseValues';
import {
  resolveAudience, sendBroadcast, watchBroadcasts, MAX_BODY, MAX_TITLE,
  type Broadcast, type BroadcastScope, type Recipient, type Segment,
} from '../utils/broadcastSchema';
import {
  AlertCircle, Bell, CheckCircle, ImagePlus, Loader, Search, Send, Trash2, X,
} from 'lucide-react';

interface Props {
  scope: BroadcastScope;
  /** Everyone this page can notify (deleted accounts already left out). */
  recipients: Recipient[];
  /** Opening from one person's drawer starts on "Choose people" with them picked. */
  preselected?: string[];
  /** "users" / "drivers", and what verified means on this page. */
  noun: { one: string; many: string };
  segmentLabels: { verified: string; unverified: string };
  onClose: () => void;
}

const STATUS_TEXT: Record<string, string> = {
  queued: 'Queued',
  sending: 'Sending',
  sent: 'Sent',
  failed: 'Failed',
};

const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/**
 * Write a notification and pick who gets it. The portal resolves the choice
 * to uids and queues one `broadcasts` document; the app's Cloud Function
 * sends it, and the list at the bottom follows its progress live.
 */
export const NotifyComposer: React.FC<Props> = ({
  scope, recipients, preselected, noun, segmentLabels, onClose,
}) => {
  const adminLabel = useAdminLabel();
  const [segment, setSegment] = useState<Segment>(preselected?.length ? 'selected' : 'all');
  const [selected, setSelected] = useState<Set<string>>(() => new Set(preselected ?? []));
  const [search, setSearch] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [image, setImage] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [sentId, setSentId] = useState<string | null>(null);
  const [recent, setRecent] = useState<Broadcast[]>([]);
  const [recentError, setRecentError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => watchBroadcasts(scope, setRecent, setRecentError), [scope]);

  useEffect(() => {
    if (!image) { setPreview(null); return; }
    const url = URL.createObjectURL(image);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [image]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !sending) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, sending]);

  const counts = useMemo(() => ({
    all: recipients.length,
    verified: recipients.filter(r => r.verified).length,
    unverified: recipients.filter(r => !r.verified).length,
    selected: recipients.filter(r => selected.has(r.uid)).length,
  }), [recipients, selected]);

  const uids = useMemo(() => resolveAudience(recipients, segment, selected), [recipients, segment, selected]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? recipients.filter(r => [r.name, r.phone, r.uid].some(v => v.toLowerCase().includes(q)))
      : recipients;
    return list.slice(0, 200);
  }, [recipients, search]);

  const toggle = (uid: string) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(uid)) next.delete(uid); else next.add(uid);
    return next;
  });

  const segments: { key: Segment; label: string; count: number }[] = [
    { key: 'all', label: `All ${noun.many}`, count: counts.all },
    { key: 'verified', label: segmentLabels.verified, count: counts.verified },
    { key: 'unverified', label: segmentLabels.unverified, count: counts.unverified },
    { key: 'selected', label: 'Choose people', count: counts.selected },
  ];
  const segmentLabel = segments.find(s => s.key === segment)?.label ?? '';

  const pickImage = (file: File | undefined) => {
    setError('');
    if (!file) return;
    if (!file.type.startsWith('image/')) { setError('Pick an image file (JPG or PNG).'); return; }
    setImage(file);
  };

  const canSend = !sending && title.trim() && body.trim() && uids.length > 0;

  const send = async () => {
    if (!canSend) return;
    const who = plural(uids.length, noun.one, noun.many);
    if (!window.confirm(`Send this notification to ${who}? It can't be taken back once it's sent.`)) return;
    setSending(true);
    setError('');
    try {
      const id = await sendBroadcast({
        scope, segment, label: segmentLabel, uids, title, body, image, adminLabel,
      });
      setSentId(id);
      setTitle('');
      setBody('');
      setImage(null);
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : 'The notification could not be queued. Nothing was sent.');
    } finally {
      setSending(false);
    }
  };

  const justSent = sentId ? recent.find(b => b.id === sentId) : undefined;

  return (
    <div className="modal-overlay" onClick={() => { if (!sending) onClose(); }}>
      <div className="modal-drawer nt-drawer" role="dialog" aria-modal="true" aria-labelledby="nt-title" onClick={e => e.stopPropagation()}>
        <div className="modal-header nt-header">
          <div className="nt-header-title">
            <span className="nt-header-icon"><Bell size={15} /></span>
            <h2 id="nt-title">Notify {noun.many}</h2>
          </div>
          <button className="modal-close-btn" onClick={onClose} disabled={sending} aria-label="Close"><X size={16} /></button>
        </div>

        <div className="modal-body nt-body">
          {/* Who */}
          <section className="nt-block">
            <h3 className="nt-label">Send to</h3>
            <div className="nt-segments" role="radiogroup" aria-label="Who gets this notification">
              {segments.map(s => (
                <button
                  key={s.key}
                  type="button"
                  role="radio"
                  aria-checked={segment === s.key}
                  className={`nt-segment ${segment === s.key ? 'active' : ''}`}
                  onClick={() => setSegment(s.key)}
                >
                  <span>{s.label}</span>
                  <strong>{s.count.toLocaleString()}</strong>
                </button>
              ))}
            </div>

            {segment === 'selected' && (
              <div className="nt-picker">
                <div className="nt-search">
                  <Search size={14} />
                  <input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search by name, phone or uid"
                    aria-label={`Search ${noun.many}`}
                  />
                </div>
                <div className="nt-picker-bar">
                  <span>{plural(counts.selected, 'person', 'people')} picked</span>
                  <button type="button" onClick={() => setSelected(prev => new Set([...prev, ...shown.map(r => r.uid)]))}>
                    Pick all shown
                  </button>
                  <button type="button" onClick={() => setSelected(new Set())} disabled={!counts.selected}>Clear</button>
                </div>
                <ul className="nt-people">
                  {shown.map(r => (
                    <li key={r.uid}>
                      <label>
                        <input type="checkbox" checked={selected.has(r.uid)} onChange={() => toggle(r.uid)} />
                        <span className="nt-person">
                          <strong>{r.name || 'Unnamed'}</strong>
                          <small>{r.phone || r.uid.slice(0, 12)}</small>
                        </span>
                        <span className={`nt-tag ${r.verified ? 'ok' : ''}`}>
                          {r.verified ? 'Verified' : 'Unverified'}
                        </span>
                      </label>
                    </li>
                  ))}
                  {shown.length === 0 && <li className="nt-empty">Nobody matches “{search}”.</li>}
                </ul>
                {recipients.length > shown.length && !search && (
                  <p className="nt-hint">Showing the first 200. Search to find anyone else.</p>
                )}
              </div>
            )}
          </section>

          {/* What */}
          <section className="nt-block">
            <div className="nt-field-head">
              <label className="nt-label" htmlFor="nt-title-input">Title</label>
              <span className={`nt-count ${title.length > MAX_TITLE ? 'over' : ''}`}>{title.length}/{MAX_TITLE}</span>
            </div>
            <input
              id="nt-title-input"
              className="form-input"
              value={title}
              maxLength={MAX_TITLE}
              onChange={e => { setTitle(e.target.value); setError(''); }}
              placeholder="e.g. Rides run as usual over Eid"
            />

            <div className="nt-field-head">
              <label className="nt-label" htmlFor="nt-body-input">Message</label>
              <span className={`nt-count ${body.length > MAX_BODY ? 'over' : ''}`}>{body.length}/{MAX_BODY}</span>
            </div>
            <textarea
              id="nt-body-input"
              className="form-input form-textarea"
              rows={3}
              value={body}
              maxLength={MAX_BODY}
              onChange={e => { setBody(e.target.value); setError(''); }}
              placeholder="What do you want them to know?"
            />

            <div className="nt-field-head">
              <span className="nt-label">Image <em>optional</em></span>
            </div>
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={e => { pickImage(e.target.files?.[0]); e.target.value = ''; }}
            />
            {preview ? (
              <div className="nt-image">
                <img src={preview} alt="Notification image" />
                <button type="button" className="tq-btn tq-btn-ghost" onClick={() => setImage(null)}>
                  <Trash2 size={14} /> Remove
                </button>
              </div>
            ) : (
              <button type="button" className="nt-add-image" onClick={() => fileInput.current?.click()}>
                <ImagePlus size={15} /> Add an image
              </button>
            )}
            <p className="nt-hint">Android phones show the image. iPhones show the title and message.</p>
          </section>

          {/* Preview */}
          <section className="nt-block">
            <h3 className="nt-label">Preview</h3>
            <div className="nt-phone" aria-hidden="true">
              <div className="nt-notice">
                <div className="nt-notice-head">
                  <img src="/dridez-icon.png" alt="" />
                  <span>Dridez</span>
                  <span>now</span>
                </div>
                <strong>{title.trim() || 'Your title'}</strong>
                <p>{body.trim() || 'Your message appears here.'}</p>
                {preview && <img className="nt-notice-image" src={preview} alt="" />}
              </div>
            </div>
          </section>

          {/* Sent */}
          <section className="nt-block">
            <h3 className="nt-label">Recent</h3>
            {recentError && <div className="rate-error"><AlertCircle size={13} /> {recentError}</div>}
            {recent.length === 0 && !recentError ? (
              <p className="nt-hint">Nothing sent from this page yet.</p>
            ) : (
              <ul className="nt-recent">
                {recent.map(b => (
                  <li key={b.id} className={b.id === sentId ? 'just-sent' : undefined}>
                    <div>
                      <strong>{b.title}</strong>
                      <small>
                        {b.audience?.label ?? ''} · {plural(b.uids?.length ?? 0, noun.one, noun.many)} · {formatDateTime(b.createdAt)}
                      </small>
                      {b.status === 'failed' && b.error && <small className="nt-error">{b.error}</small>}
                    </div>
                    <span className={`nt-status nt-status-${b.status ?? 'queued'}`}>
                      {b.status === 'sending' || b.status === 'queued' ? <Loader size={11} className="spin" /> : null}
                      {STATUS_TEXT[b.status ?? 'queued']}
                      {b.status === 'sent' || b.status === 'sending' ? ` · ${plural(b.phones ?? 0, 'phone', 'phones')}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="nt-footer">
          {error && <div className="rate-error"><AlertCircle size={13} /> {error}</div>}
          {justSent && !error && (
            <div className="rate-status rate-status-ok">
              <CheckCircle size={13} />
              <span>
                {justSent.status === 'sent'
                  ? `Sent. ${plural(justSent.phones ?? 0, 'phone', 'phones')} accepted it.`
                  : justSent.status === 'failed'
                    ? `Not sent: ${justSent.error ?? 'unknown error'}`
                    : 'Queued. It goes out in a few seconds.'}
              </span>
            </div>
          )}
          <button type="button" className="nt-send" onClick={() => { void send(); }} disabled={!canSend}>
            {sending ? <Loader size={15} className="spin" /> : <Send size={15} />}
            {sending ? 'Sending…' : uids.length ? `Send to ${plural(uids.length, noun.one, noun.many)}` : 'Nobody to send to'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default NotifyComposer;

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import {
  AlertCircle, ArrowLeft, Check, Clock, Headset, Loader, Mail, MessageSquarePlus,
  MessagesSquare, Phone, Search, SendHorizontal, Shield, X,
} from 'lucide-react';

import { db } from '../firebase';
import { useAdminAuth, useAdminLabel } from '../utils/adminAuthContext';
import { isDeletedAccount } from '../utils/broadcastSchema';
import { getVerification } from '../utils/userSchema';
import {
  MAX_MESSAGE, fullWhen, markReadByAdmin, sendAdminMessage, shortWhen, toMs,
  watchInbox, watchMessages, type SupportMessage, type SupportThread,
} from '../utils/supportChatSchema';

// ─── Support chat ─────────────────────────────────────────────────────────────
// Live conversations with riders and drivers. Users write from "Chat with
// Dridez" in the app; the team answers here and can start a conversation with
// any account ("New message", or "Message" on a user in the Users page, which
// links here as /support-chat?uid=…). Contract: dridez/schema.md §3.17.

interface Person {
  uid: string;
  name?: string;
  phone?: string;
  email?: string;
  verificationStatus?: string;
  verificationSubmitted?: boolean;
  isVerified?: boolean;
  driver?: boolean;
  deleted?: boolean;
  suspendedBy?: string;
  suspended?: boolean;
}

const initials = (name?: string) =>
  (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('') || '?';

// ─── New message: pick anyone ─────────────────────────────────────────────────

const PersonPicker: React.FC<{ onPick: (p: Person) => void; onClose: () => void }> = ({ onPick, onClose }) => {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    getDocs(collection(db, 'users'))
      .then(snap => setPeople(
        snap.docs
          .map(d => ({ ...(d.data() as Omit<Person, 'uid'>), uid: d.id }))
          .filter(p => !isDeletedAccount(p))
          .sort((a, b) => (a.name || '').localeCompare(b.name || '')),
      ))
      .catch(e => { console.error(e); setError('Users could not be loaded.'); });
  }, []);

  const matches = useMemo(() => {
    if (!people) return [];
    const q = search.trim().toLowerCase();
    const list = q
      ? people.filter(p => [p.name, p.phone, p.email, p.uid].some(v => (v || '').toLowerCase().includes(q)))
      : people;
    return list.slice(0, 60);
  }, [people, search]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="sc-picker" onClick={e => e.stopPropagation()} role="dialog" aria-label="Choose who to message">
        <div className="sc-picker-head">
          <strong>New message</strong>
          <button className="modal-close-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="users-search-bar sc-picker-search">
          <Search size={16} style={{ color: 'var(--text-secondary)' }} />
          <input
            autoFocus
            className="users-search-input"
            placeholder="Search by name, phone, email or uid…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className="sc-picker-list">
          {error ? (
            <p className="sc-muted"><AlertCircle size={14} /> {error}</p>
          ) : !people ? (
            <div className="loading-row"><Loader size={16} className="spin" /> Loading users…</div>
          ) : matches.length === 0 ? (
            <p className="sc-muted">Nobody matches “{search}”.</p>
          ) : (
            matches.map(p => (
              <button key={p.uid} className="sc-picker-row" onClick={() => onPick(p)}>
                <span className="sc-avatar">{initials(p.name)}</span>
                <span className="sc-picker-text">
                  <strong>{p.name || 'No name'}</strong>
                  <span>{[p.phone, p.email].filter(Boolean).join(' · ') || p.uid}</span>
                </span>
                {p.driver && <span className="sc-tag">Driver</span>}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

// ─── One conversation ─────────────────────────────────────────────────────────

const Conversation: React.FC<{
  uid: string;
  thread?: SupportThread;
  person: Person | null;
  onBack: () => void;
}> = ({ uid, thread, person, onBack }) => {
  const { user } = useAdminAuth();
  const adminLabel = useAdminLabel();
  const [messages, setMessages] = useState<SupportMessage[] | null>(null);
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const [sendError, setSendError] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMessages(null);
    setError('');
    setText('');
    setSendError('');
    return watchMessages(uid, setMessages, setError);
  }, [uid]);

  // Opening a conversation reads it.
  useEffect(() => {
    if ((thread?.unreadByAdmin ?? 0) > 0) markReadByAdmin(uid).catch(console.error);
  }, [uid, thread?.unreadByAdmin]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages?.length]);

  const name = person?.name || thread?.name || 'Unknown user';
  const phone = person?.phone || thread?.phone;

  const send = () => {
    const body = text.trim();
    if (!body || !user) return;
    setSendError('');
    setText('');
    // Not awaited: the message shows at once and settles when the server has it.
    sendAdminMessage({ uid, text: body, adminUid: user.uid, adminLabel, name: person?.name || thread?.name, phone })
      .catch(e => {
        console.error(e);
        setText(cur => cur || body);
        setSendError(e instanceof Error && e.message ? e.message : 'The message could not be sent.');
      });
  };

  const verification = person ? getVerification(person) : null;

  return (
    <section className="sc-conv">
      <header className="sc-conv-head">
        <button className="sc-back" onClick={onBack} aria-label="Back to conversations"><ArrowLeft size={18} /></button>
        <span className="sc-avatar sc-avatar-lg">{initials(name)}</span>
        <div className="sc-conv-who">
          <strong>{name}</strong>
          <span className="sc-conv-meta">
            {phone && <span><Phone size={12} /> {phone}</span>}
            {person?.email && <span><Mail size={12} /> {person.email}</span>}
            {verification && <span><Shield size={12} /> {verification}{person?.driver ? ' · driver' : ''}</span>}
          </span>
        </div>
      </header>

      <div className="sc-thread">
        {error ? (
          <p className="sc-muted"><AlertCircle size={14} /> {error}</p>
        ) : !messages ? (
          <div className="loading-row"><Loader size={16} className="spin" /> Loading messages…</div>
        ) : messages.length === 0 ? (
          <div className="sc-empty">
            <MessagesSquare size={34} />
            <p>No messages yet. Write below to start the conversation. {name} gets a notification on their phone.</p>
          </div>
        ) : (
          messages.map(m => (
            <div key={m.id} className={`sc-msg ${m.sender === 'admin' ? 'sc-msg-admin' : 'sc-msg-user'}`}>
              <div className="sc-bubble">{m.text}</div>
              <div className="sc-msg-meta">
                {m.sender === 'admin' && m.adminLabel && <span>{m.adminLabel} · </span>}
                {fullWhen(m.at)}
                {m.sender === 'admin' && (m.pending ? <Clock size={11} /> : <Check size={11} />)}
              </div>
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>

      <footer className="sc-composer">
        {sendError && <div className="rate-error"><AlertCircle size={13} /> {sendError}</div>}
        <div className="sc-composer-row">
          <textarea
            className="sc-input"
            rows={2}
            maxLength={MAX_MESSAGE}
            placeholder={`Reply to ${name}…  (Enter to send, Shift+Enter for a new line)`}
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
          />
          <button className="page-head-btn sc-send" onClick={send} disabled={!text.trim()}>
            <SendHorizontal size={16} /> Send
          </button>
        </div>
      </footer>
    </section>
  );
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export const SupportChat: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedUid = searchParams.get('uid');

  const [threads, setThreads] = useState<SupportThread[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [picking, setPicking] = useState(false);
  const [person, setPerson] = useState<Person | null>(null);

  useEffect(() => watchInbox(setThreads, setLoadError), []);

  // The selected account's profile: email and verification for the header,
  // and the name for a conversation the team is about to start.
  useEffect(() => {
    setPerson(null);
    if (!selectedUid) return;
    let live = true;
    getDoc(doc(db, 'users', selectedUid))
      .then(snap => { if (live && snap.exists()) setPerson({ ...(snap.data() as Omit<Person, 'uid'>), uid: snap.id }); })
      .catch(console.error);
    return () => { live = false; };
  }, [selectedUid]);

  const select = (uid: string | null) => setSearchParams(uid ? { uid } : {});

  const unreadTotal = useMemo(
    () => (threads || []).reduce((n, t) => n + (Number(t.unreadByAdmin) || 0), 0),
    [threads],
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!threads || !q) return threads || [];
    return threads.filter(t => [t.name, t.phone, t.lastMessage, t.uid].some(v => (v || '').toLowerCase().includes(q)));
  }, [threads, search]);

  const selectedThread = threads?.find(t => t.uid === selectedUid);

  return (
    <div className="sc-page">
      <div className="page-head">
        <div>
          <h1>Support Chat</h1>
          <p>
            Live conversations with riders and drivers. Your replies reach the user’s phone as a
            notification.{unreadTotal > 0 && <> <strong>{unreadTotal} unread.</strong></>}
          </p>
        </div>
        <button className="page-head-btn" onClick={() => setPicking(true)}>
          <MessageSquarePlus size={16} /> New message
        </button>
      </div>

      {loadError && (
        <div className="rate-alert rate-alert-error">
          <AlertCircle size={20} />
          <div><strong>Support chat could not be loaded</strong><p>{loadError}</p></div>
        </div>
      )}

      <div className={`sc-shell${selectedUid ? ' sc-has-selection' : ''}`}>
        <aside className="sc-list">
          <div className="sc-list-search">
            <Search size={15} />
            <input
              placeholder="Search conversations…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {search && <button onClick={() => setSearch('')} aria-label="Clear search"><X size={14} /></button>}
          </div>
          <div className="sc-list-rows">
            {!threads ? (
              <div className="loading-row"><Loader size={16} className="spin" /> Loading conversations…</div>
            ) : visible.length === 0 ? (
              <p className="sc-muted">
                {threads.length === 0 ? 'No conversations yet. Users start one from “Chat with Dridez” in the app.' : 'No conversation matches.'}
              </p>
            ) : (
              visible.map(t => {
                const unread = Number(t.unreadByAdmin) || 0;
                return (
                  <button
                    key={t.uid}
                    className={`sc-row${t.uid === selectedUid ? ' active' : ''}${unread ? ' unread' : ''}`}
                    onClick={() => select(t.uid)}
                  >
                    <span className="sc-avatar">{initials(t.name)}</span>
                    <span className="sc-row-text">
                      <span className="sc-row-top">
                        <strong>{t.name || t.phone || 'Unknown user'}</strong>
                        <span className="sc-row-time">{shortWhen(toMs(t.lastAt))}</span>
                      </span>
                      <span className="sc-row-bottom">
                        <span className="sc-row-preview">
                          {t.lastSender === 'admin' && <em>You: </em>}{t.lastMessage}
                        </span>
                        {unread > 0 && <span className="sc-unread">{unread > 99 ? '99+' : unread}</span>}
                      </span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {selectedUid ? (
          <Conversation
            uid={selectedUid}
            thread={selectedThread}
            person={person}
            onBack={() => select(null)}
          />
        ) : (
          <section className="sc-conv sc-conv-placeholder">
            <Headset size={40} />
            <p>Pick a conversation, or start a new one with any user.</p>
          </section>
        )}
      </div>

      {picking && (
        <PersonPicker
          onClose={() => setPicking(false)}
          onPick={p => { setPicking(false); select(p.uid); }}
        />
      )}
    </div>
  );
};

export default SupportChat;

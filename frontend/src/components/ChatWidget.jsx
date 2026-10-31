import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, MessageCircle, Send, Users, X } from 'lucide-react';
import client from '../api/client.js';

const POPPED_KEY = 'chat.popped';
const time = (d) => new Date(d).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
const initials = (name = '') =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('') || '?';

// Chat between the people of a branch: "Everyone" and one-to-one. Messages
// only last until Close Day, which deletes them all.
export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [contacts, setContacts] = useState(null);
  const [withId, setWithId] = useState(null); // 'all' | userId | null (list)
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const endRef = useRef(null);

  const loadContacts = useCallback(() => {
    client
      .get('/chat/contacts')
      .then((r) => setContacts(r.data.data))
      .catch(() => {});
  }, []);

  const loadMessages = useCallback(() => {
    if (!withId) return;
    client
      .get('/chat/messages', { params: { with: withId } })
      .then((r) => setMessages(r.data.data))
      .catch(() => {});
  }, [withId]);

  // Unread count and the newest message, every few seconds.
  useEffect(() => {
    loadContacts();
    const t = setInterval(loadContacts, open ? 6000 : 8000);
    return () => clearInterval(t);
  }, [open, loadContacts]);

  // A new message pops up above the Chat button so it is not missed, then
  // goes away by itself. Each message pops up once (also across reloads).
  const [popup, setPopup] = useState(null);
  const latest = contacts?.latest;
  useEffect(() => {
    if (!latest || open) return;
    let shown = '';
    try {
      shown = sessionStorage.getItem(POPPED_KEY) || '';
    } catch {
      // storage unavailable: it may pop up again after a reload
    }
    if (shown === String(latest.id)) return;
    try {
      sessionStorage.setItem(POPPED_KEY, String(latest.id));
    } catch {
      // ignore
    }
    setPopup(latest);
  }, [latest, open]);
  useEffect(() => {
    if (!popup) return undefined;
    const t = setTimeout(() => setPopup(null), 10000);
    return () => clearTimeout(t);
  }, [popup]);
  useEffect(() => {
    if (open) setPopup(null);
  }, [open]);
  const openPopup = () => {
    setWithId(popup.chat);
    setOpen(true);
    setPopup(null);
  };

  // The open conversation refreshes every few seconds.
  useEffect(() => {
    if (!open || !withId) return undefined;
    setMessages([]);
    loadMessages();
    const t = setInterval(loadMessages, 4000);
    return () => clearInterval(t);
  }, [open, withId, loadMessages]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  const send = async (e) => {
    e.preventDefault();
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      // quiet: no "Saving…" overlay for a chat message
      const r = await client.post('/chat/messages', { to: withId, text: body }, { quiet: true });
      setMessages((m) => [...m, r.data.data]);
      setText('');
    } catch {
      // keep the text so it can be sent again
    } finally {
      setSending(false);
    }
  };

  const unread = contacts?.unread || 0;
  const current = withId === 'all' ? contacts?.group : contacts?.people.find((p) => String(p.id) === String(withId));

  return (
    <div className="no-print">
      {popup && !open && (
        <div
          role="alert"
          className="chat-pop fixed bottom-20 right-5 z-[81] w-[min(340px,calc(100vw-2.5rem))] overflow-hidden rounded-2xl border border-brand-200 bg-white shadow-[0_20px_50px_-15px_rgba(11,62,168,0.55)]"
        >
          <div className="surface-blue flex items-center gap-2 px-3.5 py-2">
            <MessageCircle className="h-4 w-4" />
            <p className="min-w-0 flex-1 truncate text-xs font-bold">New message · {popup.fromName}</p>
            <span className="text-[10px] text-neutral-600">{time(popup.createdAt)}</span>
          </div>
          <button onClick={openPopup} className="block w-full px-3.5 py-3 text-left hover:bg-brand-50/60">
            <p className="line-clamp-3 whitespace-pre-wrap break-words text-sm text-neutral-900">{popup.text}</p>
          </button>
          <div className="flex justify-end gap-2 border-t border-neutral-100 px-3 py-2">
            <button onClick={() => setPopup(null)} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold text-neutral-600 hover:bg-neutral-100">
              <X className="h-3.5 w-3.5" /> Dismiss
            </button>
            <button onClick={openPopup} className="inline-flex items-center gap-1 rounded-lg bg-brand-400 px-3 py-1 text-xs font-bold text-neutral-950 hover:bg-brand-300">
              <MessageCircle className="h-3.5 w-3.5" /> Open &amp; reply
            </button>
          </div>
        </div>
      )}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-[80] inline-flex items-center gap-2 rounded-full bg-brand-400 px-4 py-3 text-sm font-bold text-neutral-950 shadow-[0_12px_30px_-10px_rgba(11,62,168,0.55)] hover:bg-brand-300"
        >
          <MessageCircle className="h-5 w-5" /> Chat
          {unread > 0 && <span className="rounded-full bg-neutral-950 px-1.5 py-0.5 text-[11px] font-bold text-white">{unread}</span>}
        </button>
      )}

      {open && (
        <div className="fixed inset-0 z-[80] flex flex-col bg-white sm:inset-auto sm:bottom-5 sm:right-5 sm:h-[540px] sm:w-[380px] sm:overflow-hidden sm:rounded-3xl sm:border sm:border-neutral-200/80 sm:shadow-[0_24px_60px_-20px_rgba(11,62,168,0.45)]">
          {/* Header */}
          <div className="surface-blue flex items-center gap-2 px-4 py-3">
            {withId && (
              <button onClick={() => setWithId(null)} className="rounded-lg p-1 hover:bg-white/50" aria-label="Back to people">
                <ArrowLeft className="h-4 w-4" />
              </button>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold">{withId ? current?.name || 'Chat' : 'Chat'}</p>
              <p className="truncate text-[11px] text-neutral-600">{contacts?.role === 'super' && !withId ? 'Branch admins · deleted at each Close Day' : 'Messages are deleted at Close Day'}</p>
            </div>
            <button onClick={() => setOpen(false)} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold hover:bg-white/50">
              <X className="h-4 w-4" /> Close
            </button>
          </div>

          {/* People */}
          {!withId && (
            <div className="flex-1 overflow-y-auto">
              {!contacts ? (
                <p className="py-10 text-center text-sm text-neutral-400">Loading…</p>
              ) : (
                <ul className="divide-y divide-neutral-100">
                  {[{ ...contacts.group, isGroup: true }, ...contacts.people].map((c) => (
                    <li key={String(c.id)}>
                      <button onClick={() => setWithId(String(c.id))} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-brand-50/60">
                        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold ${c.isGroup ? 'bg-brand-400 text-neutral-950' : 'bg-brand-100 text-brand-800'}`}>
                          {c.isGroup ? <Users className="h-4 w-4" /> : initials(c.name)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-neutral-900">{c.name}</span>
                          <span className={`block truncate text-[11px] text-neutral-400 ${c.isGroup ? "" : "capitalize"}`}>{c.isGroup ? c.note : [c.role, c.branchName].filter(Boolean).join(" · ")}</span>
                        </span>
                        {c.unread > 0 && <span className="rounded-full bg-brand-400 px-2 py-0.5 text-[11px] font-bold text-neutral-950">{c.unread}</span>}
                      </button>
                    </li>
                  ))}
                  {contacts.people.length === 0 && <li className="px-4 py-6 text-center text-xs text-neutral-400">No one else in this branch yet.</li>}
                </ul>
              )}
            </div>
          )}

          {/* Conversation */}
          {withId && (
            <>
              <div className="flex-1 space-y-2 overflow-y-auto bg-neutral-50/70 px-3 py-3">
                {messages.length === 0 && <p className="py-10 text-center text-xs text-neutral-400">No messages yet today. Say hello.</p>}
                {messages.map((m) => (
                  <div key={m.id} className={`flex ${m.mine ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${m.mine ? 'rounded-br-md bg-brand-400 text-neutral-950' : 'rounded-bl-md border border-neutral-200/80 bg-white text-neutral-900'}`}>
                      {!m.mine && withId === 'all' && (
                        <p className="mb-0.5 text-[11px] font-semibold text-brand-700">
                          {m.fromName}
                          {m.broadcast ? ' · to all admins' : ''}
                        </p>
                      )}
                      <p className="whitespace-pre-wrap break-words">{m.text}</p>
                      <p className={`mt-0.5 text-right text-[10px] ${m.mine ? 'text-neutral-700' : 'text-neutral-400'}`}>{time(m.createdAt)}</p>
                    </div>
                  </div>
                ))}
                <div ref={endRef} />
              </div>
              {withId === 'all' && contacts?.group && !contacts.group.canPost ? (
                <p className="border-t border-neutral-100 bg-white px-4 py-3 text-center text-xs text-neutral-500">Only the admin writes here. To reply, open your admin in the list.</p>
              ) : (
              <form onSubmit={send} className="flex items-center gap-2 border-t border-neutral-100 bg-white p-2.5">
                <input
                  autoFocus
                  value={text}
                  maxLength={1000}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Write a message…"
                  className="min-w-0 flex-1 rounded-xl border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-brand-400"
                />
                <button
                  type="submit"
                  disabled={!text.trim() || sending}
                  className="inline-flex items-center gap-1 rounded-xl bg-brand-400 px-3 py-2 text-sm font-semibold text-neutral-950 hover:bg-brand-300 disabled:opacity-50"
                >
                  <Send className="h-4 w-4" /> Send
                </button>
              </form>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Boxes, CalendarClock, X } from 'lucide-react';
import client from '../api/client.js';

const SEEN_KEY = 'stockAlerts.seen'; // stock steps already shown
const EXPIRY_KEY = 'expiryAlerts.day'; // { day, times, lastAt }
const EXPIRY_TIMES_PER_DAY = 5;
const EXPIRY_GAP_MS = 90 * 60 * 1000; // spread the five over the day
const CHECK_EVERY_MS = 5 * 60 * 1000;
const SHOW_FOR_MS = 25 * 1000;
const MAX_ROWS = 5;

const readJSON = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
};
const writeJSON = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage unavailable: alerts may repeat
  }
};

const shortDate = (d) => new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const whenExpires = (days) => (days < 0 ? `Expired ${-days} day${days === -1 ? '' : 's'} ago` : days === 0 ? 'Expires today' : `Expires in ${days} day${days === 1 ? '' : 's'}`);

function Card({ red, icon: Icon, title, note, onClose, onView, children }) {
  return (
    <div
      role="alert"
      className={`chat-pop w-[min(360px,calc(100vw-2.5rem))] overflow-hidden rounded-2xl border bg-white shadow-[0_20px_50px_-15px_rgba(11,62,168,0.5)] ${red ? 'border-red-200' : 'border-brand-200'}`}
    >
      <div className={`flex items-center gap-2 px-3.5 py-2 ${red ? 'bg-red-600 text-white' : 'surface-blue'}`}>
        <Icon className="h-4 w-4 shrink-0" />
        <p className="min-w-0 flex-1 truncate text-xs font-bold">{title}</p>
        {note && <span className={`text-[10px] ${red ? 'text-red-100' : 'text-neutral-600'}`}>{note}</span>}
      </div>
      <ul className="divide-y divide-neutral-100">{children}</ul>
      <div className="flex justify-end gap-2 border-t border-neutral-100 px-3 py-2">
        <button onClick={onClose} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold text-neutral-600 hover:bg-neutral-100">
          <X className="h-3.5 w-3.5" /> Dismiss
        </button>
        <button
          onClick={onView}
          className={`inline-flex items-center gap-1 rounded-lg px-3 py-1 text-xs font-bold ${red ? 'bg-red-600 text-white hover:bg-red-700' : 'bg-brand-400 text-neutral-950 hover:bg-brand-300'}`}
        >
          <Boxes className="h-3.5 w-3.5" /> View inventory
        </button>
      </div>
    </div>
  );
}

const More = ({ count }) => (count > 0 ? <li className="px-3.5 py-1.5 text-[11px] font-semibold text-neutral-500">+ {count} more</li> : null);

// Pop-up alerts for whoever looks after the stock:
//  - red: stock expiring within a month -- up to five times a day while the
//    business day is open;
//  - stock running down since its last restock: at 80%, 60%, 40% left, and
//    in red at 20% (or the minimum stock). Each step pops up once.
export default function StockAlerts() {
  const navigate = useNavigate();
  const [expiry, setExpiry] = useState(null);
  const [stock, setStock] = useState(null);

  const check = useCallback(async () => {
    let data;
    let day;
    try {
      const [a, d] = await Promise.all([
        client.get('/inventory/alerts/popup', { quiet: true }),
        client.get('/day-close/status', { quiet: true }).catch(() => null),
      ]);
      data = a.data.data;
      day = d?.data?.data;
    } catch {
      return;
    }

    // Stock steps not shown yet.
    const seen = new Set(readJSON(SEEN_KEY, []));
    const fresh = data.stock.filter((s) => !seen.has(s.key));
    writeJSON(SEEN_KEY, data.stock.map((s) => s.key));
    if (fresh.length) setStock(fresh);

    // Expiry: only while the day is open, five times a day at most.
    if (day?.status === 'OPEN' && data.expiring.length) {
      const dayKey = String(day.openedAt || day.businessDate || '');
      let rec = readJSON(EXPIRY_KEY, {});
      if (rec.day !== dayKey) rec = { day: dayKey, times: 0, lastAt: 0 };
      if (rec.times < EXPIRY_TIMES_PER_DAY && Date.now() - rec.lastAt >= EXPIRY_GAP_MS) {
        rec = { ...rec, times: rec.times + 1, lastAt: Date.now() };
        writeJSON(EXPIRY_KEY, rec);
        setExpiry({ items: data.expiring, time: rec.times });
      }
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(check, 3000);
    const t = setInterval(check, CHECK_EVERY_MS);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [check]);

  useEffect(() => {
    if (!expiry) return undefined;
    const t = setTimeout(() => setExpiry(null), SHOW_FOR_MS);
    return () => clearTimeout(t);
  }, [expiry]);
  useEffect(() => {
    if (!stock) return undefined;
    const t = setTimeout(() => setStock(null), SHOW_FOR_MS);
    return () => clearTimeout(t);
  }, [stock]);

  const view = () => {
    setExpiry(null);
    setStock(null);
    navigate('/inventory');
  };

  if (!expiry && !stock) return null;
  const stockRed = stock?.some((s) => s.red);

  return (
    <div className="no-print fixed right-5 top-16 z-[79] flex flex-col gap-3">
      {expiry && (
        <Card red icon={CalendarClock} title="Expiring within a month" note={`Alert ${expiry.time} of ${EXPIRY_TIMES_PER_DAY} today`} onClose={() => setExpiry(null)} onView={view}>
          {expiry.items.slice(0, MAX_ROWS).map((e) => (
            <li key={String(e.item)} className="flex items-start gap-3 px-3.5 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-neutral-900">{e.name}</p>
                <p className="text-[11px] text-neutral-500">
                  {shortDate(e.expiryDate)} · {e.quantity} left{e.branchName ? ` · ${e.branchName}` : ''}
                </p>
              </div>
              <span className="shrink-0 rounded-md bg-red-50 px-1.5 py-0.5 text-[11px] font-bold text-red-700">{whenExpires(e.daysLeft)}</span>
            </li>
          ))}
          <More count={expiry.items.length - MAX_ROWS} />
        </Card>
      )}
      {stock && (
        <Card red={stockRed} icon={AlertTriangle} title="Stock running low" onClose={() => setStock(null)} onView={view}>
          {stock.slice(0, MAX_ROWS).map((s) => (
            <li key={s.key} className="px-3.5 py-2">
              <div className="flex items-center gap-3">
                <p className="min-w-0 flex-1 truncate text-sm font-semibold text-neutral-900">{s.name}</p>
                <span className={`figure shrink-0 text-xs font-bold ${s.red ? 'text-red-600' : 'text-neutral-800'}`}>
                  {s.quantity} left of {s.base}
                </span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-neutral-100">
                <div className={`h-full rounded-full ${s.red ? 'bg-red-500' : 'bg-brand-400'}`} style={{ width: `${Math.max(3, Math.min(100, s.percentLeft))}%` }} />
              </div>
              {s.branchName && <p className="mt-0.5 text-[10px] text-neutral-400">{s.branchName}</p>}
            </li>
          ))}
          <More count={stock.length - MAX_ROWS} />
        </Card>
      )}
    </div>
  );
}

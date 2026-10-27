import { ChevronLeft, ChevronRight } from 'lucide-react';

// Quick periods for a From/To date filter: All, Day, Week, Month, Year, with
// Previous/Next to step back through earlier periods. A week runs Saturday to
// Friday. The parent owns `from`/`to` (YYYY-MM-DD) and `period`.
const PERIODS = [
  { key: 'day', label: 'Day' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
  { key: 'year', label: 'Year' },
];
const pad2 = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

// [from, to] (inclusive days) of the period `offset` steps back from today.
export function periodDates(type, offset) {
  const now = new Date();
  if (type === 'day') {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    return [ymd(d), ymd(d)];
  }
  if (type === 'week') {
    const back = (now.getDay() + 1) % 7; // days since Saturday
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back + offset * 7);
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
    return [ymd(start), ymd(end)];
  }
  if (type === 'month') {
    const start = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    return [ymd(start), ymd(new Date(start.getFullYear(), start.getMonth() + 1, 0))];
  }
  const y = now.getFullYear() + offset;
  return [`${y}-01-01`, `${y}-12-31`];
}

function periodLabel(type, offset, from, to) {
  const d = new Date(`${from}T00:00:00`);
  if (type === 'day') return offset === 0 ? 'Today' : offset === -1 ? 'Yesterday' : d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  if (type === 'week') {
    const e = new Date(`${to}T00:00:00`);
    const range = `${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} – ${e.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`;
    return offset === 0 ? `This week · ${range}` : range;
  }
  if (type === 'month') return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  return String(d.getFullYear());
}

// period: { type, offset } or null. onChange({ period, from, to }).
export default function PeriodFilter({ period, from, to, onChange }) {
  const choose = (type, offset = 0) => {
    const [f, t] = periodDates(type, offset);
    onChange({ period: { type, offset }, from: f, to: t });
  };
  const tab = (active) => `rounded-md px-3.5 py-1.5 text-sm font-semibold transition ${active ? 'bg-brand-400 text-neutral-950' : 'text-neutral-600 hover:bg-neutral-50'}`;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="inline-flex rounded-lg border border-neutral-200 bg-white p-0.5">
        <button onClick={() => onChange({ period: null, from: '', to: '' })} className={tab(!period && !from && !to)}>
          All
        </button>
        {PERIODS.map((p) => (
          <button key={p.key} onClick={() => choose(p.key)} className={tab(period?.type === p.key)}>
            {p.label}
          </button>
        ))}
      </div>
      {period && (
        <div className="inline-flex items-center gap-1">
          <button
            onClick={() => choose(period.type, period.offset - 1)}
            className="inline-flex items-center gap-0.5 rounded-lg border border-neutral-200 px-2.5 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
          >
            <ChevronLeft className="h-4 w-4" /> Previous
          </button>
          <span className="min-w-[10rem] px-2 text-center text-sm font-bold text-neutral-900">{periodLabel(period.type, period.offset, from, to)}</span>
          <button
            onClick={() => choose(period.type, period.offset + 1)}
            disabled={period.offset >= 0}
            className="inline-flex items-center gap-0.5 rounded-lg border border-neutral-200 px-2.5 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}

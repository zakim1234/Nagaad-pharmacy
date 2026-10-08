import { CalendarRange } from 'lucide-react';
import { Input } from '../ui/Field.jsx';

const PRESETS = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'week', label: 'This Week' },
  { value: 'month', label: 'This Month' },
  { value: 'year', label: 'This Year' },
];

// Preset ranges as pills plus an optional custom From/To. A custom date wins
// over the preset (the parent clears the dates when a preset is picked).
export default function DateRangeFilter({ range, onRangeChange, from, to, onFromChange, onToChange, allowAll = false }) {
  const custom = !!(from || to);
  const presets = allowAll ? [{ value: 'all', label: 'All History' }, ...PRESETS] : PRESETS;
  return (
    <div className="mb-5 flex flex-wrap items-center gap-3 no-print">
      <div className="flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
        {presets.map((p) => {
          const active = !custom && range === p.value;
          return (
            <button
              key={p.value}
              type="button"
              onClick={() => onRangeChange(p.value)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                active ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {p.label}
            </button>
          );
        })}
      </div>
      <div
        className={`flex flex-wrap items-center gap-2 rounded-xl border bg-white px-3 py-1.5 shadow-sm ${
          custom ? 'border-brand-300 ring-1 ring-brand-100' : 'border-slate-200'
        }`}
      >
        <CalendarRange className={`h-4 w-4 ${custom ? 'text-brand-600' : 'text-slate-400'}`} />
        <span className="text-sm text-slate-500">Custom</span>
        <Input type="date" value={from} onChange={(e) => onFromChange(e.target.value)} className="w-38! py-1!" aria-label="From date" />
        <span className="text-sm text-slate-400">to</span>
        <Input type="date" value={to} onChange={(e) => onToChange(e.target.value)} className="w-38! py-1!" aria-label="To date" />
      </div>
    </div>
  );
}

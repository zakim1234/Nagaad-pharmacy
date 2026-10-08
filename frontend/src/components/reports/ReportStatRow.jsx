// Each stat's `tone` is the text colour class of its value; the matching
// accent bar keeps the meaning (good / warning / bad) visible at a glance.
const ACCENTS = {
  'text-emerald-600': 'bg-emerald-500',
  'text-amber-600': 'bg-amber-500',
  'text-rose-600': 'bg-rose-500',
  'text-brand-600': 'bg-brand-500',
  // Plain totals: black figure, red brand accent bar.
  'text-neutral-900': 'bg-brand-600',
  'text-sky-600': 'bg-sky-500',
};

export default function ReportStatRow({ items }) {
  return (
    <div className="kpi-grid grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {items.map(({ label, value, tone }) => (
        <div
          key={label}
          className="relative overflow-hidden rounded-xl border border-slate-100 bg-gradient-to-br from-slate-50 to-white px-4 py-3.5 print:border-slate-200 print:bg-white"
        >
          <span className={`absolute inset-y-3 left-0 w-1 rounded-r-full ${ACCENTS[tone] || 'bg-slate-300'} print:hidden`} />
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</p>
          <p className={`mt-1 text-xl font-bold tabular-nums ${tone || 'text-slate-900'}`}>{value}</p>
        </div>
      ))}
    </div>
  );
}

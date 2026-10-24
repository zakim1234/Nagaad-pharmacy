// Each stat's `tone` is the text colour class of its value; the matching
// accent bar keeps the meaning (good / warning / bad) visible at a glance.
const ACCENTS = {
  'text-emerald-600': 'bg-emerald-500',
  'text-amber-600': 'bg-amber-500',
  'text-brand-600': 'bg-brand-500',
  'text-brand-600': 'bg-brand-500',
  // Plain totals: black figure, red brand accent bar.
  'text-neutral-900': 'bg-brand-600',
  'text-neutral-600': 'bg-neutral-500',
};

export default function ReportStatRow({ items }) {
  return (
    <div className="kpi-grid grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {items.map(({ label, value, tone }) => (
        <div
          key={label}
          className="relative overflow-hidden rounded-2xl border border-neutral-200/80 bg-white px-4 py-3.5"
        >
          <p className="eyebrow">{label}</p>
          <p className={`figure mt-1.5 text-xl font-extrabold ${tone === 'text-brand-600' ? 'text-brand-700' : 'text-neutral-950'}`}>{value}</p>
        </div>
      ))}
    </div>
  );
}

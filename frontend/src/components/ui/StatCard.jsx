export default function StatCard({ label, value, icon: Icon, tone = 'slate', hint }) {
  const tones = {
    slate: 'bg-neutral-100 text-neutral-600',
    indigo: 'bg-brand-100 text-brand-600',
    emerald: 'bg-emerald-100 text-emerald-600',
    amber: 'bg-amber-100 text-amber-600',
    rose: 'bg-brand-100 text-brand-600',
  };

  return (
    <div className="rounded-2xl border border-neutral-200/80 bg-white p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="eyebrow">{label}</p>
          <p className="figure mt-1.5 text-[26px] font-extrabold text-neutral-950">{value}</p>
          {hint && <p className="mt-1 text-xs text-neutral-400">{hint}</p>}
        </div>
        {Icon && (
          <div className={`rounded-lg p-2 ${tones[tone]}`}>
            <Icon className="h-5 w-5" />
          </div>
        )}
      </div>
    </div>
  );
}

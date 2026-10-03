export default function ReportStatRow({ items }) {
  return (
    <div className="kpi-grid grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {items.map(({ label, value, tone }) => (
        <div key={label} className="rounded-lg bg-slate-50 p-4 print:border print:border-slate-200 print:bg-white">
          <p className="text-xs uppercase text-slate-400">{label}</p>
          <p className={`mt-1 text-xl font-bold ${tone || 'text-slate-900'}`}>{value}</p>
        </div>
      ))}
    </div>
  );
}

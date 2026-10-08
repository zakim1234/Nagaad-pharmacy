// A print-aware report card: on paper it never splits a KPI group, chart,
// or table across a page break.
export default function ReportSection({ title, subtitle, icon: Icon, actions, className = '', children }) {
  return (
    <section className={`report-section rounded-2xl border border-slate-200/70 bg-white shadow-sm print:rounded-none print:border-slate-300 print:shadow-none ${className}`}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            {Icon && (
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-50 text-brand-600 print:hidden">
                <Icon className="h-4 w-4" />
              </div>
            )}
            <div>
              {title && <h3 className="text-[15px] font-semibold text-slate-800">{title}</h3>}
              {subtitle && <p className="text-xs text-slate-400">{subtitle}</p>}
            </div>
          </div>
          {actions}
        </div>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

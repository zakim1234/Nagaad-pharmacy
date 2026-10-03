export default function Card({ children, className = '', title, subtitle, actions, dense = false }) {
  return (
    <div className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}>
      {(title || actions) && (
        <div className={`flex items-center justify-between border-b border-slate-100 ${dense ? 'px-3.5 py-2' : 'px-5 py-3.5'}`}>
          <div>
            {title && <h3 className="text-sm font-semibold text-slate-800">{title}</h3>}
            {subtitle && <p className="mt-0.5 text-xs font-normal text-slate-400">{subtitle}</p>}
          </div>
          {actions}
        </div>
      )}
      <div className={dense ? 'p-3.5' : 'p-5'}>{children}</div>
    </div>
  );
}

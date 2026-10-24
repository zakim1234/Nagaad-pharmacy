export default function Card({ children, className = '', title, subtitle, actions, dense = false }) {
  return (
    <div className={`rounded-2xl border border-neutral-200/80 bg-white ${className}`}>
      {(title || actions) && (
        <div className={`flex items-center justify-between border-b border-neutral-100 ${dense ? 'px-3.5 py-2' : 'px-5 py-3.5'}`}>
          <div>
            {title && <h3 className="text-[15px] font-bold text-neutral-950" style={{ fontFamily: 'var(--font-display)' }}>{title}</h3>}
            {subtitle && <p className="mt-0.5 text-xs font-normal text-neutral-400">{subtitle}</p>}
          </div>
          {actions}
        </div>
      )}
      <div className={dense ? 'p-3.5' : 'p-5'}>{children}</div>
    </div>
  );
}

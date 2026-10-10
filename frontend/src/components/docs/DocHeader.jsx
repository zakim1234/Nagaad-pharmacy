import { BUSINESS } from '../../constants/business.js';
import logo from '../../images/logo.png';

// The branded top shared by every printed document: logo centred, business
// name and contacts, a red rule, and a black band with the document title
// and its date / number on the right.
export default function DocHeader({ title, meta, compact = false }) {
  return (
    <div style={{ WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}>
      <div className="flex flex-col items-center text-center">
        <img src={logo} alt={BUSINESS.name} className={`${compact ? 'h-12' : 'h-16'} w-auto object-contain`} />
        <h1 className={`mt-1 font-extrabold uppercase tracking-[0.2em] text-neutral-900 ${compact ? 'text-sm' : 'text-lg'}`}>{BUSINESS.name}</h1>
        <p className="text-[11px] text-neutral-600">
          {BUSINESS.addressLine} · {BUSINESS.phone}
        </p>
      </div>
      <div className={`${compact ? 'mt-3' : 'mt-4'} h-1 bg-brand-600`} />
      <div className={`flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 bg-neutral-950 text-white ${compact ? 'px-3 py-1.5' : 'px-4 py-2'}`}>
        <p className={`font-bold uppercase ${compact ? 'text-xs tracking-[0.2em]' : 'text-sm tracking-[0.25em]'}`}>{title}</p>
        {meta && <div className="text-[11px]">{meta}</div>}
      </div>
    </div>
  );
}

// Three totals boxes (white / red / black) used at the bottom of documents.
export function DocTotals({ items }) {
  const tone = ['border border-neutral-300 bg-white text-neutral-900', 'bg-brand-600 text-white', 'bg-neutral-950 text-white'];
  return (
    <div className={`grid gap-3`} style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))`, WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}>
      {items.map(([label, value], i) => (
        <div key={label} className={`rounded-lg px-3 py-2.5 text-center ${tone[i % 3]}`}>
          <p className={`text-[10px] uppercase tracking-wider ${i % 3 === 0 ? 'text-neutral-500' : 'text-white/75'}`}>{label}</p>
          <p className="mt-0.5 text-base font-bold tabular-nums">{value}</p>
        </div>
      ))}
    </div>
  );
}

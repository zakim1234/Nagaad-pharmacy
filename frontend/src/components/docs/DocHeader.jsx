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

// Table styling shared by documents.
export const DOC_TH = 'px-2 py-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-500';
export const DOC_THEAD_ROW = 'border-b-2 border-neutral-900';
export const docRow = (i) => `border-b border-neutral-200 ${i % 2 ? 'bg-neutral-50' : ''}`;

// The "who and which document" strip under the header: a party on the
// left (customer, supplier…) and the document number/date on the right.
export function DocInfo({ left, right }) {
  const block = ([label, main, ...sub], align) =>
    label ? (
      <div className={align}>
        <p className="text-[10px] uppercase tracking-wider text-neutral-500">{label}</p>
        <p className="text-sm font-bold text-neutral-900">{main}</p>
        {sub.filter(Boolean).map((s, i) => (
          <p key={i} className="text-[11px] text-neutral-500">
            {s}
          </p>
        ))}
      </div>
    ) : (
      <div />
    );
  return (
    <div className="mt-4 flex items-start justify-between gap-4">
      {block(left || [], 'text-left')}
      {block(right || [], 'text-right')}
    </div>
  );
}

// Money summary: plain lines, then the grand total on a black band and an
// optional red line for what is still owed.
export function DocSummary({ lines = [], grand, owed }) {
  return (
    <div className="ml-auto mt-4 w-full max-w-xs text-xs" style={{ WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}>
      {lines.filter(Boolean).map(([label, value]) => (
        <div key={label} className="flex justify-between py-1 text-neutral-600">
          <span>{label}</span>
          <span className="tabular-nums">{value}</span>
        </div>
      ))}
      {grand && (
        <div className="mt-1 flex justify-between bg-neutral-950 px-3 py-2 text-sm font-bold text-white">
          <span>{grand[0]}</span>
          <span className="tabular-nums">{grand[1]}</span>
        </div>
      )}
      {owed && (
        <div className="mt-1.5 flex justify-between bg-brand-600 px-3 py-2 text-sm font-bold text-white">
          <span>{owed[0]}</span>
          <span className="tabular-nums">{owed[1]}</span>
        </div>
      )}
    </div>
  );
}

export function DocFooter({ children }) {
  return <div className="mt-5 border-t border-neutral-200 pt-2 text-center text-[11px] text-neutral-400">{children}</div>;
}

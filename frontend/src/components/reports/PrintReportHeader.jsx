import { BUSINESS } from '../../constants/business.js';
import { formatDate, formatDateTime } from '../../utils/format.js';
import logo from '../../images/logo.png';

// The one branded page top shared by every report: logo, business name,
// address, report title, date range and (optionally) a basis line such as
// "Accrual Basis". By default it is rendered only when printing
// (`hidden print:block`) so the interactive screen never shows a duplicate
// header; a report that is itself a document (Profit & Loss) passes
// `showOnScreen` to show the same header on screen too.
export default function PrintReportHeader({ title, rangeLabel, subtitle, showOnScreen = false }) {
  return (
    <div className={showOnScreen ? '' : 'hidden print:block'}>
      <div className="flex flex-col items-center text-center">
        <img src={logo} alt={BUSINESS.name} className="h-14 w-auto object-contain" />
        <h1 className="mt-1 text-base font-bold tracking-wide text-slate-900">{BUSINESS.name}</h1>
        <p className="text-xs text-slate-500">{BUSINESS.addressLine}</p>
        <p className="text-xs text-slate-500">{BUSINESS.phone}</p>
      </div>

      <div className="my-3 border-t border-slate-300" />

      <div className="text-center">
        <p className="text-lg font-bold uppercase tracking-wide text-slate-900">{title}</p>
        {rangeLabel && <p className="mt-0.5 text-sm text-slate-600">{rangeLabel}</p>}
        {subtitle && <p className="text-xs font-medium text-slate-500">{subtitle}</p>}
        <p className="mt-0.5 text-xs text-slate-400">Generated: {formatDateTime(new Date())}</p>
      </div>

      <div className="my-4 border-t border-dashed border-slate-300" />
    </div>
  );
}

export function formatRangeLabel(range) {
  if (!range) return '';
  const from = range.from ? formatDate(range.from) : null;
  const to = range.to ? formatDate(range.to) : null;
  if (from && to) return `${from} - ${to}`;
  return from || to || '';
}

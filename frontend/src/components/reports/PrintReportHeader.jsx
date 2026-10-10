import { formatDate, formatDateTime } from '../../utils/format.js';
import DocHeader from '../docs/DocHeader.jsx';

// The one branded page top shared by every report: logo, business name,
// address, report title, date range and (optionally) a basis line such as
// "Accrual Basis". By default it is rendered only when printing
// (`hidden print:block`) so the interactive screen never shows a duplicate
// header; a report that is itself a document (Profit & Loss) passes
// `showOnScreen` to show the same header on screen too.
export default function PrintReportHeader({ title, rangeLabel, subtitle, showOnScreen = false }) {
  return (
    <div className={showOnScreen ? 'mb-5' : 'mb-5 hidden print:block'}>
      <DocHeader
        title={title}
        meta={
          <span>
            {rangeLabel && <span className="font-semibold">{rangeLabel}</span>}
            {subtitle && <span className="ml-2 text-neutral-400">{subtitle}</span>}
          </span>
        }
      />
      <p className="mt-1 text-right text-[10px] text-neutral-400">Generated: {formatDateTime(new Date())}</p>
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

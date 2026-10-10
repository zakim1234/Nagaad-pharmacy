import { useCallback, useEffect, useState } from 'react';
import { Download, Printer, RefreshCw } from 'lucide-react';
import client from '../../api/client.js';
import { useToast } from '../../context/ToastContext.jsx';
import { printReport } from '../../utils/printReport.js';
import { formatMoney } from '../../utils/format.js';
import Button from '../../components/ui/Button.jsx';
import SharePdfButton from '../../components/SharePdfButton.jsx';
import { Input, Select } from '../../components/ui/Field.jsx';
import { PageSpinner } from '../../components/ui/Spinner.jsx';
import PrintReportHeader from '../../components/reports/PrintReportHeader.jsx';

const pad = (n) => String(n).padStart(2, '0');
const dayString = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const PRESETS = [
  { key: 'mtd', label: 'This Month-to-date' },
  { key: 'last-month', label: 'Last Month' },
  { key: 'ytd', label: 'This Year' },
  { key: 'custom', label: 'Custom Range' },
];

// Resolves a preset to concrete From/To day strings in the browser's local time.
function presetRange(key) {
  const now = new Date();
  if (key === 'last-month') {
    return { from: dayString(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: dayString(new Date(now.getFullYear(), now.getMonth(), 0)) };
  }
  if (key === 'ytd') return { from: dayString(new Date(now.getFullYear(), 0, 1)), to: dayString(now) };
  return { from: dayString(new Date(now.getFullYear(), now.getMonth(), 1)), to: dayString(now) }; // mtd
}

const longDay = (s) => new Date(`${s}T12:00:00`).toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
const monthDay = (s) => new Date(`${s}T12:00:00`).toLocaleString('en-US', { month: 'long', day: 'numeric' });

// "September 1 - 19, 2026"
function rangeLabel({ from, to }) {
  if (from === to) return longDay(from);
  const [fy, fm] = from.split('-');
  const [ty, tm] = to.split('-');
  if (fy === ty && fm === tm) return `${monthDay(from)} - ${Number(to.split('-')[2])}, ${fy}`;
  if (fy === ty) return `${monthDay(from)} - ${monthDay(to)}, ${fy}`;
  return `${longDay(from)} - ${longDay(to)}`;
}

function Amount({ value }) {
  if (value === undefined || value === null) return null;
  const negative = value < 0;
  return <span className={negative ? 'text-rose-600' : ''}>{negative ? `-${formatMoney(-value)}` : formatMoney(value)}</span>;
}

function ReportRow({ row, columns }) {
  const cells = columns.map((c) => (
    <td key={c.key} className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">
      {row.values ? <Amount value={row.values[c.key]} /> : null}
    </td>
  ));

  if (row.type === 'section') {
    return (
      <tr>
        <td colSpan={columns.length + 1} className="pt-4 pb-1 text-sm font-bold text-slate-900">
          {row.label}
        </td>
      </tr>
    );
  }
  if (row.type === 'line') {
    return (
      <tr className="text-sm text-slate-700">
        <td className="px-3 py-1.5" style={{ paddingLeft: `${0.75 + (row.depth || 1) * 1.25}rem` }}>
          {row.label}
        </td>
        {cells}
      </tr>
    );
  }
  if (row.type === 'total') {
    return (
      <tr className="border-t border-slate-400 text-sm font-bold text-slate-900">
        <td className="px-3 py-1.5">{row.label}</td>
        {cells}
      </tr>
    );
  }
  // grand: Gross Profit / Net Income
  return (
    <tr className="border-t border-slate-400 bg-slate-50 text-sm font-bold text-slate-900 print:bg-white">
      <td className="border-b-4 border-double border-slate-400 px-3 py-2">{row.label}</td>
      {columns.map((c) => (
        <td key={c.key} className="whitespace-nowrap border-b-4 border-double border-slate-400 px-3 py-2 text-right tabular-nums">
          <Amount value={row.values[c.key]} />
        </td>
      ))}
    </tr>
  );
}

export default function ProfitLossReport() {
  const toast = useToast();
  const [preset, setPreset] = useState('mtd');
  const [{ from, to }, setDates] = useState(() => presetRange('mtd'));
  const [basis, setBasis] = useState('accrual');
  const [columns, setColumns] = useState('total');
  const [sort, setSort] = useState('default');
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  const params = { from, to, basis, columns, sort };

  const load = useCallback(() => {
    if (!from || !to) return;
    setLoading(true);
    client
      .get('/reports/profit-loss', { params: { from, to, basis, columns, sort } })
      .then((res) => setReport(res.data.data))
      .catch((err) => {
        setReport(null);
        toast.error(err.friendlyMessage || 'Failed to load the report.');
      })
      .finally(() => setLoading(false));
  }, [from, to, basis, columns, sort]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    load();
  }, [load]);

  const changePreset = (key) => {
    setPreset(key);
    if (key !== 'custom') setDates(presetRange(key));
  };
  const changeDate = (field) => (e) => {
    setPreset('custom');
    setDates((d) => ({ ...d, [field]: e.target.value }));
  };

  const exportExcel = async () => {
    setExporting(true);
    try {
      const res = await client.get('/reports/profit-loss/export', { params, responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `profit-and-loss_${from}_to_${to}_${basis}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Could not export to Excel.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div>
      <div className="mb-5 space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm no-print">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm font-medium text-slate-700">
            Dates
            <Select value={preset} onChange={(e) => changePreset(e.target.value)} className="mt-1 w-48">
              {PRESETS.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </Select>
          </label>
          <label className="text-sm font-medium text-slate-700">
            From
            <Input type="date" value={from} onChange={changeDate('from')} className="mt-1 w-40" />
          </label>
          <label className="text-sm font-medium text-slate-700">
            To
            <Input type="date" value={to} onChange={changeDate('to')} className="mt-1 w-40" />
          </label>
        </div>

        <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
          <fieldset>
            <legend className="text-sm font-medium text-slate-700">Report Basis</legend>
            <div className="mt-2 flex gap-4 text-sm text-slate-700">
              {[
                ['accrual', 'Accrual'],
                ['cash', 'Cash'],
              ].map(([value, label]) => (
                <label key={value} className="flex items-center gap-1.5">
                  <input type="radio" name="pl-basis" value={value} checked={basis === value} onChange={() => setBasis(value)} />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="text-sm font-medium text-slate-700">
            Show Columns
            <Select value={columns} onChange={(e) => setColumns(e.target.value)} className="mt-1 w-40">
              <option value="total">Total only</option>
              <option value="month">Month</option>
            </Select>
          </label>
          <label className="text-sm font-medium text-slate-700">
            Sort By
            <Select value={sort} onChange={(e) => setSort(e.target.value)} className="mt-1 w-44">
              <option value="default">Default</option>
              <option value="amount">Amount (high to low)</option>
              <option value="name">Name (A-Z)</option>
            </Select>
          </label>
          <div className="ml-auto flex gap-2">
            <SharePdfButton fileName={`Profit-and-Loss_${new Date().toISOString().slice(0, 10)}`} message="Profit & Loss" orientation={columns === 'month' ? 'landscape' : 'portrait'} />
            <Button variant="secondary" onClick={() => printReport(columns === 'month' ? 'landscape' : 'portrait')}>
              <Printer className="h-4 w-4" /> Print
            </Button>
            <Button variant="secondary" onClick={exportExcel} loading={exporting}>
              <Download className="h-4 w-4" /> Excel
            </Button>
            <Button variant="secondary" onClick={load} loading={loading}>
              <RefreshCw className="h-4 w-4" /> Refresh
            </Button>
          </div>
        </div>
      </div>

      {loading && !report ? (
        <PageSpinner />
      ) : !report ? (
        <p className="py-10 text-center text-sm text-slate-400">The report could not be loaded. Adjust the filters or press Refresh.</p>
      ) : (
        <div id="print-area" className={`rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8 print:rounded-none print:border-0 print:p-0 print:shadow-none ${loading ? 'opacity-60' : ''}`}>
          <PrintReportHeader
            showOnScreen
            title={report.title}
            rangeLabel={rangeLabel(report.range)}
            subtitle={report.basis === 'cash' ? 'Cash Basis' : 'Accrual Basis'}
          />

          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] border-collapse">
              <thead>
                <tr className="border-b border-slate-300 text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2 text-left" />
                  {report.columns.map((c) => (
                    <th key={c.key} className="whitespace-nowrap px-3 py-2 text-right font-semibold">
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.rows.map((row, i) => (
                  <ReportRow key={`${row.type}-${row.label}-${i}`} row={row} columns={report.columns} />
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-5 text-xs text-slate-400">
            {report.basis === 'cash'
              ? 'Cash basis: Sales Income is money actually received from customers in this period (sale and debt payments, wallet credit applied) minus refunds paid out; unpaid credit sales are not counted until paid.'
              : 'Accrual basis: Sales Income is every confirmed (Close Day) invoice in this period, net of returns, whether or not it has been paid.'}{' '}
            Cost of Goods Sold uses the Weighted Average Cost at the time of sale on both bases. Discount Received will show supplier discounts once purchase
            invoices record them.
          </p>
        </div>
      )}
    </div>
  );
}

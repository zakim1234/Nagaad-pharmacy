import { useCallback, useEffect, useState } from 'react';
import { Download, Printer, RefreshCw, CheckCircle2, AlertTriangle, Wallet, Scale } from 'lucide-react';
import client from '../../api/client.js';
import { useToast } from '../../context/ToastContext.jsx';
import { printReport } from '../../utils/printReport.js';
import { formatMoney } from '../../utils/format.js';
import Button from '../../components/ui/Button.jsx';
import { Input } from '../../components/ui/Field.jsx';
import SharePdfButton from '../../components/SharePdfButton.jsx';
import { PageSpinner } from '../../components/ui/Spinner.jsx';
import { BUSINESS } from '../../constants/business.js';
import logo from '../../images/logo.png';

const pad = (n) => String(n).padStart(2, '0');
const todayString = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

function longDay(s) {
  return new Date(`${s}T12:00:00`).toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function Amount({ value }) {
  const negative = value < 0;
  return <span className={negative ? 'text-brand-600' : ''}>{negative ? `-${formatMoney(-value)}` : formatMoney(value)}</span>;
}

function SummaryCard({ label, value, tone }) {
  const styles = tone === 'red' ? 'bg-brand-600 text-white' : tone === 'black' ? 'bg-neutral-950 text-white' : 'border border-neutral-300 bg-white';
  return (
    <div className={`rounded-xl px-4 py-3 text-center ${styles}`}>
      <p className={`text-[10px] uppercase tracking-wider ${tone ? 'text-white/70' : 'text-neutral-500'}`}>{label}</p>
      <p className="mt-1 text-xl font-bold tabular-nums">{value < 0 ? `-${formatMoney(-value)}` : formatMoney(value)}</p>
    </div>
  );
}

function Side({ title, icon: Icon, children }) {
  return (
    <section className="overflow-hidden rounded-xl border border-neutral-200 print:break-inside-avoid">
      <h2 className="flex items-center gap-2 bg-neutral-950 px-4 py-2.5 text-sm font-bold uppercase tracking-wider text-white">
        <Icon className="h-4 w-4 text-brand-400" /> {title}
      </h2>
      <div className="p-2">{children}</div>
    </section>
  );
}

function Group({ label, children }) {
  return (
    <div className="mb-2">
      <p className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-400">{label}</p>
      {children}
    </div>
  );
}

function Line({ label, hint, value }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-neutral-50">
      <span className="text-neutral-700">
        {label}
        {hint && <span className="ml-1.5 text-[11px] text-neutral-400">{hint}</span>}
      </span>
      <span className="tabular-nums">
        <Amount value={value} />
      </span>
    </div>
  );
}

function Subtotal({ label, value }) {
  return (
    <div className="mx-2 mt-1 flex items-center justify-between border-t border-neutral-300 pt-1.5 text-sm font-bold">
      <span>{label}</span>
      <span className="tabular-nums">
        <Amount value={value} />
      </span>
    </div>
  );
}

function Grand({ label, value }) {
  return (
    <div className="mt-2 flex items-center justify-between rounded-lg bg-neutral-100 px-3 py-2.5 text-sm font-extrabold uppercase tracking-wide">
      <span>{label}</span>
      <span className="text-base tabular-nums">
        <Amount value={value} />
      </span>
    </div>
  );
}


export default function BalanceSheetReport() {
  const toast = useToast();
  const [date, setDate] = useState(todayString());
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    client
      .get('/reports/balance-sheet', { params: { date } })
      .then((res) => setReport(res.data.data))
      .catch((err) => {
        setReport(null);
        toast.error(err.friendlyMessage || 'Failed to load the Balance Sheet.');
      })
      .finally(() => setLoading(false));
  }, [date]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    load();
  }, [load]);

  const exportExcel = async () => {
    setExporting(true);
    try {
      const res = await client.get('/reports/balance-sheet/export', { params: { date }, responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `balance-sheet_${date}.xlsx`;
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
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm no-print">
        <label className="text-sm font-medium text-slate-700">
          As of
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1 w-48" />
        </label>
        <div className="flex gap-2">
          <SharePdfButton fileName={`Balance-Sheet_${date}`} message={`Balance Sheet — ${date}`} />
          <Button variant="secondary" onClick={() => printReport('portrait')}>
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

      {loading && !report ? (
        <PageSpinner />
      ) : !report ? (
        <p className="py-10 text-center text-sm text-slate-400">The report could not be loaded. Adjust the date or press Refresh.</p>
      ) : (
        <div
          id="print-area"
          className={`mx-auto max-w-5xl rounded-2xl border border-slate-200 bg-white p-6 text-neutral-900 shadow-sm sm:p-8 print:max-w-none print:rounded-none print:border-0 print:p-0 print:shadow-none ${loading ? 'opacity-60' : ''}`}
          style={{ WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}
        >
          <div className="flex flex-col items-center text-center">
            <img src={logo} alt={BUSINESS.name} className="h-16 w-auto object-contain" />
            <h1 className="mt-1 text-lg font-extrabold uppercase tracking-[0.2em]">{BUSINESS.name}</h1>
            <p className="text-[11px] text-neutral-600">
              {BUSINESS.addressLine} · {BUSINESS.phone}
            </p>
          </div>

          <div className="mt-4 h-1 bg-brand-600" />
          <div className="flex flex-wrap items-center justify-between gap-2 bg-neutral-950 px-4 py-2 text-white">
            <p className="text-sm font-bold uppercase tracking-[0.25em]">Balance Sheet</p>
            <p className="text-[11px]">
              As of <span className="font-semibold">{longDay(report.asOf)}</span>
            </p>
          </div>

          {report.asOfNote && <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 no-print">{report.asOfNote}</p>}

          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3 print:grid-cols-3">
            <SummaryCard label="Total assets" value={report.assets.totalAssets} />
            <SummaryCard label="Total liabilities" value={report.liabilities.totalLiabilities} tone="red" />
            <SummaryCard label="Total equity" value={report.equity.totalEquity} tone="black" />
          </div>

          <div
            className={`mt-3 flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold ${
              report.isBalanced ? 'bg-neutral-100 text-neutral-700' : 'bg-brand-50 text-brand-700'
            }`}
          >
            {report.isBalanced ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
            {report.isBalanced
              ? 'Balanced — Assets = Liabilities + Equity'
              : `Out of balance by ${formatMoney(Math.abs(report.difference))} (Assets ${formatMoney(report.assets.totalAssets)} vs Liabilities + Equity ${formatMoney(report.totalLiabilitiesAndEquity)})`}
          </div>

          <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2 print:grid-cols-2">
            <Side title="Assets" icon={Wallet}>
              <Group label="Current assets">
                <Line label="Cash & bank (accounts)" value={report.assets.cash} />
                <Line label="Accounts receivable" hint="Customer debt" value={report.assets.receivable} />
                <Line label="Inventory" hint="Stock at cost" value={report.assets.inventory} />
                <Subtotal label="Total current assets" value={report.assets.totalCurrentAssets} />
              </Group>
              <Group label="Fixed assets">
                <Line label="Fixed assets" value={report.assets.fixedAssets} />
              </Group>
              <Grand label="Total assets" value={report.assets.totalAssets} />
            </Side>

            <Side title="Liabilities & Equity" icon={Scale}>
              <Group label="Liabilities">
                <Line label="Accounts payable" hint="Supplier debt" value={report.liabilities.payable} />
                <Subtotal label="Total liabilities" value={report.liabilities.totalLiabilities} />
              </Group>
              <Group label="Equity">
                <Line label="Partners' capital" value={report.equity.partnersCapital} />
                <Line label="Retained earnings" value={report.equity.retainedEarnings} />
                <Line label="Net income" hint="This fiscal year" value={report.equity.netIncome} />
                <Subtotal label="Total equity" value={report.equity.totalEquity} />
              </Group>
              <Grand label="Total liabilities & equity" value={report.totalLiabilitiesAndEquity} />
            </Side>
          </div>

          <p className="mt-6 border-t border-neutral-200 pt-3 text-[11px] leading-relaxed text-neutral-400">
            Partners' Capital is the sum of every partner's current equity (Partners / Investors). Net Income is this fiscal year's profit to date;
            Retained Earnings is everything before that. Cash, Receivables, Inventory, Payables, Partners' Capital and Fixed Assets are today's figures —
            no historical snapshot is kept for a past date.
          </p>
          <p className="mt-2 text-center text-[10px] text-neutral-400">Printed {new Date().toLocaleString()}</p>
        </div>
      )}
    </div>
  );
}

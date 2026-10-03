import { useCallback, useEffect, useState } from 'react';
import { Download, Printer, RefreshCw } from 'lucide-react';
import client from '../../api/client.js';
import { useToast } from '../../context/ToastContext.jsx';
import { printReport } from '../../utils/printReport.js';
import { formatMoney } from '../../utils/format.js';
import Button from '../../components/ui/Button.jsx';
import Badge from '../../components/ui/Badge.jsx';
import { Input } from '../../components/ui/Field.jsx';
import { PageSpinner } from '../../components/ui/Spinner.jsx';
import PrintReportHeader from '../../components/reports/PrintReportHeader.jsx';

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
  return <span className={negative ? 'text-rose-600' : ''}>{negative ? `-${formatMoney(-value)}` : formatMoney(value)}</span>;
}

function Row({ label, value, depth = 0, bold = false, grand = false }) {
  return (
    <tr className={grand ? 'border-t border-slate-400 bg-slate-50 text-sm font-bold text-slate-900 print:bg-white' : bold ? 'border-t border-slate-400 text-sm font-bold text-slate-900' : 'text-sm text-slate-700'}>
      <td className={`px-3 py-1.5 ${grand ? 'border-b-4 border-double border-slate-400' : ''}`} style={{ paddingLeft: `${0.75 + depth * 1.25}rem` }}>
        {label}
      </td>
      <td className={`whitespace-nowrap px-3 py-1.5 text-right tabular-nums ${grand ? 'border-b-4 border-double border-slate-400' : ''}`}>
        <Amount value={value} />
      </td>
    </tr>
  );
}

function Section({ label }) {
  return (
    <tr>
      <td colSpan={2} className="pt-4 pb-1 text-sm font-bold text-slate-900">
        {label}
      </td>
    </tr>
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
        <div id="print-area" className={`rounded-xl border border-slate-200 bg-white p-6 shadow-sm print:border-0 print:p-0 print:shadow-none ${loading ? 'opacity-60' : ''}`}>
          <PrintReportHeader showOnScreen title="Balance Sheet" rangeLabel={`As of ${longDay(report.asOf)}`} />

          {report.asOfNote && (
            <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 no-print">{report.asOfNote}</p>
          )}

          <div className="mb-4 flex justify-center">
            <Badge color={report.isBalanced ? 'green' : 'amber'}>
              {report.isBalanced ? 'Balanced' : `Out of balance by ${formatMoney(Math.abs(report.difference))}`}
            </Badge>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] border-collapse">
              <tbody>
                <Section label="ASSETS" />
                <tr>
                  <td colSpan={2} className="pl-3 pt-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Current Assets
                  </td>
                </tr>
                <Row label="Checking/Savings (Accounts)" value={report.assets.cash} depth={2} />
                <Row label="Accounts Receivable" value={report.assets.receivable} depth={2} />
                <Row label="Inventory Asset" value={report.assets.inventory} depth={2} />
                <Row label="Total Current Assets" value={report.assets.totalCurrentAssets} bold />
                <Row label="Fixed Assets" value={report.assets.fixedAssets} depth={1} />
                <Row label="TOTAL ASSETS" value={report.assets.totalAssets} grand />

                <Section label="LIABILITIES" />
                <Row label="Accounts Payable" value={report.liabilities.payable} depth={2} />
                <Row label="Total Liabilities" value={report.liabilities.totalLiabilities} bold />

                <Section label="EQUITY" />
                <Row label="Partners' Capital" value={report.equity.partnersCapital} depth={1} />
                <Row label="Retained Earnings" value={report.equity.retainedEarnings} depth={1} />
                <Row label="Net Income" value={report.equity.netIncome} depth={1} />
                <Row label="Total Equity" value={report.equity.totalEquity} bold />

                <Row label="TOTAL LIABILITIES & EQUITY" value={report.totalLiabilitiesAndEquity} grand />
              </tbody>
            </table>
          </div>

          <p className="mt-5 text-xs text-slate-400">
            "Partners' Capital" replaces the usual "Opening Balance Equity" line -- it is the sum of every partner's current equity from the
            Partners / Investors module. Net Income is this fiscal year's profit to date (accrual); Retained Earnings is everything before that.
            Cash, Receivables, Inventory, Payables, Partners' Capital and Fixed Assets are always today's figures -- this app keeps no historical
            snapshot of them for a past date.
          </p>
        </div>
      )}
    </div>
  );
}

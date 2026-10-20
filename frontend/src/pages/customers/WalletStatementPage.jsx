import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Printer } from 'lucide-react';
import client from '../../api/client.js';
import { useToast } from '../../context/ToastContext.jsx';
import { formatCurrency, formatDateTime } from '../../utils/format.js';
import { printReport } from '../../utils/printReport.js';
import { BUSINESS } from '../../constants/business.js';
import { PageSpinner } from '../../components/ui/Spinner.jsx';
import Button from '../../components/ui/Button.jsx';
import SharePdfButton from '../../components/SharePdfButton.jsx';
import DocHeader, { DocTotals, DocFooter, DOC_TH, DOC_THEAD_ROW, docRow } from '../../components/docs/DocHeader.jsx';

const TYPE = {
  DEPOSIT: 'Deposit',
  WITHDRAWAL: 'Withdrawal',
  SALE_PAYMENT: 'Used on invoice',
  REFUND: 'Restored',
  ADJUSTMENT: 'Adjustment',
};

// A customer's wallet statement: every deposit, withdrawal and use, with the
// account and the number the money came from or went to -- printable.
export default function WalletStatementPage() {
  const { id } = useParams();
  const toast = useToast();
  const [customer, setCustomer] = useState(null);
  const [history, setHistory] = useState(null);

  useEffect(() => {
    Promise.all([client.get(`/customers/${id}`), client.get(`/customers/${id}/wallet/history`)])
      .then(([c, h]) => {
        setCustomer(c.data.data);
        setHistory(h.data.data);
      })
      .catch((err) => toast.error(err.friendlyMessage || 'Could not load the wallet statement.'));
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!customer || !history) return <PageSpinner />;
  const rows = [...history.transactions].reverse(); // oldest first, running balance
  const sum = (type) => Math.round(rows.filter((t) => t.type === type).reduce((s, t) => s + Math.abs(t.amount), 0) * 100) / 100;
  const deposited = sum('DEPOSIT');
  const withdrawn = sum('WITHDRAWAL');
  const used = sum('SALE_PAYMENT');

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 no-print">
        <Link to={`/customers/${id}`} className="flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700">
          <ArrowLeft className="h-4 w-4" /> Back to customer
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <SharePdfButton fileName={`Wallet_${customer.name}`} phone={customer.phone} message={`${BUSINESS.name} — wallet statement for ${customer.name}: balance ${formatCurrency(history.walletBalance)}`} orientation="landscape" />
          <Button onClick={() => printReport('landscape')}>
            <Printer className="h-4 w-4" /> Print
          </Button>
        </div>
      </div>

      <div id="print-area" className="mx-auto max-w-6xl rounded-2xl border border-slate-200 bg-white p-6 text-neutral-900 shadow-sm sm:p-8 print:max-w-none print:rounded-none print:border-0 print:p-0 print:shadow-none">
        <DocHeader
          title="Wallet Statement"
          meta={
            <span className="font-semibold">
              {customer.name}
              {customer.phone ? ` · ${customer.phone}` : ''}
            </span>
          }
        />

        <div className="overflow-x-auto">
          <table className="mt-4 w-full border-collapse text-xs">
            <thead>
              <tr className={`${DOC_THEAD_ROW} text-left`}>
                <th className={DOC_TH}>Date</th>
                <th className={DOC_TH}>Type</th>
                <th className={DOC_TH}>Account</th>
                <th className={DOC_TH}>Number / account</th>
                <th className={DOC_TH}>Note</th>
                <th className={`${DOC_TH} text-right`}>In</th>
                <th className={`${DOC_TH} text-right`}>Out</th>
                <th className={`${DOC_TH} text-right`}>Balance</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-2 py-8 text-center text-neutral-400">
                    No wallet activity yet.
                  </td>
                </tr>
              )}
              {rows.map((t, i) => (
                <tr key={t.id} className={docRow(i)}>
                  <td className="whitespace-nowrap px-2 py-2">{formatDateTime(t.createdAt)}</td>
                  <td className="whitespace-nowrap px-2 py-2 font-semibold">
                    {TYPE[t.type] || t.type}
                    {t.saleReceiptNumber && <span className="block text-[10px] font-normal text-neutral-500">{t.saleReceiptNumber}</span>}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2">{t.accountName || '—'}</td>
                  <td className="whitespace-nowrap px-2 py-2 tabular-nums">{t.reference || '—'}</td>
                  <td className="px-2 py-2 text-neutral-600">{t.note || ''}</td>
                  <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">{t.amount > 0 ? formatCurrency(t.amount) : ''}</td>
                  <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums text-brand-700">{t.amount < 0 ? formatCurrency(-t.amount) : ''}</td>
                  <td className="whitespace-nowrap px-2 py-2 text-right font-semibold tabular-nums">{formatCurrency(t.balanceAfter)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-6">
          <DocTotals
            items={[
              ['Deposited', formatCurrency(deposited)],
              ['Withdrawn', formatCurrency(withdrawn)],
              ['Used on invoices', formatCurrency(used)],
              ['Balance now', formatCurrency(history.walletBalance)],
            ]}
          />
        </div>
        <DocFooter>Printed {new Date().toLocaleString()}</DocFooter>
      </div>
    </div>
  );
}

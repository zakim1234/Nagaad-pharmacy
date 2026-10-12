import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Printer } from 'lucide-react';
import client from '../../api/client.js';
import { useToast } from '../../context/ToastContext.jsx';
import { formatCurrency, formatDate, formatDateTime } from '../../utils/format.js';
import { printReport } from '../../utils/printReport.js';
import { BUSINESS } from '../../constants/business.js';
import { PageSpinner } from '../../components/ui/Spinner.jsx';
import Button from '../../components/ui/Button.jsx';
import { FormField, Input, Select } from '../../components/ui/Field.jsx';
import SharePdfButton from '../../components/SharePdfButton.jsx';
import DocHeader, { DocInfo, DocTotals, DocFooter, DOC_TH, DOC_THEAD_ROW, docRow } from '../../components/docs/DocHeader.jsx';
import { periodLabel } from './SalariesPage.jsx';

const ROLE_LABEL = { admin: 'Admin', manager: 'Manager', cashier: 'Cashier', custom: 'Staff' };

// Salary payment statement: every salary paid, for everyone or for one
// person, optionally within a date range -- printable and sendable.
export default function SalaryStatementPage() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const userId = params.get('user') || '';
  const from = params.get('from') || '';
  const to = params.get('to') || '';
  const [people, setPeople] = useState([]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    client
      .get('/salaries/sheet')
      .then((r) => setPeople(r.data.data.people))
      .catch(() => setPeople([]));
  }, []);

  useEffect(() => {
    setLoading(true);
    client
      .get('/salaries/statement', { params: { userId: userId || undefined, from: from || undefined, to: to || undefined } })
      .then((r) => setData(r.data.data))
      .catch((err) => toast.error(err.friendlyMessage || 'Could not load the statement.'))
      .finally(() => setLoading(false));
  }, [userId, from, to]); // eslint-disable-line react-hooks/exhaustive-deps

  const setParam = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next);
  };

  const person = people.find((p) => String(p.userId) === userId) || data?.people.find((p) => String(p.user) === userId);
  const rangeLabel = from || to ? `${from ? formatDate(`${from}T12:00:00`) : 'Start'} – ${to ? formatDate(`${to}T12:00:00`) : 'Today'}` : 'All time';
  const single = !!userId;

  return (
    <div>
      <div className="no-print">
        <Link to="/salaries" className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700">
          <ArrowLeft className="h-4 w-4" /> Back to Salaries
        </Link>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <FormField label="Person">
              <Select value={userId} onChange={(e) => setParam('user', e.target.value)} className="w-56!">
                <option value="">Everyone</option>
                {people.map((p) => (
                  <option key={p.userId} value={String(p.userId)}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="From">
              <Input type="date" value={from} onChange={(e) => setParam('from', e.target.value)} className="w-40!" />
            </FormField>
            <FormField label="To">
              <Input type="date" value={to} onChange={(e) => setParam('to', e.target.value)} className="w-40!" />
            </FormField>
            {(from || to) && (
              <Button
                variant="ghost"
                onClick={() => {
                  const next = new URLSearchParams(params);
                  next.delete('from');
                  next.delete('to');
                  setParams(next);
                }}
              >
                All time
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <SharePdfButton
              fileName={`Salary-Statement_${single ? (person?.name || 'person').replace(/\s+/g, '-') : 'everyone'}`}
              message={`${BUSINESS.name} — salary statement${single && person ? ` for ${person.name}` : ''}: ${formatCurrency(data?.total || 0)}`}
            />
            <Button onClick={() => printReport('portrait')} disabled={!data}>
              <Printer className="h-4 w-4" /> Print
            </Button>
          </div>
        </div>
      </div>

      {loading && !data ? (
        <PageSpinner />
      ) : data ? (
        <div
          id="print-area"
          className={`mx-auto max-w-4xl rounded-2xl border border-slate-200 bg-white p-6 text-neutral-900 shadow-sm sm:p-8 print:max-w-none print:rounded-none print:border-0 print:p-0 print:shadow-none ${loading ? 'opacity-60' : ''}`}
        >
          <DocHeader title="Salary Payment Statement" meta={<span className="font-semibold">{rangeLabel}</span>} />
          <DocInfo
            left={single ? ['Employee', person?.name || '—', ROLE_LABEL[person?.role] || person?.role] : ['Employees', 'Everyone', `${data.people.length} ${data.people.length === 1 ? 'person' : 'people'} paid`]}
            right={['Total paid', formatCurrency(data.total), `${data.lines.length} payment(s)`]}
          />

          <table className="mt-4 w-full border-collapse text-xs">
            <thead>
              <tr className={`${DOC_THEAD_ROW} text-left`}>
                <th className={DOC_TH}>Date paid</th>
                <th className={DOC_TH}>Month</th>
                {!single && <th className={DOC_TH}>Name</th>}
                <th className={DOC_TH}>From account</th>
                <th className={DOC_TH}>Ref.</th>
                <th className={`${DOC_TH} text-right`}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {data.lines.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-2 py-8 text-center text-neutral-400">
                    No salary payments{single ? ' for this person' : ''} in this period.
                  </td>
                </tr>
              )}
              {data.lines.map((l, i) => (
                <tr key={`${l.sheetId}-${l.user}`} className={docRow(i)}>
                  <td className="whitespace-nowrap px-2 py-2">{formatDate(l.paymentDate)}</td>
                  <td className="whitespace-nowrap px-2 py-2 font-medium">{periodLabel(l.period)}</td>
                  {!single && <td className="px-2 py-2 font-medium">{l.name}</td>}
                  <td className="px-2 py-2 text-neutral-600">{l.account}</td>
                  <td className="whitespace-nowrap px-2 py-2 text-neutral-500">
                    <Link to={`/salaries/${l.sheetId}`} className="hover:text-brand-600 hover:underline print:no-underline">
                      {l.sheetNumber}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 text-right font-semibold tabular-nums">{formatCurrency(l.amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-neutral-900 font-bold">
                <td className="px-2 py-2.5 uppercase tracking-wider" colSpan={single ? 4 : 5}>
                  Total paid
                </td>
                <td className="px-2 py-2.5 text-right tabular-nums text-brand-700">{formatCurrency(data.total)}</td>
              </tr>
            </tfoot>
          </table>

          {!single && data.people.length > 0 && (
            <>
              <p className="mb-1 mt-6 text-[11px] font-bold uppercase tracking-[0.2em] text-neutral-500">By person</p>
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className={`${DOC_THEAD_ROW} text-left`}>
                    <th className={DOC_TH}>Name</th>
                    <th className={DOC_TH}>Role</th>
                    <th className={`${DOC_TH} text-center`}>Payments</th>
                    <th className={`${DOC_TH} text-right`}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {data.people.map((p, i) => (
                    <tr key={String(p.user)} className={docRow(i)}>
                      <td className="px-2 py-2 font-medium">
                        <button type="button" onClick={() => setParam('user', String(p.user))} className="hover:text-brand-600 hover:underline print:no-underline">
                          {p.name}
                        </button>
                      </td>
                      <td className="px-2 py-2 text-neutral-600">{ROLE_LABEL[p.role] || p.role}</td>
                      <td className="px-2 py-2 text-center">{p.payments}</td>
                      <td className="px-2 py-2 text-right font-semibold tabular-nums">{formatCurrency(p.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          <div className="mt-6">
            <DocTotals
              items={[
                [single ? 'Employee' : 'People', single ? person?.name || '—' : String(data.people.length)],
                ['Total paid', formatCurrency(data.total)],
                ['Period', rangeLabel],
              ]}
            />
          </div>
          {single && (
            <div className="mt-12 grid grid-cols-2 gap-16 text-[11px] text-neutral-600">
              <p className="border-t border-neutral-900 pt-1.5 text-center">{BUSINESS.name}</p>
              <p className="border-t border-neutral-900 pt-1.5 text-center">{person?.name || 'Employee'}</p>
            </div>
          )}
          <DocFooter>Printed {formatDateTime(new Date())}</DocFooter>
        </div>
      ) : null}
    </div>
  );
}

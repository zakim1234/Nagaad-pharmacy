import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { Link } from 'react-router-dom';
import { formatCurrency, formatDate } from '../../utils/format.js';
import Badge from '../../components/ui/Badge.jsx';
import { Select } from '../../components/ui/Field.jsx';
import { Table, THead, Th, TBody, Td, TableEmpty } from '../../components/ui/Table.jsx';
import ReportSection from '../../components/reports/ReportSection.jsx';
import ReportStatRow from '../../components/reports/ReportStatRow.jsx';
import EmptyReportState from '../../components/reports/EmptyReportState.jsx';
import { axisProps, gridProps, compactMoney, ChartTooltip, DonutChart } from '../../components/reports/chartKit.jsx';

const COLORS = ['#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#f43f5e', '#a855f7'];

export function ExpenseReport({ data }) {
  return (
    <div className="space-y-6">
      <ReportSection title="Expense Summary">
        <ReportStatRow items={[{ label: 'Total Expenses', value: formatCurrency(data.totalExpenses), tone: 'text-rose-600' }, { label: 'Entries', value: data.expenses.length }]} />
      </ReportSection>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ReportSection title="By Category">
          <Table>
            <THead>
              <tr>
                <Th>Category</Th>
                <Th>Entries</Th>
                <Th>Amount</Th>
                <Th>%</Th>
              </tr>
            </THead>
            <TBody>
              {data.byCategory.length === 0 ? (
                <TableEmpty colSpan={4} message="No expenses in this date range." />
              ) : (
                <>
                  {data.byCategory.map((c) => (
                    <tr key={c.category}>
                      <Td className="font-medium text-slate-900">{c.category}</Td>
                      <Td>{c.count}</Td>
                      <Td>{formatCurrency(c.amount)}</Td>
                      <Td>{c.percent}%</Td>
                    </tr>
                  ))}
                  <tr className="font-bold">
                    <Td>Total Expenses</Td>
                    <Td />
                    <Td>{formatCurrency(data.totalExpenses)}</Td>
                    <Td />
                  </tr>
                </>
              )}
            </TBody>
          </Table>
        </ReportSection>

        <ReportSection title="Spending Over Time">
          {data.byDay.length === 0 ? (
            <EmptyReportState message="No expenses in this date range." />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={data.byDay} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="date" {...axisProps} tickFormatter={(d) => d.slice(5)} />
                <YAxis {...axisProps} tickFormatter={compactMoney} width={56} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: '#f1f5f9' }} />
                <Bar dataKey="amount" fill="#f43f5e" radius={[6, 6, 0, 0]} maxBarSize={28} name="Expenses" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ReportSection>
      </div>

      <ReportSection title="All Expenses">
        <Table>
          <THead>
            <tr>
              <Th>Date</Th>
              <Th>No.</Th>
              <Th>Category</Th>
              <Th>Amount</Th>
              <Th>Note</Th>
              <Th>Paid From</Th>
            </tr>
          </THead>
          <TBody>
            {data.expenses.length === 0 ? (
              <TableEmpty colSpan={6} message="No expenses in this date range." />
            ) : (
              data.expenses.map((e) => (
                <tr key={e.id}>
                  <Td>{formatDate(e.date)}</Td>
                  <Td className="font-mono text-xs text-slate-500">{e.expenseNumber}</Td>
                  <Td>{e.category}</Td>
                  <Td>{formatCurrency(e.amount)}</Td>
                  <Td>{e.note || '—'}</Td>
                  <Td>{e.paymentAccountName}</Td>
                </tr>
              ))
            )}
          </TBody>
        </Table>
      </ReportSection>
    </div>
  );
}

export function PaymentMethodReport({ data }) {
  return (
    <div className="space-y-6">
      <ReportSection title="Payment Method Summary">
        <ReportStatRow items={[{ label: 'Total Collected', value: formatCurrency(data.totalCollected), tone: 'text-emerald-600' }, { label: 'Payment Accounts Used', value: data.methods.length }]} />
      </ReportSection>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ReportSection title="Collected by Payment Account">
          <Table>
            <THead>
              <tr>
                <Th>Account</Th>
                <Th>Sales</Th>
                <Th>Debt Payments</Th>
                <Th>Deposits</Th>
                <Th>Total</Th>
                <Th>%</Th>
              </tr>
            </THead>
            <TBody>
              {data.methods.length === 0 ? (
                <TableEmpty colSpan={6} message="No payments collected in this date range." />
              ) : (
                <>
                  {data.methods.map((m) => (
                    <tr key={m.account}>
                      <Td className="font-medium text-slate-900">{m.account}</Td>
                      <Td>{formatCurrency(m.salePayments)}</Td>
                      <Td>{formatCurrency(m.debtPayments)}</Td>
                      <Td>{formatCurrency(m.deposits)}</Td>
                      <Td className="font-semibold">{formatCurrency(m.total)}</Td>
                      <Td>{m.percent}%</Td>
                    </tr>
                  ))}
                  <tr className="font-bold">
                    <Td>Total Collected</Td>
                    <Td />
                    <Td />
                    <Td />
                    <Td>{formatCurrency(data.totalCollected)}</Td>
                    <Td />
                  </tr>
                </>
              )}
            </TBody>
          </Table>
          <p className="mt-3 text-xs text-slate-400">
            Counted when the payment posts to the account (same-day draft invoices post at Close Day). Gross of refunds.
          </p>
        </ReportSection>

        <ReportSection title="Share of Collections">
          {data.methods.length === 0 ? (
            <EmptyReportState message="No payments collected in this date range." />
          ) : (
            <DonutChart data={data.methods} valueKey="total" nameKey="account" colors={COLORS} centerLabel="Collected" height={200} />
          )}
        </ReportSection>
      </div>
    </div>
  );
}

// Mode/days controls live in the report itself (not the date-range bar): expiry
// is a "state of the shelf right now" question, not a history question.
export function ExpiredProductsControls({ mode, onModeChange, days, onDaysChange }) {
  return (
    <div className="mb-5 flex flex-wrap items-end gap-3 no-print">
      <Select value={mode} onChange={(e) => onModeChange(e.target.value)} className="w-48">
        <option value="expired">Expired</option>
        <option value="near">Near Expiry</option>
      </Select>
      {mode === 'near' && (
        <label className="flex items-center gap-2 text-sm text-slate-600">
          Expiring within
          <Select value={days} onChange={(e) => onDaysChange(Number(e.target.value))} className="w-32">
            <option value={7}>7 days</option>
            <option value={30}>30 days</option>
            <option value={60}>60 days</option>
            <option value={90}>90 days</option>
          </Select>
        </label>
      )}
    </div>
  );
}

export function ExpiredProductsReport({ data }) {
  const isNear = data.mode === 'near';
  return (
    <div className="space-y-6">
      <ReportSection title={isNear ? `Near Expiry (next ${data.days} days)` : 'Expired Products'}>
        <ReportStatRow
          items={[
            { label: isNear ? 'Total Value Near Expiry' : 'Total Expired Value', value: formatCurrency(data.totalValue), tone: 'text-rose-600' },
            { label: 'Units', value: data.totalQuantity },
            { label: 'Batches', value: data.items.length },
          ]}
        />
      </ReportSection>
      <ReportSection title="Batches">
        <Table>
          <THead>
            <tr>
              <Th>Item</Th>
              <Th>Batch</Th>
              <Th>Expiry Date</Th>
              <Th>Qty</Th>
              <Th>Value (at cost)</Th>
            </tr>
          </THead>
          <TBody>
            {data.items.length === 0 ? (
              <TableEmpty colSpan={5} message={isNear ? 'Nothing is expiring in this window.' : 'No expired stock on hand.'} />
            ) : (
              data.items.map((r, i) => (
                <tr key={`${r.itemId}-${i}`}>
                  <Td className="font-medium text-slate-900">
                    {r.itemName} <span className="text-xs text-slate-400">{r.itemCode}</span>
                  </Td>
                  <Td>{r.batch || '—'}</Td>
                  <Td>{formatDate(r.expiryDate)}</Td>
                  <Td>{r.quantity}</Td>
                  <Td>{formatCurrency(r.value)}</Td>
                </tr>
              ))
            )}
          </TBody>
        </Table>
      </ReportSection>
    </div>
  );
}

export function LowStockReport({ data }) {
  return (
    <div className="space-y-6">
      <ReportSection title="Low Stock Summary">
        <ReportStatRow
          items={[
            { label: 'Low Stock Items', value: data.lowCount, tone: 'text-amber-600' },
            { label: 'Out of Stock Items', value: data.outCount, tone: 'text-rose-600' },
          ]}
        />
      </ReportSection>
      <ReportSection title="Items At or Below Minimum Stock">
        <Table>
          <THead>
            <tr>
              <Th>Item</Th>
              <Th>Category</Th>
              <Th>Current Qty</Th>
              <Th>Minimum Stock</Th>
              <Th>To Reach Minimum</Th>
              <Th>Status</Th>
            </tr>
          </THead>
          <TBody>
            {data.items.length === 0 ? (
              <TableEmpty colSpan={6} message="Every active item is above its minimum stock." />
            ) : (
              data.items.map((r) => (
                <tr key={r.itemId}>
                  <Td className="font-medium text-slate-900">
                    {r.itemName} <span className="text-xs text-slate-400">{r.itemCode}</span>
                  </Td>
                  <Td>{r.category}</Td>
                  <Td>
                    {r.quantity} {r.unit}
                  </Td>
                  <Td>{r.minimumStock}</Td>
                  <Td>{r.shortfall}</Td>
                  <Td>{r.status === 'OUT' ? <Badge color="red">Out of Stock</Badge> : <Badge color="amber">Low</Badge>}</Td>
                </tr>
              ))
            )}
          </TBody>
        </Table>
      </ReportSection>
    </div>
  );
}

const itemsText = (items) => items.map((i) => `${i.name} ×${i.quantity}`).join(', ');

export function SalesReturnReport({ data }) {
  return (
    <div className="space-y-6">
      <ReportSection title="Sales Returns Summary">
        <ReportStatRow
          items={[
            { label: 'Returns', value: data.totalReturns },
            { label: 'Total Returns Value', value: formatCurrency(data.totalReturnValue), tone: 'text-rose-600' },
            { label: 'Refunded From Accounts', value: formatCurrency(data.totalRefunded) },
          ]}
        />
      </ReportSection>
      <ReportSection title="Returns">
        <Table>
          <THead>
            <tr>
              <Th>Date</Th>
              <Th>Invoice</Th>
              <Th>Customer</Th>
              <Th>Items</Th>
              <Th>Qty</Th>
              <Th>Value</Th>
              <Th>Reason</Th>
            </tr>
          </THead>
          <TBody>
            {data.returns.length === 0 ? (
              <TableEmpty colSpan={7} message="No sales returns in this date range." />
            ) : (
              data.returns.map((r, i) => (
                <tr key={`${r.saleId}-${i}`}>
                  <Td>{formatDate(r.date)}</Td>
                  <Td className="font-medium text-slate-900">
                    <Link to={`/receipt/${r.saleId}`} className="text-indigo-600 hover:underline no-print">
                      {r.receiptNumber}
                    </Link>
                    <span className="hidden print:inline">{r.receiptNumber}</span>
                  </Td>
                  <Td>{r.customerName}</Td>
                  <Td>{itemsText(r.items)}</Td>
                  <Td>{r.quantity}</Td>
                  <Td>{formatCurrency(r.value)}</Td>
                  <Td>{r.reason || '—'}</Td>
                </tr>
              ))
            )}
          </TBody>
        </Table>
      </ReportSection>
    </div>
  );
}

export function PurchaseReturnReport({ data }) {
  return (
    <div className="space-y-6">
      <ReportSection title="Purchase Returns Summary">
        <ReportStatRow
          items={[
            { label: 'Returned Invoices', value: data.totalReturns },
            { label: 'Total Returns Value', value: formatCurrency(data.totalReturnValue), tone: 'text-rose-600' },
          ]}
        />
        <p className="mt-3 text-xs text-slate-400">
          Goods sent back to a supplier are recorded by voiding the purchase invoice, so this lists voided purchases by the date they were voided.
        </p>
      </ReportSection>
      <ReportSection title="Returns">
        <Table>
          <THead>
            <tr>
              <Th>Date</Th>
              <Th>Purchase</Th>
              <Th>Supplier</Th>
              <Th>Items</Th>
              <Th>Qty</Th>
              <Th>Value</Th>
              <Th>Reason</Th>
            </tr>
          </THead>
          <TBody>
            {data.returns.length === 0 ? (
              <TableEmpty colSpan={7} message="No purchase returns in this date range." />
            ) : (
              data.returns.map((r) => (
                <tr key={r.purchaseId}>
                  <Td>{formatDate(r.date)}</Td>
                  <Td className="font-medium text-slate-900">
                    <Link to={`/purchases/${r.purchaseId}`} className="text-indigo-600 hover:underline no-print">
                      {r.purchaseNumber}
                    </Link>
                    <span className="hidden print:inline">{r.purchaseNumber}</span>
                  </Td>
                  <Td>{r.supplierName}</Td>
                  <Td>{itemsText(r.items)}</Td>
                  <Td>{r.quantity}</Td>
                  <Td>{formatCurrency(r.value)}</Td>
                  <Td>{r.reason || '—'}</Td>
                </tr>
              ))
            )}
          </TBody>
        </Table>
      </ReportSection>
    </div>
  );
}

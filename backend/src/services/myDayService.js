import Sale from '../models/Sale.js';
import Payment from '../models/Payment.js';
import Account from '../models/Account.js';
import AccountTransaction from '../models/AccountTransaction.js';
import { fromCents } from '../utils/money.js';
import { lastCloseAt } from './staffScope.js';
import { nameKey } from './itemsSoldService.js';

// One person's own day, since the last Close Day: the invoices they made,
// what they sold item by item, the debt payments they took, and the money
// in and out of each account by their hand. Back to nothing after Close Day.
export async function getMyDay(user) {
  const since = await lastCloseAt();
  const mine = { createdBy: user._id, createdAt: { $gte: since } };

  const [sales, payments, txns, accounts] = await Promise.all([
    Sale.find({ ...mine, status: { $in: ['DRAFT', 'CONFIRMED'] } }).sort({ createdAt: -1 }).lean(),
    Payment.find({ ...mine, type: 'debt_payment', status: { $ne: 'CANCELLED' } }).sort({ createdAt: -1 }).lean(),
    AccountTransaction.find({ ...mine, status: { $ne: 'REVERSED' } }).lean(),
    Account.find().select('name').lean(),
  ]);
  const accountName = new Map(accounts.map((a) => [String(a._id), a.name]));

  const items = new Map();
  for (const s of sales) {
    for (const line of s.items) {
      const k = nameKey(line.itemName) || String(line.item);
      const row = items.get(k) || { name: line.itemName, quantity: 0, totalCents: 0 };
      row.quantity += line.quantity;
      row.totalCents += line.subtotalCents - (line.discountCents || 0);
      items.set(k, row);
    }
  }

  const byAccount = new Map();
  for (const t of txns) {
    const k = String(t.account);
    const a = byAccount.get(k) || { accountName: accountName.get(k) || 'Account', inCents: 0, outCents: 0 };
    if (t.direction === 'IN') a.inCents += t.amountCents;
    else a.outCents += t.amountCents;
    byAccount.set(k, a);
  }

  const sum = (list, f) => list.reduce((t, x) => t + (x[f] || 0), 0);
  const paidAtSaleCents = sum(sales, 'paidAmountCents');
  const debtCents = sum(payments, 'amountCents');
  return {
    since: since.getTime() ? since : null,
    totals: {
      invoices: sales.length,
      sales: fromCents(sum(sales, 'totalCents')),
      paidAtSale: fromCents(paidAtSaleCents),
      debtCollected: fromCents(debtCents),
      received: fromCents(paidAtSaleCents + debtCents),
      credit: fromCents(sales.reduce((t, s) => t + Math.max(0, s.totalCents - (s.paidAmountCents || 0) - (s.walletAmountCents || 0)), 0)),
      fromWallet: fromCents(sum(sales, 'walletAmountCents')),
    },
    accounts: [...byAccount.values()]
      .map((a) => ({ accountName: a.accountName, moneyIn: fromCents(a.inCents), moneyOut: fromCents(a.outCents), net: fromCents(a.inCents - a.outCents) }))
      .sort((x, y) => y.net - x.net),
    items: [...items.values()].map((r) => ({ name: r.name, quantity: r.quantity, total: fromCents(r.totalCents) })).sort((x, y) => y.total - x.total),
    invoices: sales.map((s) => ({
      id: s._id,
      receiptNumber: s.receiptNumber,
      customerName: s.customerName || 'Walk-in',
      time: s.createdAt,
      total: fromCents(s.totalCents),
      paid: fromCents(s.paidAmountCents || 0),
      account: accountName.get(String(s.paymentAccount)) || '',
      status: s.status,
    })),
    payments: payments.map((p) => ({ id: p._id, receiptNumber: p.receiptNumber, time: p.createdAt, amount: fromCents(p.amountCents), account: p.paymentAccountName || accountName.get(String(p.paymentAccount)) || '' })),
  };
}

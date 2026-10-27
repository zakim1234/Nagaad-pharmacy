import Sale from '../models/Sale.js';
import Payment from '../models/Payment.js';
import Account from '../models/Account.js';
import User from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { fromCents } from '../utils/money.js';
import { periodKey } from './itemsSoldService.js';

// For the admin, one month day by day: what each person sold (confirmed
// invoices) and the money they took in -- paid at the sale and debt payments
// collected -- split by account, plus what they sold on credit.
export async function getStaffDaily({ month }) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(month || ''));
  if (!m) throw new ApiError(400, 'Choose a month (YYYY-MM).');
  const start = new Date(Number(m[1]), Number(m[2]) - 1, 1);
  const end = new Date(Number(m[1]), Number(m[2]), 1);

  const [sales, payments, accounts] = await Promise.all([
    Sale.find({ status: 'CONFIRMED', createdAt: { $gte: start, $lt: end } })
      .select('createdBy createdAt totalCents paidAmountCents paymentAccount balanceAddedCents walletAmountCents')
      .lean(),
    Payment.find({ type: 'debt_payment', status: { $ne: 'CANCELLED' }, createdAt: { $gte: start, $lt: end } })
      .select('createdBy createdAt amountCents paymentAccount paymentAccountName')
      .lean(),
    Account.find().select('name').lean(),
  ]);
  const accountName = new Map(accounts.map((a) => [String(a._id), a.name]));
  const userIds = [...new Set([...sales, ...payments].map((x) => String(x.createdBy || '')).filter(Boolean))];
  const users = await User.find({ _id: { $in: userIds } }).select('name').lean();
  const userName = new Map(users.map((u) => [String(u._id), u.name]));

  const rows = new Map(); // day|user -> row
  const rowFor = (date, user) => {
    const day = periodKey('day', date);
    const key = `${day}|${user || ''}`;
    if (!rows.has(key)) {
      rows.set(key, {
        day,
        user: user || null,
        userName: userName.get(String(user || '')) || 'Unknown',
        invoices: 0,
        salesCents: 0,
        paidAtSaleCents: 0,
        debtCollectedCents: 0,
        creditCents: 0,
        walletCents: 0,
        byAccount: new Map(),
      });
    }
    return rows.get(key);
  };
  const addAccount = (row, id, name, cents) => {
    if (!cents) return;
    const k = String(id || name || 'none');
    const a = row.byAccount.get(k) || { accountName: name || accountName.get(String(id)) || 'Account', cents: 0 };
    a.cents += cents;
    row.byAccount.set(k, a);
  };

  for (const s of sales) {
    const row = rowFor(s.createdAt, s.createdBy);
    row.invoices += 1;
    row.salesCents += s.totalCents || 0;
    row.paidAtSaleCents += s.paidAmountCents || 0;
    row.creditCents += s.balanceAddedCents || 0;
    row.walletCents += s.walletAmountCents || 0;
    addAccount(row, s.paymentAccount, accountName.get(String(s.paymentAccount)), s.paidAmountCents || 0);
  }
  for (const p of payments) {
    const row = rowFor(p.createdAt, p.createdBy);
    row.debtCollectedCents += p.amountCents || 0;
    addAccount(row, p.paymentAccount, p.paymentAccountName || accountName.get(String(p.paymentAccount)), p.amountCents || 0);
  }

  const out = (r) => ({
    day: r.day,
    user: r.user,
    userName: r.userName,
    invoices: r.invoices,
    sales: fromCents(r.salesCents),
    paidAtSale: fromCents(r.paidAtSaleCents),
    debtCollected: fromCents(r.debtCollectedCents),
    received: fromCents(r.paidAtSaleCents + r.debtCollectedCents),
    credit: fromCents(r.creditCents),
    wallet: fromCents(r.walletCents),
    byAccount: [...r.byAccount.values()].map((a) => ({ accountName: a.accountName, amount: fromCents(a.cents) })),
  });

  const all = [...rows.values()];
  const days = [...new Set(all.map((r) => r.day))].sort().reverse().map((day) => {
    const dayRows = all.filter((r) => r.day === day).sort((a, b) => b.salesCents - a.salesCents);
    return { day, rows: dayRows.map(out), totals: out(sumRows(dayRows, { day })) };
  });
  const byPerson = new Map();
  for (const r of all) {
    const k = String(r.user || '');
    byPerson.set(k, [...(byPerson.get(k) || []), r]);
  }
  const people = [...byPerson.values()]
    .map((list) => ({ ...out(sumRows(list, { user: list[0].user, userName: list[0].userName })), days: new Set(list.map((r) => r.day)).size }))
    .sort((a, b) => b.sales - a.sales);

  return { month: `${m[1]}-${m[2]}`, days, people, totals: out(sumRows(all, {})) };
}

function sumRows(list, base) {
  const t = { day: null, user: null, userName: '', invoices: 0, salesCents: 0, paidAtSaleCents: 0, debtCollectedCents: 0, creditCents: 0, walletCents: 0, byAccount: new Map(), ...base };
  for (const r of list) {
    t.invoices += r.invoices;
    t.salesCents += r.salesCents;
    t.paidAtSaleCents += r.paidAtSaleCents;
    t.debtCollectedCents += r.debtCollectedCents;
    t.creditCents += r.creditCents;
    t.walletCents += r.walletCents;
    for (const [k, a] of r.byAccount) {
      const cur = t.byAccount.get(k) || { accountName: a.accountName, cents: 0 };
      cur.cents += a.cents;
      t.byAccount.set(k, cur);
    }
  }
  return t;
}

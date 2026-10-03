import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import User from '../src/models/User.js';
import Customer from '../src/models/Customer.js';
import Account from '../src/models/Account.js';
import InventoryItem from '../src/models/InventoryItem.js';
import Expense from '../src/models/Expense.js';
import BusinessDay from '../src/models/BusinessDay.js';
import { createSaleDraft } from '../src/services/saleService.js';
import { closeDay, getDailyClosings } from '../src/services/dayCloseService.js';
import { runInTransaction } from '../src/utils/transaction.js';

test('DAILY CLOSING -- every close on the same day rolls into one row, with that day\'s expenses', { timeout: 90000 }, async () => {
  await mongoose.connect(`mongodb://127.0.0.1:27028/daily_closing_${Date.now()}?replicaSet=stocktest`);
  try {
    await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
    const admin = await User.create({ username: 'admin', name: 'Admin', passwordHash: 'unused', role: 'admin' });
    const customer = await Customer.create({ name: 'Cumar', phone: '1' });
    const account = await Account.create({ name: 'Cash Drawer' });
    const item = await InventoryItem.create({ name: 'Widget', itemCode: 'WIDG-D', quantity: 100, costPriceCents: 400, sellingPriceCents: 1000 });
    const sell = (qty, paid) =>
      runInTransaction((session) => createSaleDraft({ customerId: customer.id, items: [{ itemId: item.id, quantity: qty }], paidAmount: paid, paymentAccountId: account.id }, admin, session));

    // Close, reopen the day, sell again, close again -- two DayClose records on one date.
    await sell(2, 20);
    await closeDay({ user: admin });
    await BusinessDay.findByIdAndUpdate('current', { status: 'OPEN' });
    await sell(3, 0);
    await closeDay({ user: admin });

    const noon = new Date();
    noon.setHours(12, 0, 0, 0);
    await Expense.create({ expenseNumber: 'EXP-T-1', category: 'Rent', amountCents: 500, date: noon, paymentAccount: account._id });
    await Expense.create({ expenseNumber: 'EXP-T-2', category: 'Rent', amountCents: 999, date: noon, paymentAccount: account._id, status: 'VOIDED' });

    const { items, pagination } = await getDailyClosings();
    assert.equal(pagination.total, 1, 'one day, not one row per close');
    const [day] = items;
    assert.equal(day.closes.length, 2);
    assert.equal(day.invoiceCount, 2);
    assert.equal(day.revenueCents, 5000);
    assert.equal(day.grossProfitCents, 3000);
    assert.equal(day.cashCollectedCents, 2000);
    assert.equal(day.customerCreditCents, 3000);
    assert.equal(day.expensesCents, 500, 'voided expenses are ignored');
    assert.equal(day.netProfitCents, 2500);
    assert.equal(day.paymentBreakdown.length, 1);
    assert.equal(day.paymentBreakdown[0].amountCents, 2000);
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});

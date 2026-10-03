import Account from '../models/Account.js';

const DEFAULT_ACCOUNTS = [
  { name: 'EVC Plus', type: 'MOBILE_MONEY' },
  { name: 'eDahab', type: 'MOBILE_MONEY' },
  { name: 'Dahabshiil', type: 'MOBILE_MONEY' },
  { name: 'Merchant', type: 'MERCHANT' },
  { name: 'Salaam Bank', type: 'BANK' },
];

// Idempotent: only creates accounts that don't already exist by name, so
// re-running on every startup never duplicates or overwrites user edits.
export async function seedDefaultAccounts() {
  let created = 0;
  for (const acc of DEFAULT_ACCOUNTS) {
    const existing = await Account.findOne({ name: acc.name });
    if (!existing) {
      await Account.create({ ...acc, openingBalanceCents: 0, currentBalanceCents: 0 });
      created += 1;
    }
  }
  if (created > 0) {
    console.log(`[seed] accounts: created ${created} default account(s).`);
  }
  return created;
}

export default seedDefaultAccounts;

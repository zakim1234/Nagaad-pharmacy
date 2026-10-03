import test from 'node:test';
import assert from 'node:assert/strict';
import { draftKey, readDraft, writeDraft, clearDraft } from '../src/utils/posDraft.js';
test('draft survives restoration, isolates users and contexts, and clears explicitly', () => {
  const data = new Map();
  const storage = { getItem: k => data.get(k), setItem: (k, v) => data.set(k, v), removeItem: k => data.delete(k) };
  const key = draftKey('seller-1');
  const draft = { customer: { id: 'customer' }, lines: [{ itemId: 'product', quantity: 5, unitPrice: 1.1 }], discount: '2', paidAmount: '3', paymentAccountId: 'evc', customerQuery: 'Mohamed' };
  writeDraft(key, draft, storage);
  assert.deepEqual(readDraft(key, storage), { ...draft, version: 1 });
  assert.equal(readDraft(draftKey('seller-2'), storage), null);
  assert.equal(readDraft(draftKey('seller-1', 'quotation:123'), storage), null);
  clearDraft(key, storage);
  assert.equal(readDraft(key, storage), null);
});
test('storage failures retain navigation draft in memory and malformed data is ignored', () => {
  const storage = { getItem: () => '{bad', setItem: () => { throw Error('quota'); }, removeItem: () => {} };
  assert.equal(readDraft('bad', storage), null);
  assert.equal(writeDraft('memory', { lines: [] }, storage), false);
  assert.deepEqual(readDraft('memory', storage), { lines: [], version: 1 });
});

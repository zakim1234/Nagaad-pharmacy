import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const receiptSource = readFileSync(fileURLToPath(new URL('../src/pages/receipt/ReceiptPage.jsx', import.meta.url)), 'utf8');
const statementSource = readFileSync(fileURLToPath(new URL('../src/pages/customers/CustomerStatementPage.jsx', import.meta.url)), 'utf8');

// TEST PR1 + PR2: the customer-facing PENDING warning (and, by the same
// mechanism, its red banner styling) must never appear in actual print
// output. The app's global print stylesheet (index.css) hides any element
// carrying the `no-print` class with `display: none !important` during
// @media print, while leaving it fully visible on screen -- this is a
// structural regression guard that the PENDING paragraph keeps that class
// (and hasn't been moved out of it), not a DOM/print-media render test.
test('TEST PR1/PR2 -- customer receipt PENDING warning is print-hidden but screen-visible', () => {
  // The <p> element carrying the PENDING text must also carry the
  // `no-print` class -- index.css hides `.no-print` with
  // `display: none !important` under @media print while leaving it fully
  // visible on screen, which is the actual mechanism proving PR1/PR2.
  const pendingParagraph = receiptSource.match(/<p className="([^"]*)">\s*This invoice is PENDING and will only become final when the business day is closed\./);
  assert.ok(pendingParagraph, 'expected a <p> element directly wrapping the PENDING warning text');
  assert.match(pendingParagraph[1], /\bno-print\b/, 'the PENDING warning must carry the no-print class so it never reaches the printed page');
});

// TEST PR3: internal admin/cashier UI (this same on-screen component) still
// renders the Pending text -- only removed from the printed OUTPUT.
test('TEST PR3 -- internal on-screen view still displays the Pending warning text', () => {
  assert.match(receiptSource, /This invoice is PENDING and will only become final when the business day is closed\./);
});

// TEST PR4: this feature must not touch the Customer Account Statement's
// own, separate pending/reference messaging.
test('TEST PR4 -- Customer Account Statement pending messaging file is untouched by this feature', () => {
  assert.match(statementSource, /PENDING/i);
});

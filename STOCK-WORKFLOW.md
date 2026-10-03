# Stock and financial purchases

Purchase invoices now pay a single account and never receive inventory. Existing
purchase documents and their product history are retained. New references use
PUR; old reference numbers stay unchanged.

Stock entries receive many products under one generated STK reference. The existing
InventoryLot collection is the stock-batch model; no duplicate batch collection is
introduced. It now stores entry reference, selling price, expiry and reservations.
Stock rows reuse existing items, including zero-stock items. Legacy physical stock
without lots is covered lazily before receiving or reserving more stock, using the
available legacy cost and expiry. Missing historical information cannot be recovered.

Draft sales reserve specific FEFO batches (FIFO for ties or undated batches).
Close Day consumes those reservations and records exact allocation COGS. If a held
batch expires, confirmation fails and rolls back; edit or cancel that draft.
Old drafts without allocations acquire them during Close Day. Cancelled drafts release
reservations. Receipt/restock and sale/out-of-stock events are retained on the item.

## Database requirement

All financial and stock mutations require MongoDB transactions: use Atlas or a
replica set. The old standalone fallback is removed because it could leave partial
payments or stock writes. backend/.env.example shows a local rs0 connection example;
changing the URI alone does not configure a replica set. No production data migration
or database configuration was performed by this change.

## Verification

- `cd backend; npm.cmd test`: FEFO/FIFO, expiry/reservation exclusion, exact COGS.
- `cd frontend; npm.cmd run build` and `npm.cmd run lint`.
- Integration tests use only a local disposable replica set at 127.0.0.1:27028,
  replica name stocktest. They create a new stock_test_<timestamp> database each run,
  never read .env, and never access the application's database.
- Start mongod with an isolated dbpath, port 27028, bind_ip 127.0.0.1, and replSet
  stocktest. Run `node backend/test/init-replica.js` once, then
  `cd backend; npm.cmd run test:integration`.
- Integration coverage: payment/ledger balances, insufficient funds and competing
  payments, multiple rows, repeated/new items, concurrent item creation, atomic
  rollback, draft reservations/edits/cancellation, overselling prevention,
  Close Day and exact COGS, expiry before confirmation, out-of-stock/restock,
  preserved costs, item history and serial search.

Printing uses existing HTML/CSS, business identity and logo. Browser printer output
still needs a visual acceptance check on the target printer.

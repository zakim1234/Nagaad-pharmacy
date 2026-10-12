import Purchase from '../models/Purchase.js';
import Supplier from '../models/Supplier.js';
import PurchasePayment from '../models/PurchasePayment.js';
import InventoryLot from '../models/InventoryLot.js';
import SupplierInvoiceArchive from '../models/SupplierInvoiceArchive.js';
import { ApiError } from '../utils/ApiError.js';
import { fromCents } from '../utils/money.js';
import { generatePurchaseNumber } from '../controllers/purchaseController.js';
import { reversePayment } from './supplierPaymentService.js';

// Goods taken on credit: a purchase invoice with nothing paid, the whole
// amount owed to the supplier. Runs inside the caller's transaction.
export async function createDebtPurchase(session, { supplier, serial, totalCents, notes = '', purchaseDate = new Date(), sourceArchive = null, user }) {
  const purchaseNumber = await generatePurchaseNumber(session);
  const [purchase] = await Purchase.create(
    [
      {
        purchaseNumber,
        supplierInvoiceNumber: String(serial || '').trim(),
        supplier: supplier._id,
        supplierName: supplier.name,
        items: [],
        totalCostCents: totalCents,
        paidAmountCents: 0,
        balanceCents: totalCents,
        purchaseDate,
        notes,
        sourceArchive,
        createdBy: user?._id,
      },
    ],
    { session }
  );
  supplier.totalSpentCents += totalCents;
  await supplier.save({ session });
  return purchase;
}

// Deletes a purchase invoice. Its payments are cancelled first, each one's
// money going back to its account; an invoice stock was received on can
// only be voided. Returns how much was refunded (cents).
export async function removePurchase(session, purchase, { user, reason }) {
  if (await InventoryLot.exists({ purchase: purchase._id }).session(session)) {
    throw new ApiError(409, 'Stock was received on this invoice, so it cannot be deleted. Void it instead.');
  }
  const active = await PurchasePayment.find({ purchase: purchase._id, status: 'POSTED' }).session(session);
  for (const p of active) await reversePayment(session, p, { reason: reason || `invoice ${purchase.purchaseNumber} deleted`, user, purchase });
  if (purchase.status !== 'voided') {
    const supplier = await Supplier.findById(purchase.supplier).session(session);
    if (supplier) {
      supplier.totalSpentCents -= purchase.totalCostCents;
      await supplier.save({ session });
    }
  }
  if (purchase.sourceArchive) await SupplierInvoiceArchive.updateOne({ _id: purchase.sourceArchive }, { $set: { purchase: null } }, { session });
  await PurchasePayment.deleteMany({ purchase: purchase._id }, { session });
  await purchase.deleteOne({ session });
  return active.reduce((s, p) => s + p.amountCents, 0);
}

// Keeps the purchase invoice behind a Manual Entry archive in step with it:
// created when the archive has a supplier and a total, updated (supplier,
// serial, total) when the archive is edited, removed when the archive no
// longer has a supplier or total. A voided invoice is left as it is.
export async function syncArchivePurchase(session, archive, { user }) {
  const linked = archive.purchase ? await Purchase.findById(archive.purchase).session(session) : null;
  if (linked?.status === 'voided') return linked;
  const wanted = archive.supplier && archive.grandTotalCents > 0;

  if (!wanted) {
    if (linked) {
      if (linked.paidAmountCents > 0) {
        throw new ApiError(409, `${linked.purchaseNumber} already has ${fromCents(linked.paidAmountCents).toFixed(2)} paid on it, so its supplier and total must stay. Cancel the payments first.`);
      }
      await removePurchase(session, linked, { user });
      archive.purchase = null;
    }
    return null;
  }

  const supplier = await Supplier.findById(archive.supplier).session(session);
  if (!supplier) throw new ApiError(404, 'Selected supplier no longer exists.');

  if (!linked) {
    const purchase = await createDebtPurchase(session, {
      supplier,
      serial: archive.serialNumber,
      totalCents: archive.grandTotalCents,
      notes: `From supplier invoice ${archive.archiveNumber}`,
      sourceArchive: archive._id,
      user,
    });
    archive.purchase = purchase._id;
    return purchase;
  }

  if (archive.grandTotalCents < linked.paidAmountCents) {
    throw new ApiError(400, `The total cannot be less than the ${fromCents(linked.paidAmountCents).toFixed(2)} already paid on ${linked.purchaseNumber}.`);
  }
  if (String(linked.supplier) !== String(supplier._id) || linked.totalCostCents !== archive.grandTotalCents) {
    const old = await Supplier.findById(linked.supplier).session(session);
    if (old) {
      old.totalSpentCents -= linked.totalCostCents;
      await old.save({ session });
    }
    const fresh = String(old?._id) === String(supplier._id) ? old : supplier;
    fresh.totalSpentCents += archive.grandTotalCents;
    await fresh.save({ session });
  }
  linked.supplier = supplier._id;
  linked.supplierName = supplier.name;
  linked.supplierInvoiceNumber = archive.serialNumber;
  linked.totalCostCents = archive.grandTotalCents;
  linked.balanceCents = archive.grandTotalCents - linked.paidAmountCents;
  await linked.save({ session });
  return linked;
}

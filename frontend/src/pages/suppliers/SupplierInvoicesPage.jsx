import ManualSupplierInvoiceArchive from './ManualSupplierInvoiceArchive.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';

// Supplier Invoices: the archive of suppliers' paper invoices, entered by
// hand and kept exactly as received. Never touches Stock or Accounts.
export default function SupplierInvoicesPage() {
  return (
    <div className="space-y-4">
      <PageHeader title="Supplier Invoices" subtitle="Keep a searchable copy of every supplier's paper invoice, exactly as received." />
      <ManualSupplierInvoiceArchive />
    </div>
  );
}

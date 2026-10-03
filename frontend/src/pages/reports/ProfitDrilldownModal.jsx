import { useEffect, useState } from 'react';
import Modal from '../../components/ui/Modal.jsx';
import client from '../../api/client.js';
import { formatCurrency, formatDateTime } from '../../utils/format.js';
import { Table, THead, Th, TBody, Td, TableEmpty } from '../../components/ui/Table.jsx';
import { PageSpinner } from '../../components/ui/Spinner.jsx';

// "Where did this profit come from?" — drill down from an item's total
// profit to the exact invoices that produced it.
export default function ProfitDrilldownModal({ itemId, itemName, rangeParams, onClose }) {
  const [rows, setRows] = useState(null);

  useEffect(() => {
    if (!itemId) return;
    setRows(null);
    client
      .get(`/reports/profit/items/${itemId}`, { params: rangeParams })
      .then((res) => setRows(res.data.data.invoices))
      .catch(() => setRows([]));
  }, [itemId, rangeParams]);

  return (
    <Modal open={!!itemId} onClose={onClose} title={`Profit Source — ${itemName}`} size="lg">
      {rows === null ? (
        <PageSpinner />
      ) : (
        <Table>
          <THead>
            <tr>
              <Th>Invoice</Th>
              <Th>Customer</Th>
              <Th>Date</Th>
              <Th>Qty</Th>
              <Th>Revenue</Th>
              <Th>Cost</Th>
              <Th>Profit</Th>
            </tr>
          </THead>
          <TBody>
            {rows.length === 0 ? (
              <TableEmpty colSpan={7} message="No sales for this item in the selected range." />
            ) : (
              rows.map((r) => (
                <tr key={r.saleId}>
                  <Td className="font-medium text-slate-900">{r.receiptNumber}</Td>
                  <Td>{r.customerName}</Td>
                  <Td>{formatDateTime(r.createdAt)}</Td>
                  <Td>{r.quantity}</Td>
                  <Td>{formatCurrency(r.revenue)}</Td>
                  <Td>{formatCurrency(r.cost)}</Td>
                  <Td className="font-semibold text-emerald-600">{formatCurrency(r.profit)}</Td>
                </tr>
              ))
            )}
          </TBody>
        </Table>
      )}
    </Modal>
  );
}

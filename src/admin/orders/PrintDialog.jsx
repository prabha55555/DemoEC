import React, { useEffect } from 'react';
import { Button, Modal } from '../ui';
import { useBrand } from '../../context/BrandContext';
import InvoiceDocument from '../../components/InvoiceDocument';
import PackingSlip from './PackingSlip';

// Preview + print for one or many orders: GST invoices (the same InvoiceDocument the customer prints) or packing slips.
// "Print" uses the browser's print dialog ("Save as PDF" is in there too). The print rules in orders.css hide the admin
// and the dialog's own frame so only the documents print, one per page.
//   <PrintDialog kind="invoice" orders={[order]} onClose={…} />
export default function PrintDialog({ kind, orders, onClose }) {
  const { brand } = useBrand();
  // The print rules in orders.css apply only while this class is on <html>: a normal Ctrl+P elsewhere is untouched.
  useEffect(() => {
    document.documentElement.classList.add('adm-printing');
    return () => document.documentElement.classList.remove('adm-printing');
  }, []);
  if (!orders || orders.length === 0) return null;
  const invoice = kind === 'invoice';
  const many = orders.length > 1;
  return (
    <Modal open onClose={onClose} size="lg"
      title={invoice ? (many ? `Print ${orders.length} invoices` : `Invoice ${orders[0].order_id}`) : (many ? `Print ${orders.length} packing slips` : `Packing slip ${orders[0].order_id}`)}
      subtitle="Preview. Use Print, then choose a printer or Save as PDF."
      footer={(
        <>
          <Button onClick={onClose}>Close</Button>
          <Button variant="primary" icon="doc" onClick={() => window.print()}>Print / Save as PDF</Button>
        </>
      )}>
      <div className="ord-print-sheet">
        {orders.map(o => (
          <div className="ord-print-page" key={o.id}>
            {invoice ? <InvoiceDocument order={o} brand={brand} /> : <PackingSlip order={o} brand={brand} />}
          </div>
        ))}
      </div>
    </Modal>
  );
}

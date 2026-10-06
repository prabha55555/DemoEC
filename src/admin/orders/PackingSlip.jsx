import React from 'react';
import { addressLines, formatDeliveryLabel, fmtDateTime, lineVariantLabel, paymentMethodLabel } from '../../utils/orderFormat';
import { code39Bars } from './code39';
import { codToCollect, customerName } from './orderLogic';

// The slip that goes in the parcel: who it is for, what is inside (no prices, so it can ride in a gift), the order number
// as a scannable barcode, and -- for Cash on Delivery -- the amount the courier must collect. Prints on A4.
const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

export function Barcode({ value, height = 42 }) {
  const { bars, width, text } = code39Bars(value);
  const quiet = 10; // quiet zone each side, in modules: scanners need clear paper around the bars
  const total = width + quiet * 2;
  return (
    <svg className="pks-barcode" viewBox={`0 0 ${total} ${height}`} width={`${(total * 0.5).toFixed(1)}mm`} height="14mm" preserveAspectRatio="none" role="img" aria-label={`Barcode of ${text}`} style={{ maxWidth: '100%' }}>
      {bars.map((b, i) => <rect key={i} x={b.x + quiet} y={0} width={b.w} height={height} fill="#000" />)}
    </svg>
  );
}

export default function PackingSlip({ order, brand }) {
  if (!order) return null;
  const b = brand || {};
  const seller = b.seller_legal_name || b.brand_name || '';
  const ship = order.address || {};
  const items = Array.isArray(order.items) ? order.items : [];
  const physical = items.filter(i => !i.isGiftCard);
  const gifts = items.filter(i => i.isGiftCard);
  const units = physical.reduce((s, i) => s + (Number(i.qty) || 0), 0);
  const cod = codToCollect(order);
  const eta = formatDeliveryLabel(order.estimated_delivery);

  return (
    <article className="pks" aria-label={`Packing slip ${order.order_id}`}>
      <header className="pks-head">
        <div>
          <div className="pks-brand">{seller}</div>
          {b.registered_office && <div className="pks-small">{b.registered_office}</div>}
          {(b.support_email || b.support_phone) && <div className="pks-small">{[b.support_email, b.support_phone].filter(Boolean).join(' · ')}</div>}
        </div>
        <div className="pks-ord">
          <div className="pks-title">PACKING SLIP</div>
          <div className="pks-num">{order.order_id}</div>
          <Barcode value={order.order_id} />
        </div>
      </header>

      {cod > 0 && <div className="pks-cod" role="note">CASH ON DELIVERY — collect <strong>{inr(cod)}</strong> from the customer</div>}

      <section className="pks-cols">
        <div>
          <div className="pks-label">Ship to</div>
          {addressLines(ship).map((l, i) => <div key={i} className={i === 0 ? 'pks-strong' : undefined}>{l}</div>)}
        </div>
        <div>
          <div className="pks-label">Order</div>
          <div>Placed: {fmtDateTime(order.created_at)}</div>
          <div>Customer: {customerName(order)}</div>
          <div>Payment: {paymentMethodLabel(order) || '—'}</div>
          {eta && <div>Delivery by: {eta}</div>}
          {(order.shipping_carrier || order.tracking_number) && <div>Courier: {[order.shipping_carrier, order.tracking_number].filter(Boolean).join(' · ')}</div>}
        </div>
      </section>

      <table className="pks-items">
        <thead>
          <tr><th className="c-tick" aria-label="Packed" /><th>Item</th><th>SKU</th><th className="r">Qty</th></tr>
        </thead>
        <tbody>
          {physical.map((it, i) => (
            <tr key={`${it.variantId || it.id}-${i}`}>
              <td className="c-tick"><span className="pks-box" aria-hidden="true" /></td>
              <td><strong>{it.name || 'Item'}</strong>{lineVariantLabel(it) && <div className="pks-small">{lineVariantLabel(it)}</div>}</td>
              <td className="pks-mono">{it.sku || '—'}</td>
              <td className="r pks-qty">{Number(it.qty) || 1}</td>
            </tr>
          ))}
          {gifts.map((g, i) => (
            <tr key={`g${i}`}>
              <td className="c-tick" />
              <td><strong>{g.name || 'Gift card'}</strong><div className="pks-small">Digital gift card: nothing to pack</div></td>
              <td>—</td>
              <td className="r pks-qty">{Number(g.qty) || 1}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr><td colSpan={3} className="r"><strong>Total units to pack</strong></td><td className="r pks-qty">{units}</td></tr>
        </tfoot>
      </table>

      <section className="pks-sign">
        <div><span>Packed by</span><i /></div>
        <div><span>Checked by</span><i /></div>
        <div><span>Date</span><i /></div>
      </section>
      <p className="pks-foot">Thank you for shopping with {b.brand_name || seller || 'us'}.{b.support_email ? ` Questions? ${b.support_email}.` : ''}</p>

      <style>{'@page { size: A4; margin: 10mm; }'}</style>
    </article>
  );
}

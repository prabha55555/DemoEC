import React, { useMemo } from 'react';
import { buildInvoice } from '../utils/invoiceData';
import { addressLines, fmtDate, paymentMethodLabel } from '../utils/orderFormat';

// Printable A4 GST tax invoice. Pure and reusable: <InvoiceDocument order={order} brand={brand} /> -- the
// customer's /invoice/:orderId page and the admin both render it. All numbers come from
// utils/invoiceData.js (prices are GST-inclusive; CGST+SGST within the seller's state, IGST otherwise).
const inr = (n) => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function InvoiceDocument({ order, brand }) {
  const inv = useMemo(() => buildInvoice(order, brand || {}), [order, brand]);
  if (!order) return null;
  const { seller } = inv;
  const ship = order.address || {};
  const bill = order.address?.billing?.line1 ? order.address.billing : ship;
  const intra = inv.intraState;
  const cancelled = order.status === 'Cancelled';
  const digital = (order.items || []).length > 0 && (order.items || []).every(i => i.isGiftCard);

  return (
    <article className="invd" aria-label={`Tax invoice ${inv.number}`}>
      {cancelled && <div className="invd-void" role="note">CANCELLED — this invoice is void</div>}

      <header className="invd-head">
        <div className="invd-seller">
          <div className="invd-brand">{seller.name}</div>
          {seller.address && <div>{seller.address}</div>}
          {seller.gstin && <div><b>GSTIN:</b> {seller.gstin}</div>}
          {(seller.email || seller.phone) && <div>{[seller.email, seller.phone].filter(Boolean).join(' · ')}</div>}
        </div>
        <div className="invd-meta">
          <div className="invd-title">TAX INVOICE</div>
          <table>
            <tbody>
              <tr><th>Invoice no.</th><td>{inv.number}</td></tr>
              <tr><th>Invoice date</th><td>{fmtDate(order.created_at)}</td></tr>
              <tr><th>Order no.</th><td>{order.order_id}</td></tr>
              <tr><th>Payment</th><td>{paymentMethodLabel(order) || '—'}</td></tr>
            </tbody>
          </table>
        </div>
      </header>

      <section className="invd-parties">
        <div>
          <div className="invd-label">Billed to</div>
          {addressLines(bill).map((l, i) => <div key={i} className={i === 0 ? 'invd-strong' : undefined}>{l}</div>)}
          {order.user_email && <div>{order.user_email}</div>}
        </div>
        {!digital && (
          <div>
            <div className="invd-label">Shipped to</div>
            {addressLines(ship).map((l, i) => <div key={i} className={i === 0 ? 'invd-strong' : undefined}>{l}</div>)}
          </div>
        )}
        <div>
          <div className="invd-label">Place of supply</div>
          <div className="invd-strong">{ship.state || '—'}</div>
          <div>{intra ? 'Intra-state supply (CGST + SGST)' : 'Inter-state supply (IGST)'}</div>
        </div>
      </section>

      <table className="invd-items">
        <thead>
          <tr>
            <th className="c-no">#</th>
            <th className="c-desc">Description</th>
            <th>HSN</th>
            <th className="r">Qty</th>
            <th className="r">Unit price<br /><small>(incl. GST)</small></th>
            <th className="r">Discount</th>
            <th className="r">Taxable value</th>
            <th className="r">GST %</th>
            {intra ? <><th className="r">CGST</th><th className="r">SGST</th></> : <th className="r">IGST</th>}
            <th className="r">Amount</th>
          </tr>
        </thead>
        <tbody>
          {inv.lines.map(l => (
            <tr key={l.no}>
              <td className="c-no">{l.no}</td>
              <td className="c-desc">
                <b>{l.name}</b>
                {l.variantLabel && <div>{l.variantLabel}</div>}
                {l.sku && <div className="invd-dim">SKU {l.sku}</div>}
              </td>
              <td>{l.hsn || '—'}</td>
              <td className="r">{l.qty}</td>
              <td className="r">{inr(l.unitPrice)}</td>
              <td className="r">{l.discount > 0 ? inr(l.discount) : '—'}</td>
              <td className="r">{inr(l.taxable)}</td>
              <td className="r">{l.rate}%</td>
              {intra ? <><td className="r">{inr(l.cgst)}</td><td className="r">{inr(l.sgst)}</td></> : <td className="r">{inr(l.igst)}</td>}
              <td className="r">{inr(l.amount)}</td>
            </tr>
          ))}
          {inv.giftLines.map(g => (
            <tr key={`g${g.no}`}>
              <td className="c-no">{g.no}</td>
              <td className="c-desc"><b>{g.name}</b><div className="invd-dim">Gift card (voucher) — not subject to GST when issued</div></td>
              <td>—</td>
              <td className="r">{g.qty}</td>
              <td className="r">{inr(g.unitPrice)}</td>
              <td className="r">—</td>
              <td className="r">{inr(g.amount)}</td>
              <td className="r">—</td>
              {intra ? <><td className="r">—</td><td className="r">—</td></> : <td className="r">—</td>}
              <td className="r">{inr(g.amount)}</td>
            </tr>
          ))}
          {[inv.deliveryLine, inv.codLine].filter(Boolean).map(c => (
            <tr key={c.label}>
              <td className="c-no" />
              <td className="c-desc"><b>{c.label}</b></td>
              <td>—</td>
              <td className="r">1</td>
              <td className="r">{inr(c.amount)}</td>
              <td className="r">—</td>
              <td className="r">{inr(c.taxable)}</td>
              <td className="r">{c.rate}%</td>
              {intra ? <><td className="r">{inr(c.cgst)}</td><td className="r">{inr(c.sgst)}</td></> : <td className="r">{inr(c.igst)}</td>}
              <td className="r">{inr(c.amount)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={6} className="r"><b>Total</b></td>
            <td className="r"><b>{inr(inv.taxable)}</b></td>
            <td />
            {intra ? <><td className="r"><b>{inr(inv.cgst)}</b></td><td className="r"><b>{inr(inv.sgst)}</b></td></> : <td className="r"><b>{inr(inv.igst)}</b></td>}
            <td className="r"><b>{inr(inv.invoiceValue)}</b></td>
          </tr>
        </tfoot>
      </table>

      <section className="invd-totals">
        <div className="invd-words">
          <div className="invd-label">Amount in words</div>
          <div className="invd-strong">{inv.inWords}</div>
          <div className="invd-note">All prices include GST. Taxable value {inr(inv.taxable)} + GST {inr(inv.tax)}{inv.giftTotal > 0 ? ' (gift cards carry no GST)' : ''}.</div>
        </div>
        <table className="invd-sum">
          <tbody>
            <tr><td>Items total</td><td className="r">{inr(inv.goodsGross + inv.giftTotal)}</td></tr>
            {inv.discount > 0 && <tr><td>Discount{order.coupon_code ? ` (${order.coupon_code})` : ''}</td><td className="r">− {inr(inv.discount)}</td></tr>}
            {inv.shipping > 0 && <tr><td>Delivery charge</td><td className="r">{inr(inv.shipping)}</td></tr>}
            {inv.codFee > 0 && <tr><td>Cash on Delivery fee</td><td className="r">{inr(inv.codFee)}</td></tr>}
            <tr className="invd-strongrow"><td>Invoice value</td><td className="r">{inr(inv.invoiceValue)}</td></tr>
            {inv.giftCardApplied > 0 && <tr><td>Paid with gift card{order.gift_card_code ? ` (${order.gift_card_code})` : ''}</td><td className="r">− {inr(inv.giftCardApplied)}</td></tr>}
            <tr className="invd-grand"><td>{inv.mode === 'cod' ? 'Amount payable on delivery' : 'Amount paid'}</td><td className="r">₹ {inr(inv.total)}</td></tr>
            {inv.refunded > 0 && <tr><td>Refunded</td><td className="r">{inr(inv.refunded)}</td></tr>}
          </tbody>
        </table>
      </section>

      <footer className="invd-foot">
        <div className="invd-decl">
          <div className="invd-label">Declaration</div>
          <div>We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.{seller.name ? ` Goods are sold by ${seller.name}.` : ''}</div>
        </div>
        <div className="invd-sign">
          <div className="invd-signbox" />
          <div>Authorised signatory{seller.name ? ` — ${seller.name}` : ''}</div>
        </div>
      </footer>
      <div className="invd-generated">This is a computer-generated invoice and does not require a physical signature.</div>

      <style>{INVOICE_CSS}</style>
    </article>
  );
}

const INVOICE_CSS = `
  .invd { box-sizing: border-box; width: 210mm; max-width: 100%; margin: 0 auto; padding: 12mm 12mm 10mm; background: #fff; color: #1b2220; font: 11px/1.45 'DM Sans', Arial, sans-serif; border: 1px solid #DDE4E2; position: relative; }
  .invd * { box-sizing: border-box; }
  .invd b, .invd .invd-strong { font-weight: 700; }
  .invd-void { margin: -4mm 0 4mm; padding: 6px 10px; border: 2px solid #C0352B; color: #C0352B; font-weight: 700; text-align: center; letter-spacing: .04em; }
  .invd-head { display: flex; justify-content: space-between; gap: 12mm; padding-bottom: 5mm; border-bottom: 2px solid #1b2220; }
  .invd-brand { font-size: 17px; font-weight: 700; margin-bottom: 2px; }
  .invd-seller { max-width: 95mm; overflow-wrap: anywhere; }
  .invd-meta { text-align: right; }
  .invd-title { font-size: 18px; font-weight: 800; letter-spacing: .06em; margin-bottom: 4px; }
  .invd-meta table { margin-left: auto; border-collapse: collapse; }
  .invd-meta th { font-weight: 400; text-align: right; padding: 1px 8px 1px 0; color: #5F6B69; }
  .invd-meta td { text-align: right; padding: 1px 0; font-weight: 600; }
  .invd-parties { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6mm; padding: 4mm 0; border-bottom: 1px solid #DDE4E2; overflow-wrap: anywhere; }
  .invd-label { font-size: 9.5px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: #5F6B69; margin-bottom: 2px; }
  .invd-items { width: 100%; border-collapse: collapse; margin-top: 4mm; table-layout: fixed; font-size: 10px; }
  .invd-items th { background: #F1F4F3; border: 1px solid #C9D3D1; padding: 4px 4px; text-align: left; font-weight: 700; vertical-align: bottom; }
  .invd-items th small { font-weight: 400; color: #5F6B69; }
  .invd-items td { border: 1px solid #DDE4E2; padding: 4px 4px; vertical-align: top; overflow-wrap: anywhere; }
  .invd-items tfoot td { background: #F7F9F8; border-color: #C9D3D1; }
  .invd .r { text-align: right; }
  .invd-items .c-no { width: 6mm; text-align: center; }
  .invd-items .c-desc { width: 44mm; }
  .invd-dim { color: #5F6B69; font-size: 9px; }
  .invd-totals { display: flex; justify-content: space-between; gap: 8mm; margin-top: 5mm; align-items: flex-start; }
  .invd-words { flex: 1; min-width: 0; }
  .invd-note { margin-top: 4px; font-size: 9.5px; color: #5F6B69; }
  .invd-sum { width: 78mm; border-collapse: collapse; flex-shrink: 0; }
  .invd-sum td { padding: 3px 0; }
  .invd-strongrow td { border-top: 1px solid #C9D3D1; font-weight: 700; }
  .invd-grand td { border-top: 2px solid #1b2220; padding-top: 5px; font-size: 13px; font-weight: 800; }
  .invd-foot { display: flex; justify-content: space-between; gap: 10mm; margin-top: 8mm; padding-top: 4mm; border-top: 1px solid #DDE4E2; align-items: flex-end; }
  .invd-decl { flex: 1; font-size: 9.5px; color: #3D4A48; }
  .invd-sign { width: 62mm; text-align: center; font-size: 9.5px; }
  .invd-signbox { height: 14mm; border-bottom: 1px solid #1b2220; margin-bottom: 3px; }
  .invd-generated { margin-top: 5mm; text-align: center; font-size: 9px; color: #5F6B69; }
  @page { size: A4; margin: 8mm; }
  @media print {
    .invd { width: auto; margin: 0; padding: 0; border: none; box-shadow: none; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .invd-items tr, .invd-totals, .invd-foot { break-inside: avoid; }
  }
  @media (max-width: 760px) {
    .invd { width: 100%; padding: 14px 10px; overflow-x: auto; }
    .invd-head, .invd-totals, .invd-foot { flex-direction: column; }
    .invd-meta { text-align: left; } .invd-meta table { margin-left: 0; }
    .invd-parties { grid-template-columns: 1fr; }
    .invd-sum { width: 100%; }
    .invd-items { min-width: 640px; }
  }
`;

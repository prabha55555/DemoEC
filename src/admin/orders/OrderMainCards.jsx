import React from 'react';
import { Link } from 'react-router-dom';
import { Button, Card, CopyButton, DateTime, EmptyState, Icon, Money, StatusPill } from '../ui';
import { thumb } from '../../utils/thumbnail';
import { lineVariantLabel, paymentMethodLabel } from '../../utils/orderFormat';
import { formatMoney } from '../lib/format';
import { adminCanCancel, buildTimeline, codToCollect, lineAmounts, refundSummary, shortReturnId } from './orderLogic';

const money = (n) => formatMoney(n) || '₹0';

// ------------------------------------------------------------------------------------------ items
function Line({ item }) {
  const a = lineAmounts(item);
  const gift = !!item.isGiftCard;
  const price = Number(item.price) || 0;
  const mrp = Number(item.mrp) > price ? Number(item.mrp) : 0;
  const label = lineVariantLabel(item);
  const rate = item.gstRate !== null && item.gstRate !== undefined && item.gstRate !== '' ? Number(item.gstRate) : null;
  const linkable = !gift && item.id;
  return (
    <li className="ord-line">
      {item.image ? <img src={thumb(item.image, 112)} alt="" loading="lazy" /> : <span className="ord-line-img"><Icon name={gift ? 'gift' : 'box'} size={22} /></span>}
      <div style={{ minWidth: 0 }}>
        {linkable ? <Link className="ord-line-name" to={`/admin/products/${item.id}`}>{item.name || 'Item'}</Link> : <span className="ord-line-name">{item.name || 'Item'}</span>}
        <div className="ord-line-meta">
          {label && <span>{label}</span>}
          {item.sku && <span>SKU <span className="adm-mono">{item.sku}</span></span>}
          {item.brand && !gift && <span>{item.brand}</span>}
        </div>
        <div className="ord-line-meta">
          <span>{a.qty} × {money(price)}</span>
          {mrp > 0 && <span>MRP <s>{money(mrp)}</s></span>}
          {!gift && <span>GST {rate === null ? '—' : `${rate}%`} included{item.hsn ? ` · HSN ${item.hsn}` : ''}</span>}
        </div>
        {gift && (
          <div className="ord-line-meta" style={{ marginTop: 6 }}>
            {item.giftCode
              ? <span><span className="ord-code">{item.giftCode}</span> <CopyButton text={item.giftCode} /></span>
              : <span>No code was issued for this card.</span>}
            {(item.recipientName || item.recipientEmail) && <span>For {[item.recipientName, item.recipientEmail].filter(Boolean).join(' · ')}</span>}
          </div>
        )}
      </div>
      <div className="ord-line-sum">
        <strong><Money value={a.net} /></strong>
        {a.discount > 0 && <small>was <Money value={a.gross} /></small>}
        {a.discount > 0 && <small className="is-off">−<Money value={a.discount} /> coupon</small>}
      </div>
    </li>
  );
}

export function ItemsCard({ order }) {
  const items = Array.isArray(order.items) ? order.items : [];
  const units = items.reduce((s, i) => s + (Number(i.qty) || 0), 0);
  return (
    <Card title="Items" subtitle={`${items.length} line${items.length === 1 ? '' : 's'} · ${units} unit${units === 1 ? '' : 's'}`} pad={false}>
      {items.length === 0 ? <EmptyState compact icon="box" title="No items recorded" /> : <ul className="ord-lines">{items.map((it, i) => <Line key={`${it.variantId || it.id}-${i}`} item={it} />)}</ul>}
    </Card>
  );
}

// ------------------------------------------------------------------------------------------ timeline
export function TimelineCard({ order, returns }) {
  const events = buildTimeline(order, returns);
  return (
    <Card title="Timeline" subtitle="Status changes, refunds and returns, newest first">
      {events.length === 0 ? <p className="adm-muted" style={{ margin: 0 }}>Nothing has been recorded for this order yet.</p> : (
        <ol className="ord-tl">
          {events.map(e => (
            <li key={e.key} className={`${e.tone}${e.failed ? ' is-failed' : ''}`}>
              <span className="ord-tl-dot" aria-hidden="true" />
              <div>
                <div className="ord-tl-title">
                  {e.href ? <Link to={e.href}>{e.title}</Link> : e.title}
                  {e.failed && <> <StatusPill kind="generic" tone="danger" status="failed" label="failed" /></>}
                </div>
                <div className="ord-tl-sub">
                  <DateTime value={e.at} />{e.by ? ` · ${e.by}` : ''}{e.detail ? ` · ${e.detail}` : ''}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------------------------------ payment
const TYPE_LABEL = { online: 'To payment method', manual: 'Manual refund', gift_card: 'Gift card credit' };

function RefundRow({ entry: e }) {
  return (
    <li className={`ord-refund${e.status === 'failed' ? ' is-failed' : ''}`}>
      <span className="ord-refund-amt">{money(e.amount)}</span>
      <span className="ord-refund-tags">
        <span className="adm-chip">{TYPE_LABEL[e.type]}</span>
        {e.status === 'failed' ? <StatusPill kind="generic" tone="danger" status="failed" label="failed" />
          : e.status === 'pending' ? <StatusPill kind="generic" tone="warning" status="pending" label="pending" />
            : <StatusPill kind="generic" tone="success" status="processed" label="processed" />}
      </span>
      <span className="ord-refund-meta">
        <DateTime value={e.at} />
        {e.by && <span>by {e.by}</span>}
        {e.reason && <span>{e.reason}</span>}
        {e.code && <span>card {e.code}</span>}
        {e.ref && <span className="ord-payid">ref {e.ref}<CopyButton text={e.ref} /></span>}
        {e.status === 'failed' && <span>No money moved: this amount is refundable again.</span>}
        {e.type === 'gift_card' && e.status !== 'failed' && <span>Back on the customer's gift card, not gateway money.</span>}
      </span>
    </li>
  );
}

export function PaymentCard({ order, onRefund, onCancel }) {
  const s = refundSummary(order);
  const cod = codToCollect(order);
  const discount = Number(order.discount) || 0;
  const gift = Number(order.gift_card_applied) || 0;
  const shipping = Number(order.shipping) || 0;
  const codFee = Number(order.cod_fee) || 0;
  return (
    <Card title="Payment" actions={<StatusPill status={order.payment_status} kind="payment" />}>
      <div className="adm-stack">
        <dl className="ord-kv">
          <div><dt>Method</dt><dd>{paymentMethodLabel(order) || '—'}</dd></div>
          {order.payment_id && <div><dt>Razorpay payment</dt><dd><span className="ord-payid">{order.payment_id}<CopyButton text={order.payment_id} /></span></dd></div>}
          {cod > 0 && <div><dt>To collect on delivery</dt><dd><strong>{money(cod)}</strong></dd></div>}
        </dl>
        <dl className="ord-kv" aria-label="Order totals">
          <div><dt>Items</dt><dd><Money value={order.subtotal} /></dd></div>
          {discount > 0 && <div className="is-minus"><dt>Discount{order.coupon_code ? ` (${order.coupon_code})` : ''}</dt><dd>−<Money value={discount} /></dd></div>}
          <div><dt>Delivery</dt><dd>{shipping > 0 ? <Money value={shipping} /> : 'Free'}</dd></div>
          {codFee > 0 && <div><dt>Cash on delivery fee</dt><dd><Money value={codFee} /></dd></div>}
          {gift > 0 && <div className="is-minus"><dt>Paid with gift card{order.gift_card_code ? ` (${order.gift_card_code})` : ''}</dt><dd>−<Money value={gift} /></dd></div>}
          <div className="is-total"><dt>{order.payment_method === 'cod' ? 'Total payable' : 'Total charged'}</dt><dd><Money value={order.total} /></dd></div>
          {Number(order.tax_total) > 0 && <div className="is-sub"><dt>GST included in the total</dt><dd><Money value={order.tax_total} /></dd></div>}
          {s.refunded > 0 && <div className="is-minus"><dt>Refunded</dt><dd>−<Money value={s.refunded} /></dd></div>}
        </dl>

        {s.entries.length > 0 && (
          <div>
            <div className="adm-label" style={{ marginBottom: 8 }}>Refunds</div>
            <ul className="ord-refunds">{s.entries.map(e => <RefundRow key={e.id} entry={e} />)}</ul>
          </div>
        )}

        {s.canRefund
          ? <div className="ord-remaining"><span>{s.cap !== null ? 'Can be refunded before delivery' : 'Still refundable'}</span><strong><Money value={s.cap !== null ? s.cap : s.remaining} /></strong></div>
          : <p className="adm-hint" style={{ margin: 0 }}>{s.blocked}</p>}
        {s.canRefund && s.cap !== null && <p className="adm-hint" style={{ margin: 0 }}>Before delivery only part of the order can be refunded. To give back all of it, cancel the order.</p>}

        <div className="ord-actions-row">
          <Button icon="undo" onClick={onRefund} disabled={!s.canRefund} title={s.canRefund ? undefined : s.blocked}>Issue refund</Button>
          {adminCanCancel(order) && <Button variant="danger" icon="close" onClick={onCancel}>Cancel order</Button>}
        </div>
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------------------------------ returns
export function ReturnsCard({ returns }) {
  if (!returns || returns.length === 0) return null;
  return (
    <Card title="Returns" subtitle="Return and replacement requests for this order">
      <ul className="ord-returns">
        {returns.map(r => {
          const names = (r.items || []).map(i => `${i.qty} × ${i.name}`).join(', ');
          return (
            <li key={r.id} className="ord-return">
              <span style={{ minWidth: 0 }}>
                <Link to={`/admin/returns/${r.id}`}><strong>{r.type === 'replacement' ? 'Replacement' : 'Return'} {shortReturnId(r.id)}</strong></Link>
                <span className="adm-cell-sub" style={{ display: 'block', overflowWrap: 'anywhere' }}>{names}</span>
                <span className="adm-cell-sub" style={{ display: 'block' }}>Requested <DateTime value={r.created_at} /> · refund proposed <Money value={r.refund_amount} /></span>
              </span>
              <span className="adm-row"><StatusPill status={r.status} kind="return" /><Button size="sm" to={`/admin/returns/${r.id}`}>Open</Button></span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

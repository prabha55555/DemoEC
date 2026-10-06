import React from 'react';
import { pillFor } from './status';

// A coloured status badge with a dot.
//   <StatusPill status={order.status} kind="order" />            Placed / Confirmed / Shipped / Delivered / Cancelled …
//   <StatusPill status={order.payment_status} kind="payment" />  paid / cod_pending / partially_refunded / refunded
//   <StatusPill status={ret.status} kind="return" />             Requested / Approved / Rejected / …
//   <StatusPill status={product.status} kind="product" />        active / draft / archived
//   <StatusPill status={review.status} kind="review" />          pending / approved / rejected
//   <StatusPill status="active" kind="generic" label="On sale" />   anything else; `tone` forces a colour
// kind defaults to 'auto'. tone: 'success' | 'warning' | 'danger' | 'info' | 'primary' | 'neutral'.
export default function StatusPill({ status, kind = 'auto', label, tone }) {
  const p = pillFor(status, kind);
  return <span className={`adm-badge ${tone || p.tone}`}>{label || p.label}</span>;
}

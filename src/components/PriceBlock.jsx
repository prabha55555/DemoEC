import React from 'react';
import { formatMoney, discountPercent, savingsAmount } from '../utils/catalog';

// Selling price, the struck-through MRP and "% off" -- one look for the product card, the search rows and the
// buy box, so the numbers are always presented the same way. `price` is what the customer pays (GST-inclusive).
//   prefix   'from' for a product whose variants have different prices
//   size     'sm' (cards), 'lg' (buy box: adds "You save" and the tax note when `detail` is set)
export default function PriceBlock({ price, mrp, prefix = '', size = 'sm', detail = false }) {
  const p = Number(price);
  if (!Number.isFinite(p) || p <= 0) return null;
  const off = discountPercent(p, mrp);
  const save = savingsAmount(p, mrp);
  return (
    <div className={`pb pb-${size}`}>
      <div className="pb-row">
        {prefix && <span className="pb-prefix">{prefix}</span>}
        <span className="pb-now">{formatMoney(p)}</span>
        {off > 0 && (
          <>
            <span className="pb-mrp"><span className="sr-only">M.R.P. </span><s>{formatMoney(mrp)}</s></span>
            <span className="pb-off">{off}% off</span>
          </>
        )}
      </div>
      {detail && (
        <div className="pb-detail">
          {save > 0 && <span className="pb-save">You save {formatMoney(save)}</span>}
          <span className="pb-tax">Inclusive of all taxes</span>
        </div>
      )}
    </div>
  );
}

import React from 'react';
import { formatMoney } from '../utils/catalog';
import './orderUi.css';

// The "Price details" card shared by the cart and checkout (Flipkart-style: MRP total, discount, delivery,
// total, "you will save"). Purely presentational -- callers build the rows from checkoutRules.js.
//
//   rows   [{ key, label, value, tone?: 'minus' | 'free', sub? }]   value is already formatted text
//   total  { label, value }
//   hint   { text, away?, threshold? }  free-delivery nudge; with away + threshold it draws a progress bar
//   children  rendered above the rows (checkout puts the coupon box here)
export default function PriceSummary({ title = 'Price details', headRight = null, rows, total, savings = 0, hint = null, note = 'Inclusive of all taxes', children = null, footer = null, className = '', style }) {
  const progress = hint && hint.threshold > 0 ? Math.max(0, Math.min(100, ((hint.threshold - hint.away) / hint.threshold) * 100)) : null;
  return (
    <aside className={`pst ${className}`.trim()} aria-label={title} style={style}>
      <div className="pst-head"><span>{title}</span>{headRight}</div>
      <div className="pst-body">
        {hint && (
          <div className="pst-hint" role="status">
            {hint.text}
            {progress !== null && <div className="pst-bar" aria-hidden="true"><span style={{ width: `${progress}%` }} /></div>}
          </div>
        )}
        {children}
        <dl className="pst-rows">
          {rows.map(r => (
            <div className="pst-row" key={r.key || r.label}>
              <dt>{r.label}{r.sub && <small className="pst-sub">{r.sub}</small>}</dt>
              <dd className={r.tone ? `is-${r.tone}` : undefined}>{r.value}</dd>
            </div>
          ))}
        </dl>
        <div className="pst-total"><span>{total.label}</span><strong>{total.value}</strong></div>
        {savings > 0 && <div className="pst-save">You will save {formatMoney(savings)} on this order</div>}
        {note && <div className="pst-note">{note}</div>}
        {footer}
      </div>
    </aside>
  );
}

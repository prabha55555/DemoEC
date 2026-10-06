import React from 'react';
import { Link } from 'react-router-dom';
import { formatMoney } from '../utils/catalog';
import { thumb } from '../utils/thumbnail';
import { lineVariantLabel, orderLineKey } from '../utils/orderFormat';
import './orderUi.css';

const Placeholder = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" /><polyline points="3.29 7 12 12 20.71 7" /><line x1="12" y1="22" x2="12" y2="12" />
  </svg>
);

// A line image: links to the product page for real products, plain for gift cards and old lines with no id.
export function LineImage({ item, size = 160, linked = true }) {
  const src = item?.image || (Array.isArray(item?.images) ? item.images[0] : null);
  const inner = src ? <img src={thumb(src, size)} alt="" loading="lazy" decoding="async" /> : <Placeholder />;
  if (linked && item?.id && !item.isGiftCard) {
    return <Link to={`/product/${item.id}`} className="oil-img" aria-label={`View ${item.name || 'product'}`}>{inner}</Link>;
  }
  return <div className="oil-img" aria-hidden="true">{inner}</div>;
}

// Items of an order (order detail, confirmation, invoice-less summaries). Reads both new orders
// (variantLabel, image, mrp) and old ones (size, no image).
//   reviewLinks  show "Write a review" under each physical item (delivered orders)
//   compact      smaller thumbnails
export default function OrderItemsList({ items, reviewLinks = false, compact = false }) {
  const list = Array.isArray(items) ? items : [];
  return (
    <ul className={`oil${compact ? ' is-compact' : ''}`}>
      {list.map((item, i) => {
        const qty = Number(item.qty) || 1;
        const price = Number(item.price) || 0;
        const mrp = Number(item.mrp) > price ? Number(item.mrp) : 0;
        const label = lineVariantLabel(item);
        const name = item.name || 'Item';
        return (
          <li key={`${orderLineKey(item, i)}-${i}`} className="oil-row">
            <LineImage item={item} size={compact ? 120 : 160} />
            <div className="oil-main">
              {item.brand && !item.isGiftCard && <div className="oil-brand">{item.brand}</div>}
              <div className="oil-name">
                {item.id && !item.isGiftCard ? <Link to={`/product/${item.id}`}>{name}</Link> : name}
              </div>
              {label && <div className="oil-meta">{label}</div>}
              <div className="oil-meta">Qty {qty}{qty > 1 ? ` × ${formatMoney(price)}` : ''}</div>
              {item.isGiftCard && (
                <>
                  {item.recipientName && <div className="oil-meta">For {item.recipientName}</div>}
                  {item.giftCode
                    ? <div className="oil-meta">Gift card code: <span className="oil-code">{item.giftCode}</span></div>
                    : <div className="oil-meta">Your code is emailed once the card is issued.</div>}
                </>
              )}
              {reviewLinks && !item.isGiftCard && item.id && (
                <div className="oil-actions"><Link to={`/product/${item.id}#reviews`} className="oil-link">Write a review</Link></div>
              )}
            </div>
            <div className="oil-price">
              {formatMoney(price * qty)}
              {mrp > 0 && <s aria-label={`MRP ${formatMoney(mrp * qty)}`}>{formatMoney(mrp * qty)}</s>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

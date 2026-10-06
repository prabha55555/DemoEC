import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useBrand } from '../context/BrandContext';
import { COMPANY } from '../config/company';
import { returnWindowDays } from '../utils/storeCopy';
import { usePageMeta } from '../utils/usePageMeta';
import { LegalLayout, LegalSection, LegalCallout } from '../components/LegalLayout';

const N = COMPANY.name;
const ICONS = [
  <><path d="M3 12a9 9 0 109-9 9.75 9.75 0 00-6.74 2.74L3 8M3 3v5h5" /></>,
  <><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /></>,
  <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.2 2" /></>,
  <><path d="M21 8l-9-5-9 5v8l9 5 9-5z" /><path d="M3 8l9 5 9-5M12 13v8" /></>,
];

const link = { color: 'var(--primary)', fontWeight: 500 };

// Returns, refunds, cancellations and replacements. The return window comes from the store settings; individual
// products can override it (or be non-returnable), which the product page states for that item.
export default function ReturnsPolicy() {
  const { brand } = useBrand();
  usePageMeta({
    title: 'Returns & Refunds',
    description: `How to return an item, cancel an order or get a refund or replacement at ${N}.`,
    path: '/returns-policy',
  });

  const days = returnWindowDays(null, brand);
  const hasCod = !!brand.cod_enabled;
  const email = brand.support_email || COMPANY.email;
  const phone = brand.support_phone || COMPANY.phoneDisplay;

  const sections = useMemo(() => [
    {
      id: 'window', title: '1. Return window',
      body: [
        days > 0
          ? `You can return most items within ${days} days of delivery. The ${days} days are counted from the date your order was marked as delivered.`
          : 'Most items are not eligible for return once delivered. The exceptions are items that arrive damaged, defective or different from what you ordered, which you can always report.',
        'Some products have their own return window, or are not returnable. This is shown on the product page (for example “7-day returns” or “Non-returnable”) and applies to that product.',
      ],
    },
    {
      id: 'eligible', title: '2. What you can return',
      items: [
        'Items that are unused, unwashed and in their original condition, with tags, accessories and packaging',
        'Items that arrived damaged, defective or incomplete',
        'Items that are not what you ordered (wrong product, size, colour or quantity)',
      ],
    },
    {
      id: 'noteligible', title: '3. What cannot be returned',
      items: [
        'Gift cards',
        'Products marked non-returnable on their product page',
        'Items that have been used, washed, altered or damaged after delivery',
        'Items with missing tags, accessories or packaging, or with a broken hygiene seal (for example, opened beauty and personal-care products)',
        'Requests made after the return window has ended',
      ],
    },
    {
      id: 'how', title: '4. How to return an item',
      steps: [
        'Sign in and open Account → Orders. Choose the delivered order.',
        'Select Return, then pick the items, the quantity and the reason. Add a short description and photos if the item is damaged or wrong.',
        'Submit the request. We will review it and let you know if it is approved.',
        'Once approved, we arrange a pickup from your delivery address (where our delivery partner serves it) or tell you how to send the item back. Pack the item securely in its original packaging.',
      ],
    },
    {
      id: 'inspection', title: '5. Pickup and inspection',
      body: 'When your return reaches us we check that it matches the request: right item, condition, tags and accessories. If it does not qualify, we will tell you why and, where possible, send it back to you.',
    },
    {
      id: 'refunds', title: '6. Refunds',
      body: [
        'Your refund is started once the returned item has passed inspection, for the price you paid for the returned item (after any discount applied to it). If an order is returned in full because we sent a wrong, damaged or defective item, the delivery fee is refunded too.',
        'Online payments (UPI, cards, net banking) are refunded to the original payment method. After we start the refund it usually reaches you within 5–7 business days, depending on your bank or card issuer.',
        ...(hasCod ? ['Cash on Delivery orders are refunded by bank transfer: we will ask you for your bank or UPI details when the return is approved.'] : []),
        'If you paid with a gift card balance, that amount goes back to your gift card.',
      ],
    },
    {
      id: 'cancel', title: '7. Cancelling an order',
      body: [
        'You can cancel an order yourself, free of charge, until it is dispatched: open it in Account → Orders and choose Cancel order. The amount you paid is refunded to the original payment method.',
        'Once an order has been dispatched it can no longer be cancelled. When it arrives you can return it under this policy.',
        ...(hasCod ? ['If you refuse a Cash on Delivery parcel at the door, please let us know so we can close the order.'] : []),
      ],
    },
    {
      id: 'replace', title: '8. Replacements',
      body: 'If you would rather have the same item again, choose Replacement instead of Refund when you raise the request for a wrong, damaged or defective item. A replacement is sent subject to stock; if it is not available we will offer a refund.',
    },
    {
      id: 'damaged', title: '9. Damaged, defective or wrong items',
      body: 'We are sorry when this happens. Please report it as soon as you notice, within the return window, with clear photos of the item and the packaging. We will arrange a replacement or a full refund at no cost to you.',
    },
  ], [days, hasCod]);

  const toc = useMemo(() => sections.map(({ id, title }) => ({ id: `returns-${id}`, title })), [sections]);

  const tiles = [
    { label: 'Return window', value: days > 0 ? `${days} days from delivery` : 'Damaged or wrong items only' },
    { label: 'Refund to', value: hasCod ? 'Original payment method (bank transfer for COD)' : 'Original payment method' },
    { label: 'Refund time', value: '5–7 business days after approval' },
    { label: 'Cancellation', value: 'Free until dispatched' },
  ];
  const summary = (
    <div className="ret-summary">
      {tiles.map(({ label, value }, i) => (
        <div key={label} className="ret-tile">
          <span className="ret-ico" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{ICONS[i % ICONS.length]}</svg>
          </span>
          <div style={{ minWidth: 0 }}>
            <div className="ret-lbl">{label}</div>
            <div className="ret-val">{value}</div>
          </div>
        </div>
      ))}
      <style>{`
        .ret-summary { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        .ret-tile { display: flex; align-items: center; gap: 12px; min-width: 0; background: #fff; border: 1px solid var(--line); border-radius: 8px; padding: 12px 14px; }
        .ret-ico { display: flex; flex-shrink: 0; color: var(--primary); }
        .ret-lbl { font-size: 12.5px; color: var(--text-muted); line-height: 1.3; margin-bottom: 2px; }
        .ret-val { font-weight: 600; font-size: 14px; color: var(--ink); line-height: 1.3; }
        @media (max-width: 520px) { .ret-tile { flex-direction: column; align-items: flex-start; gap: 8px; } }
        @media (min-width: 768px) { .ret-summary { grid-template-columns: repeat(4, 1fr); gap: 12px; } }
      `}</style>
    </div>
  );

  return (
    <LegalLayout crumb="Returns & Refunds" title="Returns & Refunds" subtitle="How to return an item, cancel an order and get your money back." updated="Last updated: October 2026" toc={toc} lead={summary}>
      {sections.map(({ id, title, body, items, steps }) => (
        <LegalSection key={id} id={`returns-${id}`} title={title}>
          {body && (Array.isArray(body) ? body : [body]).map((p, i) => <p key={i}>{p}</p>)}
          {items && <ul className="lg-list">{items.map((it, i) => <li key={i}>{it}</li>)}</ul>}
          {steps && <ol className="lg-steps">{steps.map((st, i) => <li key={i}><span>{String(i + 1).padStart(2, '0')}</span><span>{st}</span></li>)}</ol>}
        </LegalSection>
      ))}
      <LegalCallout tone="mint" icon="phone">
        <p>Need help with a return? Call {phone} or email {email}, or visit the <Link to="/help" style={link}>Help Centre</Link>. Delivery details are in our <Link to="/shipping-policy" style={link}>Shipping policy</Link>.</p>
      </LegalCallout>
    </LegalLayout>
  );
}

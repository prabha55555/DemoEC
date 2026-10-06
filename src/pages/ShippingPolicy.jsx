import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useBrand } from '../context/BrandContext';
import { COMPANY } from '../config/company';
import { shippingPromise } from '../utils/storeCopy';
import { deliveryFeeText, codText, metroCities } from '../utils/policyCopy';
import { usePageMeta } from '../utils/usePageMeta';
import { LegalLayout, LegalSection, LegalCallout } from '../components/LegalLayout';

const N = COMPANY.name;

// One icon per summary tile (same order as the tiles below).
const SUMMARY_ICONS = [
  <><path d="M3 7.5h11v8.5H3zM14 10.5h4l3 3v2.5h-7z" /><circle cx="7.5" cy="17.5" r="1.8" /><circle cx="17" cy="17.5" r="1.8" /></>,
  <><path d="M21 8l-9-5-9 5v8l9 5 9-5z" /><path d="M3 8l9 5 9-5M12 13v8" /></>,
  <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.2 2" /></>,
  <><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" /><circle cx="12" cy="10" r="2.4" /></>,
];

export default function ShippingPolicy() {
  const { brand } = useBrand();
  usePageMeta({
    title: 'Shipping Policy',
    description: `Delivery charges, delivery times, tracking and Cash on Delivery for orders placed with ${N}.`,
    path: '/shipping-policy',
  });

  const metros = useMemo(() => metroCities(brand), [brand]);
  const extraDays = Number(brand.delivery_extra_days) || 0;
  const cod = codText(brand);
  const email = brand.support_email || COMPANY.email;
  const phone = brand.support_phone || COMPANY.phoneDisplay;

  const sections = useMemo(() => [
    {
      id: 'areas', title: '1. Where we deliver',
      body: [
        'We deliver to serviceable PIN codes across India. We do not ship outside India at the moment.',
        'Enter your PIN code on any product page to check delivery and the estimated date before you order.',
      ],
    },
    {
      id: 'charges', title: '2. Delivery charges',
      body: [
        deliveryFeeText(brand),
        ...(metros.length ? [`Metro cities for delivery fees and timelines: ${metros.join(', ')}.`] : []),
        'Gift cards are digital and carry no delivery fee. Any delivery fee is shown at checkout, before you pay, and is never hidden in the price of a product.',
      ],
    },
    {
      id: 'time', title: '3. Delivery time',
      body: [
        'Each product page shows an estimated delivery date for your PIN code. Estimates are counted in business days (Monday to Friday) from the day your order is dispatched.',
        ...(extraDays > 0 ? [`Locations outside the metro cities usually take about ${extraDays} business days longer than the estimate for metro cities.`] : []),
        'If your order contains several items, they may arrive in separate parcels. Estimates are not guarantees: weather, strikes and courier delays can add time.',
      ],
    },
    {
      id: 'dispatch', title: '4. Order processing and dispatch',
      body: 'Orders are usually packed and handed to our delivery partner within 1–2 business days of being confirmed. Orders placed after business hours, on weekends or on public holidays are processed on the next working day.',
    },
    {
      id: 'tracking', title: '5. Tracking your order',
      body: 'When your order is dispatched we send you the courier name and tracking number. You can also follow every step under Account → Orders, including the tracking link and the estimated delivery date.',
    },
    {
      id: 'attempts', title: '6. Delivery attempts',
      body: 'Our delivery partners usually make up to three delivery attempts. Please make sure your address and phone number are correct at checkout. If a parcel cannot be delivered it is returned to us, and we will contact you to re-ship it or refund your order.',
    },
    ...(cod ? [{ id: 'cod', title: '7. Cash on Delivery', body: [cod, 'Cash on Delivery is not available for gift cards or for products marked as not eligible on their product page.'] }] : []),
    {
      id: 'problems', title: `${cod ? 8 : 7}. Delays, damaged or missing parcels`,
      body: [
        'If your order is late, or tracking shows delivered but you have not received it, contact us as soon as you can and we will investigate with the courier.',
        'If a parcel arrives damaged, or an item is wrong, raise a return from Account → Orders. See our Returns & refunds policy for how we make it right.',
      ],
    },
  ], [brand, metros, extraDays, cod]);

  const toc = useMemo(() => sections.map(({ id, title }) => ({ id: `shipping-${id}`, title })), [sections]);

  const tiles = [
    { label: 'Delivery charges', value: shippingPromise(brand) },
    { label: 'Dispatch', value: 'Within 1–2 business days' },
    { label: 'Delivery time', value: 'Shown on every product page' },
    { label: 'Delivery area', value: 'All of India' },
  ];
  const summary = (
    <div className="ship-summary">
      {tiles.map(({ label, value }, i) => (
        <div key={label} className="ship-tile">
          <span className="ship-ico" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{SUMMARY_ICONS[i % SUMMARY_ICONS.length]}</svg>
          </span>
          <div className="ship-txt">
            <div className="ship-lbl">{label}</div>
            <div className="ship-val">{value}</div>
          </div>
        </div>
      ))}
      <style>{`
        .ship-summary { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        .ship-tile { display: flex; align-items: center; gap: 12px; min-width: 0; background: #fff; border: 1px solid var(--line); border-radius: 8px; padding: 12px 14px; }
        .ship-ico { display: flex; flex-shrink: 0; color: var(--primary); }
        .ship-txt { min-width: 0; }
        .ship-lbl { font-size: 12.5px; color: var(--text-muted); line-height: 1.3; margin-bottom: 2px; }
        .ship-val { font-weight: 600; font-size: 14.5px; color: var(--ink); line-height: 1.3; }
        @media (max-width: 520px) { .ship-tile { flex-direction: column; align-items: flex-start; gap: 8px; } }
        @media (min-width: 768px) { .ship-summary { grid-template-columns: repeat(4, 1fr); gap: 12px; } }
      `}</style>
    </div>
  );

  return (
    <LegalLayout crumb="Shipping Policy" title="Shipping Policy" subtitle="Delivery charges, delivery times and tracking for your orders." updated="Last updated: October 2026" toc={toc} lead={summary}>
      {sections.map(({ id, title, body }) => (
        <LegalSection key={id} id={`shipping-${id}`} title={title}>
          {(Array.isArray(body) ? body : [body]).map((p, i) => <p key={i}>{p}</p>)}
        </LegalSection>
      ))}
      <LegalCallout tone="mint" icon="phone">
        <p>Questions about a shipment? Call {phone} or email {email}. You can also read our <Link to="/returns-policy" style={{ color: 'var(--primary)', fontWeight: 500 }}>Returns &amp; refunds policy</Link> and the <Link to="/help" style={{ color: 'var(--primary)', fontWeight: 500 }}>Help Centre</Link>.</p>
      </LegalCallout>
    </LegalLayout>
  );
}

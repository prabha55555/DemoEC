import React from 'react';
import { COMPANY } from '../config/company';
import { usePageMeta } from '../utils/usePageMeta';
import { LegalLayout, LegalSection, LegalCallout } from '../components/LegalLayout';

const N = COMPANY.name;

const SUMMARY = [
  { label: 'Processing time', value: '2–3 business days' },
  { label: 'Domestic delivery', value: '5–10 business days' },
  { label: 'International delivery', value: '15–25 business days' },
  { label: 'Domestic shipping', value: 'Based on delivery pincode' },
];

const SECTIONS = [
  { title: '1. Packaging', body: 'Each item is individually wrapped and packed in protective materials suited to its size, material and fragility. Smaller items are securely packed in corrugated boxes, while larger, heavier or more delicate items are given additional protection during transit.' },
  { title: '2. Domestic Shipping', body: 'We ship across all states in India via trusted courier partners. Standard delivery takes 5–10 business days from dispatch. Remote areas may take longer. A tracking number will be shared via WhatsApp once your order is dispatched.' },
  { title: '3. International Shipping', body: 'We ship globally. International orders may be subject to customs duties and import taxes levied by the destination country. These are borne entirely by the buyer. Delivery typically takes 30–40 business days via freight upon dispatch, depending on the destination.' },
  { title: '4. Shipping Charges', body: 'Domestic shipping charges within India are based on the delivery pincode. Where an item requires additional freight or handling, that cost is already built into the listed price, so you will never see a separate shipping charge added at checkout. International orders are quoted individually based on weight and destination and confirmed with you directly before your order is placed.' },
  { title: '5. Tracking', body: "You will receive a WhatsApp message with tracking details once your order is dispatched. You can track your shipment directly on the courier partner's website using the provided tracking number." },
  { title: '6. Delays', body: `${N} is not responsible for delays caused by courier partners, natural events, strikes, or customs clearance. We will assist you in following up with the courier if your shipment is delayed beyond the estimated delivery date.` },
  { title: '7. Lost or Stolen Shipments', body: `If your tracking shows delivery but you have not received the item, please contact us within 24 hours. We will initiate an investigation with the courier. ${N} is not liable for shipments stolen after confirmed delivery.` },
];

const slug = (t) => 'shipping-' + t.split('.')[0];
const TOC = SECTIONS.map(({ title }) => ({ id: slug(title), title }));

// One icon per summary tile (same order as SUMMARY).
const SUMMARY_ICONS = [
  <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.2 2" /></>,
  <><path d="M3 7.5h11v8.5H3zM14 10.5h4l3 3v2.5h-7z" /><circle cx="7.5" cy="17.5" r="1.8" /><circle cx="17" cy="17.5" r="1.8" /></>,
  <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.6 2.6 3.9 5.6 3.9 9s-1.3 6.4-3.9 9c-2.6-2.6-3.9-5.6-3.9-9S9.4 5.6 12 3z" /></>,
  <><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" /><circle cx="12" cy="10" r="2.4" /></>,
];

export default function ShippingPolicy() {
  usePageMeta({
    title: 'Shipping Policy',
    description: `Shipping, delivery and tracking information for orders placed with ${N}.`,
    path: '/shipping-policy',
  });

  // Key facts: a flat row of bordered boxes between the title bar and the policy text.
  const summary = (
    <div className="ship-summary">
      {SUMMARY.map(({ label, value }, i) => (
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
    <LegalLayout
      crumb="Shipping Policy"
      title="Shipping Policy"
      subtitle="Delivery timelines, charges and tracking for your orders."
      updated="Last updated: June 2026"
      toc={TOC}
      lead={summary}
    >
      {SECTIONS.map(({ title, body }) => (
        <LegalSection key={title} id={slug(title)} title={title}>
          <p>{body}</p>
        </LegalSection>
      ))}
      <LegalCallout tone="mint" icon="phone">
        <p>Questions about a shipment? Call or WhatsApp {COMPANY.phoneDisplay}, or email {COMPANY.email}.</p>
      </LegalCallout>
    </LegalLayout>
  );
}

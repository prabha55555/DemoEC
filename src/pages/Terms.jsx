import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useBrand } from '../context/BrandContext';
import { COMPANY } from '../config/company';
import { returnWindowDays } from '../utils/storeCopy';
import { usePageMeta } from '../utils/usePageMeta';
import { LegalLayout, LegalSection, LegalCallout } from '../components/LegalLayout';

const N = COMPANY.name;
const link = { color: 'var(--primary)', fontWeight: 500 };

// Terms of use and sale. Generic by design; the parts that depend on store settings (Cash on Delivery, the return
// window, gift card validity) are read from them so the terms never contradict what the checkout does.
export default function Terms() {
  const { brand } = useBrand();
  usePageMeta({
    title: 'Terms & Conditions',
    description: `Terms and conditions for using the ${N} website and placing orders: pricing, orders, payments, delivery, returns and more.`,
    path: '/terms',
  });

  const days = returnWindowDays(null, brand);
  const hasCod = !!brand.cod_enabled;
  const giftMonths = Number(brand.gift_card_validity_months) || 0;
  const seller = brand.seller_legal_name || N;
  const email = brand.support_email || COMPANY.email;
  const phone = brand.support_phone || COMPANY.phoneDisplay;

  const sections = useMemo(() => [
    {
      id: 'about', title: '1. About these terms',
      body: [
        `These terms apply to your use of the ${N} website and to every order you place through it. The store is operated by ${seller}, ${COMPANY.addressOneLine}.`,
        'By browsing the site, creating an account or placing an order you agree to these terms, our Shipping policy, our Returns & refunds policy and our Privacy policy. If you do not agree, please do not use the site.',
      ],
    },
    {
      id: 'account', title: '2. Your account',
      body: 'You may need an account to place orders, track them and manage returns. Give accurate details and keep your sign-in details private; you are responsible for activity on your account. We may suspend or close accounts that are used for fraud, abuse or anything unlawful.',
    },
    {
      id: 'products', title: '3. Products and pricing',
      body: [
        'We take care to describe products accurately, but photographs, colours and packaging can differ slightly from the item you receive. Specifications are supplied by brands and suppliers, and we update them when we are told of an error.',
        'All prices are in Indian Rupees (INR) and include GST. Delivery fees, where they apply, are shown separately at checkout before you pay. Prices, discounts and availability can change without notice, but the price shown when you place your order is the price you pay.',
        'If a product is listed at a clearly wrong price, we may cancel the order and refund you in full.',
      ],
    },
    {
      id: 'orders', title: '4. Orders and cancellation',
      body: [
        'Placing an order is an offer to buy. It is confirmed when payment succeeds (or, for Cash on Delivery, when we accept the order) and we send you a confirmation. We may refuse or cancel an order if an item is out of stock, a price is wrong, we cannot deliver to your address or we suspect fraud. You are refunded in full for anything you have already paid.',
        'You can cancel an order yourself from Account → Orders until it is dispatched. After dispatch, see our Returns & refunds policy.',
      ],
    },
    {
      id: 'payments', title: '5. Payments',
      body: [
        `You can pay online by UPI, debit or credit card or net banking${hasCod ? ', or choose Cash on Delivery on eligible orders' : ''}. Online payments are processed securely by our payment partner; we do not store your card details.`,
        ...(hasCod ? ['Cash on Delivery may carry a handling fee and is not available for every order or product. Any fee is shown at checkout.'] : []),
        'Coupons and gift cards are applied at checkout subject to their own conditions, such as a minimum order value or an expiry date. Coupons have no cash value and cannot be combined unless stated.',
        ...(giftMonths > 0 ? [`Gift cards are valid for ${giftMonths} months from the date of purchase.`] : []),
      ],
    },
    {
      id: 'shipping', title: '6. Shipping and delivery',
      body: 'We deliver within India. Delivery charges, estimated delivery times, tracking and delivery attempts are explained in our Shipping policy. Estimated dates are not guarantees. Ownership and risk in the goods pass to you when they are delivered to you.',
      link: { to: '/shipping-policy', label: 'Read the Shipping policy' },
    },
    {
      id: 'returns', title: '7. Returns, refunds and replacements',
      body: days > 0
        ? `Most items can be returned within ${days} days of delivery, if they are unused and in their original condition. Items that arrive damaged, defective or wrong can always be returned for a replacement or refund. Some products are non-returnable, which is shown on their product page. Refunds are made to the original payment method.`
        : 'Most items cannot be returned once delivered, but items that arrive damaged, defective or wrong can be returned for a replacement or refund. Refunds are made to the original payment method.',
      link: { to: '/returns-policy', label: 'Read the Returns & refunds policy' },
    },
    {
      id: 'reviews', title: '8. Reviews and your content',
      body: 'Customers who have received a product can post a review. Reviews must be honest, relevant and lawful, and may be edited or removed if they are not. By posting you allow us to display your review on the site. Do not post anything abusive, misleading or that infringes anyone else’s rights.',
    },
    {
      id: 'ip', title: '9. Our content and intellectual property',
      body: [
        `The ${N} name and logo, the design of the site, and the photographs, descriptions and other content we create are protected by copyright, trademark and other laws. Product names and brands belong to their owners.`,
        'You may use the site and its content for your own personal, non-commercial use, including researching a purchase. You may not copy, scrape, re-publish or use our content commercially without our written permission.',
      ],
    },
    {
      id: 'use', title: '10. Acceptable use',
      items: [
        'Do not use the site for anything unlawful, or to harm or interfere with it or other users',
        'Do not attempt to gain unauthorised access to accounts, systems or data',
        'Do not use automated tools to collect content or place orders, or abuse offers, coupons or returns',
        'Do not provide false information or impersonate anyone',
      ],
    },
    {
      id: 'liability', title: '11. Limitation of liability',
      body: 'To the extent the law allows, we are not liable for indirect or consequential loss arising from your use of the site or products, or for delays and failures caused by events beyond our control, such as courier disruptions, weather or network outages. Our total liability for any order is limited to the amount you paid for it. Nothing in these terms limits your rights under Indian consumer protection law.',
    },
    {
      id: 'law', title: '12. Governing law',
      body: 'These terms are governed by the laws of India. Disputes are subject to the courts at Tiruppur, Tamil Nadu, without affecting any right you have to approach a consumer forum.',
    },
    {
      id: 'changes', title: '13. Changes to these terms',
      body: 'We may update these terms from time to time. The date at the top shows when they last changed, and orders are covered by the terms in force when they were placed.',
    },
    {
      id: 'contact', title: '14. Contact us',
      body: `Questions about these terms? Call ${phone} or write to ${email}.`,
    },
  ], [days, hasCod, giftMonths, seller, email, phone]);

  const toc = useMemo(() => sections.map(({ id, title }) => ({ id: `terms-${id}`, title })), [sections]);

  return (
    <LegalLayout crumb="Terms & Conditions" title="Terms & Conditions" subtitle="The terms for using our website and placing orders." updated="Last updated: October 2026" toc={toc}>
      <LegalCallout tone="mint" icon="info" title="In short">
        <p>Prices include GST. {days > 0 ? `Most items can be returned within ${days} days. ` : ''}You can cancel an order until it is dispatched. Details are in our <Link to="/shipping-policy" style={link}>Shipping policy</Link> and <Link to="/returns-policy" style={link}>Returns &amp; refunds policy</Link>.</p>
      </LegalCallout>

      {sections.map(({ id, title, body, items, link: l }) => (
        <LegalSection key={id} id={`terms-${id}`} title={title}>
          {body && (Array.isArray(body) ? body : [body]).map((p, i) => <p key={i}>{p}</p>)}
          {items && <ul className="lg-list">{items.map((it, i) => <li key={i}>{it}</li>)}</ul>}
          {l && <p><Link to={l.to} style={link}>{l.label} &rsaquo;</Link></p>}
        </LegalSection>
      ))}
    </LegalLayout>
  );
}

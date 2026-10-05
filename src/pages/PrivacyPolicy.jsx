import React from 'react';
import { COMPANY } from '../config/company';
import { usePageMeta } from '../utils/usePageMeta';
import { LegalLayout, LegalSection, LegalCallout } from '../components/LegalLayout';

const N = COMPANY.name;

const SECTIONS = [
  { title: '1. Data We Collect', body: 'We collect name, email address, phone number, delivery address, and payment information when you place an order or create an account. We also collect browsing data such as pages visited and time spent, to improve our website experience.' },
  { title: '2. How We Use Your Data', body: 'Your data is used to process orders, communicate order status, send relevant updates about new arrivals or offers (only if you opt in), and improve our website. We do not sell or share your personal data with third parties for marketing purposes.' },
  { title: '3. Data Storage & Security', body: 'Your data is stored securely on Supabase servers hosted in the South Asia (Mumbai) region. We use industry-standard encryption and access controls. Payment data is processed by Razorpay and is never stored on our servers.' },
  { title: '4. Cookies', body: 'We use essential cookies to keep you logged in and maintain your cart. We do not use advertising or tracking cookies. You can disable cookies in your browser settings, though some features may not function correctly.' },
  { title: '5. Your Rights', body: `You have the right to access, correct, or delete your personal data at any time. To make a request, contact us on WhatsApp or email (${COMPANY.email}). We will respond within 7 business days.` },
  { title: '6. Third-Party Services', body: 'We may use trusted third-party service providers for essential functions such as payment processing, data storage, image hosting, and website hosting. Only the minimum information necessary to provide these services is shared. These providers are responsible for handling your information in accordance with their own privacy policies.' },
  { title: "7. Children's Privacy", body: 'Our website is not directed at children under 18. We do not knowingly collect data from minors. If you believe we have inadvertently collected such data, please contact us immediately.' },
  { title: '8. Changes to This Policy', body: 'We may update this policy periodically. Changes will be posted on this page with an updated date. Continued use of the website after changes constitutes acceptance of the updated policy.' },
  { title: '9. Contact', body: `For privacy-related queries, contact us on WhatsApp at ${COMPANY.phoneDisplay} or by email at ${COMPANY.email}. We take all privacy concerns seriously and will respond within 3 business days.` },
];

const slug = (t) => 'privacy-' + t.split('.')[0];
const TOC = SECTIONS.map(({ title }) => ({ id: slug(title), title }));

export default function PrivacyPolicy() {
  usePageMeta({
    title: 'Privacy Policy',
    description: `How ${N} collects, uses and protects your personal information.`,
    path: '/privacy-policy',
  });
  return (
    <LegalLayout
      crumb="Privacy Policy"
      title="Privacy Policy"
      subtitle="How we collect, use and protect your personal information."
      updated="Last updated: June 2026"
      toc={TOC}
    >
      <LegalCallout tone="mint" icon="lock">
        <p>{N} respects your privacy and is committed to protecting your personal data. This policy explains how we collect, use, and safeguard your information.</p>
      </LegalCallout>
      {SECTIONS.map(({ title, body }) => (
        <LegalSection key={title} id={slug(title)} title={title}>
          <p>{body}</p>
        </LegalSection>
      ))}
    </LegalLayout>
  );
}

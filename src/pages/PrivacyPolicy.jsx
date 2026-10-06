import React, { useMemo } from 'react';
import { useBrand } from '../context/BrandContext';
import { COMPANY } from '../config/company';
import { usePageMeta } from '../utils/usePageMeta';
import { LegalLayout, LegalSection, LegalCallout } from '../components/LegalLayout';

const N = COMPANY.name;

export default function PrivacyPolicy() {
  const { brand } = useBrand();
  usePageMeta({
    title: 'Privacy Policy',
    description: `How ${N} collects, uses and protects your personal information.`,
    path: '/privacy-policy',
  });
  const email = brand.support_email || COMPANY.email;
  const phone = brand.support_phone || COMPANY.phoneDisplay;

  const sections = useMemo(() => [
    { id: 'collect', title: '1. Information we collect', body: 'We collect your name, email address, phone number and delivery and billing addresses when you create an account or place an order, along with your order history, wishlist, returns and any reviews or messages you send us. Payment details are entered with our payment partner and are not stored by us. We also collect basic technical and browsing information, such as pages visited, to keep the site working and improve it.' },
    { id: 'use', title: '2. How we use it', body: 'We use your information to process and deliver orders, take payments and refunds, send order and delivery updates by email, SMS or WhatsApp, handle returns and support requests, prevent fraud and improve the store. We send offers and news only if you have opted in, and you can opt out at any time. We do not sell your personal information.' },
    { id: 'share', title: '3. Who we share it with', body: 'We share only what is needed with the services that help us run the store: payment processing, delivery partners (name, address and phone so the parcel reaches you), email and messaging providers, hosting and analytics. They may use your information only to provide those services. We may also disclose information where the law requires it.' },
    { id: 'storage', title: '4. Storage and security', body: 'Your data is stored with our cloud database and hosting providers using industry-standard encryption in transit and access controls. Card, UPI and net-banking details are handled by our payment partner and never reach our servers. No system is perfectly secure, so please keep your sign-in details private.' },
    { id: 'cookies', title: '5. Cookies and local storage', body: 'We use essential cookies and your browser’s local storage to keep you signed in, remember your cart and wishlist, and remember things like recent searches and recently viewed products on your device. You can clear these in your browser settings; some features may then stop working.' },
    { id: 'rights', title: '6. Your choices and rights', body: `You can view and update your details under Account, and you can ask us to access, correct or delete your personal information. To make a request, email ${email}. We will respond within 7 business days. We may need to keep some records, such as invoices, for as long as the law requires.` },
    { id: 'retention', title: '7. How long we keep it', body: 'We keep account and order information for as long as your account is open and for the period needed for tax, accounting and legal obligations. You can ask us to close your account at any time.' },
    { id: 'children', title: '8. Children', body: 'The store is not directed at children under 18, and we do not knowingly collect their data. If you believe a child has given us information, please contact us and we will remove it.' },
    { id: 'changes', title: '9. Changes to this policy', body: 'We may update this policy from time to time. The date above shows the latest version; continued use of the site means you accept the updated policy.' },
    { id: 'contact', title: '10. Contact us', body: `For privacy questions, email ${email} or call ${phone}. We will respond within 3 business days.` },
  ], [email, phone]);
  const toc = useMemo(() => sections.map(({ id, title }) => ({ id: `privacy-${id}`, title })), [sections]);

  return (
    <LegalLayout crumb="Privacy Policy" title="Privacy Policy" subtitle="How we collect, use and protect your personal information." updated="Last updated: October 2026" toc={toc}>
      <LegalCallout tone="mint" icon="lock">
        <p>{N} respects your privacy and is committed to protecting your personal data. This policy explains what we collect, why, and the choices you have.</p>
      </LegalCallout>
      {sections.map(({ id, title, body }) => (
        <LegalSection key={id} id={`privacy-${id}`} title={title}><p>{body}</p></LegalSection>
      ))}
    </LegalLayout>
  );
}

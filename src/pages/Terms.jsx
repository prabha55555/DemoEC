import React from 'react';
import { COMPANY } from '../config/company';
import { usePageMeta } from '../utils/usePageMeta';
import { LegalLayout, LegalSection, LegalCallout } from '../components/LegalLayout';

const N = COMPANY.name;

const SECTIONS = [
  {
    title: `1. About ${N}`,
    body: [
      `${N} operates this online store from Tiruppur, Tamil Nadu, offering a range of products across multiple categories.`,
      `These terms apply to your use of this website and to every order placed through it.`,
    ]
  },
  {
    title: '2. Product Information',
    body: `All products listed on our website are genuine. Descriptions of specifications, features and compatibility are provided in good faith based on information available to us from manufacturers and suppliers. ${N} does not guarantee specific results or performance unless explicitly stated. Minor variations in colour, finish, and packaging are normal and do not constitute defects.`
  },
  {
    title: '3. Pricing & Payment',
    body: `All prices are listed in Indian Rupees (INR) inclusive of applicable taxes. Prices are subject to change without prior notice. Payment is accepted via UPI, debit card, credit card, and net banking through our secure payment gateway. For enquiry-only products, pricing is shared directly via WhatsApp after reviewing your requirements and delivery location.`
  },
  {
    title: '4. Orders & Confirmation',
    body: `An order is confirmed only after successful payment and a confirmation message from ${N}. We reserve the right to cancel any order in case of pricing errors, stock discrepancy, or suspected fraudulent activity. In such cases, a full refund will be processed within 5–7 business days.`
  },
  {
    title: '5. Shipping & Delivery',
    body: `We ship worldwide, with delivery timelines varying by location and product. Fragile items are carefully packed in protective materials. Risk of loss or damage passes to the buyer upon handover to the courier. ${N} is not liable for delays caused by courier partners, natural events, or customs clearance. See our Shipping Policy page for detailed timelines.`
  },
  {
    title: '6. Availability',
    body: `All products are subject to availability. We make reasonable efforts to keep availability information updated, but an item may become unavailable before the website is updated. If an item becomes unavailable after payment, ${N} will contact you regarding the available resolution.`
  },
  {
    title: '7. Returns, Exchanges & Damaged Items',
    body: `All sales are final. ${N} does not accept returns or exchanges once an order has been delivered, except where an item is received broken or damaged during transit. Where damage is confirmed to have occurred during transit, we may offer a replacement, repair, refund, or other appropriate resolution at our discretion, subject to availability.`,
    steps: [
      'Record a continuous, unedited unboxing video showing the unopened package, the shipping label, all packaging, and the product being removed — this video is mandatory for any damage claim.',
      'Please notify us within 24–48 hours of receiving your order, along with an unboxing video and clear photos of the damage. Returns will be accepted only for damaged products.',
      'We review the evidence and get back to you with the resolution.',
    ],
    note: 'Claims without a valid, continuous unboxing video may not be accepted. This policy does not cover damage caused after delivery, misuse, improper handling, accidents, or normal wear and tear.'
  },
  {
    title: '8. Copyright & Intellectual Property',
    body: `All content and materials appearing on the ${N} website are protected by applicable copyright, trademark, and other intellectual property laws. Unless otherwise stated, the content is owned by ${N} or is used with the permission of the relevant rights holder. This includes, but is not limited to:`,
    items: [
      'Product photographs and original images',
      'Product descriptions and written content',
      'Logos, names, trademarks, and brand elements',
      'Graphics, illustrations, and artwork',
      'Website layout, visual presentation, and design',
      'Digital catalogues and other materials created for ' + N,
      'Any other original content published through our website or official digital channels',
    ],
  },
  {
    title: '9. Permitted Personal Use',
    body: `You may access, view, and use the ${N} website and its content for your own personal, non-commercial purposes, including researching or considering a purchase. Such personal use does not give you ownership of, or any intellectual property rights in, the content.`
  },
  {
    title: '10. Restrictions on Use',
    body: `Unless you have received prior written permission from ${N}, you may not:`,
    items: [
      'Copy or reproduce our photographs, product images, descriptions, or other original content',
      'Modify, edit, adapt, or create derivative works from our content',
      'Re-publish or upload our content to another website, marketplace, catalogue, or platform',
      'Use our photographs or descriptions to advertise, promote, or sell products belonging to another business',
      `Use ${N} content for commercial purposes`,
      'Distribute, sell, license, or otherwise exploit our content',
      'Remove or alter copyright, trademark, branding, or other proprietary notices',
      'Present our content, photographs, descriptions, or creative work as your own',
    ],
  },
  {
    title: '11. Product Photographs & Descriptions',
    body: `Our product photographs and descriptions are created or commissioned for the presentation of ${N} products. They may not be copied or reused for other commercial listings, social media accounts, advertisements, catalogues, marketplaces, or competing businesses without our prior written consent. Permission to view or purchase a product does not grant permission to reproduce or commercially use the photographs, descriptions, or other content associated with that product.`
  },
  {
    title: '12. Permission to Use Our Content',
    body: `If you would like to reproduce, publish, feature, or otherwise use any ${N} content for a purpose beyond personal, non-commercial use, please contact us and obtain prior written permission. Any permission granted may be subject to specific conditions, including attribution, permitted duration, permitted platforms, and the particular content that may be used.`
  },
  {
    title: '13. Enforcement of Rights',
    body: `${N} reserves the right to take appropriate action where its copyrighted material, trademarks, photographs, written content, or other intellectual property is used without authorisation. We may request the removal of unauthorised copies or uses of our content and may pursue any other remedies available to us under applicable law.`
  },
  {
    title: '14. Ownership',
    body: `Nothing on the ${N} website should be interpreted as transferring ownership or intellectual property rights to any visitor or customer. The purchase of a product from ${N} gives the customer ownership of the purchased physical product, but does not transfer ownership of our photographs, product descriptions, branding, website content, or other intellectual property associated with that product. All rights not expressly granted under this policy are reserved by ${N}.`
  },
  {
    title: '15. User Accounts',
    body: `You are responsible for maintaining the confidentiality of your account credentials. ${N} reserves the right to suspend or terminate accounts used for fraudulent, abusive, or unauthorised activity.`
  },
  {
    title: '16. Limitation of Liability',
    body: `To the maximum extent permitted by law, ${N} shall not be liable for any indirect, incidental, or consequential damages arising from the use of our products or website. Our total liability to you shall not exceed the amount paid for the specific order in question.`
  },
  {
    title: '17. Governing Law',
    body: `These terms are governed by the laws of India. Any disputes shall be subject to the exclusive jurisdiction of courts in Tiruppur, Tamil Nadu.`
  },
  {
    title: '18. Contact Us',
    body: `For any questions regarding these Terms and Conditions, including returns, damage claims, or use of our content, please reach us at ${COMPANY.phoneDisplay} (call or WhatsApp) or ${COMPANY.email}. We are happy to clarify any aspect of our policies before you make a purchase.`
  },
];

const slug = (t) => 'terms-' + t.split('.')[0];
const TOC = SECTIONS.map(({ title }) => ({ id: slug(title), title }));

export default function Terms() {
  usePageMeta({
    title: 'Terms & Conditions',
    description: `Terms and Conditions for using the ${N} website and placing orders — returns, shipping, intellectual property and more.`,
    path: '/terms',
  });
  return (
    <LegalLayout
      crumb="Terms & Conditions"
      title="Terms & Conditions"
      subtitle="The rules for using our website and placing orders."
      updated="Last updated: August 2026"
      toc={TOC}
    >
      <p style={{ margin: '0 0 18px' }}>Please read these Terms and Conditions carefully before using the {N} website. By accessing or placing an order, you agree to be bound by these terms — including our returns policy (section 7) and our copyright &amp; intellectual property policy (sections 8–14) below.</p>

      {/* HIGHLIGHT BOX — all-sales-final / mandatory-unboxing-video policy */}
      <LegalCallout tone="sun" icon="shield" title="Our return promise">
        <p>All sales are final, except for products received <strong>broken or damaged in transit</strong> — reported with a mandatory continuous unboxing video. For everything else, we encourage you to speak with us directly before placing your order; we're happy to share detailed photos, videos, and product information beforehand.</p>
      </LegalCallout>

      {SECTIONS.map(({ title, body, items, steps, note }) => (
        <LegalSection key={title} id={slug(title)} title={title}>
          {body && (Array.isArray(body)
            ? body.map((p, i) => <p key={i} style={{ marginBottom: i < body.length - 1 ? 10 : 0 }}>{p}</p>)
            : <p>{body}</p>
          )}
          {items && (
            <ul className="lg-list">
              {items.map((item, i) => <li key={i}>{item}</li>)}
            </ul>
          )}
          {steps && (
            <ol className="lg-steps">
              {steps.map((step, i) => (
                <li key={i}><span>{String(i + 1).padStart(2, '0')}</span><span>{step}</span></li>
              ))}
            </ol>
          )}
          {note && <p className="lg-note">{note}</p>}
        </LegalSection>
      ))}
    </LegalLayout>
  );
}

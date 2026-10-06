import React from 'react';
import { Link } from 'react-router-dom';
import { useBrand } from '../context/BrandContext';
import { COMPANY, DEFAULT_WA_MESSAGE, whatsappLink } from '../config/company';
import { PhoneIcon, EmailIcon, WhatsAppIcon } from './SocialIcons';

// "Still need help?" -- the contact options, shown at the bottom of the Help Centre (usable on any support page).
// Phone and email come from the store settings when set, otherwise from the company details.
export default function ExpertAdviceCTA() {
  const { brand } = useBrand();
  const phone = brand.support_phone || COMPANY.phoneDisplay;
  const tel = (brand.support_phone || COMPANY.phoneTel).replace(/[^\d+]/g, '');
  const email = brand.support_email || COMPANY.email;
  const options = [
    { label: 'Call us', value: phone, href: `tel:${tel}`, Icon: PhoneIcon },
    { label: 'WhatsApp', value: 'Chat with our team', href: whatsappLink(DEFAULT_WA_MESSAGE), Icon: WhatsAppIcon, external: true },
    { label: 'Email', value: email, href: `mailto:${email}`, Icon: EmailIcon },
  ];
  return (
    <section className="bl-wrap eac-wrap" aria-labelledby="eac-h">
      <div className="eac">
        <div className="eac-copy">
          <h2 id="eac-h">Still need help?</h2>
          <p>Our team is available {COMPANY.hours.toLowerCase()}. Have your order number ready and we will sort it out quickly.</p>
        </div>
        <ul className="eac-opts">
          {options.map(({ label, value, href, Icon, external }) => (
            <li key={label}>
              <a href={href} className="eac-opt" {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}>
                <Icon width="22" height="22" aria-hidden="true" />
                <span><b>{label}</b><small>{value}</small></span>
              </a>
            </li>
          ))}
          <li><Link to="/contact" className="eac-opt"><EmailIcon width="22" height="22" aria-hidden="true" /><span><b>Contact form</b><small>Send us a message</small></span></Link></li>
        </ul>
      </div>
      <style>{`
        .bl-wrap.eac-wrap { padding-top: 8px; padding-bottom: 28px; }
        .eac { background: #fff; border: 1px solid var(--line); border-radius: 8px; padding: clamp(16px, 2.4vw, 22px) clamp(16px, 2.4vw, 24px); display: grid; gap: 14px; }
        .eac h2 { font-family: var(--font-head); font-weight: 600; font-size: clamp(17px, 2vw, 20px); line-height: 1.25; margin: 0 0 4px; }
        .eac p { font-size: 14px; color: var(--text-muted); margin: 0; max-width: 560px; line-height: 1.55; }
        .eac-opts { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: 1fr; gap: 10px; }
        @media (min-width: 560px) { .eac-opts { grid-template-columns: 1fr 1fr; } }
        @media (min-width: 1000px) { .eac-opts { grid-template-columns: repeat(4, 1fr); } }
        .eac-opt { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border: 1px solid var(--line); border-radius: 8px; color: var(--text); min-width: 0; }
        .eac-opt svg { color: var(--primary); flex-shrink: 0; }
        .eac-opt span { min-width: 0; }
        .eac-opt b { display: block; font-size: 14px; font-weight: 600; }
        .eac-opt small { display: block; font-size: 12.5px; color: var(--text-muted); overflow-wrap: anywhere; }
        @media (hover: hover) and (pointer: fine) { .eac-opt:hover { border-color: var(--primary); } }
      `}</style>
    </section>
  );
}

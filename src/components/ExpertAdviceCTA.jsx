import React from 'react';
import { useAuth } from '../context/AuthContext';
import { recordWhatsAppEnquiry } from '../utils/enquiryBeacon';
import { COMPANY, DEFAULT_WA_MESSAGE, whatsappLink } from '../config/company';
import { WhatsAppIcon } from './SocialIcons';

// Shared "Need help choosing?" WhatsApp callout -- a flat yellow-tint strip (`.bl-cta sun`)
// shown on the Help Centre page (and usable above the Footer on any page).
export default function ExpertAdviceCTA() {
  const { currentUser } = useAuth();
  return (
    <section className="bl-wrap eac-wrap">
      <div className="bl-cta sun eac">
        <div className="eac-copy">
          <h2>Need help choosing?</h2>
          <p>
            Not sure which product is right for you? Message our team at {COMPANY.name} and we will help you choose. We are available {COMPANY.hours.toLowerCase()}.
          </p>
        </div>
        <a href={whatsappLink(DEFAULT_WA_MESSAGE)} target="_blank" rel="noreferrer" onClick={() => recordWhatsAppEnquiry(currentUser, 'Expert advice CTA')} className="btn btn-dark eac-btn">
          <WhatsAppIcon width="18" height="18" aria-hidden="true" style={{ color: '#25D366' }} /> Ask on WhatsApp
        </a>
      </div>
      <style>{`
        .bl-wrap.eac-wrap { padding-top: 8px; padding-bottom: 28px; }
        .bl-cta.eac { flex-direction: column; align-items: flex-start; gap: 12px; padding: clamp(16px, 2.4vw, 22px) clamp(16px, 2.4vw, 24px); }
        .eac-copy { position: relative; z-index: 1; min-width: 0; }
        .bl-cta.eac h2 { font-family: var(--font-head); font-weight: 600; font-size: clamp(17px, 2vw, 20px); line-height: 1.25; margin: 0 0 4px; }
        .bl-cta.eac p { font-size: 14px; line-height: 1.55; max-width: 640px; margin: 0; opacity: 1; }
        .eac-btn { align-self: stretch; }
        @media (min-width: 720px) {
          .bl-cta.eac { flex-direction: row; align-items: center; justify-content: space-between; gap: 24px; }
          .eac-copy { flex: 1; }
          .eac-btn { align-self: center; flex-shrink: 0; }
        }
      `}</style>
    </section>
  );
}

import React from 'react';
import { WhatsAppIcon } from './SocialIcons';
import { useAuth } from '../context/AuthContext';
import { recordWhatsAppEnquiry } from '../utils/enquiryBeacon';
import { whatsappLink, DEFAULT_WA_MESSAGE } from '../config/company';

// Bottom-left, not bottom-right -- react-hot-toast's toasts already live bottom-right
// (see App.jsx's <Toaster position="bottom-right" />), and this button is permanent
// while toasts are transient, so it's the button that should stay out of the way.
// On mobile it floats above the fixed bottom tab bar.
export default function FloatingWhatsApp() {
  const { currentUser } = useAuth();
  return (
    <>
      <a
        href={whatsappLink(DEFAULT_WA_MESSAGE)}
        target="_blank"
        rel="noreferrer"
        onClick={() => recordWhatsAppEnquiry(currentUser, 'Floating WhatsApp button')}
        aria-label="Chat with us on WhatsApp"
        title="Chat with us on WhatsApp"
        className="floating-wa-btn"
      >
        <WhatsAppIcon width={26} height={26} style={{ flexShrink: 0 }} />
        <span className="floating-wa-label">Chat with us</span>
      </a>
      <style>{`
        .floating-wa-btn {
          position: fixed; left: clamp(14px,3vw,26px); bottom: clamp(14px,3vw,26px); z-index: 400;
          height: 52px; padding: 0 20px 0 14px; border-radius: 100px; background: #25D366; color: #fff;
          display: flex; align-items: center; gap: 10px; text-decoration: none;
          box-shadow: 0 6px 18px rgba(20,17,11,.28); transition: transform .2s, box-shadow .2s;
        }
        .floating-wa-label { font-weight: 600; font-size: 14px; white-space: nowrap; }
        @media (hover: hover) and (pointer: fine) {
          .floating-wa-btn:hover { transform: scale(1.06); box-shadow: 0 8px 24px rgba(20,17,11,.36); }
        }
        @media (max-width: 899px) {
          .floating-wa-btn { left: auto; right: 14px; bottom: calc(var(--bottom-nav-h) + 14px + env(safe-area-inset-bottom, 0px)); width: 50px; height: 50px; padding: 0; justify-content: center; }
          .floating-wa-label { display: none; }
        }
      `}</style>
    </>
  );
}

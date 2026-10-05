import React from 'react';

// Clean, minimal single-path glyphs (social + contact) — sized via the wrapping <svg>'s width/height.
// The social glyphs are generic platform logos; none of them is tied to a particular account.
export function FacebookIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M22 12.06C22 6.5 17.52 2 12 2S2 6.5 2 12.06c0 5.02 3.66 9.18 8.44 9.94v-7.03H7.9v-2.91h2.54V9.85c0-2.51 1.49-3.9 3.77-3.9 1.09 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.77-1.63 1.56v1.88h2.78l-.44 2.91h-2.34V22c4.78-.76 8.44-4.92 8.44-9.94z" />
    </svg>
  );
}

export function InstagramIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...props}>
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4.2" />
      <circle cx="17.4" cy="6.6" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function PinterestIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M12 2C6.48 2 2 6.48 2 12c0 4.24 2.64 7.86 6.35 9.31-.09-.79-.17-2.01.03-2.87.19-.79 1.22-5.03 1.22-5.03s-.31-.62-.31-1.53c0-1.44.83-2.51 1.87-2.51.88 0 1.31.66 1.31 1.45 0 .88-.56 2.21-.85 3.44-.24 1.02.51 1.86 1.52 1.86 1.82 0 3.05-2.34 3.05-5.11 0-2.11-1.42-3.68-4-3.68-2.91 0-4.73 2.17-4.73 4.6 0 .84.25 1.43.63 1.89.18.21.2.3.14.54-.05.18-.16.65-.21.83-.07.27-.28.36-.52.26-1.44-.59-2.11-2.17-2.11-3.94 0-2.93 2.47-6.44 7.36-6.44 3.93 0 6.52 2.85 6.52 5.9 0 4.04-2.24 7.06-5.53 7.06-1.11 0-2.15-.6-2.51-1.28 0 0-.6 2.37-.73 2.83-.22.79-.66 1.58-1.06 2.2.95.28 1.94.43 2.98.43 5.52 0 10-4.48 10-10S17.52 2 12 2z" />
    </svg>
  );
}

export function TwitterXIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M18.24 2.75h3.09l-6.75 7.72 7.94 10.78h-6.22l-4.87-6.37-5.57 6.37H2.77l7.22-8.25L2.37 2.75h6.38l4.4 5.82zm-1.08 16.6h1.71L7.03 4.53H5.19z" />
    </svg>
  );
}

export function WhatsAppIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.39 1.26 4.81L2 22l5.42-1.34c1.37.75 2.94 1.18 4.62 1.18 5.46 0 9.91-4.45 9.91-9.91S17.5 2 12.04 2zm0 18.06c-1.48 0-2.87-.4-4.06-1.1l-.29-.17-3.21.79.81-3.13-.19-.32a8.14 8.14 0 0 1-1.24-4.32c0-4.5 3.67-8.17 8.19-8.17 4.51 0 8.18 3.67 8.18 8.17 0 4.51-3.67 8.25-8.19 8.25zm4.48-6.13c-.24-.12-1.45-.72-1.68-.8-.23-.08-.39-.12-.56.12-.16.24-.64.8-.78.96-.14.16-.29.18-.53.06-.24-.12-1.02-.38-1.94-1.2-.72-.64-1.2-1.43-1.35-1.67-.14-.24-.02-.37.11-.49.11-.11.24-.29.36-.43.12-.14.16-.24.24-.4.08-.16.04-.3-.02-.42-.06-.12-.56-1.36-.77-1.86-.2-.49-.41-.42-.56-.43-.14-.01-.31-.01-.47-.01-.16 0-.43.06-.65.3-.22.24-.86.84-.86 2.05s.88 2.38 1 2.54c.12.16 1.73 2.65 4.2 3.71.59.25 1.05.4 1.4.52.59.19 1.13.16 1.55.1.47-.07 1.45-.59 1.66-1.16.2-.57.2-1.06.14-1.16-.06-.1-.22-.16-.46-.28z" />
    </svg>
  );
}

export function EmailIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...props}>
      <rect x="2.5" y="4.5" width="19" height="15" rx="2.5" />
      <path d="M3.5 6l8.5 7 8.5-7" />
    </svg>
  );
}

export function PhoneIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M5 4h3.5l1.8 4.6-2.3 1.5a11 11 0 0 0 5.4 5.4l1.5-2.3L20 15.5V19a1.5 1.5 0 0 1-1.6 1.5C10.6 20 4 13.4 3.5 5.6A1.5 1.5 0 0 1 5 4z" />
    </svg>
  );
}

export function PinIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" />
      <circle cx="12" cy="10" r="2.4" />
    </svg>
  );
}

export function ClockIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.2 2" />
    </svg>
  );
}

export function GlobeIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.6 2.6 3.9 5.6 3.9 9s-1.3 6.4-3.9 9c-2.6-2.6-3.9-5.6-3.9-9S9.4 5.6 12 3z" />
    </svg>
  );
}

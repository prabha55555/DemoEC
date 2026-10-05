// Shared "record this WhatsApp enquiry so it shows up in Admin" helper for every WhatsApp button on
// the site that ISN'T the product page (which has its own richer version of this exact logic, tied to
// a specific product/reason/size -- see ProductPage.jsx's handleEnquire). This is the general-purpose
// version for buttons with no associated product: the floating site-wide bubble, the Help
// "Ask on WhatsApp" CTAs, and the Contact page's standalone WhatsApp link.
//
// Same delivery guarantee as ProductPage.jsx: navigator.sendBeacon() first (survives the page
// backgrounding that happens the instant window.open() switches to the WhatsApp app on a phone),
// falling back to a keepalive fetch only if sendBeacon itself is unavailable or refuses the request.
import { supabase } from '../supabase';

function beaconOrFetch(payload) {
  const json = JSON.stringify(payload);
  if (navigator.sendBeacon && navigator.sendBeacon('/api/send-enquiry-whatsapp', new Blob([json], { type: 'application/json' }))) {
    return;
  }
  fetch('/api/send-enquiry-whatsapp', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: json }).catch(() => {});
}

// `payload` is either `{ source }` -- a short fixed label identifying which button was clicked (e.g.
// "Floating WhatsApp button"), always a literal string from the calling component, never user input --
// for a button with no associated product, or `{ productId, reason, size }` for one that does (e.g.
// ProductCard.jsx's grid-card "Enquire" button on an enquiry-only product), matching the shape
// ProductPage.jsx's own handleEnquire sends. `currentUser` is whatever useAuth().currentUser already
// gives the caller. A bare string is also accepted for `payload` and treated as `{ source: payload }`,
// so existing call sites that pass a plain label keep working.
export function recordWhatsAppEnquiry(currentUser, payload) {
  const body = typeof payload === 'string' ? { source: payload } : payload;
  if (!currentUser) { beaconOrFetch(body); return; }
  supabase.auth.getSession()
    .then(({ data }) => {
      const token = data?.session?.access_token;
      beaconOrFetch(token ? { ...body, accessToken: token } : body);
    })
    .catch(() => beaconOrFetch(body));
}

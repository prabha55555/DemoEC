// SERVER-ONLY. Sends a WhatsApp message built from an admin-editable
// whatsapp_templates row, via the existing `send-whatsapp` Supabase Edge
// Function (source confirmed directly by the user; never modified or
// reimplemented here). One shared function for both the automatic
// ORDER_CONFIRMED send (src/utils/sendWhatsAppConfirmation.js) and the
// manual "Set & Notify" send (api/send-order-whatsapp.js), so the two paths
// can never render a message differently.
import { withTimeout } from './withTimeout.js';
import { interpolate } from './emailBlocks.js';
import { resolveWhatsAppVariables } from './whatsappVariables.js';

const SEND_TIMEOUT_MS = 10000;

// orders.user_phone is validated at checkout as a bare 10-digit Indian
// mobile number (see src/pages/Checkout.jsx's phone regex) -- no country
// code stored. WhatsApp delivery needs the full international number --
// same "91" prefix convention this codebase's own outbound WhatsApp number
// already uses everywhere else (wa.me/917845081278).
export function formatIndianWhatsAppNumber(rawPhone) {
  const last10 = String(rawPhone || '').replace(/\D/g, '').slice(-10);
  return last10.length === 10 ? `91${last10}` : null;
}

// Never throws -- always resolves to { ok, error? }, matching
// sendTemplateEmail.js's own contract. Callers decide what "failed" means
// for their situation (silently logged for the automatic send, surfaced as
// a toast for the manual one).
//
// mediaUrl (optional): a real, direct image URL (not the product-share.js
// wrapper page -- WAClient's media endpoint fetches this itself server-side
// and needs the actual image resource, not an HTML redirect page). Callers
// resolve this themselves (see sendWhatsAppConfirmation.js /
// api/send-order-whatsapp.js) since it requires a `products` lookup this
// pure function doesn't have a DB client for. When present, the {{photo_url}}
// token is stripped from the visible caption instead of interpolated --
// once a real photo is attached, showing its wrapper link as text too would
// be redundant.
export async function sendWhatsAppTemplate({ template, order, mediaUrl }) {
  const number = formatIndianWhatsAppNumber(order?.user_phone);
  if (!number) {
    return { ok: false, error: 'This order has no usable phone number.' };
  }

  const variables = resolveWhatsAppVariables(order);
  const messageSource = mediaUrl
    ? template.message.replace(/\n?\{\{\s*photo_url\s*\}\}\n?/gi, '\n').trim()
    : template.message;
  const message = interpolate(messageSource, variables);

  const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
  const anonKey = process.env.REACT_APP_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    return { ok: false, error: 'Supabase is not configured.' };
  }

  try {
    const res = await withTimeout(fetch(`${supabaseUrl}/functions/v1/send-whatsapp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Supabase's Edge Function gateway requires a valid bearer token
        // before it will even route to the function -- the anon key is the
        // correct credential here, same as every other server-to-Supabase
        // call in this codebase, never a service-role key.
        'Authorization': `Bearer ${anonKey}`,
        'apikey': anonKey,
      },
      // send-whatsapp decides text vs. media based on whether media_url is
      // present in this body -- see the updated Edge Function source.
      body: JSON.stringify({ number, message, ...(mediaUrl ? { media_url: mediaUrl } : {}) }),
    }), SEND_TIMEOUT_MS);

    let data = null;
    try { data = await res.json(); } catch { /* gateway-level rejection may not return the function's own JSON shape */ }

    if (!res.ok || !data?.success) {
      return { ok: false, error: data?.error || `send-whatsapp did not report success (HTTP ${res.status}).` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message || 'Could not reach send-whatsapp.' };
  }
}

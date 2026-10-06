// SERVER-ONLY. Records EVERY enquiry the site can generate -- every WhatsApp button (product-specific,
// via src/pages/ProductPage.jsx's "Enquire on WhatsApp", AND the general site-wide ones with no
// associated product: the floating bubble, the Help "Ask on WhatsApp" CTAs, the Contact page's
// standalone WhatsApp link -- see src/utils/enquiryBeacon.js) plus the Contact page's actual enquiry
// FORM (AboutContact.jsx's Contact component) -- and, for a logged-in customer with a saved phone
// number enquiring about a specific product, sends the automatic PRODUCT_ENQUIRY_RECEIVED WhatsApp
// acknowledgement -- all in one request.
//
// P0 fix: this used to be ack-sending only, reached AFTER the browser itself inserted the enquiry row
// directly into Supabase with the anon key, fire-and-forget, with any failure only ever logged to the
// browser console -- a customer (or a guest, whose insert additionally depends on the `enquiries` table's
// own RLS allowing an anonymous write) had no way to know their enquiry was never actually saved, and
// Admin would just silently never show it. The insert now happens HERE, with the service-role client, so
// it works identically for a guest or a signed-in customer and can never be silently dropped by an RLS
// gap -- and a real failure is finally something the browser can show the customer, instead of vanishing
// into a console only a developer would ever open. The Contact FORM had the same RLS dependency (though
// it did at least surface a toast on failure) and is now routed through this same service-role write for
// the same guest-reliability guarantee.
//
// The actual WhatsApp message to the business (the wa.me redirect) is still a customer-initiated
// browser action, not a server send -- see ProductPage.jsx's own handleEnquire for that half. This
// endpoint only ever writes to OUR OWN `enquiries` table and, conditionally, sends the acknowledgement.
//
// Reuses the exact same infrastructure as every other WhatsApp send in this codebase -- the
// whatsapp_templates table, sendWhatsAppTemplate.js (which itself calls the existing send-whatsapp
// Supabase Edge Function / WAClient integration), and the same Indian-number formatting already used
// there. No new WhatsApp integration of any kind.
//
// Abuse model: the recipient phone is the caller's own profiles.phone, which the customer types
// themselves and which is NOT verified (no OTP), so this endpoint must not become a way to make the
// business number message a third party. Three things bound that: (1) the only customer-influenced text
// in the acknowledgement is the product name, and it is resolved from the `products` table by id, never
// taken from client-supplied text; (2) per-user and per-phone rate limits on the acknowledgement send;
// (3) a per-IP rate limit on creating enquiries at all, since this is now a public write endpoint.
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../src/utils/supabaseAdmin.js';
import { sendWhatsAppTemplate, formatIndianWhatsAppNumber } from '../src/utils/sendWhatsAppTemplate.js';
import { isRateLimited, clientIp } from '../src/utils/rateLimit.js';

// Anon-key client used ONLY to verify the caller's own bearer token, when one is sent -- mirrors the
// identity-binding pattern already used in api/razorpay-verify-payment.js / api/verify-free-order.js.
// Never used for any privileged read/write; those go through supabaseAdmin below.
const supabaseAuth = createClient(process.env.REACT_APP_SUPABASE_URL, process.env.REACT_APP_SUPABASE_ANON_KEY);

// Same ceiling as the other send endpoints (api/send-order-email.js etc.): the 10s gateway timeout
// inside sendWhatsAppTemplate plus several DB round trips must not be cut off by the platform default.
export const config = { maxDuration: 20 };

const PRODUCT_NAME_MAX = 80;
const MAX_ACKS_PER_USER_PER_HOUR = 5;
const USER_WINDOW_MS = 60 * 60 * 1000;
// One ack per phone per window, counted across every account that saved the same number -- an attacker
// can make many accounts, but not many victims' worth of messages to one number.
const PHONE_WINDOW_MS = 10 * 60 * 1000;
// 'question' is a plain product question; 'priceOnEnquiry' is the old name for it (kept so an older bundle still works).
const REASONS = { soldOut: 'soldOut', question: 'question', priceOnEnquiry: 'question', inStock: 'inStock' };
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

function text(value, max) {
  if (typeof value !== 'string') return '';
  return value.replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

// The name is resolved from `products` (admin-authored) so this is defense in depth: anything link-shaped
// or multi-line is dropped so the acknowledgement can't carry a clickable URL or fake extra lines, and the
// length is capped.
function cleanProductName(name) {
  // \x escapes cover the C0 controls + DEL + NEL (all <= 0xFF); the Unicode line/paragraph separators
  // (0x2028/0x2029) are built via fromCharCode with decimal code points rather than \u escapes -- see the
  // identical note on src/utils/sendTemplateEmail.js's stripControlChars for why.
  const lineSep = String.fromCharCode(8232, 8233);
  // eslint-disable-next-line no-control-regex
  const controlCharsRe = new RegExp('[\\x00-\\x1F\\x7F\\x85' + lineSep + ']+', 'g');
  return String(name ?? '')
    .replace(/(?:https?:\/\/|www\.)\S+/gi, ' ')
    .replace(controlCharsRe, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, PRODUCT_NAME_MAX);
}

function enquiryMessageFor(reason, productName, size) {
  const sizeNote = size ? ` (Option: ${size})` : '';
  if (reason === 'soldOut') return 'Asked about an out-of-stock product via WhatsApp.';
  const bodies = {
    question: `Hi,\nI have a question about "${productName}"${sizeNote}.\nCould you please help me?`,
    inStock: `Hi,\nI'm interested in "${productName}"${sizeNote}.\nCould you please share the availability, price and more details about this product?`,
  };
  return bodies[reason] || bodies.inStock;
}

// Runs AFTER this request has claimed its enquiry (whatsapp_ack_sent=true), so the claim itself is
// counted: concurrent requests each see each other's claims and over-refuse rather than under-refuse.
// Throws on a DB error -- the caller treats that as "could not verify", never as "allowed".
async function isAckRateLimited(userId, last10) {
  const userSince = new Date(Date.now() - USER_WINDOW_MS).toISOString();
  const { count: userCount, error: userErr } = await supabaseAdmin
    .from('enquiries')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('whatsapp_ack_sent', true)
    .gte('created_at', userSince);
  if (userErr) throw userErr;
  if ((userCount || 0) > MAX_ACKS_PER_USER_PER_HOUR) return true;

  // profiles.phone is free text ("98765 43210", "+91-98765-43210", ...), so match the ten digits in
  // order with anything between them.
  const pattern = `%${last10.split('').join('%')}%`;
  const { data: sharers, error: sharersErr } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .ilike('phone', pattern)
    .limit(50);
  if (sharersErr) throw sharersErr;
  const ids = [...new Set([userId, ...(sharers || []).map(p => p.id)])];

  const phoneSince = new Date(Date.now() - PHONE_WINDOW_MS).toISOString();
  const { count: phoneCount, error: phoneErr } = await supabaseAdmin
    .from('enquiries')
    .select('id', { count: 'exact', head: true })
    .in('user_id', ids)
    .eq('whatsapp_ack_sent', true)
    .gte('created_at', phoneSince);
  if (phoneErr) throw phoneErr;
  return (phoneCount || 0) > 1;
}

// Best-effort acknowledgement. Never throws; a failure here never undoes the enquiry that was already
// saved, and is never surfaced as an error to the customer -- the enquiry itself is what matters.
async function sendAckIfEligible({ enquiryId, userId, phone, productName }) {
  const whatsappNumber = formatIndianWhatsAppNumber(phone);
  if (!whatsappNumber) return;
  const last10 = whatsappNumber.slice(-10);

  const { data: template, error: templateErr } = await supabaseAdmin
    .from('whatsapp_templates')
    .select('*')
    .eq('event_type', 'PRODUCT_ENQUIRY_RECEIVED')
    .eq('enabled', true)
    .maybeSingle();
  if (templateErr || !template) return;

  // Atomic claim -- only the first caller for this enquiry proceeds to actually send. A concurrent/
  // retried call finds whatsapp_ack_sent already true and safely no-ops.
  const { data: claimed, error: claimErr } = await supabaseAdmin
    .from('enquiries')
    .update({ whatsapp_ack_sent: true })
    .eq('id', enquiryId)
    .eq('whatsapp_ack_sent', false)
    .select()
    .maybeSingle();
  if (claimErr || !claimed) return;

  try {
    if (await isAckRateLimited(userId, last10)) {
      await supabaseAdmin.from('enquiries').update({ whatsapp_ack_sent: false }).eq('id', enquiryId).eq('whatsapp_ack_sent', true);
      return;
    }
    const result = await sendWhatsAppTemplate({ template, order: { user_phone: phone, product_name: productName } });
    if (!result.ok) {
      // A failed send must remain retryable, never permanently marked sent.
      await supabaseAdmin.from('enquiries').update({ whatsapp_ack_sent: false }).eq('id', enquiryId).eq('whatsapp_ack_sent', true);
      console.error('send-enquiry-whatsapp: ack send failed.', result.error, enquiryId);
    }
  } catch (err) {
    await supabaseAdmin.from('enquiries').update({ whatsapp_ack_sent: false }).eq('id', enquiryId).eq('whatsapp_ack_sent', true);
    console.error('send-enquiry-whatsapp: unexpected ack failure.', err?.message, enquiryId);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }

  // A generous per-IP budget -- this fires once per genuine enquiry click, so it only ever throttles
  // someone hammering the endpoint directly.
  if (isRateLimited(`enquiry-create:${clientIp(req)}`, { limit: 20, windowMs: 10 * 60 * 1000 })) {
    res.status(429).json({ ok: false, error: 'Too many requests. Please wait a moment and try again.' });
    return;
  }

  const body = req.body || {};

  // The Contact page's own enquiry FORM: name/email/phone/message are typed by the visitor right there
  // in the form, not resolved from any account -- that's the entire point of a contact form, unlike the
  // WhatsApp buttons below where identity must come from the token to prevent spoofing. An expired/bad
  // token here just means "don't link this to an account"; it must never block a genuine visitor's
  // enquiry the way it correctly does for the WhatsApp ack-eligible path.
  if (body.formSubmit === true) {
    const name = text(body.name, 120);
    const email = text(body.email, 200);
    const phoneField = text(body.phone, 40);
    const subject = text(body.subject, 120);
    const msg = text(body.message, 2000);
    if (!name || !email || !phoneField || !msg) {
      res.status(400).json({ ok: false, error: 'Please fill in all required fields.' });
      return;
    }
    let formUserId = null;
    const formAuthHeader = req.headers.authorization || '';
    const formBearerToken = formAuthHeader.startsWith('Bearer ') ? formAuthHeader.slice(7).trim() : (text(body.accessToken, 4096) || '');
    if (formBearerToken) {
      const { data: formAuthData } = await supabaseAuth.auth.getUser(formBearerToken);
      if (formAuthData?.user) formUserId = formAuthData.user.id;
    }
    const { error: formInsertErr } = await supabaseAdmin.from('enquiries').insert({
      user_id: formUserId,
      user_name: name,
      user_email: email,
      user_phone: phoneField,
      product: subject || 'General Enquiry',
      message: msg,
      type: 'Email',
      status: 'Received',
    });
    if (formInsertErr) {
      console.error('send-enquiry-whatsapp: contact form insert failed.', formInsertErr.message);
      res.status(500).json({ ok: false, error: 'Failed to send. Please try again.' });
      return;
    }
    res.status(200).json({ ok: true });
    return;
  }

  const productId = body.productId;
  const hasProduct = productId != null && productId !== '' && (typeof productId === 'string' || typeof productId === 'number');
  const reason = REASONS[body.reason] ? REASONS[body.reason] : 'inStock';
  // The chosen option, e.g. "M / Red" (`size` is the old field name).
  const size = text(body.variant ?? body.size, 60) || null;
  // The general (non-product) WhatsApp buttons -- floating bubble, Help CTAs, the Contact
  // page's standalone WhatsApp link -- send a short fixed `source` label instead of a productId; see
  // src/utils/enquiryBeacon.js. Every caller of that helper passes a literal string, never user input.
  const source = text(body.source, 80) || null;
  if (!hasProduct && !source) {
    res.status(400).json({ ok: false, error: 'Missing product.' });
    return;
  }

  // Identity: if a bearer token is present, it -- not anything the client claims -- decides who this
  // enquiry belongs to and whose saved phone number the acknowledgement (if any) goes to. No token at
  // all is a legitimate guest enquiry, exactly as this form has always allowed.
  //
  // The token may arrive either as the usual Authorization header, or as `accessToken` in the JSON
  // body -- ProductPage.jsx sends this via navigator.sendBeacon() for the strongest possible delivery
  // guarantee right as the browser switches away to the WhatsApp app, and sendBeacon cannot set custom
  // request headers at all, only a body. Same token either way; only the transport differs.
  let userId = null;
  let userName = 'Website Visitor';
  let userEmail = null;
  let phone = null;
  const authHeader = req.headers.authorization || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : (text(body.accessToken, 4096) || '');
  if (bearerToken) {
    const { data: authData, error: authError } = await supabaseAuth.auth.getUser(bearerToken);
    if (authError || !authData?.user) {
      res.status(401).json({ ok: false, error: 'Your session has expired. Please sign in again and retry.' });
      return;
    }
    userId = authData.user.id;
    userEmail = authData.user.email;
    const { data: profile } = await supabaseAdmin.from('profiles').select('name, phone').eq('id', userId).maybeSingle();
    if (profile?.name) userName = profile.name;
    phone = profile?.phone || null;
  }

  try {
    let productName = null;
    let message;
    if (hasProduct) {
      const { data: product, error: productErr } = await supabaseAdmin.from('products').select('name').eq('id', productId).maybeSingle();
      if (productErr) {
        console.error('send-enquiry-whatsapp: product lookup failed.', productErr.message, productId);
        res.status(500).json({ ok: false, error: 'Could not save your enquiry. Please try again.' });
        return;
      }
      productName = cleanProductName(product?.name) || 'this product';
      message = enquiryMessageFor(reason, productName, size);
    } else {
      // No specific product -- store the same fixed convention already used by the Contact form for a
      // non-product enquiry, with the `source` label kept in the message so Admin still shows which
      // button on the site was actually clicked.
      productName = 'General Enquiry';
      message = `Enquired via WhatsApp (${source}).`;
    }

    const { data: inserted, error: insertErr } = await supabaseAdmin
      .from('enquiries')
      .insert({
        user_id: userId,
        user_name: userName,
        user_email: userEmail,
        user_phone: phone,
        product: productName,
        message,
        type: 'WhatsApp',
        status: 'Received',
      })
      .select('id')
      .single();
    if (insertErr || !inserted) {
      console.error('send-enquiry-whatsapp: enquiry insert failed.', insertErr?.message);
      res.status(500).json({ ok: false, error: 'Could not save your enquiry. Please try again, or message us directly on WhatsApp.' });
      return;
    }

    // The acknowledgement template is worded around a specific product ("your enquiry about
    // {{product_name}}"), so it's only sent for product enquiries -- a general enquiry with no product
    // never triggered one before either (the old client-side insert had no ack path for it at all).
    if (hasProduct && userId && phone) {
      await sendAckIfEligible({ enquiryId: inserted.id, userId, phone, productName });
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('send-enquiry-whatsapp: unexpected failure.', err?.message);
    res.status(500).json({ ok: false, error: 'Could not save your enquiry. Please try again, or message us directly on WhatsApp.' });
  }
}

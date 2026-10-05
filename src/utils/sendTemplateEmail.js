// SERVER-ONLY. This is the one file that ever reads BREVO_API_KEY. Import it
// only from /api (Vercel serverless functions, Node runtime) -- never from a
// React component or anything else that ends up in the browser bundle. CRA
// only inlines REACT_APP_-prefixed vars into the client build, so an
// accidental import wouldn't leak the key's value (process.env.BREVO_API_KEY
// would just be undefined in the browser) -- but the discipline is to never
// let this file anywhere near client code in the first place, same as
// src/utils/orderWrite.js already does for the order-write path.
//
// Never throws: callers are either mid checkout (orderWrite.js's automatic
// ORDER_CONFIRMED) or an admin action, and a Brevo outage must never fail an
// order or block an admin from doing their job. Every path resolves to
// { ok, error? } instead.
//
// Also best-effort logs every attempt to email_sends (audit trail) with the
// service-role client, so email_sends needs no anon INSERT policy (an open
// one would let anyone holding the public anon key forge audit rows). A
// logging failure is caught and reported server-side only; it never changes
// what this function returns to its caller, and never blocks or retries the
// actual send.
import { supabaseAdmin as supabase } from './supabaseAdmin.js';
import { withTimeout } from './withTimeout.js';

const BREVO_SEND_URL = 'https://api.brevo.com/v3/smtp/email';
const SEND_TIMEOUT_MS = 10000;

const DEFAULT_SENDER_NAME = process.env.BREVO_SENDER_NAME || 'Brightlight Solutions';
const ORDER_SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL || 'orders@brightlightsolutions.in';
const SUPPORT_SENDER_EMAIL = process.env.BREVO_SUPPORT_EMAIL || 'contact@brightlightsolutions.in';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Subject/name values are interpolated from customer-typed data. A CR/LF (or
// any other control character) in a header-bound field is a header-injection
// vector for anything downstream that builds raw MIME from it, so collapse
// them to a single space before the value ever reaches the Brevo payload.
function stripControlChars(value) {
  // eslint-disable-next-line no-control-regex
  // \x escapes cover the C0 controls + DEL + NEL (all <= 0xFF); the Unicode
  // line/paragraph separators (0x2028/0x2029) are built via fromCharCode with
  // decimal code points instead of \u escapes, deliberately -- this file has
  // previously ended up with the raw separator characters themselves typed
  // literally into a regex class here, which is invalid inside a regex
  // literal (LineTerminator is disallowed there) and breaks the whole file.
  const lineSep = String.fromCharCode(8232, 8233);
  const re = new RegExp('[\\x00-\\x1F\\x7F\\x85' + lineSep + ']+', 'g');
  return String(value ?? '').replace(re, ' ').trim();
}

// Order-lifecycle events (ORDER_CONFIRMED, ORDER_SHIPPED, ...) default to the
// order@ sender; everything else (SUPPORT_REPLY, a future contact-form reply,
// ...) defaults to support@. A caller can still override with an explicit
// senderEmail/senderName -- this is only the default.
function defaultSenderFor(eventType) {
  const isOrderEvent = typeof eventType === 'string' && eventType.toUpperCase().startsWith('ORDER_');
  return { email: isOrderEvent ? ORDER_SENDER_EMAIL : SUPPORT_SENDER_EMAIL, name: DEFAULT_SENDER_NAME };
}

// Sends one transactional email via Brevo's HTTP API. Always resolves --
// never rejects/throws -- to { ok: true, messageId } or { ok: false, error }.
export async function sendTemplateEmail({
  eventType,     // e.g. 'ORDER_CONFIRMED' -- drives the default sender + is logged/tagged
  toEmail,
  toName,
  senderEmail,   // optional override; defaults per defaultSenderFor(eventType)
  senderName,
  subject,
  html,
  text,          // optional plain-text alternative
  orderId,       // optional -- DB row id, for logging/traceability only
  orderNumber,   // optional -- human-facing order number, for logging/traceability only
  attachment,    // optional -- { name, content } (base64) or { name, url }
  templateId,    // optional -- email_templates.id, logged as email_sends.template_id
  isTest = false,
  sentBy,        // optional -- e.g. admin email, for the audit log only
} = {}) {
  subject = stripControlChars(subject);
  toName = toName ? stripControlChars(toName) : toName;
  senderName = senderName ? stripControlChars(senderName) : senderName;

  // Every return path funnels through here so every attempt -- success,
  // validation failure, or Brevo rejection -- gets one best-effort audit row.
  // A logging failure is swallowed and reported only via console.error; it
  // can never change `result` or throw back into the caller.
  async function finish(result) {
    if (toEmail) {
      try {
        const { error: logError } = await supabase.from('email_sends').insert({
          template_id: templateId || null,
          event_type: eventType || null,
          order_number: orderNumber || null,
          recipient_email: toEmail,
          recipient_name: toName || null,
          subject: subject || '',
          is_test: !!isTest,
          status: result.ok ? 'sent' : 'failed',
          brevo_message_id: result.messageId || null,
          error_message: result.ok ? null : (result.error || null),
          sent_by: sentBy || null,
        });
        if (logError) console.error('sendTemplateEmail: email_sends logging failed (non-fatal).', logError.message, { eventType, orderNumber });
      } catch (logErr) {
        console.error('sendTemplateEmail: email_sends logging threw (non-fatal).', logErr?.message, { eventType, orderNumber });
      }
    }
    return result;
  }

  try {
    const apiKey = process.env.BREVO_API_KEY;
    if (!apiKey) {
      console.error('sendTemplateEmail: BREVO_API_KEY is not set -- email not sent.', { eventType, orderNumber });
      return finish({ ok: false, error: 'Email service is not configured.' });
    }
    if (!toEmail || !EMAIL_RE.test(toEmail)) {
      return finish({ ok: false, error: 'A valid recipient email is required.' });
    }
    if (!subject || !String(subject).trim()) {
      return finish({ ok: false, error: 'Subject is required.' });
    }
    if (!html || !String(html).trim()) {
      return finish({ ok: false, error: 'Email HTML content is required.' });
    }

    const sender = (senderEmail && EMAIL_RE.test(senderEmail))
      ? { email: senderEmail, name: senderName || DEFAULT_SENDER_NAME }
      : defaultSenderFor(eventType);

    const payload = {
      sender,
      to: [{ email: toEmail, name: toName || undefined }],
      subject: String(subject),
      htmlContent: String(html),
      ...(text ? { textContent: String(text) } : {}),
      // Tags surface in Brevo's own dashboard/logs -- cheap traceability back
      // to the event + order in addition to our own email_sends log.
      ...(eventType || orderNumber ? { tags: [eventType, orderNumber].filter(Boolean).map(String) } : {}),
    };

    if (attachment?.content && attachment?.name) {
      payload.attachment = [{ name: String(attachment.name), content: String(attachment.content) }];
    } else if (attachment?.url && attachment?.name) {
      payload.attachment = [{ name: String(attachment.name), url: String(attachment.url) }];
    }

    const res = await withTimeout(fetch(BREVO_SEND_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'api-key': apiKey,
      },
      body: JSON.stringify(payload),
    }), SEND_TIMEOUT_MS);

    let data = null;
    try { data = await res.json(); } catch { /* Brevo always returns a JSON body -- an unparsable one means something upstream is very wrong */ }

    if (!res.ok) {
      const message = data?.message || `Brevo responded with status ${res.status}.`;
      console.error('sendTemplateEmail: Brevo rejected the send.', { eventType, orderNumber, orderId, status: res.status, message });
      return finish({ ok: false, error: message });
    }

    return finish({ ok: true, messageId: data?.messageId || null });
  } catch (err) {
    // Covers network failures and the withTimeout race (a hung Brevo request
    // must not hang whatever called this).
    console.error('sendTemplateEmail: failed.', { eventType, orderNumber, orderId, message: err?.message });
    return finish({ ok: false, error: 'Could not send email.' });
  }
}

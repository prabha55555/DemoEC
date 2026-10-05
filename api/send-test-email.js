// Vercel serverless function -- admin-only test-send endpoint. Proves the
// Brevo integration works end-to-end without becoming a general-purpose
// email relay: the message content is fixed and non-configurable from the
// request -- only the recipient is caller-supplied. The full template editor
// (arbitrary content, real order-lifecycle events, automatic triggers) is a
// later phase; this endpoint never sends anything except this one canned
// message, and only to a caller proven to be the configured admin.
import { requireAdmin } from '../src/utils/requireAdmin.js';
import { sendTemplateEmail } from '../src/utils/sendTemplateEmail.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Both GET (diagnostic) and POST (real send) below go through the shared
// admin check (src/utils/requireAdmin.js) -- both are equally gated, not just
// the send.

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }

  try {
    const auth = await requireAdmin(req, 'send-test-email');
    if (!auth.ok) {
      res.status(auth.status).json({ ok: false, error: auth.error });
      return;
    }

    if (req.method === 'GET') {
      // Read-only diagnostic -- lets the admin confirm, from their own
      // authenticated session, which Supabase project and sender this
      // DEPLOYED function is actually configured with (Vercel's own env
      // vars, never the local .env -- a local file is never deployed).
      // Nothing returned here is a secret: the project ref and sender/admin
      // addresses are already public (visible in the site's own browser
      // bundle and in any email this function sends); brevoConfigured is a
      // boolean, never the key itself.
      const urlMatch = (process.env.REACT_APP_SUPABASE_URL || '').match(/https:\/\/([a-z0-9]+)\.supabase\.co/);
      res.status(200).json({
        ok: true,
        supabaseProjectRef: urlMatch ? urlMatch[1] : null,
        adminEmail: auth.adminEmail,
        senderEmail: process.env.BREVO_SENDER_EMAIL || 'orders@brightlightsolutions.in',
        brevoConfigured: !!process.env.BREVO_API_KEY,
      });
      return;
    }

    // ---- POST: send the fixed test email -- toEmail is the only caller-controlled field ----
    const { toEmail } = req.body || {};
    if (!toEmail || typeof toEmail !== 'string' || !EMAIL_RE.test(toEmail)) {
      res.status(400).json({ ok: false, error: 'A valid recipient email is required.' });
      return;
    }

    const subject = 'Brightlight Solutions — Brevo Test Email';
    const html = `
      <div style="font-family:Arial,Helvetica,sans-serif;color:#1F2A28;max-width:480px;margin:0 auto;padding:24px;">
        <h2 style="margin:0 0 12px;">Brightlight Solutions</h2>
        <p style="margin:0 0 12px;">This is a test email sent from the Admin dashboard to confirm the Brevo integration is working correctly.</p>
        <p style="margin:0;color:#6B6556;font-size:13px;">Sent ${new Date().toISOString()}</p>
      </div>
    `.trim();

    const result = await sendTemplateEmail({
      eventType: 'ADMIN_TEST',
      toEmail,
      subject,
      html,
      senderEmail: process.env.BREVO_SENDER_EMAIL || 'orders@brightlightsolutions.in',
      senderName: process.env.BREVO_SENDER_NAME || 'Brightlight Solutions',
      isTest: true,
      sentBy: auth.adminEmail,
    });

    if (!result.ok) {
      res.status(502).json({ ok: false, error: result.error || 'Failed to send test email.' });
      return;
    }

    res.status(200).json({ ok: true, messageId: result.messageId });
  } catch (err) {
    console.error('send-test-email failed:', err);
    res.status(500).json({ ok: false, error: 'Could not send test email. Please try again.' });
  }
}

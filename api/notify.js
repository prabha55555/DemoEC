// Vercel serverless function -- the admin-only notification sends, merged into ONE function
// (Hobby plan caps a deployment at 12; see api/lookup.js for the same pattern). Each branch is the
// former standalone endpoint, unchanged, now living in src/utils/handlers/:
//
//   ?kind=order-email      POST  { orderId, templateId }   send an order email from a saved template
//   ?kind=order-whatsapp   POST  { orderId, templateId }   send an order WhatsApp from a saved template
//   ?kind=test-email       GET   Brevo/Supabase diagnostic      POST { toEmail }  fixed test email
//
// `kind` may be given in the query string or the JSON body. Every branch is gated by requireAdmin.
import sendOrderEmail from '../src/utils/handlers/sendOrderEmail.js';
import sendOrderWhatsApp from '../src/utils/handlers/sendOrderWhatsApp.js';
import sendTestEmail from '../src/utils/handlers/sendTestEmail.js';

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  const kind = String(req.query?.kind || req.body?.kind || '');
  if (kind === 'order-email') return sendOrderEmail(req, res);
  if (kind === 'order-whatsapp') return sendOrderWhatsApp(req, res);
  if (kind === 'test-email') return sendTestEmail(req, res);
  res.status(400).json({ ok: false, error: 'Unknown notification kind.' });
}

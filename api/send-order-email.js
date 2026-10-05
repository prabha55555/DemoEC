// Vercel serverless function -- admin-only "send this order a notification
// email using a template I pick" endpoint. Wired to Admin's Orders tab
// ("Set & Notify"): the admin updates an order's stage, then explicitly
// chooses which saved email_templates row to send, rather than the system
// silently guessing one by event_type. Reuses the exact same
// render+resolve+send pipeline as the automatic ORDER_CONFIRMED email
// (src/utils/sendOrderConfirmationEmail.js) so a manually-triggered send and
// an automatic one can never drift in appearance.
import { requireAdmin } from '../src/utils/requireAdmin.js';
import { sendTemplateEmail } from '../src/utils/sendTemplateEmail.js';
import { resolveVariables } from '../src/utils/emailVariables.js';
import { renderEmailHtml, interpolate } from '../src/utils/emailBlocks.js';
import { ORDER_EMAIL_EVENT_TYPES } from '../src/utils/emailEvents.js';

export const config = { maxDuration: 20 };

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }

  try {
    const auth = await requireAdmin(req, 'send-order-email');
    if (!auth.ok) {
      res.status(auth.status).json({ ok: false, error: auth.error });
      return;
    }

    const { orderId, templateId } = req.body || {};
    if (!orderId || !templateId) {
      res.status(400).json({ ok: false, error: 'orderId and templateId are required.' });
      return;
    }

    // Token-scoped client (from requireAdmin), NOT an anon one -- `orders`
    // has no anon SELECT policy (see src/utils/orderWrite.js's own comment:
    // it never reads orders back either, only inserts). Re-fetching
    // server-side as the real authenticated admin, rather than trusting order
    // content the client might send in the request body, is what lets this
    // stay a genuine "the email says what actually happened" send.
    const adminSupabase = auth.client;

    const [{ data: order, error: orderErr }, { data: template, error: templateErr }, { data: brandRow }] = await Promise.all([
      adminSupabase.from('orders').select('*').eq('id', orderId).maybeSingle(),
      adminSupabase.from('email_templates').select('*').eq('id', templateId).maybeSingle(),
      adminSupabase.from('settings').select('logo_url, order_confirmation_hero_image, instagram_url, facebook_url, youtube_url, pinterest_url').eq('id', 'brand').maybeSingle(),
    ]);

    if (orderErr || !order) {
      res.status(404).json({ ok: false, error: 'Order not found.' });
      return;
    }
    if (templateErr || !template) {
      res.status(404).json({ ok: false, error: 'Template not found.' });
      return;
    }
    if (!template.enabled) {
      res.status(400).json({ ok: false, error: 'This template is disabled.' });
      return;
    }
    // Allowlist, not a denylist: SUPPORT_REPLY resolves against an enquiry
    // row, not an order -- picking one here would silently render every
    // {{support_*}} token as literal text. The Orders tab's picker already
    // filters to these events; this is the server-side backstop, and any
    // event added to the registry later is refused until it's opted in.
    if (!ORDER_EMAIL_EVENT_TYPES.includes(template.event_type)) {
      res.status(400).json({ ok: false, error: 'This template is not an order notification.' });
      return;
    }

    const productIds = [...new Set((order.items || []).filter(i => !i.isGiftCard).map(i => i.id))];
    const { data: products } = productIds.length
      ? await adminSupabase.from('products').select('id, images').in('id', productIds)
      : { data: [] };
    const imageByProductId = Object.fromEntries((products || []).map(p => [p.id, Array.isArray(p.images) ? p.images[0] : null]));
    const enrichedOrder = { ...order, items: (order.items || []).map(item => ({ ...item, image: imageByProductId[item.id] || null })) };

    const variables = resolveVariables(order);
    const subject = interpolate(template.subject, variables);
    const html = renderEmailHtml({ blocks: template.body_blocks, variables, order: enrichedOrder, eventType: template.event_type, brand: brandRow || {} });

    const result = await sendTemplateEmail({
      eventType: template.event_type,
      toEmail: order.user_email,
      toName: order.user_name,
      senderEmail: template.sender_email || undefined,
      senderName: template.sender_name || undefined,
      subject,
      html,
      orderNumber: order.order_id,
      templateId: template.id,
      isTest: false,
      sentBy: auth.adminEmail,
    });

    if (!result.ok) {
      res.status(502).json({ ok: false, error: result.error || 'Failed to send email.' });
      return;
    }

    res.status(200).json({ ok: true, messageId: result.messageId });
  } catch (err) {
    console.error('send-order-email failed:', err);
    res.status(500).json({ ok: false, error: 'Could not send email. Please try again.' });
  }
}

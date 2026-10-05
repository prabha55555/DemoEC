// Vercel serverless function -- admin-only "send this order a WhatsApp
// notification using a template I pick" endpoint. Wired to Admin's Orders
// tab ("Set & Notify"), right alongside the existing email template picker
// (api/send-order-email.js) -- same shape, separate button, per the admin's
// own request that these stay independent rather than combined into one.
import { requireAdmin } from '../src/utils/requireAdmin.js';
import { sendWhatsAppTemplate } from '../src/utils/sendWhatsAppTemplate.js';
import { templateWantsPhoto } from '../src/utils/whatsappVariables.js';
import { ORDER_WHATSAPP_EVENT_TYPES } from '../src/utils/whatsappEvents.js';
import { thumb } from '../src/utils/thumbnail.js';

export const config = { maxDuration: 20 };

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }

  try {
    const auth = await requireAdmin(req, 'send-order-whatsapp');
    if (!auth.ok) {
      res.status(auth.status).json({ ok: false, error: auth.error });
      return;
    }

    const { orderId, templateId } = req.body || {};
    if (!orderId || !templateId) {
      res.status(400).json({ ok: false, error: 'orderId and templateId are required.' });
      return;
    }

    // Token-scoped client from requireAdmin -- `orders` has no anon SELECT
    // policy, only admin (same reasoning as api/send-order-email.js).
    const adminSupabase = auth.client;

    const [{ data: order, error: orderErr }, { data: template, error: templateErr }] = await Promise.all([
      adminSupabase.from('orders').select('*').eq('id', orderId).maybeSingle(),
      adminSupabase.from('whatsapp_templates').select('*').eq('id', templateId).maybeSingle(),
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
    // PRODUCT_ENQUIRY_RECEIVED resolves against an enquiry, not an order --
    // sent here it would render blank order tokens to a real customer.
    if (!ORDER_WHATSAPP_EVENT_TYPES.includes(template.event_type)) {
      res.status(400).json({ ok: false, error: 'This template is not an order notification.' });
      return;
    }

    // Real, direct image URL for WAClient's media endpoint, only when the
    // chosen template actually opted in via {{photo_url}}. order.package_image_url
    // (set by the admin in the Orders tab once an order is actually packed)
    // takes priority over the product's catalog photo -- right for
    // ORDER_SHIPPED/ORDER_DELIVERED, where a photo of the real packed box
    // means more than a generic product shot. Falls back to the catalog
    // photo (src/utils/sendWhatsAppConfirmation.js's own lookup) for
    // ORDER_CONFIRMED, sent before anything's been packed yet.
    let mediaUrl;
    if (templateWantsPhoto(template.message)) {
      if (order.package_image_url) {
        mediaUrl = thumb(order.package_image_url, 800);
      } else {
        const firstItemId = order.items?.[0]?.id;
        if (firstItemId) {
          const { data: product } = await adminSupabase.from('products').select('images').eq('id', firstItemId).maybeSingle();
          const rawImage = product?.images?.[0];
          if (rawImage) mediaUrl = thumb(rawImage, 800);
        }
      }
    }

    const result = await sendWhatsAppTemplate({ template, order, mediaUrl });
    if (!result.ok) {
      res.status(502).json({ ok: false, error: result.error || 'Failed to send WhatsApp message.' });
      return;
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('send-order-whatsapp failed:', err);
    res.status(500).json({ ok: false, error: 'Could not send WhatsApp message. Please try again.' });
  }
}

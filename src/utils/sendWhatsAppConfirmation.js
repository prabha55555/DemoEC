// SERVER-ONLY. Fires the automatic ORDER_CONFIRMED WhatsApp message -- the
// only caller is api/razorpay-verify-payment.js, right after
// writeVerifiedOrder() has already succeeded. Mirrors
// sendOrderConfirmationEmail.js's own shape: best-effort, never throws,
// never delays or can fail the checkout response, and only ever sends if an
// enabled whatsapp_templates row exists for this event -- an admin can
// disable/edit the message without a code change.
import { supabaseAdmin as supabase } from './supabaseAdmin.js';
import { sendWhatsAppTemplate } from './sendWhatsAppTemplate.js';
import { templateWantsPhoto } from './whatsappVariables.js';
import { thumb } from './thumbnail.js';

export async function sendWhatsAppOrderConfirmation(order) {
  try {
    if (!order?.user_phone) {
      console.error('sendWhatsAppOrderConfirmation: order has no user_phone -- skipping.', 'order', order?.order_id);
      return;
    }

    const { data: template, error } = await supabase.from('whatsapp_templates').select('*').eq('event_type', 'ORDER_CONFIRMED').eq('enabled', true).maybeSingle();
    if (error) {
      console.error('sendWhatsAppOrderConfirmation: template lookup failed.', error.message, 'order', order?.order_id);
      return;
    }
    if (!template) {
      console.log('sendWhatsAppOrderConfirmation: no enabled ORDER_CONFIRMED whatsapp template configured -- skipping.', 'order', order?.order_id);
      return;
    }

    // Real, direct image URL for WAClient's media endpoint to fetch --
    // distinct from the {{photo_url}} token's product-share.js wrapper page
    // (that's for a plain-text link's preview; WAClient needs the actual
    // image resource). Only looked up if the template actually opted in via
    // {{photo_url}}, and the order's own item never stores an image itself
    // (see orderWrite.js) -- same one-time `products` lookup
    // sendOrderConfirmationEmail.js already does for the email.
    let mediaUrl;
    const firstItemId = order.items?.[0]?.id;
    if (templateWantsPhoto(template.message) && firstItemId) {
      const { data: product } = await supabase.from('products').select('images').eq('id', firstItemId).maybeSingle();
      const rawImage = product?.images?.[0];
      if (rawImage) mediaUrl = thumb(rawImage, 800);
    }

    const result = await sendWhatsAppTemplate({ template, order, mediaUrl });
    if (!result.ok) {
      console.error('sendWhatsAppOrderConfirmation: send failed.', result.error, 'order', order.order_id);
    }
  } catch (err) {
    console.error('sendWhatsAppOrderConfirmation: unexpected failure.', err?.message, 'order', order?.order_id);
  }
}

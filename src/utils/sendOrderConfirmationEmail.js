// SERVER-ONLY. Fires the automatic ORDER_CONFIRMED email -- the only caller
// is orderWrite.js's writeVerifiedOrder(), immediately after a real `orders`
// row has actually been written (covers both the paid and the ₹0/free path,
// since both funnel through that single function). Kept in its own file,
// deliberately NOT inlined into orderWrite.js, so the security-critical
// pricing/replay/insert logic there stays untouched and easy to review --
// this file only ever reads the already-written order and sends a best-
// effort notification about it.
//
// Never throws, never delays, never affects the order: every path here is
// wrapped so a template-lookup failure, a malformed template, or a Brevo
// outage can only ever produce a console.error, never a failed checkout.
import { supabaseAdmin as supabase } from './supabaseAdmin.js';
import { sendTemplateEmail } from './sendTemplateEmail.js';
import { resolveVariables } from './emailVariables.js';
import { renderEmailHtml, interpolate } from './emailBlocks.js';

// Duplicate protection: this function is only ever reached after orders.insert()
// succeeds inside writeVerifiedOrder(), which itself only runs once per unique
// paymentKey -- writeVerifiedOrder() claims the payment in `used_payments`
// (a unique constraint) BEFORE writing the order, so a retried verification
// request for the same payment is rejected at that claim step and never
// reaches here a second time. That existing replay guard is what actually
// prevents duplicate confirmation emails; no separate idempotency check is
// added here.
export async function sendOrderConfirmationEmail(order) {
  try {
    if (!order?.user_email) {
      console.error('sendOrderConfirmationEmail: order has no user_email -- skipping.', 'order', order?.order_id);
      return;
    }

    // Template, brand (for the email header/footer logo), and each ordered
    // item's real catalog image -- fetched together, all read-only. The order
    // itself never stores an image URL (see orderWrite.js's orderItems shape),
    // so this is the "correct way to obtain the product image" for the email:
    // a live lookup against the same `products` table the rest of the site
    // reads from, by the same product id the order line already carries.
    const productIds = [...new Set((order.items || []).filter(i => !i.isGiftCard).map(i => i.id))];
    const [{ data: template, error: templateError }, { data: brandRow }, { data: products }] = await Promise.all([
      supabase.from('email_templates').select('*').eq('event_type', 'ORDER_CONFIRMED').eq('enabled', true).eq('is_system', true).maybeSingle(),
      supabase.from('settings').select('logo_url, order_confirmation_hero_image, instagram_url, facebook_url, youtube_url, pinterest_url').eq('id', 'brand').maybeSingle(),
      productIds.length ? supabase.from('products').select('id, images').in('id', productIds) : Promise.resolve({ data: [] }),
    ]);

    if (templateError) {
      console.error('sendOrderConfirmationEmail: template lookup failed.', templateError.message, 'order', order?.order_id);
      return;
    }
    if (!template) {
      console.log('sendOrderConfirmationEmail: no enabled system ORDER_CONFIRMED template configured -- skipping.', 'order', order?.order_id);
      return;
    }

    // Never mutate the real order object -- a fresh copy with each item's
    // real first catalog image attached (undefined if the product has none
    // or the lookup failed; renderOrderSummary leaves that line's image cell
    // empty in that case, never a placeholder/fabricated URL).
    const imageByProductId = Object.fromEntries((products || []).map(p => [p.id, Array.isArray(p.images) ? p.images[0] : null]));
    const enrichedOrder = { ...order, items: (order.items || []).map(item => ({ ...item, image: imageByProductId[item.id] || null })) };

    // Real order data only -- resolveVariables() reads straight from the
    // actual written order (order_id, user_name, subtotal, items, ... --
    // see src/utils/orderWrite.js's orderData shape). Nothing here is
    // sample/placeholder data.
    const variables = resolveVariables(order);
    const subject = interpolate(template.subject, variables);
    const html = renderEmailHtml({ blocks: template.body_blocks, variables, order: enrichedOrder, eventType: 'ORDER_CONFIRMED', brand: brandRow || {} });

    const result = await sendTemplateEmail({
      eventType: 'ORDER_CONFIRMED',
      toEmail: order.user_email,
      toName: order.user_name,
      senderEmail: template.sender_email || undefined,
      senderName: template.sender_name || undefined,
      subject,
      html,
      orderNumber: order.order_id,
      templateId: template.id,
      isTest: false,
      sentBy: 'auto:order_confirmed',
    });

    if (!result.ok) {
      console.error('sendOrderConfirmationEmail: send failed.', result.error, 'order', order.order_id);
    }
  } catch (err) {
    // Belt-and-suspenders -- sendTemplateEmail() itself never throws, but the
    // template lookup/render above is new code, so this stays defensive too.
    console.error('sendOrderConfirmationEmail: unexpected failure.', err?.message, 'order', order?.order_id);
  }
}

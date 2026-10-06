// SERVER-ONLY. Sends the email and/or WhatsApp message for ONE order lifecycle event
// (shipped, out for delivery, delivered, cancelled, refund, return decision ...).
//
// It reuses the existing transports untouched -- sendTemplateEmail (Brevo) and
// sendWhatsAppTemplate (the send-whatsapp edge function) -- and the same template tables, renderer
// and variable registries the confirmation email uses, so every message is built the same way.
// Messages go out only when an ENABLED template exists for the event, so the store owner decides
// the wording and can switch any of them off in Admin.
//
// Never throws and never blocks the caller's own work: both channels run in parallel, each bounded
// by its transport's timeout, and any failure is reported in the return value + console only.
import { supabaseAdmin } from './supabaseAdmin.js';
import { sendTemplateEmail } from './sendTemplateEmail.js';
import { sendWhatsAppTemplate } from './sendWhatsAppTemplate.js';
import { resolveVariables } from './emailVariables.js';
import { renderEmailHtml, interpolate } from './emailBlocks.js';
import { templateWantsPhoto } from './whatsappVariables.js';
import { thumb } from './thumbnail.js';

const BRAND_COLUMNS = 'logo_url, order_confirmation_hero_image, instagram_url, facebook_url, youtube_url, pinterest_url';

// Old orders stored no image on their lines; look the first catalogue image up for those only.
async function withItemImages(client, order) {
  const items = Array.isArray(order.items) ? order.items : [];
  const missing = items.filter(i => !i.isGiftCard && !i.image).map(i => i.id);
  if (!missing.length) return order;
  const { data } = await client.from('products').select('id, images').in('id', [...new Set(missing)]);
  const byId = Object.fromEntries((data || []).map(p => [p.id, Array.isArray(p.images) ? p.images[0] : null]));
  return { ...order, items: items.map(i => (i.image || i.isGiftCard ? i : { ...i, image: byId[i.id] || null })) };
}

async function sendEmailFor({ client, eventType, order, sentBy }) {
  if (!order.user_email) return 'skipped:no-email';
  const { data: templates, error } = await client.from('email_templates').select('*')
    .eq('event_type', eventType).eq('enabled', true).order('is_system', { ascending: false }).order('created_at', { ascending: true }).limit(1);
  if (error) { console.error('notifyOrderEvent: email template lookup failed.', error.message, eventType); return 'failed'; }
  const template = templates?.[0];
  if (!template) return 'skipped:no-template';

  const [{ data: brandRow }, enriched] = await Promise.all([
    client.from('settings').select(BRAND_COLUMNS).eq('id', 'brand').maybeSingle(),
    withItemImages(client, order),
  ]);
  const variables = resolveVariables(order);
  const html = renderEmailHtml({ blocks: template.body_blocks, variables, order: enriched, eventType, brand: brandRow || {} });
  const result = await sendTemplateEmail({
    eventType,
    toEmail: order.user_email,
    toName: order.user_name,
    senderEmail: template.sender_email || undefined,
    senderName: template.sender_name || undefined,
    subject: interpolate(template.subject, variables),
    html,
    orderNumber: order.order_id,
    templateId: template.id,
    isTest: false,
    sentBy,
  });
  if (!result.ok) console.error('notifyOrderEvent: email send failed.', result.error, eventType, order.order_id);
  return result.ok ? 'sent' : 'failed';
}

async function sendWhatsAppFor({ client, eventType, order }) {
  if (!order.user_phone) return 'skipped:no-phone';
  const { data: template, error } = await client.from('whatsapp_templates').select('*').eq('event_type', eventType).eq('enabled', true).maybeSingle();
  if (error) { console.error('notifyOrderEvent: whatsapp template lookup failed.', error.message, eventType); return 'failed'; }
  if (!template) return 'skipped:no-template';

  let mediaUrl;
  if (templateWantsPhoto(template.message)) {
    const raw = order.package_image_url || (Array.isArray(order.items) ? order.items.find(i => i.image)?.image : null);
    if (raw) mediaUrl = thumb(raw, 800);
  }
  const result = await sendWhatsAppTemplate({ template, order, mediaUrl });
  if (!result.ok) console.error('notifyOrderEvent: whatsapp send failed.', result.error, eventType, order.order_id);
  return result.ok ? 'sent' : 'failed';
}

// extra: event-specific facts that are not order columns, e.g.
//   { cancelReason, refundAmount, refundId, returnId, returnReason, returnNote }
// channels: { email, whatsapp } -- both on by default.
export async function notifyOrderEvent({ eventType, order, extra = {}, sentBy = 'system', channels = {}, client = supabaseAdmin }) {
  const result = { email: 'skipped', whatsapp: 'skipped' };
  if (!eventType || !order) return result;
  const withExtra = { ...order, _extra: extra };
  const wantEmail = channels.email !== false;
  const wantWa = channels.whatsapp !== false;
  await Promise.all([
    wantEmail ? sendEmailFor({ client, eventType, order: withExtra, sentBy }).then(r => { result.email = r; }).catch(e => { console.error('notifyOrderEvent email threw:', e?.message); result.email = 'failed'; }) : null,
    wantWa ? sendWhatsAppFor({ client, eventType, order: withExtra }).then(r => { result.whatsapp = r; }).catch(e => { console.error('notifyOrderEvent whatsapp threw:', e?.message); result.whatsapp = 'failed'; }) : null,
  ]);
  return result;
}

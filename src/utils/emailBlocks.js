// Central registry of email content-block types + the pure rendering logic
// meant to be shared, unchanged, by a later live preview and the real send
// path -- one implementation, so what an admin previews is exactly what
// gets sent. Table-based, inline-styled HTML, no <script> -- the one
// exception is a single <style> block in <head> (standard "hybrid coding"
// for responsive email, supported by every major mobile mail client) purely
// for @media rules that reflow multi-column tables on narrow screens; every
// element still carries its own inline styles too, so a client that ignores
// <style> entirely just renders the desktop layout, never unstyled content.
// Deliberately NOT a drag-and-drop visual editor -- that's a later phase;
// this is only the data shape + the function that turns it into HTML.
//
// Pure module -- no DOM/React, never touches Supabase or the network. Any
// data a block needs beyond `order`/`variables` (e.g. product images, which
// aren't stored on the order itself) must be resolved by the caller and
// attached to `order` before this is called -- see
// src/utils/sendOrderConfirmationEmail.js.
export const BLOCK_TYPES = [
  { type: 'heading', label: 'Heading', fields: ['text'] },
  { type: 'text', label: 'Text', fields: ['text'] },
  { type: 'image', label: 'Image', fields: ['url', 'alt'] },
  { type: 'button', label: 'Button', fields: ['label', 'url'] },
  { type: 'order_summary', label: 'Order Summary', fields: [] },
  { type: 'customer_details', label: 'Customer Details', fields: [] },
  { type: 'shipping_details', label: 'Shipping Details', fields: [] },
  { type: 'tracking', label: 'Tracking', fields: [] },
  { type: 'divider', label: 'Divider', fields: [] },
  { type: 'spacer', label: 'Spacer', fields: [] },
  { type: 'footer', label: 'Footer', fields: ['text'] },
];

export function emptyBlock(type) {
  const def = BLOCK_TYPES.find(b => b.type === type);
  const block = { type };
  (def?.fields || []).forEach(f => { block[f] = ''; });
  return block;
}

// Replaces {{token}} with a resolved value -- an unknown token is left
// visibly literal (never silently blanked), so a typo in a template is
// obvious in preview rather than quietly dropping content.
export function interpolate(str, variables) {
  if (!str) return '';
  return String(str).replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (match, key) => {
    const v = variables?.[key];
    return (v === undefined || v === null || v === '') ? match : String(v);
  });
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtMoney(n) {
  return (n === null || n === undefined || n === '' || isNaN(Number(n))) ? '' : `₹${Number(n).toLocaleString('en-IN')}`;
}

// ---- Brand tokens -- kept in one place so header/hero/footer/buttons never drift ----
const INK = '#1F2A28';       // primary text
const MUTED = '#5F6B69';     // secondary text
const CREAM = '#F1F8F6';     // page background
const CARD = '#ffffff';      // card background -- white card on the off-white page
const LINE = '#DCE9E6';      // hairline borders
const GOLD = '#0F766E';      // primary CTA colour (Brightlight indigo; white text passes AA on it)
const SITE_URL = 'https://www.brightlightsolutions.in';
const SUPPORT_EMAIL = 'contact@brightlightsolutions.in';
const COMPANY_NAME = 'Brightlight Solutions';
const COMPANY_TAGLINE = 'Technology That Moves Business Forward';
const COMPANY_ADDRESS = 'Kamatchi Amman Kovil Street, Kumarananthapuram, Tiruppur, Tamil Nadu 641602, India';

// Email-safe system sans-serif stack -- no webfont dependency, so every mail
// client renders the same typeface. FONT_BODY kept as its own name (rather
// than replacing every call site with FONT_DISPLAY) purely so this stays a
// one-line change if the two ever need to diverge again.
const FONT_DISPLAY = "Arial, Helvetica, sans-serif";
const FONT_BODY = FONT_DISPLAY;

// Logo image (when set) stacked above the wordmark text, both always shown
// together -- never one or the other.
function renderLogoMark(brand) {
  const logoUrl = brand?.logo_url;
  const logoImg = logoUrl
    ? `<img src="${escapeHtml(logoUrl)}" alt="Brightlight Solutions" height="40" style="height:40px;width:auto;display:block;margin:0 auto 10px;border:0;"/>`
    : '';
  return `${logoImg}<span style="font-family:${FONT_DISPLAY};font-weight:bold;font-size:22px;color:${INK};letter-spacing:.01em;display:block;">${COMPANY_NAME}</span>`;
}

function renderHeader(brand) {
  return `<tr><td align="center" style="padding:28px 24px 22px;background:${CARD};border-bottom:1px solid ${LINE};">
    ${renderLogoMark(brand)}
  </td></tr>`;
}

// The one part of the shell that's specific to ORDER_CONFIRMED -- every other
// event just gets the generic header/blocks/footer shell below it.
function renderHero(variables, brand) {
  const orderUrl = `${SITE_URL}/account?tab=orders`;
  const heroImage = brand?.order_confirmation_hero_image;
  return `<tr><td align="center" style="padding:44px 32px 8px;background:${CARD};">
    <div style="font-family:${FONT_BODY};font-size:11px;font-weight:bold;letter-spacing:.24em;color:${GOLD};margin-bottom:16px;">ORDER CONFIRMED</div>
    <div style="font-family:${FONT_DISPLAY};font-size:27px;line-height:1.4;color:${INK};margin-bottom:14px;">Hi ${escapeHtml(variables.customer_name || 'there')},<br/>Your order is confirmed!</div>
    <div style="font-family:${FONT_BODY};font-size:14.5px;line-height:1.7;color:${MUTED};max-width:420px;margin:0 auto 26px;">Thank you for shopping with Brightlight Solutions. We've received your order and will begin processing it right away.</div>
    <a href="${orderUrl}" style="display:inline-block;background:${GOLD};color:#fff;text-decoration:none;padding:13px 30px;font-family:${FONT_BODY};font-size:12px;font-weight:bold;letter-spacing:.1em;text-transform:uppercase;">View Your Order</a>
    <div style="margin-top:14px;">${heroImage ? '' : `<a href="${SITE_URL}/shop" style="font-family:${FONT_BODY};font-size:12.5px;color:${MUTED};text-decoration:underline;">or Visit our store</a>`}</div>
    ${heroImage ? `<div style="margin-top:28px;"><img src="${escapeHtml(heroImage)}" alt="Brightlight Solutions" style="width:100%;max-width:536px;display:block;border:1px solid ${LINE};"/></div>
    <div style="margin-top:14px;"><a href="${SITE_URL}/shop" style="font-family:${FONT_BODY};font-size:12.5px;color:${MUTED};text-decoration:underline;">or Visit our store</a></div>` : ''}
  </td></tr>`;
}

function renderNextSteps() {
  // Emoji, not SVG/icon-font/hosted images -- renders consistently across
  // email clients (system emoji font) without needing an image asset or
  // risking inconsistent SVG support in Outlook/older clients.
  const steps = [
    ['\u{1F4E6}', 'We’re Processing Your Order'],
    ['\u{1F69A}', 'You’ll Get a Shipping Update'],
    ['✉️', 'Track Your Order Easily'],
    ['❤️', 'Thank You For Shopping With Us'],
  ];
  const cols = steps.map(([icon, label]) => `
    <td class="tt-step-td" width="25%" align="center" valign="top" style="padding:18px 6px;">
      <div style="font-size:22px;line-height:1;margin-bottom:8px;">${icon}</div>
      <div style="font-family:${FONT_BODY};font-size:11px;font-weight:bold;color:${INK};line-height:1.4;">${escapeHtml(label)}</div>
    </td>`).join('');
  return `<tr><td style="padding:8px 20px 28px;background:${CARD};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${cols}</tr></table>
  </td></tr>`;
}

function renderHelpSection() {
  return `<tr><td align="center" style="padding:32px 32px;background:${CREAM};border-top:1px solid ${LINE};border-bottom:1px solid ${LINE};">
    <div style="font-family:${FONT_DISPLAY};font-size:19px;color:${INK};margin-bottom:6px;">Need Help?</div>
    <div style="font-family:${FONT_BODY};font-size:13.5px;color:${MUTED};margin-bottom:16px;">If you have any questions about your order, we're here to help.</div>
    <a href="${SITE_URL}/contact" style="display:inline-block;background:transparent;color:${INK};text-decoration:none;padding:11px 24px;font-family:${FONT_BODY};font-size:12px;font-weight:bold;letter-spacing:.1em;text-transform:uppercase;border:1px solid ${LINE};">Contact Support</a>
  </td></tr>`;
}

function renderFooter(brand) {
  const links = [
    ['Shipping & Returns', `${SITE_URL}/shipping-policy`],
    ['Contact Us', `${SITE_URL}/contact`],
  ];
  const linksHtml = links.map(([label, href], i) => `${i > 0 ? `<span style="color:${LINE};"> &nbsp;|&nbsp; </span>` : ''}<a href="${href}" style="color:${MUTED};text-decoration:underline;">${escapeHtml(label)}</a>`).join('');

  // Social links -- text links, not icon images (no real icon assets exist,
  // and a fabricated icon graphic would be worse than plain text). Only ever
  // shown when the admin has actually set a real URL in Brand Settings.
  const socials = [
    ['Instagram', brand?.instagram_url],
    ['Facebook', brand?.facebook_url],
    ['YouTube', brand?.youtube_url],
    ['Pinterest', brand?.pinterest_url],
  ].filter(([, url]) => url);
  const socialsHtml = socials.length ? `<div style="margin-top:10px;font-family:${FONT_BODY};font-size:11px;color:${MUTED};">
    ${socials.map(([label, url], i) => `${i > 0 ? `<span style="color:${LINE};"> &nbsp;|&nbsp; </span>` : ''}<a href="${escapeHtml(url)}" style="color:${MUTED};text-decoration:underline;">${escapeHtml(label)}</a>`).join('')}
  </div>` : '';

  return `<tr><td align="center" style="padding:28px 24px;background:${CARD};">
    ${renderLogoMark(brand)}
    ${socialsHtml}
    <div style="margin-top:16px;font-family:${FONT_BODY};font-size:11.5px;color:${MUTED};">${linksHtml}</div>
    <div style="margin-top:12px;font-family:${FONT_BODY};font-size:11px;color:${MUTED};">${COMPANY_TAGLINE}</div>
    <div style="margin-top:6px;font-family:${FONT_BODY};font-size:11px;line-height:1.6;color:${MUTED};">${COMPANY_ADDRESS}<br/><a href="mailto:${SUPPORT_EMAIL}" style="color:${MUTED};text-decoration:underline;">${SUPPORT_EMAIL}</a></div>
    <div style="margin-top:14px;font-family:${FONT_BODY};font-size:10.5px;color:${MUTED};">&copy; ${new Date().getFullYear()} ${COMPANY_NAME}. All rights reserved.</div>
  </td></tr>`;
}

function renderBlock(block, variables, order) {
  const pad = 'padding:12px 32px;';
  switch (block.type) {
    case 'heading':
      return `<tr><td style="${pad}font-family:${FONT_DISPLAY};font-size:21px;color:${INK};background:${CARD};">${escapeHtml(interpolate(block.text, variables))}</td></tr>`;
    case 'text':
      return `<tr><td style="${pad}font-family:${FONT_BODY};font-size:14px;line-height:1.7;color:${MUTED};background:${CARD};">${escapeHtml(interpolate(block.text, variables)).replace(/\n/g, '<br/>')}</td></tr>`;
    case 'image':
      return block.url ? `<tr><td style="${pad}background:${CARD};"><img src="${escapeHtml(block.url)}" alt="${escapeHtml(block.alt || '')}" style="max-width:100%;display:block;"/></td></tr>` : '';
    case 'button':
      return block.url ? `<tr><td align="center" style="${pad}background:${CARD};"><a href="${escapeHtml(interpolate(block.url, variables))}" style="display:inline-block;background:${GOLD};color:#fff;text-decoration:none;padding:12px 26px;font-family:${FONT_BODY};font-size:12px;font-weight:bold;letter-spacing:.1em;text-transform:uppercase;">${escapeHtml(interpolate(block.label || 'View', variables))}</a></td></tr>` : '';
    case 'order_summary':
      return renderOrderSummary(variables, order);
    case 'customer_details':
      return `<tr><td style="${pad}font-family:${FONT_BODY};font-size:13.5px;color:${MUTED};background:${CARD};">${escapeHtml(variables.customer_name || '')}<br/>${escapeHtml(variables.customer_email || '')}</td></tr>`;
    case 'shipping_details': {
      const addr = order?.address;
      const line = addr ? [addr.line1, addr.city, addr.state, addr.pincode].filter(Boolean).join(', ') : '';
      return `<tr><td style="${pad}font-family:${FONT_BODY};font-size:13.5px;color:${MUTED};background:${CARD};">${escapeHtml(line || 'Shipping address not available in preview.')}</td></tr>`;
    }
    case 'tracking':
      // Only ever rendered if the admin explicitly added this block AND real
      // tracking data exists on the order -- never a fabricated link.
      return (order?.tracking_number || order?.tracking_url)
        ? `<tr><td style="${pad}font-family:${FONT_BODY};font-size:13.5px;color:${MUTED};background:${CARD};">${order.tracking_number ? `Tracking: ${escapeHtml(order.tracking_number)}` : ''}${order.tracking_url ? ` &mdash; <a href="${escapeHtml(order.tracking_url)}" style="color:${GOLD};">Track shipment</a>` : ''}</td></tr>`
        : '';
    case 'divider':
      return `<tr><td style="padding:0 32px;background:${CARD};"><div style="border-top:1px solid ${LINE};"></div></td></tr>`;
    case 'spacer':
      return `<tr><td style="height:20px;line-height:20px;font-size:0;background:${CARD};">&nbsp;</td></tr>`;
    case 'footer':
      // Legacy free-text footer block, kept for templates that still use it --
      // the real branded footer (logo/tagline/links/copyright) is now always
      // appended automatically by renderEmailHtml() below, regardless of blocks.
      return block.text ? `<tr><td style="padding:16px 32px;font-family:${FONT_BODY};font-size:11px;color:${MUTED};background:${CARD};">${escapeHtml(interpolate(block.text, variables))}</td></tr>` : '';
    default:
      return '';
  }
}

// The rich "order info + items + pricing" card -- the one block that does the
// real commerce-data heavy lifting. order.items is the real, server-written
// line-item array (see src/utils/orderWrite.js's orderItems.push({id,name,
// qty,price,cat,size,...})) enriched with `image` by sendOrderConfirmationEmail.js
// (the order itself never stores a product image) -- nothing here is invented.
function renderOrderSummary(variables, order) {
  const items = Array.isArray(order?.items) ? order.items : [];

  const infoRows = [
    ['Order Number', variables.order_number],
    ['Order Date', variables.order_date],
    ['Payment Status', variables.payment_status],
    ['Order Status', variables.order_status],
  ].filter(([, v]) => v);
  const infoHtml = infoRows.map(([label, value]) => `
    <td class="tt-info-td" style="padding:14px 16px;text-align:center;">
      <div style="font-family:${FONT_BODY};font-size:10px;font-weight:bold;letter-spacing:.12em;text-transform:uppercase;color:${MUTED};margin-bottom:4px;">${escapeHtml(label)}</div>
      <div style="font-family:${FONT_BODY};font-size:13.5px;color:${INK};">${escapeHtml(value)}</div>
    </td>`).join(`<td class="tt-info-div" width="1" style="background:${LINE};"></td>`);
  const infoCard = infoRows.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CREAM};border:1px solid ${LINE};margin-bottom:24px;"><tr>${infoHtml}</tr></table>` : '';

  const colHead = 'padding:0 8px 6px;font-family:' + FONT_BODY + ';font-size:10px;font-weight:bold;letter-spacing:.1em;text-transform:uppercase;color:' + MUTED + ';border-bottom:1px solid ' + LINE + ';';
  const itemsHeader = items.length ? `<tr class="tt-hide-mobile">
      <td colspan="2" style="${colHead}padding-left:0;">Product</td>
      <td style="${colHead}text-align:right;">Price</td>
      <td style="${colHead}text-align:center;">Qty</td>
      <td style="${colHead}text-align:right;padding-right:0;">Total</td>
    </tr>` : '';
  const itemRows = items.map(item => {
    const qty = Number(item.qty) || 0;
    const unit = Number(item.price) || 0;
    const cell = 'padding:12px 8px;border-bottom:1px solid ' + LINE + ';';
    // No image -> an empty cell of the same width, never a placeholder URL:
    // the table keeps its columns aligned and nothing can 404 in the inbox.
    const imgHtml = item.image
      ? `<img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.name || '')}" width="52" height="52" style="width:52px;height:52px;object-fit:cover;border:1px solid ${LINE};display:block;"/>`
      : '';
    return `<tr>
      <td width="56" style="${cell}padding-left:0;" valign="top">${imgHtml}</td>
      <td style="${cell}" valign="top">
        <div style="font-family:${FONT_BODY};font-size:13.5px;color:${INK};">${escapeHtml(item.name || '')}</div>
        ${item.size ? `<div style="font-family:${FONT_BODY};font-size:12px;color:${MUTED};margin-top:2px;">Size: ${escapeHtml(item.size)}</div>` : ''}
        <div class="tt-mobile-only" style="display:none;font-family:${FONT_BODY};font-size:12px;color:${MUTED};margin-top:2px;">Qty: ${qty} &times; ${escapeHtml(fmtMoney(unit))}</div>
      </td>
      <td class="tt-hide-mobile" style="${cell}text-align:right;white-space:nowrap;" valign="top">
        <div style="font-family:${FONT_BODY};font-size:13px;color:${MUTED};">${escapeHtml(fmtMoney(unit))}</div>
      </td>
      <td class="tt-hide-mobile" style="${cell}text-align:center;" valign="top">
        <div style="font-family:${FONT_BODY};font-size:13px;color:${MUTED};">${qty}</div>
      </td>
      <td style="${cell}text-align:right;white-space:nowrap;padding-right:0;" valign="top">
        <div style="font-family:${FONT_BODY};font-size:13.5px;font-weight:bold;color:${INK};">${escapeHtml(fmtMoney(qty * unit))}</div>
      </td>
    </tr>`;
  }).join('');
  const itemsTable = items.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:6px;">${itemsHeader}${itemRows}</table>` : '';
  const inclusiveNote = items.length ? `<div style="font-family:${FONT_BODY};font-size:11px;font-style:italic;color:${MUTED};margin-bottom:20px;">Product prices are inclusive of all applicable taxes.</div>` : '';

  // Zero-value lines are hidden, not shown as "₹0" -- checked against the
  // raw order numbers, not the pre-formatted {{variable}} strings (fmtMoney(0)
  // returns the truthy string "₹0", which silently defeated a truthiness
  // check on the formatted value). Tax is never a real, separate line in this
  // business at all (prices are tax-inclusive site-wide) -- there is no raw
  // value to check, so it's simply never included.
  const pricingRows = [
    ['Subtotal', variables.subtotal],
    Number(order?.shipping) > 0 ? ['Shipping', variables.shipping] : null,
    Number(order?.discount) > 0 ? ['Discount', `− ${variables.discount}`] : null,
  ].filter(Boolean);
  const pricingHtml = pricingRows.map(([label, value]) => `
    <tr><td style="padding:4px 0;font-family:${FONT_BODY};font-size:13px;color:${MUTED};">${escapeHtml(label)}</td><td style="padding:4px 0;font-family:${FONT_BODY};font-size:13px;color:${INK};text-align:right;">${escapeHtml(value)}</td></tr>`).join('');
  const totalHtml = variables.total ? `
    <tr><td colspan="2" style="padding:6px 0 0;"><div style="border-top:1px solid ${LINE};"></div></td></tr>
    <tr><td style="padding:10px 0 0;font-family:${FONT_BODY};font-size:15px;font-weight:bold;color:${INK};">Total</td><td style="padding:10px 0 0;font-family:${FONT_BODY};font-size:15px;font-weight:bold;color:${INK};text-align:right;">${escapeHtml(variables.total)}</td></tr>` : '';

  return `<tr><td style="padding:8px 32px 28px;background:${CARD};">
    ${infoCard}
    ${itemsTable}
    ${inclusiveNote}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${pricingHtml}${totalHtml}</table>
  </td></tr>`;
}

// The one function meant to back both a later live preview and the real
// send -- same output either way, so preview never lies about what sends.
//
// `eventType`/`brand` are optional -- omitting them still renders correctly
// (generic header/blocks/footer, no ORDER_CONFIRMED-specific hero/next-steps/
// help), so every existing caller keeps working unchanged.
export function renderEmailHtml({ blocks, variables, order, eventType, brand }) {
  const vars = variables || {};
  const isOrderConfirmed = eventType === 'ORDER_CONFIRMED';
  const blockRows = (blocks || []).map(b => renderBlock(b, vars, order)).join('');

  const inner = [
    renderHeader(brand),
    isOrderConfirmed ? renderHero(vars, brand) : '',
    blockRows,
    isOrderConfirmed ? renderNextSteps() : '',
    renderHelpSection(),
    renderFooter(brand),
  ].join('');

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title></title>
<meta name="color-scheme" content="light"/>
<meta name="supported-color-schemes" content="light"/>
<style>
  /* Locks this email to its own light palette regardless of the reader's
     device/client dark-mode setting. The meta tags above cover Apple
     Mail/Outlook.com; Gmail's own dark mode (especially its Android/iOS
     apps) needs this explicit override too -- confirmed live, without it
     Gmail auto-inverted the whole email to a dark background with light
     text despite every color already being set to the light palette. */
  @media (prefers-color-scheme: dark) {
    body, .tt-bg { background: ${CREAM} !important; }
    .tt-card { background: ${CARD} !important; }
  }
  [data-ogsc] body, [data-ogsc] .tt-bg { background: ${CREAM} !important; }
  [data-ogsc] .tt-card { background: ${CARD} !important; }
  /* Real phone/small-client responsiveness -- the outer table's max-width:100%
     alone only shrinks the whole layout proportionally, which leaves the
     order-info card (4 columns) and items table (5 columns) too cramped to
     read on a ~360-400px screen. These rules reflow them into single-column
     rows instead. Supported by every major mobile mail client (Gmail/Apple
     Mail/Outlook apps); ignored harmlessly by clients that don't apply
     <style> media queries, which just keep the desktop layout. */
  @media only screen and (max-width: 480px) {
    .tt-info-td { display: block !important; width: 100% !important; text-align: left !important; border-bottom: 1px solid ${LINE} !important; }
    .tt-info-div { display: none !important; }
    .tt-hide-mobile { display: none !important; }
    .tt-mobile-only { display: block !important; }
    .tt-step-td { width: 50% !important; display: inline-block !important; }
  }
</style>
</head>
<body class="tt-bg" bgcolor="${CREAM}" style="margin:0;padding:0;background:${CREAM};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${CREAM}" class="tt-bg" style="background:${CREAM};">
<tr><td align="center" bgcolor="${CREAM}" class="tt-bg" style="padding:24px 12px;background:${CREAM};">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" bgcolor="${CARD}" class="tt-card" style="width:600px;max-width:100%;background:${CARD};">
${inner}
</table>
</td></tr>
</table>
</body>
</html>`;
}

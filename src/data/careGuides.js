import { returnWindowDays } from '../utils/storeCopy';
import { deliveryFeeText, codText, metroCities } from '../utils/policyCopy';

// ---------------------------------------------------------------------------------------------------------------
// Help Centre content (src/pages/Care.jsx, route /help).
//
//   buildHelpFaqs(brand)   the built-in questions, grouped. Written from the live store settings (delivery fees,
//                          return window, COD ...) so they never promise something the store does not do.
//   CARE_GUIDES_DEFAULT    the starting list for Admin's "extra help topics" editor. These are shown BELOW the built-in
//                          questions as "More help", so they cover different ground and nothing appears twice.
//   normaliseGuides(list)  brand.care_guides -> [{ title, answer, steps }]. Accepts the current { title, answer } rows
//                          and tolerates the old { material, icon, tagline, steps[], note } rows.
// ---------------------------------------------------------------------------------------------------------------

export const CARE_GUIDES_DEFAULT = [
  {
    title: 'Choosing the right size and colour',
    answer: 'Check the size and option chips on the product page, and read the specifications and description. Colours can look slightly different on different screens. If you are between sizes, the product description is the best guide.',
  },
  {
    title: 'Looking after your purchase',
    answer: 'Read any care label or manual in the box and follow it. Keep your invoice and the original packaging until you are sure you are happy, in case you need to return the item.',
  },
];

// { title, answer, steps } -- steps is optional (legacy rows). Rows without a title or any text are dropped.
export function normaliseGuides(list) {
  if (!Array.isArray(list)) return [];
  return list.map((g) => {
    if (!g || typeof g !== 'object') return null;
    const title = String(g.title ?? g.material ?? '').trim();
    const steps = Array.isArray(g.steps) ? g.steps.map(s => String(s).trim()).filter(Boolean) : [];
    const answer = String(g.answer ?? g.description ?? g.note ?? g.tagline ?? '').trim();
    return title && (answer || steps.length) ? { title, answer, steps } : null;
  }).filter(Boolean);
}

export function buildHelpFaqs(brand) {
  const days = returnWindowDays(null, brand);
  const cod = codText(brand);
  const metros = metroCities(brand);
  const extraDays = Number(brand?.delivery_extra_days) || 0;
  const returnsLine = days > 0
    ? `You can return most items within ${days} days of delivery. Some products are marked non-returnable on their product page.`
    : 'Returns are not accepted for most items, apart from products that arrive damaged, defective or wrong. See the Returns policy for details.';

  return [
    {
      id: 'orders', title: 'Orders & tracking', items: [
        { q: 'How do I track my order?', a: 'Open Account → Orders and choose your order. Once it has been dispatched you will see the courier and tracking number, with a link to track the parcel. We also send you updates as the order moves along.' },
        { q: 'Can I cancel my order?', a: 'Yes, until it is dispatched: open the order in Account → Orders and choose Cancel order. You will be refunded to your original payment method. After dispatch an order cannot be cancelled, but you can return it once delivered.', link: { to: '/returns-policy', label: 'Returns & refunds policy' } },
        { q: 'Why was my order cancelled?', a: 'An order can be cancelled if the payment did not go through, an item ran out of stock, or we could not deliver to your PIN code. Anything you paid is refunded automatically.' },
        { q: 'Where can I get my invoice?', a: 'Open the order in Account → Orders and choose Invoice. All prices on the store include GST, and the invoice shows the tax breakup.' },
      ],
    },
    {
      id: 'shipping', title: 'Shipping & delivery', items: [
        { q: 'What are the delivery charges?', a: deliveryFeeText(brand) },
        { q: 'How long will delivery take?', a: `Every product page shows an estimated delivery date for your PIN code. ${extraDays > 0 ? `Locations outside the metro cities${metros.length ? ` (${metros.join(', ')})` : ''} usually take about ${extraDays} business days longer. ` : ''}Delivery estimates are in business days and start once your order is dispatched.`, link: { to: '/shipping-policy', label: 'Shipping policy' } },
        { q: 'Do you deliver outside India?', a: 'Not at the moment. We deliver to serviceable PIN codes across India.' },
        { q: 'What if I am not at home when the parcel arrives?', a: 'Our delivery partners usually make up to three attempts. If you miss a delivery, contact the courier using the tracking link, or write to us and we will help you rearrange it.' },
        { q: 'Is Cash on Delivery available?', a: cod || 'Not right now. We currently accept online payments only: UPI, cards and net banking.' },
      ],
    },
    {
      id: 'returns', title: 'Returns & refunds', items: [
        { q: 'What is your return policy?', a: returnsLine, link: { to: '/returns-policy', label: 'Read the full returns policy' } },
        { q: 'How do I return an item?', a: 'Open Account → Orders, choose the delivered order and select Return. Pick the items and the reason, and submit. Once approved we arrange the pickup and tell you what happens next.' },
        { q: 'When will I get my refund?', a: 'After the returned item reaches us and passes a quick check, the refund is started right away. Online payments go back to the original payment method and usually show up within 5–7 business days, depending on your bank. Cash on Delivery orders are refunded by bank transfer.' },
        { q: 'My item arrived damaged or is not what I ordered.', a: 'We are sorry about that. Raise a return from Account → Orders and choose the reason, with a short description and photos if you can. We will arrange a replacement or a refund.' },
      ],
    },
    {
      id: 'payments', title: 'Payments & offers', items: [
        { q: 'Which payment methods can I use?', a: `UPI, debit and credit cards and net banking${brand?.cod_enabled ? ', and Cash on Delivery on eligible orders' : ''}.` },
        { q: 'Is it safe to pay on the store?', a: 'Yes. Online payments are processed by our payment partner over a secure connection. We never see or store your card details.' },
        { q: 'My payment failed but money was deducted.', a: 'This is usually a delay on the bank side. If the order was not confirmed, the amount is returned to you automatically, normally within 5–7 business days. If it has not arrived after that, contact us with your payment reference.' },
        { q: 'How do I use a coupon or gift card?', a: 'Enter the code in the coupon or gift card box at checkout and apply it before you pay. Terms such as minimum order value are shown with each offer.' },
        { q: 'Are prices inclusive of tax?', a: 'Yes. The price you see includes GST. Delivery fees, if any, are shown separately before you pay.' },
      ],
    },
    {
      id: 'account', title: 'Account', items: [
        { q: 'How do I sign in?', a: 'Use the Sign in page: enter your mobile number (we send a one-time code), your email and password, or continue with Google. New here? Creating an account takes a minute.' },
        { q: 'I forgot my password.', a: 'Choose “Forgot password” on the sign-in page and we will send you a reset link.' },
        { q: 'How do I change my address or phone number?', a: 'Go to Account → Addresses to add or edit delivery addresses, and Account → Account details for your name and phone.' },
        { q: 'How do I save a product for later?', a: 'Tap the heart on any product. Everything you save is in Account → Wishlist, on every device you sign in on.' },
        { q: 'How do I review a product?', a: 'Once an order has been delivered, open the product page and choose Write a review.' },
      ],
    },
  ];
}

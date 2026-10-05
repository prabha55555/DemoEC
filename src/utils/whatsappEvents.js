// Central registry of WhatsApp notification events -- mirrors
// src/utils/emailEvents.js's own registry, kept as a separate, smaller list
// since WhatsApp only ever needs the 3 order-lifecycle moments the admin
// actually asked for (no SUPPORT_REPLY-style event here).
export const WHATSAPP_EVENTS = [
  { type: 'ORDER_CONFIRMED', label: 'Order Confirmed', description: 'Sent automatically right after a Razorpay payment is verified.' },
  { type: 'ORDER_SHIPPED', label: 'Order Shipped', description: 'Sent from Orders > Set & Notify when you choose to notify by WhatsApp.' },
  { type: 'ORDER_DELIVERED', label: 'Order Delivered', description: 'Sent from Orders > Set & Notify when you choose to notify by WhatsApp.' },
  { type: 'PRODUCT_ENQUIRY_RECEIVED', label: 'Product Enquiry Received', description: 'Sent automatically to logged-in customers with a saved phone number, right after they submit a product enquiry. Guests are unaffected -- their enquiry still records normally, with no automatic message.' },
];

export const WHATSAPP_EVENT_TYPES = WHATSAPP_EVENTS.map(e => e.type);

// Events whose message is built from a real `orders` row -- the only ones the
// admin's Orders > Set & Notify picker (and api/send-order-whatsapp.js) may
// use. PRODUCT_ENQUIRY_RECEIVED resolves against an enquiry, not an order, so
// picking it there would render every order-only token blank.
export const ORDER_WHATSAPP_EVENT_TYPES = WHATSAPP_EVENTS.map(e => e.type).filter(t => t !== 'PRODUCT_ENQUIRY_RECEIVED');

export function whatsappEventLabel(type) {
  return WHATSAPP_EVENTS.find(e => e.type === type)?.label || type;
}

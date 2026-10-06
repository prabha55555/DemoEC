// Central registry of WhatsApp notification events -- mirrors
// src/utils/emailEvents.js, kept as a separate list since WhatsApp only needs the moments a
// customer actually wants a ping for. Like email, each one is sent automatically by
// api/orders.js when an enabled template exists for it.
export const WHATSAPP_EVENTS = [
  { type: 'ORDER_CONFIRMED', label: 'Order Confirmed', description: 'Sent automatically right after an order is placed.' },
  { type: 'ORDER_SHIPPED', label: 'Order Shipped', description: 'Sent automatically when the order is marked Shipped.' },
  { type: 'ORDER_OUT_FOR_DELIVERY', label: 'Out for Delivery', description: 'Sent automatically when the order is marked Out for Delivery.' },
  { type: 'ORDER_DELIVERED', label: 'Order Delivered', description: 'Sent automatically when the order is marked Delivered.' },
  { type: 'ORDER_CANCELLED', label: 'Order Cancelled', description: 'Sent automatically when an order is cancelled.' },
  { type: 'REFUND_PROCESSED', label: 'Refund Processed', description: 'Sent automatically when a refund is issued.' },
  { type: 'PRODUCT_ENQUIRY_RECEIVED', label: 'Customer Query Received', description: 'Sent automatically to logged-in customers with a saved phone number, right after they submit a question. Guests are unaffected -- their query still records normally, with no automatic message.' },
];

export const WHATSAPP_EVENT_TYPES = WHATSAPP_EVENTS.map(e => e.type);

// Events whose message is built from a real `orders` row -- the only ones the
// admin's Orders > Notify picker (and api/notify.js) may use. PRODUCT_ENQUIRY_RECEIVED
// resolves against a customer query, not an order, so picking it there would render every
// order-only token blank.
export const ORDER_WHATSAPP_EVENT_TYPES = WHATSAPP_EVENTS.map(e => e.type).filter(t => t !== 'PRODUCT_ENQUIRY_RECEIVED');

export function whatsappEventLabel(type) {
  return WHATSAPP_EVENTS.find(e => e.type === type)?.label || type;
}

// Central registry of transactional email event types -- the single source
// of truth for the Admin template editor's event dropdown and for which
// events the send endpoints accept. Adding a new event type means adding one
// entry here; nothing else needs to know the full list.
//
// Only ORDER_CONFIRMED fires automatically (orderWrite.js, right after the
// order is written). Every other event is sent by the admin, on purpose, from
// Orders > Set & Notify -- changing an order's status never sends anything by
// itself.
export const EMAIL_EVENTS = [
  { type: 'ORDER_CONFIRMED', label: 'Order Confirmed', description: 'Sent automatically right after a paid (or free) order is placed. Can also be re-sent manually from Orders > Set & Notify.' },
  { type: 'ORDER_SHIPPED', label: 'Order Shipped', description: 'Sent manually from Orders > Set & Notify. Marking an order Shipped does not send it by itself.' },
  { type: 'ORDER_DELIVERED', label: 'Order Delivered', description: 'Sent manually from Orders > Set & Notify. Marking an order Delivered does not send it by itself.' },
  { type: 'REFUND_PROCESSED', label: 'Refund Processed', description: 'Sent manually from Orders > Set & Notify. Issuing a refund does not send it by itself.' },
  { type: 'SUPPORT_REPLY', label: 'Support Reply', description: 'Not sendable yet: no reply-sending system exists, so a template for this event is never used. Editable for a future phase only.' },
];

export const EMAIL_EVENT_TYPES = EMAIL_EVENTS.map(e => e.type);

// Events whose email is built from a real `orders` row -- the only ones
// api/send-order-email.js will send. SUPPORT_REPLY resolves against an
// enquiry instead, so it is deliberately excluded.
export const ORDER_EMAIL_EVENT_TYPES = EMAIL_EVENTS.map(e => e.type).filter(t => t !== 'SUPPORT_REPLY');

export function emailEventLabel(type) {
  return EMAIL_EVENTS.find(e => e.type === type)?.label || type;
}

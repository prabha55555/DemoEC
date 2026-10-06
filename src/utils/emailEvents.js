// Central registry of transactional email event types -- the single source
// of truth for the Admin template editor's event dropdown and for which
// events the send endpoints accept. Adding a new event type means adding one
// entry here; nothing else needs to know the full list.
//
// ORDER_CONFIRMED fires automatically right after the order is written
// (orderWrite.js). Every lifecycle event below it fires automatically when the
// matching action runs through api/orders.js (an admin moving an order to the next
// status, a cancellation, a return decision, a refund) -- provided an enabled
// template exists for the event, so the store owner stays in control of the wording and can
// switch any message off. The admin can also re-send any of them by hand from
// Orders > Notify.
export const EMAIL_EVENTS = [
  { type: 'ORDER_CONFIRMED', label: 'Order Confirmed', description: 'Sent automatically right after an order is placed (paid online, Cash on Delivery, or fully covered by a gift card/coupon).' },
  { type: 'ORDER_SHIPPED', label: 'Order Shipped', description: 'Sent automatically when the order is marked Shipped. Tracking details are included when entered.' },
  { type: 'ORDER_OUT_FOR_DELIVERY', label: 'Out for Delivery', description: 'Sent automatically when the order is marked Out for Delivery.' },
  { type: 'ORDER_DELIVERED', label: 'Order Delivered', description: 'Sent automatically when the order is marked Delivered.' },
  { type: 'ORDER_CANCELLED', label: 'Order Cancelled', description: 'Sent automatically when an order is cancelled by the customer or by you.' },
  { type: 'REFUND_PROCESSED', label: 'Refund Processed', description: 'Sent automatically when a refund is issued (cancellation or approved return).' },
  { type: 'RETURN_REQUESTED', label: 'Return Requested', description: 'Sent automatically to the customer when they submit a return request.' },
  { type: 'RETURN_APPROVED', label: 'Return Approved', description: 'Sent automatically when you approve a return request.' },
  { type: 'RETURN_REJECTED', label: 'Return Rejected', description: 'Sent automatically when you reject a return request. Include the reason with {{return_note}}.' },
  { type: 'SUPPORT_REPLY', label: 'Support Reply', description: 'Not sendable yet: no reply-sending system exists, so a template for this event is never used. Editable for a future phase only.' },
];

export const EMAIL_EVENT_TYPES = EMAIL_EVENTS.map(e => e.type);

// Events whose email is built from a real `orders` row -- the only ones
// api/notify.js will send by hand. SUPPORT_REPLY resolves against an
// enquiry instead, so it is deliberately excluded.
export const ORDER_EMAIL_EVENT_TYPES = EMAIL_EVENTS.map(e => e.type).filter(t => t !== 'SUPPORT_REPLY');

export function emailEventLabel(type) {
  return EMAIL_EVENTS.find(e => e.type === type)?.label || type;
}

// The email event that goes with each order status change (ORDER_CONFIRMED is sent at creation).
export const EVENT_FOR_STATUS = {
  Shipped: 'ORDER_SHIPPED',
  'Out for Delivery': 'ORDER_OUT_FOR_DELIVERY',
  Delivered: 'ORDER_DELIVERED',
  Cancelled: 'ORDER_CANCELLED',
};

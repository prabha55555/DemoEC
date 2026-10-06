// SERVER-ONLY. Everything that happens to an order AFTER it is placed: moving it along its
// lifecycle, cancelling it, returning goods, refunding money. Called only from api/orders.js,
// which authenticates the caller (customer or admin) first. See docs/ECOMMERCE_REDESIGN.md B3.
//
// Safety model
//   * The status guard is atomic (SQL transition_order): of two racing requests, one wins and the
//     other is told the order is no longer in that state. Everything that has side effects -- restock,
//     coupon release, gift-card credit, the Razorpay refund -- runs only for the winner, so it
//     happens exactly once.
//   * Money only moves through refundMoney(): it can never refund more than was charged, it records
//     every refund on the order, and a failed gateway call is surfaced (and noted for the admin),
//     never swallowed.
//   * The customer never supplies an amount: refunds are derived from the order.
import { supabaseAdmin as supabase } from './supabaseAdmin.js';
import { refundRazorpayPayment } from './razorpayRefund.js';
import { creditGiftCardBalance } from './giftCards.js';
import { notifyOrderEvent } from './notifyOrderEvent.js';
import { EVENT_FOR_STATUS } from './emailEvents.js';
import { CUSTOMER_CANCELLABLE, ADMIN_CANCELLABLE, FULFILMENT_STEPS, returnableLines, returnRefundAmount, refundCapBeforeDelivery, refundBeforeDeliveryMessage } from './orderStatus.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const fail = (error, code, status = 400) => ({ ok: false, error, code, status });

export async function loadOrder(ref) {
  const col = UUID.test(String(ref || '')) ? 'id' : 'order_id';
  const { data, error } = await supabase.from('orders').select('*').eq(col, String(ref || '')).maybeSingle();
  if (error) throw error;
  return data || null;
}

// A customer may only act on their own order. A missing or foreign order reads the same ("not found")
// so order numbers cannot be probed.
function ownedBy(order, userId) {
  return !!order && !!userId && order.user_id === userId;
}

async function addInternalNote(order, note, author = 'system') {
  try { await supabase.from('order_notes').insert({ order_uuid: order.id, author, note }); }
  catch (e) { console.error('addInternalNote failed:', e?.message); }
}

// ------------------------------------------------------------------------------ money
// Returns { ok, amount, onlineRefunded, giftCardCredited, refundId, manual, skipped, error, refundFailed }.
//  * online (Razorpay) payments are refunded to the original method, never above what was charged
//  * any remainder (the part a gift card originally paid) goes back onto that gift card
//  * COD / free orders have no gateway money: with allowManual the refund is recorded as MANUAL
//    (the admin returns the cash/bank transfer themselves) so the books still show it
//
// The cap check and the bookkeeping happen in ONE locked database call (reserve_refund) BEFORE any money moves,
// so concurrent refunds (double click, cancel + goodwill refund, two admins) can never total more than was
// charged; each reserved amount is then settled as processed or failed (finish_refund), and a failed gateway
// call gives its amount back to the refundable balance.
export async function refundMoney({ order, amount, reason, by, allowManual = false }) {
  const want = round2(amount);
  if (!(want > 0)) return { ok: true, amount: 0, skipped: 'nothing to refund' };
  const gateway = order.payment_method === 'razorpay' && !!order.payment_id;

  const { data: held, error } = await supabase.rpc('reserve_refund', {
    p_order_id: order.order_id, p_want: want, p_allow_online: gateway || allowManual, p_manual: !gateway,
    p_by: by || null, p_reason: reason || null,
  });
  if (error || !held) {
    console.error('refundMoney: reserve_refund failed.', error?.message, order.order_id);
    return { ...fail('Could not record the refund. Please try again.', 'ERROR', 500), refundFailed: true };
  }
  if (!(Number(held.online) > 0) && !(Number(held.gift) > 0)) return { ok: true, amount: 0, skipped: 'already fully refunded' };

  const settle = (entryId, ok, ref) => (entryId
    ? supabase.rpc('finish_refund', { p_order_id: order.order_id, p_entry_id: entryId, p_ok: ok, p_ref: ref || null })
    : null);
  const result = { ok: true, amount: 0, onlineRefunded: 0, giftCardCredited: 0, refundId: null, manual: false };

  // The gift-card part first: it cannot fail at the gateway, and must not be skipped just because the gateway is down.
  if (Number(held.gift) > 0) {
    const credited = await creditGiftCardBalance(supabase, held.gift_code, Number(held.gift));
    await settle(held.gift_entry, credited);
    if (credited) {
      result.giftCardCredited = Number(held.gift);
      result.amount += Number(held.gift);
    } else {
      console.error('refundMoney: could not credit the gift card back -- needs manual check.', held.gift_code, held.gift, order.order_id);
      await addInternalNote(order, `Could not credit ₹${held.gift} back to gift card ${held.gift_code}. Credit it manually.`);
    }
  }

  if (Number(held.online) > 0) {
    if (gateway) {
      const r = await refundRazorpayPayment({
        keyId: process.env.RAZORPAY_KEY_ID, keySecret: process.env.RAZORPAY_KEY_SECRET,
        paymentId: order.payment_id, amountPaise: Math.round(Number(held.online) * 100), reason,
      });
      if (!r.ok) {
        console.error('refundMoney: gateway refund failed.', r.error, 'order', order.order_id, held.online);
        await settle(held.online_entry, false);
        await addInternalNote(order, `Automatic refund of ₹${held.online} FAILED (${r.error}). Refund it from the Razorpay dashboard, or retry from Orders > Refund.`);
        return { ...result, ok: false, refundFailed: true, error: `The payment gateway could not process the refund: ${r.error}`, code: 'REFUND_FAILED', status: 502 };
      }
      await settle(held.online_entry, true, r.id || null);
      result.refundId = r.id || null;
    } else {
      await settle(held.online_entry, true);
      result.manual = true;                                              // COD / free order: refunded outside the gateway
    }
    result.onlineRefunded = Number(held.online);
    result.amount += Number(held.online);
  }
  return result;
}

// ------------------------------------------------------------------------------ gift cards bought on an order
// A purchased gift card is issued the moment the order is written. Cancelling that order would refund the money
// while the card stayed spendable, so a card is voided FIRST (and only while completely unspent), and put back if
// the cancellation then does not go through.
async function voidGiftCardsOf(order) {
  const codes = (order.items || []).filter(i => i.isGiftCard && i.giftCode).map(i => i.giftCode);
  if (!codes.length) return { ok: true, voided: [] };
  const { data: cards } = await supabase.from('gift_cards').select('code, balance, initial_value').in('code', codes);
  const used = (cards || []).some(c => Number(c.balance) < Number(c.initial_value));
  const message = 'A gift card bought with this order has already been used (at least in part), so the order cannot be cancelled automatically. Refund the unused amount manually if that is right.';
  if (used) return { ok: false, error: message };
  const voided = [];
  for (const c of cards || []) {
    // compare-and-set: only while still completely unspent
    const { data: hit } = await supabase.from('gift_cards').update({ balance: 0 }).eq('code', c.code).eq('balance', c.initial_value).select('code');
    if (!hit?.length) { await restoreGiftCards(voided); return { ok: false, error: message }; }
    voided.push(c);
  }
  return { ok: true, voided };
}

async function restoreGiftCards(cards) {
  for (const c of cards || []) await supabase.from('gift_cards').update({ balance: c.initial_value }).eq('code', c.code).eq('balance', 0);
}

// ------------------------------------------------------------------------------ cancel
export async function cancelOrder({ ref, by, reason, userId = null, actor = 'customer' }) {
  const order = await loadOrder(ref);
  if (!order || (actor === 'customer' && !ownedBy(order, userId))) return fail('Order not found.', 'NOT_FOUND', 404);

  const hasGiftCard = (order.items || []).some(i => i.isGiftCard);
  if (hasGiftCard && actor === 'customer') {
    return fail('This order includes a gift card, which cannot be cancelled once purchased. Please contact support if something is wrong.', 'GIFT_CARD_ORDER', 409);
  }
  const gift = hasGiftCard ? await voidGiftCardsOf(order) : { ok: true, voided: [] };
  if (!gift.ok) return fail(gift.error, 'GIFT_CARD_USED', 409);

  const allowed = actor === 'admin' ? ADMIN_CANCELLABLE : CUSTOMER_CANCELLABLE;
  const cleanReason = String(reason || '').trim().slice(0, 300) || null;
  const { data: updated, error } = await supabase.rpc('transition_order', {
    p_order_id: order.order_id, p_to: 'Cancelled', p_allowed: allowed, p_by: by, p_note: null, p_cancel_reason: cleanReason,
  });
  if (error || !updated) {
    await restoreGiftCards(gift.voided);                               // the order is NOT cancelled: its cards live on
    if (error) { console.error('cancelOrder: transition failed', error.message); return fail('Could not cancel the order. Please try again.', 'ERROR', 500); }
    return fail(actor === 'admin'
      ? `This order is ${order.status} and can no longer be cancelled.`
      : 'This order has already been dispatched or closed, so it can no longer be cancelled. You can request a return once it is delivered.', 'NOT_CANCELLABLE', 409);
  }

  // From here we are the single winner -- each step below happens once.
  const steps = {};
  const { error: restockError } = await supabase.rpc('restock_order_items', { p_order_id: order.order_id, p_reason: 'cancel' });
  steps.restocked = !restockError;
  if (restockError) console.error('cancelOrder: restock failed', restockError.message, order.order_id);

  if (updated.coupon_code && Number(updated.discount) > 0) {
    const { error: couponError } = await supabase.rpc('release_coupon_use', { p_code: updated.coupon_code });
    steps.couponReleased = !couponError;
  }

  // Everything the customer paid goes back: the online part to the original method, the gift-card part to the card.
  const refund = await refundMoney({
    order: updated, amount: round2(Number(updated.total) + Number(updated.gift_card_applied || 0)),
    reason: cleanReason ? `Order cancelled: ${cleanReason}` : 'Order cancelled', by,
  });
  steps.refund = refund;

  const fresh = (await loadOrder(order.order_id)) || updated;
  // both messages go out together: refund (<=12s) + two serial notifications could otherwise exceed the function's time limit
  const [notified] = await Promise.all([
    notifyOrderEvent({
      eventType: 'ORDER_CANCELLED', order: fresh, sentBy: by,
      extra: { cancelReason: cleanReason || '', refundAmount: refund.onlineRefunded || undefined, refundId: refund.refundId || '' },
    }),
    refund.ok && refund.onlineRefunded > 0
      ? notifyOrderEvent({ eventType: 'REFUND_PROCESSED', order: fresh, sentBy: by, extra: { refundAmount: refund.onlineRefunded, refundId: refund.refundId || '' } })
      : null,
  ]);
  // The cancellation itself succeeded either way; a failed refund is reported, never hidden.
  return {
    ok: true, order: fresh, refund, steps, notified,
    refundFailed: refund.ok === false,
    refundError: refund.ok === false ? refund.error : undefined,
    message: refund.ok === false ? 'Your order is cancelled, but the refund could not be completed automatically. Our team has been notified and will process it manually.' : undefined,
  };
}

// ------------------------------------------------------------------------------ status (admin)
export async function updateStatus({ ref, to, by, note, tracking = null, notify = true }) {
  if (!FULFILMENT_STEPS.includes(to) || to === 'Placed') return fail('That status cannot be set here.', 'BAD_STATUS');
  const order = await loadOrder(ref);
  if (!order) return fail('Order not found.', 'NOT_FOUND', 404);

  // Tracking details are saved first so the notification that follows already carries them.
  if (tracking && (tracking.carrier || tracking.number || tracking.url)) {
    const patch = {};
    if (tracking.carrier !== undefined) patch.shipping_carrier = String(tracking.carrier || '').slice(0, 80) || null;
    if (tracking.number !== undefined) patch.tracking_number = String(tracking.number || '').slice(0, 80) || null;
    if (tracking.url !== undefined) {
      // Shown to the customer as a clickable link and put in emails, so only a real web address is stored (the admin
      // screen checks this too; the server does not trust it).
      const url = String(tracking.url || '').trim().slice(0, 500);
      if (url && !/^https?:\/\/[^\s]+$/i.test(url)) return fail('Use a full https:// tracking link.', 'BAD_TRACKING_URL');
      patch.tracking_url = url || null;
    }
    await supabase.from('orders').update(patch).eq('id', order.id);
  }

  const allowed = FULFILMENT_STEPS.slice(0, FULFILMENT_STEPS.indexOf(to));
  const { data: updated, error } = await supabase.rpc('transition_order', {
    p_order_id: order.order_id, p_to: to, p_allowed: allowed, p_by: by, p_note: String(note || '').trim().slice(0, 300) || null,
  });
  if (error) { console.error('updateStatus: transition failed', error.message); return fail('Could not update the order. Please try again.', 'ERROR', 500); }
  if (!updated) return fail(`This order is ${order.status}; it cannot move to ${to}.`, 'BAD_TRANSITION', 409);

  const fresh = (await loadOrder(order.order_id)) || updated;
  const eventType = EVENT_FOR_STATUS[to];
  const notified = notify && eventType ? await notifyOrderEvent({ eventType, order: fresh, sentBy: by }) : null;
  return { ok: true, order: fresh, notified };
}

// ------------------------------------------------------------------------------ admin refund
export async function adminRefund({ ref, amount, reason, by }) {
  const order = await loadOrder(ref);
  if (!order) return fail('Order not found.', 'NOT_FOUND', 404);
  if ((order.items || []).some(i => i.isGiftCard)) {
    return fail('This order includes a gift card. Cancel the order instead: that voids the card (while it is unspent) and refunds the payment.', 'GIFT_CARD_ORDER', 409);
  }
  // The admin screen greys the button out in these cases, but it is only a hint: the same rules are enforced here.
  if (order.payment_method === 'free' || !(Number(order.total) > 0)) return fail('Nothing was charged for this order, so there is nothing to refund.', 'NOTHING_TO_REFUND');
  if (order.payment_method === 'cod' && order.payment_status === 'cod_pending') return fail('Cash on delivery: no money has been collected yet, so there is nothing to refund.', 'NOTHING_TO_REFUND');
  const cap = refundCapBeforeDelivery(order);
  if (cap !== null && round2(amount) > cap) return fail(refundBeforeDeliveryMessage(cap), 'CANCEL_INSTEAD', 409);
  const refund = await refundMoney({ order, amount, reason: reason || 'Refund from store', by, allowManual: true });
  if (!refund.ok) return refund;
  if (!(refund.amount > 0)) return fail(refund.skipped === 'already fully refunded' ? 'This order has already been fully refunded.' : 'Nothing to refund.', 'NOTHING_TO_REFUND');
  const fresh = (await loadOrder(order.order_id)) || order;
  const notified = await notifyOrderEvent({ eventType: 'REFUND_PROCESSED', order: fresh, sentBy: by, extra: { refundAmount: refund.amount, refundId: refund.refundId || '' } });
  return { ok: true, order: fresh, refund, notified };
}

// ------------------------------------------------------------------------------ returns
async function returnedQtyByLine(orderUuid) {
  const { data } = await supabase.from('order_returns').select('items, status').eq('order_uuid', orderUuid).neq('status', 'Rejected').neq('status', 'Closed');
  const map = {};
  for (const r of data || []) for (const it of r.items || []) {
    const key = it.variantId || `${it.id}::${it.size || ''}`;
    map[key] = (map[key] || 0) + Number(it.qty || 0);
  }
  return map;
}

export async function requestReturn({ ref, userId, items, reason, details, type = 'return' }) {
  const order = await loadOrder(ref);
  if (!order || !ownedBy(order, userId)) return fail('Order not found.', 'NOT_FOUND', 404);

  const wanted = Array.isArray(items) ? items.filter(i => i && Number(i.qty) > 0) : [];
  if (!wanted.length) return fail('Choose at least one item to return.', 'NO_ITEMS');
  const cleanReason = String(reason || '').trim().slice(0, 200);
  if (!cleanReason) return fail('Please tell us why you are returning this.', 'NO_REASON');

  const eligibility = returnableLines(order, await returnedQtyByLine(order.id));
  if (!eligibility.eligible) return fail(eligibility.reason, 'NOT_RETURNABLE', 409);
  const byKey = new Map(eligibility.lines.map(l => [l.key, l]));

  // The same item listed twice is ONE request for the sum of its quantities -- checking each entry on its own would
  // let two entries of "2" pass against a line of 2 and double the refund and the restock.
  const merged = new Map();
  for (const w of wanted) {
    const key = String(w.variantId || '');
    const qty = Math.floor(Number(w.qty));
    if (!(qty >= 1)) return fail('Please choose a valid quantity.', 'BAD_QTY');
    const prev = merged.get(key);
    merged.set(key, { qty: (prev?.qty || 0) + qty, reason: prev?.reason || w.reason });
  }
  const lines = [];
  for (const [key, w] of merged) {
    const line = byKey.get(key);
    if (!line) return fail('One of the selected items cannot be returned.', 'NOT_RETURNABLE', 409);
    if (w.qty > line.returnableQty) return fail(`You can return at most ${line.returnableQty} of "${line.name}".`, 'BAD_QTY');
    lines.push({ id: line.id, variantId: line.variantId, name: line.name, variantLabel: line.variantLabel || '', image: line.image || null, qty: w.qty, price: line.price, reason: String(w.reason || cleanReason).slice(0, 200) });
  }

  const { data: created, error } = await supabase.from('order_returns').insert({
    order_uuid: order.id, order_id: order.order_id, user_id: userId,
    type: type === 'replacement' ? 'replacement' : 'return',
    items: lines, reason: cleanReason, details: String(details || '').trim().slice(0, 1000) || null,
    status: 'Requested', refund_amount: returnRefundAmount(order, lines),
  }).select('*').single();
  if (error) { console.error('requestReturn: insert failed', error.message); return fail('Could not submit your request. Please try again.', 'ERROR', 500); }

  const notified = await notifyOrderEvent({
    eventType: 'RETURN_REQUESTED', order, sentBy: 'customer', channels: { whatsapp: false },
    extra: { returnId: created.id, returnReason: cleanReason },
  });
  return { ok: true, return: created, notified };
}

const RETURN_FLOW = {
  Requested: ['Approved', 'Rejected'],
  Approved: ['Pickup Scheduled', 'Received', 'Refunded', 'Closed'],
  'Pickup Scheduled': ['Received', 'Refunded', 'Closed'],
  Received: ['Refunded', 'Closed'],
};

export async function updateReturn({ returnId, status, adminNote, refundAmount, restock, by }) {
  const { data: ret } = await supabase.from('order_returns').select('*').eq('id', returnId).maybeSingle();
  if (!ret) return fail('Return request not found.', 'NOT_FOUND', 404);
  const order = await loadOrder(ret.order_uuid);
  if (!order) return fail('Order not found.', 'NOT_FOUND', 404);

  const patch = {};
  if (adminNote !== undefined) patch.admin_note = String(adminNote || '').slice(0, 1000) || null;
  if (restock !== undefined) patch.restock = !!restock;
  const wantsRefund = status === 'Refunded';
  const amountForRefund = wantsRefund ? round2(refundAmount ?? ret.refund_amount) : null;
  if (refundAmount !== undefined && Number.isFinite(Number(refundAmount)) && Number(refundAmount) >= 0) patch.refund_amount = round2(refundAmount);

  let notified = null;
  let refund = null;

  if (status && status !== ret.status) {
    if (!(RETURN_FLOW[ret.status] || []).includes(status)) return fail(`A return that is ${ret.status} cannot move to ${status}.`, 'BAD_TRANSITION', 409);
    patch.status = status;
    if (['Rejected', 'Refunded', 'Closed'].includes(status)) patch.resolved_at = new Date().toISOString();

    // Claim the transition first (compare-and-set on the previous status) so a double click can't refund twice.
    const { data: claimed, error } = await supabase.from('order_returns').update(patch).eq('id', ret.id).eq('status', ret.status).select('*');
    if (error || !claimed?.length) return fail('This return was just updated by someone else. Refresh and try again.', 'CONFLICT', 409);

    const extra = { returnId: ret.id, returnReason: ret.reason || '', returnNote: patch.admin_note ?? ret.admin_note ?? '' };
    if (status === 'Approved') notified = await notifyOrderEvent({ eventType: 'RETURN_APPROVED', order, sentBy: by, extra, channels: { whatsapp: false } });
    if (status === 'Rejected') notified = await notifyOrderEvent({ eventType: 'RETURN_REJECTED', order, sentBy: by, extra, channels: { whatsapp: false } });

    if (wantsRefund) {
      refund = await refundMoney({ order, amount: amountForRefund, reason: `Return ${String(ret.id).slice(0, 8).toUpperCase()}`, by, allowManual: true });
      if (!refund.ok || !(refund.amount > 0)) {
        // roll the claim back so the admin can retry (gateway down, or nothing left to refund -- never restock for nothing)
        await supabase.from('order_returns').update({ status: ret.status, resolved_at: null }).eq('id', ret.id).eq('status', 'Refunded');
        return refund.ok ? fail('Nothing was refunded: this order has no refundable balance left.', 'NOTHING_TO_REFUND', 409) : refund;
      }
      const shouldRestock = patch.restock ?? ret.restock;
      if (shouldRestock) await supabase.rpc('restock_items', { p_ref: `return:${ret.id}`, p_items: ret.items, p_reason: 'return' });
      const fresh = await loadOrder(order.order_id);
      // everything refunded -> the order itself is now Returned
      if (fresh && fresh.status === 'Delivered' && Number(fresh.refunded_amount) + 0.005 >= Number(fresh.total) && Number(fresh.total) > 0) {
        await supabase.rpc('transition_order', { p_order_id: fresh.order_id, p_to: 'Returned', p_allowed: ['Delivered'], p_by: by, p_note: 'Fully refunded' });
      }
      notified = await notifyOrderEvent({ eventType: 'REFUND_PROCESSED', order: (await loadOrder(order.order_id)) || order, sentBy: by, extra: { ...extra, refundAmount: refund.amount, refundId: refund.refundId || '' } });
      await supabase.from('order_returns').update({ refund_ref: refund.refundId || (refund.manual ? 'manual' : null), refund_amount: refund.amount || patch.refund_amount || ret.refund_amount }).eq('id', ret.id);
    }
  } else if (Object.keys(patch).length) {
    await supabase.from('order_returns').update(patch).eq('id', ret.id);
  }

  const { data: fresh } = await supabase.from('order_returns').select('*').eq('id', ret.id).maybeSingle();
  return { ok: true, return: fresh, refund, notified };
}

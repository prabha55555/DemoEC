import {
  adminCanCancel, buildTimeline, cancelConsequences, codToCollect, describeNotified, itemsHeadline, lineAmounts, nextStep, notifiedSentence,
  orderListFilters, planBulkAdvance, planNotification, refundBlockReason, refundEntries, refundSummary, runBulkAdvance, statusValues, waNumber,
} from './orderLogic';

const order = (o = {}) => ({
  id: 'u1', order_id: 'BL-1', status: 'Placed', payment_method: 'razorpay', payment_status: 'paid', total: 1000, refunded_amount: 0, refunds: [],
  gift_card_applied: 0, discount: 0, items: [{ id: 'p1', name: 'Shirt', qty: 2, price: 500 }], user_email: 'a@b.test', user_phone: '9876543210', ...o,
});

describe('status filter values', () => {
  test('Placed also matches the legacy Paid / Pending rows', () => {
    expect(statusValues('Placed')).toEqual(['Placed', 'Paid', 'Pending']);
  });
  test('a comma list (the dashboard link) keeps every status once', () => {
    expect(statusValues('Placed,Confirmed,Packed')).toEqual(['Placed', 'Paid', 'Pending', 'Confirmed', 'Packed']);
  });
  test('unknown words in a hand-edited URL are ignored; empty means no filter', () => {
    expect(statusValues('Nonsense,Shipped')).toEqual(['Shipped']);
    expect(statusValues('')).toEqual([]);
    expect(statusValues(undefined)).toEqual([]);
  });
});

describe('orderListFilters', () => {
  const base = { status: '', method: '', pay: '', from: '', to: '', flag: '' };
  test('no filters: only soft-deleted orders are hidden', () => {
    expect(orderListFilters(base)).toEqual({ deleted_at: null });
  });
  test('every filter lands on its column', () => {
    const f = orderListFilters({ ...base, status: 'Shipped', method: 'cod', pay: 'cod_pending', from: '2026-10-01', to: '2026-10-06', flag: 'inventory_issue' });
    expect(f.status).toEqual(['Shipped']);
    expect(f.payment_method).toBe('cod');
    expect(f.payment_status).toBe('cod_pending');
    expect(f.inventory_issue).toEqual({ not: ['is', null] });
    expect(f.deleted_at).toBeNull();
    // 1 Oct 00:00 IST = 30 Sep 18:30 UTC; the whole last day counts, so the range ends at 7 Oct 00:00 IST
    expect(f.created_at).toEqual({ gte: '2026-09-30T18:30:00.000Z', lt: '2026-10-06T18:30:00.000Z' });
  });
  test('the deleted view shows only soft-deleted orders', () => {
    expect(orderListFilters({ ...base, flag: 'deleted' })).toEqual({ deleted_at: { not: ['is', null] } });
  });
  test('withStatus: false leaves the status out (tab counts)', () => {
    expect(orderListFilters({ ...base, status: 'Shipped' }, { withStatus: false }).status).toBeUndefined();
  });
});

describe('quick advance', () => {
  test('each status offers its next happy-path step, never Cancelled', () => {
    expect(nextStep(order({ status: 'Placed' }))).toBe('Confirmed');
    expect(nextStep(order({ status: 'Confirmed' }))).toBe('Packed');
    expect(nextStep(order({ status: 'Packed' }))).toBe('Shipped');
    expect(nextStep(order({ status: 'Shipped' }))).toBe('Out for Delivery');
    expect(nextStep(order({ status: 'Out for Delivery' }))).toBe('Delivered');
  });
  test('finished, cancelled, returned and deleted orders offer nothing', () => {
    ['Delivered', 'Cancelled', 'Returned'].forEach(s => expect(nextStep(order({ status: s }))).toBeNull());
    expect(nextStep(order({ deleted_at: '2026-10-01T00:00:00Z' }))).toBeNull();
  });
  test('a legacy Paid row advances like Placed', () => {
    expect(nextStep(order({ status: 'Paid' }))).toBe('Confirmed');
  });
});

describe('planBulkAdvance', () => {
  const orders = [
    order({ id: 'a', order_id: 'BL-1', status: 'Placed' }),
    order({ id: 'b', order_id: 'BL-2', status: 'Packed' }),
    order({ id: 'c', order_id: 'BL-3', status: 'Packed' }),
    order({ id: 'd', order_id: 'BL-4', status: 'Delivered' }),
    order({ id: 'e', order_id: 'BL-5', status: 'Cancelled' }),
    order({ id: 'f', order_id: 'BL-6', status: 'Shipped', deleted_at: '2026-10-01T00:00:00Z' }),
  ];
  const plan = planBulkAdvance(orders);
  test('every movable order moves exactly one step', () => {
    expect(plan.moves.map(m => `${m.orderId}:${m.from}>${m.to}`)).toEqual(['BL-1:Placed>Confirmed', 'BL-2:Packed>Shipped', 'BL-3:Packed>Shipped']);
  });
  test('the others are listed with a reason, not dropped', () => {
    expect(plan.skipped.map(s => `${s.orderId}:${s.reason}`)).toEqual(['BL-4:Already delivered', 'BL-5:Cancelled', 'BL-6:Deleted order']);
  });
  test('the summary groups by destination in lifecycle order', () => {
    expect(plan.summary).toEqual([{ to: 'Confirmed', count: 1 }, { to: 'Shipped', count: 2 }]);
  });
  test('nothing selected plans nothing', () => {
    expect(planBulkAdvance([])).toEqual({ moves: [], skipped: [], summary: [] });
  });
});

describe('runBulkAdvance', () => {
  const moves = [{ orderId: 'BL-1', to: 'Packed' }, { orderId: 'BL-2', to: 'Packed' }, { orderId: 'BL-3', to: 'Packed' }];
  test('runs one at a time, in order, and reports progress', async () => {
    const calls = [];
    const progress = [];
    const res = await runBulkAdvance(moves, async (m, o) => { calls.push([m.orderId, o.notify]); return { ok: true, notified: { email: 'sent' } }; }, { notify: false, onProgress: p => progress.push(p.index) });
    expect(calls).toEqual([['BL-1', false], ['BL-2', false], ['BL-3', false]]);
    expect(progress).toEqual([0, 1, 2]);
    expect(res.done).toHaveLength(3);
    expect(res.failed).toEqual([]);
  });
  test('one failure (or a throw) never stops the rest, and carries the server message', async () => {
    const res = await runBulkAdvance(moves, async (m) => {
      if (m.orderId === 'BL-1') return { ok: false, error: 'This order is Shipped; it cannot move to Packed.' };
      if (m.orderId === 'BL-2') throw new Error('boom');
      return { ok: true };
    });
    expect(res.done.map(d => d.orderId)).toEqual(['BL-3']);
    expect(res.failed.map(f => `${f.orderId}: ${f.error}`)).toEqual(['BL-1: This order is Shipped; it cannot move to Packed.', 'BL-2: boom']);
  });
  test('"too many requests" stops the run: the remainder is reported untouched, not hammered', async () => {
    let n = 0;
    const res = await runBulkAdvance(moves, async () => { n += 1; return n === 2 ? { ok: false, status: 429, error: 'Too many requests.' } : { ok: true }; });
    expect(n).toBe(2);
    expect(res.done.map(d => d.orderId)).toEqual(['BL-1']);
    expect(res.failed.map(f => f.orderId)).toEqual(['BL-2']);
    expect(res.notAttempted.map(f => f.orderId)).toEqual(['BL-3']);
  });
});

describe('notification wording', () => {
  test('describeNotified turns the server result into plain words', () => {
    const parts = describeNotified({ email: 'sent', whatsapp: 'skipped:no-template' });
    expect(parts).toEqual([
      { channel: 'email', state: 'sent', text: 'Email sent' },
      { channel: 'whatsapp', state: 'skipped', text: 'no enabled WhatsApp template for this event' },
    ]);
    expect(notifiedSentence({ email: 'sent', whatsapp: 'skipped:no-template' })).toBe('Email sent · WhatsApp: no enabled WhatsApp template for this event');
    expect(notifiedSentence({ email: 'failed', whatsapp: 'skipped:no-phone' })).toBe('Email could not be sent · WhatsApp: the customer has no phone number');
    expect(describeNotified(null)).toEqual([]);
    expect(notifiedSentence({ email: 'skipped', whatsapp: 'skipped' })).toBe('');
  });
  test('Confirmed / Packed send nothing, and the dialog says so', () => {
    const plan = planNotification({ to: 'Packed', order: order() });
    expect(plan.eventType).toBeNull();
    expect(plan.lines[0].text).toMatch(/Nothing is sent to the customer/);
  });
  test('Shipped with enabled templates lists both channels', () => {
    const plan = planNotification({ to: 'Shipped', order: order(), templates: { email: { name: 'Shipped (system)' }, whatsapp: { name: 'x' } } });
    expect(plan.eventType).toBe('ORDER_SHIPPED');
    expect(plan.lines.map(l => `${l.channel}:${l.state}`)).toEqual(['email:send', 'whatsapp:send']);
    expect(plan.lines[0].text).toContain('a@b.test');
  });
  test('says plainly when no enabled template exists, or the customer cannot be reached', () => {
    const none = planNotification({ to: 'Delivered', order: order(), templates: { email: null, whatsapp: null } });
    expect(none.lines.map(l => l.state)).toEqual(['skip', 'skip']);
    expect(none.lines[0].text).toMatch(/no enabled "Order Delivered" email template/);
    const noContact = planNotification({ to: 'Delivered', order: order({ user_email: '', user_phone: '' }), templates: { email: { name: 'x' }, whatsapp: { name: 'y' } } });
    expect(noContact.lines[0].text).toMatch(/no email address/);
    expect(noContact.lines[1].text).toMatch(/no phone number/);
  });
});

describe('refunds', () => {
  const entries = [
    { id: 'r2', amount: 100, at: '2026-10-02T10:00:00Z', type: 'online', status: 'failed', reason: 'x' },
    { id: 'r1', amount: 200, at: '2026-10-01T10:00:00Z', type: 'manual', status: 'processed', by: 'admin@x' },
    { id: 'r3', amount: 50, at: '2026-10-03T10:00:00Z', type: 'gift_card', status: 'processed', code: 'BL-GC-1' },
    { id: 'r4', amount: 30, at: '2026-10-04T10:00:00Z' }, // an old row: no type, no status
  ];
  test('entries are normalised and sorted oldest first', () => {
    const list = refundEntries(order({ refunds: entries }));
    expect(list.map(e => e.id)).toEqual(['r1', 'r2', 'r3', 'r4']);
    expect(list[3]).toMatchObject({ type: 'online', status: 'processed' });
    expect(list[1].status).toBe('failed');
    expect(refundEntries(order({ refunds: null }))).toEqual([]);
  });
  test('the remaining hint is total - refunded_amount (the column already counts only money that left)', () => {
    const s = refundSummary(order({ total: 1000, refunded_amount: 230, refunds: entries }));
    expect(s.remaining).toBe(770);
    expect(s.hasFailed).toBe(true);
    expect(s.canRefund).toBe(true);
  });
  test('gift-card credits are tracked separately from gateway money', () => {
    const s = refundSummary(order({ total: 1000, gift_card_applied: 300, gift_card_code: 'BL-GC-1', refunded_amount: 0, refunds: [entries[2]] }));
    expect(s.giftReturned).toBe(50);
    expect(s.giftLeft).toBe(250);
  });
  test('a cancelled online order whose gateway refund failed needs attention', () => {
    const o = order({ status: 'Cancelled', total: 1000, refunded_amount: 0, refunds: [{ id: 'f', amount: 1000, status: 'failed', type: 'online' }] });
    const s = refundSummary(o);
    expect(s.needsAttention).toBe(true);
    expect(s.canRefund).toBe(true);
    expect(refundSummary(order({ refunded_amount: 1000 })).needsAttention).toBe(false);
  });
  test('a failed goodwill refund on a live order owes nothing, so it raises no "money still owed" warning', () => {
    const failed = [{ id: 'f', amount: 100, status: 'failed', type: 'online' }];
    expect(refundSummary(order({ status: 'Placed', total: 439, refunded_amount: 0, refunds: failed })).needsAttention).toBe(false);
    expect(refundSummary(order({ status: 'Delivered', total: 439, refunded_amount: 0, refunds: failed })).needsAttention).toBe(false);
    expect(refundSummary(order({ status: 'Cancelled', total: 439, refunded_amount: 0, refunds: failed })).needsAttention).toBe(true);
  });
  test('the refund button is blocked, with a reason, where a refund makes no sense', () => {
    expect(refundBlockReason(order({ items: [{ isGiftCard: true, qty: 1, price: 1000 }] }))).toMatch(/Cancel the order instead/);
    expect(refundBlockReason(order({ payment_method: 'free', total: 0 }))).toMatch(/Nothing was charged/);
    expect(refundBlockReason(order({ payment_method: 'cod', payment_status: 'cod_pending' }))).toMatch(/no money has been collected/);
    expect(refundBlockReason(order({ refunded_amount: 1000 }))).toMatch(/fully refunded/);
    expect(refundBlockReason(order({ payment_method: 'cod', payment_status: 'paid', status: 'Delivered' }))).toBe('');
    expect(refundBlockReason(order())).toBe('');
  });
  test('before delivery only part of an order can be refunded: the cap leaves Rs 1, and the button blocks once nothing may go back', () => {
    expect(refundSummary(order({ status: 'Shipped', total: 1000 }))).toMatchObject({ cap: 999, maxAmount: 999, canRefund: true });
    expect(refundSummary(order({ status: 'Placed', total: 1000, refunded_amount: 400 }))).toMatchObject({ cap: 599, maxAmount: 599 });
    expect(refundSummary(order({ status: 'Delivered', total: 1000 }))).toMatchObject({ cap: null, maxAmount: 1000, canRefund: true });
    expect(refundBlockReason(order({ status: 'Packed', total: 1000, refunded_amount: 999.5 }))).toMatch(/cancel the order instead/i);
    expect(refundBlockReason(order({ status: 'Delivered', total: 1000, refunded_amount: 999.5 }))).toBe('');
  });
});

describe('cancelConsequences', () => {
  const kinds = (o) => cancelConsequences(o).map(c => c.kind);
  test('a plain paid online order: restock, refund, status, notification', () => {
    expect(kinds(order())).toEqual(['stock', 'refund-online', 'status', 'notify']);
  });
  test('coupon, gift card and refund all appear when the order used them', () => {
    const list = cancelConsequences(order({ coupon_code: 'SAVE', discount: 100, gift_card_code: 'BL-GC-9', gift_card_applied: 400, total: 600 }));
    expect(list.map(c => c.kind)).toEqual(['stock', 'coupon', 'gift-credit', 'refund-online', 'status', 'notify']);
    expect(list.find(c => c.kind === 'coupon').text).toContain('SAVE');
    expect(list.find(c => c.kind === 'gift-credit').text).toContain('BL-GC-9');
    expect(list.find(c => c.kind === 'refund-online').text).toContain('600');
  });
  test('an order with a stock-hold problem does not promise a restock', () => {
    const list = cancelConsequences(order({ inventory_issue: { reason: 'expired' } }));
    expect(list[0].kind).toBe('stock-none');
    expect(list[0].text).toMatch(/never taken out of stock/);
  });
  test('COD: nothing to refund while pending, cash to repay once delivered', () => {
    expect(cancelConsequences(order({ payment_method: 'cod', payment_status: 'cod_pending' })).find(c => c.kind === 'refund-none').text).toMatch(/nothing was collected/);
    expect(cancelConsequences(order({ payment_method: 'cod', payment_status: 'paid' })).find(c => c.kind === 'refund-none').text).toMatch(/yours to pay out/);
  });
  test('an order that bought a gift card says the card is voided first', () => {
    expect(kinds(order({ items: [{ isGiftCard: true, qty: 1, price: 1000 }] }))[0]).toBe('gift-void');
  });
  test('an already refunded payment is not promised again', () => {
    expect(kinds(order({ refunded_amount: 1000 }))).toContain('refund-none');
  });
  test('only some statuses can be cancelled by an admin', () => {
    expect(adminCanCancel(order({ status: 'Shipped' }))).toBe(true);
    expect(adminCanCancel(order({ status: 'Delivered' }))).toBe(false);
    expect(adminCanCancel(order({ status: 'Placed', deleted_at: '2026-10-01T00:00:00Z' }))).toBe(false);
  });
});

describe('buildTimeline', () => {
  const o = order({
    timeline: [{ status: 'Placed', at: '2026-10-01T10:00:00Z', by: 'system' }, { status: 'Shipped', at: '2026-10-02T10:00:00Z', by: 'admin@x', note: 'Handed to courier' }],
    refunds: [{ id: 'r1', amount: 200, at: '2026-10-03T10:00:00Z', type: 'online', status: 'processed', reason: 'Goodwill', ref: 'rfnd_1' }, { id: 'r2', amount: 50, at: '2026-10-03T11:00:00Z', type: 'online', status: 'failed' }],
  });
  const returns = [{ id: 'abcdef12-0000', type: 'return', created_at: '2026-10-02T15:00:00Z', status: 'Refunded', resolved_at: '2026-10-04T09:00:00Z', reason: 'Damaged', admin_note: 'ok' }];
  const t = buildTimeline(o, returns);
  test('status changes, refunds and returns are woven together, newest first', () => {
    expect(t.map(e => e.title)).toEqual([
      'Return refunded (ABCDEF12)', 'Refund failed: ₹50', 'Refund: ₹200', 'Return requested (ABCDEF12)', 'Shipped', 'Placed',
    ]);
  });
  test('who and what each entry carries', () => {
    expect(t.find(e => e.title === 'Shipped')).toMatchObject({ by: 'admin@x', detail: 'Handed to courier', kind: 'status' });
    expect(t.find(e => e.title === 'Refund: ₹200').detail).toBe('to the original payment method · Goodwill · ref rfnd_1');
    expect(t.find(e => e.title === 'Refund failed: ₹50')).toMatchObject({ failed: true, tone: 'danger' });
    expect(t.find(e => e.kind === 'return').href).toBe('/admin/returns/abcdef12-0000');
  });
  test('an order with nothing recorded has an empty timeline', () => {
    expect(buildTimeline(order({ timeline: null, refunds: null }))).toEqual([]);
  });
});

describe('small helpers', () => {
  test('lineAmounts takes the line coupon share off', () => {
    expect(lineAmounts({ qty: 2, price: 499, lineDiscount: 100 })).toEqual({ qty: 2, gross: 998, discount: 100, net: 898 });
    expect(lineAmounts({ qty: 1, price: 50, lineDiscount: 80 }).net).toBe(0);
  });
  test('itemsHeadline: first item, how many more, total units', () => {
    const h = itemsHeadline(order({ items: [{ name: 'A', qty: 2 }, { name: 'B', qty: 1 }, { name: 'C', qty: 3 }] }));
    expect(h.first.name).toBe('A');
    expect(h.more).toBe(2);
    expect(h.units).toBe(6);
  });
  test('wa.me numbers: a 10-digit mobile gets 91 in front', () => {
    expect(waNumber('98765 43210')).toBe('919876543210');
    expect(waNumber('+91 98765 43210')).toBe('919876543210');
    expect(waNumber('09876543210')).toBe('9876543210');
  });
  test('codToCollect is the amount a courier takes, only while it is unpaid', () => {
    expect(codToCollect(order({ payment_method: 'cod', payment_status: 'cod_pending', total: 1597 }))).toBe(1597);
    expect(codToCollect(order({ payment_method: 'cod', payment_status: 'paid' }))).toBe(0);
    expect(codToCollect(order())).toBe(0);
  });
});

describe('returns helpers', () => {
  const { returnNextStatuses, returnWindows, itemsSummaryText, RETURN_ACTION_LABEL } = require('./orderLogic');
  test('the next moves follow the server flow', () => {
    expect(returnNextStatuses('Requested')).toEqual(['Approved', 'Rejected']);
    expect(returnNextStatuses('Approved')).toEqual(['Pickup Scheduled', 'Received', 'Refunded', 'Closed']);
    expect(returnNextStatuses('Pickup Scheduled')).toEqual(['Received', 'Refunded', 'Closed']);
    expect(returnNextStatuses('Received')).toEqual(['Refunded', 'Closed']);
    ['Rejected', 'Refunded', 'Closed', 'Nonsense'].forEach(s => expect(returnNextStatuses(s)).toEqual([]));
    returnNextStatuses('Approved').forEach(s => expect(RETURN_ACTION_LABEL[s]).toBeTruthy());
  });
  test('a summary line per item, with the variant when there is one', () => {
    expect(itemsSummaryText([{ qty: 2, name: 'Kurta', variantLabel: 'M / Red' }, { qty: 1, name: 'Cap', variantLabel: 'Default' }])).toBe('2 × Kurta (M / Red), 1 × Cap');
    expect(itemsSummaryText(null)).toBe('');
  });
  test('return windows count from the delivery date, per line', () => {
    const delivered = '2026-10-01T00:00:00Z';
    const o = { delivered_at: delivered, items: [{ variantId: 'a', name: 'A', returnWindowDays: 7 }, { variantId: 'b', name: 'B', returnWindowDays: 0 }] };
    const day = 24 * 60 * 60 * 1000;
    const within = new Date(delivered).getTime() + 3 * day;
    const after = new Date(delivered).getTime() + 9 * day;
    const w1 = returnWindows(o, [{ variantId: 'a' }, { variantId: 'b' }], within);
    expect(w1[0]).toMatchObject({ state: 'open', daysLeft: 4, deadline: '2026-10-08T00:00:00.000Z' });
    expect(w1[1].state).toBe('none');
    expect(returnWindows(o, [{ variantId: 'a' }], after)[0]).toMatchObject({ state: 'closed' });
    expect(returnWindows({ ...o, delivered_at: null }, [{ variantId: 'a' }], within)[0].state).toBe('unknown');
  });
});

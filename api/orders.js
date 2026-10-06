// Vercel serverless function -- every action that changes an order AFTER it is placed.
// One function with an `action` switch (Hobby plan caps a deployment at 12 functions; see
// api/lookup.js for the same pattern). The logic lives in src/utils/orderActions.js.
//
//   customer (needs the customer's own session token; ownership is re-checked server-side)
//     cancel          { orderId, reason }
//     return_request  { orderId, items:[{variantId, qty, reason}], reason, details, type }
//   admin (requireAdmin: confirmed admin account only)
//     admin_status    { orderId, status, note, tracking:{carrier,number,url}, notify }
//     admin_cancel    { orderId, reason }
//     admin_refund    { orderId, amount, reason }
//     return_update   { returnId, status, adminNote, refundAmount, restock }
//
// Nothing here trusts an amount from the browser except an admin's explicit refund amount, and even
// that is capped at what the order actually charged (refundMoney).
import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '../src/utils/requireAdmin.js';
import { isRateLimited, clientIp } from '../src/utils/rateLimit.js';
import { cancelOrder, updateStatus, adminRefund, requestReturn, updateReturn } from '../src/utils/orderActions.js';

// Anon-key client used ONLY to verify the caller's own bearer token.
const supabaseAuth = createClient(process.env.REACT_APP_SUPABASE_URL, process.env.REACT_APP_SUPABASE_ANON_KEY);

// Cancelling / refunding can send an email, a WhatsApp message and call Razorpay in one request.
export const config = { maxDuration: 30 };

const CUSTOMER_ACTIONS = new Set(['cancel', 'return_request']);
const ADMIN_ACTIONS = new Set(['admin_status', 'admin_cancel', 'admin_refund', 'return_update']);

function reply(res, result) {
  if (result.ok) { res.status(200).json(result); return; }
  res.status(result.status || 400).json({ ok: false, error: result.error, code: result.code });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }
  const body = req.body || {};
  const action = String(body.action || '');
  if (!CUSTOMER_ACTIONS.has(action) && !ADMIN_ACTIONS.has(action)) {
    res.status(400).json({ ok: false, error: 'Unknown action.' });
    return;
  }
  if (isRateLimited(`orders:${clientIp(req)}`, { limit: 60, windowMs: 10 * 60 * 1000 })) {
    res.status(429).json({ ok: false, error: 'Too many requests. Please wait a few minutes and try again.' });
    return;
  }

  try {
    if (CUSTOMER_ACTIONS.has(action)) {
      const authHeader = req.headers.authorization || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
      if (!token) { res.status(401).json({ ok: false, error: 'Please sign in to continue.' }); return; }
      const { data, error } = await supabaseAuth.auth.getUser(token);
      if (error || !data?.user) { res.status(401).json({ ok: false, error: 'Your session has expired. Please sign in again.' }); return; }
      const userId = data.user.id;

      if (action === 'cancel') {
        reply(res, await cancelOrder({ ref: body.orderId, by: `customer:${userId}`, reason: body.reason, userId, actor: 'customer' }));
        return;
      }
      reply(res, await requestReturn({ ref: body.orderId, userId, items: body.items, reason: body.reason, details: body.details, type: body.type }));
      return;
    }

    const auth = await requireAdmin(req, `orders:${action}`);
    if (!auth.ok) { res.status(auth.status).json({ ok: false, error: auth.error }); return; }
    const by = auth.adminEmail;

    if (action === 'admin_status') {
      reply(res, await updateStatus({ ref: body.orderId, to: body.status, by, note: body.note, tracking: body.tracking || null, notify: body.notify !== false }));
    } else if (action === 'admin_cancel') {
      reply(res, await cancelOrder({ ref: body.orderId, by, reason: body.reason, actor: 'admin' }));
    } else if (action === 'admin_refund') {
      reply(res, await adminRefund({ ref: body.orderId, amount: body.amount, reason: body.reason, by }));
    } else {
      reply(res, await updateReturn({ returnId: body.returnId, status: body.status, adminNote: body.adminNote, refundAmount: body.refundAmount, restock: body.restock, by }));
    }
  } catch (err) {
    console.error(`orders:${action} failed:`, err);
    res.status(500).json({ ok: false, error: 'Something went wrong. Please try again.' });
  }
}

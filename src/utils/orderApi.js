// Browser helper for api/orders.js -- every action that changes an order after it is placed
// (customer: cancel, return_request; admin: admin_status, admin_cancel, admin_refund, return_update).
// Sends the signed-in user's own session token; the server decides what that user may do.
//
//   const { ok, error, ...data } = await callOrdersApi('cancel', { orderId, reason });
//
// Never throws: a network failure resolves { ok: false, error }.
import { supabase } from '../supabase';

export async function callOrdersApi(action, payload = {}) {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    const res = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ action, ...payload }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.ok === false) return { ok: false, error: body.error || 'Something went wrong. Please try again.', code: body.code, status: res.status };
    return { ok: true, ...body };
  } catch {
    return { ok: false, error: 'Could not reach the server. Please check your connection and try again.' };
  }
}

// Admin notification sends (api/notify.js): kind = 'order-email' | 'order-whatsapp' | 'test-email'
export async function callNotifyApi(kind, payload = {}, { method = 'POST' } = {}) {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    const res = await fetch(`/api/notify?kind=${encodeURIComponent(kind)}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(method === 'POST' ? { body: JSON.stringify(payload) } : {}),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.ok === false) return { ok: false, error: body.error || 'Could not send. Please try again.', status: res.status };
    return { ok: true, ...body };
  } catch {
    return { ok: false, error: 'Could not reach the server. Please check your connection and try again.' };
  }
}

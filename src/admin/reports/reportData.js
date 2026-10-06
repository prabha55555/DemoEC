// What the report screens read from the database.
import { supabase } from '../../supabase';
import { withTimeout } from '../../utils/withTimeout';

// Calls one of the admin reporting functions (SECURITY DEFINER, admin only) and returns its rows. They return TABLES, which
// PostgREST sends as a JSON array; anything else is a broken answer and must not be shown as "no sales".
export async function rpcRows(fn, args) {
  const { data, error } = await withTimeout(supabase.rpc(fn, args), 25000);
  if (error) throw error;
  if (!Array.isArray(data)) throw new Error(`The server gave an unexpected answer for ${fn}. Please try again, and tell the developer if it keeps happening.`);
  return data;
}

// Reading orders for a report: only what the figures need, in a stable order so 1,000-row pages never skip or repeat a row.
export const GST_ORDER_COLUMNS = 'items, discount, shipping, cod_fee, address, status, refunded_amount';
export const PAYMENT_SUMMARY_COLUMNS = 'payment_method, payment_status, status, total, gift_card_applied, discount, refunded_amount';
export const PAYMENT_ROW_COLUMNS = 'id, order_id, created_at, user_name, user_email, user_phone, payment_method, payment_id, payment_status, status, total, gift_card_applied, discount, refunded_amount';
export const COUPON_ORDER_COLUMNS = 'coupon_code, discount, total, status';

export const REPORT_ROW_CAP = 20000;

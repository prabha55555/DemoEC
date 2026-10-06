// What the coupon screens read, and how each status is shown.
export const COUPON_COLUMNS = 'id, code, description, type, value, applies_to, product_ids, category_ids, active, max_uses, times_used, min_order_value, max_discount, starts_at, expires_at, per_user_limit, first_order_only, is_public, created_at';

export const STATUS_PILL = {
  active: { tone: 'success', label: 'Active' },
  scheduled: { tone: 'info', label: 'Scheduled' },
  expired: { tone: 'danger', label: 'Expired' },
  exhausted: { tone: 'warning', label: 'Used up' },
  inactive: { tone: 'neutral', label: 'Switched off' },
};

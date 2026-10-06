// Estimated delivery date range for a product, adjusted by shipping location.
// Each product carries its own base min/max days (set in Admin); a configurable list of
// metro cities gets that base estimate as-is, everywhere else adds a configurable buffer.
// This is an honest estimate, not a live courier-tracked figure -- there is no courier API
// wired in, so it is a business rule the admin controls.

const fmtDate = (d) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

// Delivery day counts (product.delivery_min/max_days) are business-day estimates from
// the courier, not calendar days -- Saturdays and Sundays don't count toward them.
// Adding them as plain calendar days understated how far out the actual delivery date
// lands whenever a weekend fell inside the window.
function addBusinessDays(date, days) {
  const result = new Date(date);
  let added = 0;
  while (added < days) {
    result.setDate(result.getDate() + 1);
    const day = result.getDay(); // 0 = Sunday, 6 = Saturday
    if (day !== 0 && day !== 6) added++;
  }
  return result;
}

// Shipping FEES live in ./shipping.js. This file only estimates WHEN an order arrives.

export function isMetroCity(city, brand) {
  if (!city) return true; // unknown location: show the optimistic/base estimate
  const metros = (brand?.delivery_metro_cities || '')
    .split(',').map(c => c.trim().toLowerCase()).filter(Boolean);
  return metros.includes(city.trim().toLowerCase());
}

export function getDeliveryRange(product, brand, city) {
  // ?? (not ||) so an admin-set 0 (same-day/ready-stock item) survives -- 0 is
  // falsy, so || would silently coerce a deliberate 0 back to the default.
  // Accepts a product row (delivery_min_days) or a cart line snapshot (deliveryMinDays).
  const baseMin = Number(product?.delivery_min_days ?? product?.deliveryMinDays ?? 5);
  const baseMax = Number(product?.delivery_max_days ?? product?.deliveryMaxDays ?? 8);
  const extra = isMetroCity(city, brand) ? 0 : (Number(brand?.delivery_extra_days) || 0);
  const minDays = baseMin + extra;
  const maxDays = baseMax + extra;

  const today = new Date();
  const start = addBusinessDays(today, minDays);
  const end = addBusinessDays(today, maxDays);

  return {
    minDays, maxDays,
    label: `${fmtDate(start)} – ${fmtDate(end)}`,
    daysLabel: minDays === maxDays ? `${minDays} business days` : `${minDays}–${maxDays} business days`,
  };
}

// Widest range across every item in a cart, since a mixed order ships together and is
// bound by whichever step takes longest.
export function getCartDeliveryRange(cartItems, brand, city) {
  const real = (cartItems || []).filter(i => !i.isGiftCard);
  if (real.length === 0) return null;
  const ranges = real.map(i => getDeliveryRange(i, brand, city));
  const minDays = Math.max(...ranges.map(r => r.minDays));
  const maxDays = Math.max(...ranges.map(r => r.maxDays));
  const today = new Date();
  const start = addBusinessDays(today, minDays);
  const end = addBusinessDays(today, maxDays);
  return {
    minDays, maxDays,
    label: `${fmtDate(start)} – ${fmtDate(end)}`,
    daysLabel: minDays === maxDays ? `${minDays} business days` : `${minDays}–${maxDays} business days`,
  };
}

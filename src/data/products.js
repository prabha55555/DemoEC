// Products are managed entirely via the Supabase Admin Panel
// This file has NO seed data — all products come from Supabase
// Admin adds products at /admin/login → Admin Panel → Add Product

// Label for the curated "Top Picks" collection (products flagged is_collectors_piece
// in the database -- the column keeps its name, only the customer-facing label changed).
export const COLLECTOR_LABEL = "Top Picks";

// Grouped taxonomy — drives the header category bar, the mega-menu and the Shop filters.
// This is only the starting default: an admin can replace it from Admin -> Brand Settings
// (stored as brand.category_taxonomy), after which that customised list is what shows.
export const CATEGORY_GROUPS = [
  { label: 'Fashion', items: ['Women Ethnic', 'Women Western', 'Men', 'Kids'] },
  { label: 'Home & Kitchen', items: ['Home Decor', 'Kitchen & Dining', 'Furnishing', 'Storage & Organisers'] },
  { label: 'Beauty & Personal Care', items: ['Skincare', 'Makeup', 'Hair Care', 'Health & Wellness'] },
  { label: 'Electronics', items: ['Mobile Accessories', 'Audio', 'Smart Gadgets', 'Computer Accessories'] },
  { label: 'Bags, Footwear & Jewellery', items: ['Bags', 'Footwear', 'Jewellery', 'Watches'] },
];

export const categories = [
  'All',
  ...CATEGORY_GROUPS.flatMap(g => g.items),
  COLLECTOR_LABEL,
];

// Categories with no products yet -- shown greyed-out with a "Coming Soon"
// badge in the nav/filter instead of silently leading to an empty "no
// products found" result that reads as broken rather than "not open yet".
// NOTE: matched by exact label text against whichever taxonomy is actually
// live (brand.category_taxonomy if the admin has customized it, else this
// file's CATEGORY_GROUPS) -- keep this in sync with the real saved spelling.
export const COMING_SOON_CATEGORIES = [];

// Resolves which taxonomy is actually live -- the admin's own customized
// category_taxonomy if they've ever saved one (including a deliberately
// emptied list), else this file's built-in default. Array.isArray, not a
// truthiness/length check, so an admin who intentionally clears every
// category doesn't have the hardcoded default silently reappear underneath
// them. Was duplicated (with exactly that bug) across five call sites before
// being consolidated here.
export function effectiveTaxonomy(brand) {
  return Array.isArray(brand?.category_taxonomy) ? brand.category_taxonomy : CATEGORY_GROUPS;
}

export const fmt = (n) => '₹' + Number(n).toLocaleString('en-IN');

// Text fields checked by both the Navbar's live search dropdown (server-side .or()/ilike,
// see SearchBar.jsx) and the Shop page's ?search= filter (client-side, over already-loaded
// products) -- kept as one shared list so the two never quietly search different things.
export const SEARCHABLE_PRODUCT_FIELDS = ['name', 'cat', 'subtitle', 'origin', 'material', 'story'];

export function matchesSearch(product, query) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return SEARCHABLE_PRODUCT_FIELDS.some(field => (product[field] || '').toLowerCase().includes(q));
}

// A product can carry up to two badges (e.g. "Vintage" + "Rare"). Older products
// stored both crammed into the single `badge` field as "A | B" before a real
// `badge2` column existed -- this splits that legacy format apart at display time
// so those products show two clean pills without needing to be re-saved in Admin.
export function productBadges(p) {
  const badge = (p.badge || '').trim();
  const badge2 = (p.badge2 || '').trim();
  if (badge2) return [badge, badge2].filter(Boolean);
  if (badge.includes('|')) return badge.split('|').map(s => s.trim()).filter(Boolean);
  return badge ? [badge] : [];
}

// Shared date display format -- three call sites (Account's Orders/Enquiries/Gift
// Cards tabs, Stories) used to each format dates slightly differently (some with
// `day: '2-digit'`, some bare `toLocaleDateString('en-IN')` with no options), so the
// same date could render "21 Aug 2026" in one place and "21/8/2026" in another.
export const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '';

// Same date format as fmtDate, plus a time -- for lists where knowing WHEN
// something came in (not just what day) matters, e.g. Admin's Enquiries
// table, where several can land on the same day and the order/time they
// arrived is part of triaging them.
export const fmtDateTime = (d) => d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }) : '';

// orders.estimated_delivery holds either a plain YYYY-MM-DD an admin explicitly set
// (via Admin's "Set & Notify"), or an auto-generated range label with no year (e.g.
// "20 Aug – 25 Aug", not parseable as a real date) -- only the former should ever be
// reformatted; running the latter through fmtDate would just produce "Invalid Date".
export const formatDeliveryLabel = (str) => /^\d{4}-\d{2}-\d{2}$/.test(str || '') ? fmtDate(str) : (str || '');

// The base product.stock field predates variants and isn't kept in sync with them --
// a variant product is only truly sold out when every one of its variants is.
// Shared by ProductCard and Shop so the grid and its "Sold Out" filter never disagree.
// Number(null) coerces to 0, not NaN -- so null/undefined must be excluded
// explicitly before coercing, not caught after the fact via Number.isFinite alone.
// Returns the numeric stock, or null if it's genuinely unset/unknown.
export const knownStock = (value) => {
  if (value === null || value === undefined) return null;
  // A string is only genuinely "unset" once whitespace is stripped -- a stray
  // space (`" "`) survives a bare `!== ''` check and then coerces to 0 via
  // Number(), wrongly reading as "explicitly sold out" instead of "not tracked."
  const trimmed = typeof value === 'string' ? value.trim() : value;
  if (trimmed === '') return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
};

// Unset stock (null, undefined, '') is treated as "unknown, assume available" --
// never as sold out -- consistent with knownStock's own null-for-unset contract.
export const isProductSoldOut = (p) =>
  Array.isArray(p.variants) && p.variants.length > 0
    ? p.variants.every(v => knownStock(v.stock) === 0)
    : knownStock(p.stock) === 0;

// A product's shipping_charge (if the admin set one) is a flat add-on to whatever
// price is being shown/charged -- shown to the customer as one combined number
// everywhere (Shop grid, product page, cart, checkout, the actual Razorpay charge)
// rather than surfaced as a separate line, so the number never differs depending on
// where you're looking at it. Mirrored server-side in api/razorpay-create-order.js,
// which re-derives this same total from the database rather than trusting the cart.
export const effectivePrice = (price, shippingCharge) => (Number(price) || 0) + (Number(shippingCharge) || 0);

// A variant-only product (Admin's own instructions: "Leave [price] empty for a
// single-option product -- the variant fields are used instead") has no base
// `price` at all -- reading p.price directly everywhere it's displayed (grid
// cards, search results, and the product page before a variant is picked) showed
// "Rs. 0" instead of a real number. This is the one price to show in all of those
// "nothing chosen yet" contexts: the lowest of its variant prices, or the
// product's own price when it has no variants.
export function startingPrice(p) {
  const variants = Array.isArray(p.variants) ? p.variants : [];
  if (variants.length > 0) {
    const prices = variants.map(v => Number(v.price)).filter(n => Number.isFinite(n) && n > 0);
    if (prices.length > 0) return Math.min(...prices);
  }
  // Normalized through Number(), not returned raw -- Admin's own save
  // validation already requires a price on every product/variant, so this
  // fallback should be unreachable in practice, but a stray non-numeric or
  // zero value from outside that path should read as "no price" (null),
  // never silently render as "Rs. 0" via fmt().
  const base = Number(p.price);
  return Number.isFinite(base) && base > 0 ? base : null;
}

// Folds a product's shipping_charge into whatever price is being added to the cart,
// and carries shipping_charge/show_shipping_at_checkout along so Cart/Checkout can
// optionally caption the line item ("Shipping included") without re-deriving it.
export function withShippingCharge(item, price) {
  return {
    ...item,
    price: effectivePrice(price, item.shipping_charge),
    shipping_charge: Number(item.shipping_charge) || 0,
    show_shipping_at_checkout: item.show_shipping_at_checkout !== false,
  };
}

// Builds the object to hand to addToCart() -- for a variant product this picks the
// first in-stock variant (falling back to the first variant if all are sold out,
// which addToCart's own stock check will then correctly reject) so callers never
// add the bare base product at its stale price/stock with no size selected.
export const productAddToCartPayload = (p) => {
  if (!Array.isArray(p.variants) || p.variants.length === 0) return withShippingCharge(p, p.price);
  // `Number(v.stock) > 0` couldn't tell "explicitly sold out (0)" apart from
  // "untracked (null)" -- both coerce to a non-positive number, so an untracked
  // (always-available) variant could lose out to a genuinely sold-out one that
  // just happens to come first. Prefer a variant with known stock, then an
  // untracked one, and only fall back to the first variant (even if sold out) if
  // nothing else qualifies -- addToCart's own stock check rejects that case.
  const variant = p.variants.find(v => knownStock(v.stock) > 0)
    || p.variants.find(v => knownStock(v.stock) === null)
    || p.variants[0];
  return { ...withShippingCharge(p, variant.price ?? p.price), size: variant.size, stock: variant.stock };
};

export default [];
// Shared save/pin (wishlist) helpers — backed by the same localStorage key
// Account.jsx's Wishlist tab already reads from.

const KEY = 'tt_wl';

export function getWishlist() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); }
  catch { return []; }
}

// `size` is optional -- callers that don't track variants (ProductCard's grid
// card, which never lets you pick a size) can keep asking "is this product
// saved at all", matching pre-variant-support behavior. Callers that do track a
// specific variant (ProductPage) should pass it, so switching between two sizes
// of the same product doesn't show one size's saved state as the other's.
export function isSaved(id, size) {
  return getWishlist().some(p => p.id === id && (size === undefined || (p.size || null) === (size || null)));
}

export function toggleSaved(product) {
  const list = getWishlist();
  const size = product.size || null;
  // Matched by (id, size) together, not id alone -- otherwise saving Large after
  // Small was already saved (same product, different size) read as "already
  // saved" and removed the Small entry instead of adding a second one for Large.
  const exists = list.some(p => p.id === product.id && (p.size || null) === size);
  const next = exists ? list.filter(p => !(p.id === product.id && (p.size || null) === size)) : [...list, product];
  localStorage.setItem(KEY, JSON.stringify(next));
  return !exists; // true if now saved
}

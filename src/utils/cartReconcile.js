// Pure rules for bringing a stored (localStorage) cart back in line with the live catalogue.
// A cart is saved in the browser and goes stale: a product may have been unpublished, a variant
// deleted, a price changed, stock sold. Also upgrades carts saved by the old size-based model.
//
// lines      the stored cart lines
// products   live product rows (id, status, name, images, brand, cat, category_id, max_qty_per_order, ...)
// variants   live variant rows for those products
// categoryIdsFor(product) -> [leaf, ...ancestors]  (for category coupons; may return [])
//
// Returns { lines, entries, removed, adjusted, repriced }
//   entries   [{ original, line }] -- line is null when the original was dropped (lets a caller merge
//             the result into a cart that changed while the catalogue check was in flight)
//   removed   lines dropped (product gone / unpublished / variant gone / unmatched legacy line)
//   adjusted  lines whose quantity was lowered to what is in stock
//   repriced  lines whose price changed since they were added
import { cartLineFromVariant, isVariantPurchasable, variantStock } from './catalog';

export function reconcileCart(lines, products, variants, categoryIdsFor = () => []) {
  const productById = new Map((products || []).map(p => [p.id, p]));
  const byProduct = new Map();
  for (const v of variants || []) {
    if (v.active === false) continue;
    if (!byProduct.has(v.product_id)) byProduct.set(v.product_id, []);
    byProduct.get(v.product_id).push(v);
  }

  const entries = [];
  let removed = 0, adjusted = 0, repriced = 0;

  for (const line of Array.isArray(lines) ? lines : []) {
    if (!line || typeof line !== 'object') { removed++; continue; }
    if (line.isGiftCard) { entries.push({ original: line, line }); continue; }

    const product = productById.get(line.id);
    if (!product || product.status !== 'active') { removed++; entries.push({ original: line, line: null }); continue; }
    const options = byProduct.get(product.id) || [];

    let variant = line.variantId ? options.find(v => v.id === line.variantId) : null;
    if (!variant && !line.variantId) {
      // legacy line saved as (product id + size): match by the variant label the migration kept,
      // or the product's only variant. Anything ambiguous is dropped rather than guessed.
      variant = options.find(v => v.label === (line.size || 'Default')) || (options.length === 1 ? options[0] : null);
    }
    if (!variant) { removed++; entries.push({ original: line, line: null }); continue; }

    const wanted = Math.max(1, Math.floor(Number(line.qty) || 1));
    const fresh = cartLineFromVariant(product, variant, { categoryIds: categoryIdsFor(product), qty: wanted });
    const soldOut = !isVariantPurchasable(variant);

    let qty = wanted;
    if (!soldOut) {
      const cap = Math.max(1, fresh.maxQty);
      if (qty > cap) { qty = cap; adjusted++; }
    }
    if (Number(line.price) > 0 && Number(line.price) !== fresh.price) repriced++;
    entries.push({ original: line, line: { ...fresh, qty, soldOut, stock: variantStock(variant) } });
  }
  return { lines: entries.filter(e => e.line).map(e => e.line), entries, removed, adjusted, repriced };
}

// Identity of a STORED line: its variant, or (legacy lines) product + size.
export const storedKey = (line) => (line?.isGiftCard ? `gc:${line.id}` : String(line?.variantId || `${line?.id}::${line?.size || ''}`));

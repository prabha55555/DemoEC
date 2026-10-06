// The write side of the catalogue screens: saving a product (a multi-step write done in a safe order), duplicating,
// deleting, bulk status changes, export paging and the CSV import runner. Every write goes through adminWrite (so a
// write that row-level security silently blocks is reported, never swallowed) and every stock change on an existing
// variant goes through the admin_adjust_stock RPC (atomic and ledgered) -- stock is never UPDATEd directly.
//
// Order of a save, so a failure at any step leaves something sensible behind:
//   1. checks (read-only)  product number + SKUs not taken by another product
//   2. the product row     (a NEW product is inserted as a DRAFT first)
//   3. variants            insert new -> update changed -> delete removed   (a product is never left without a variant)
//   4. stock               opening stock for new variants, edits to existing ones, all through admin_adjust_stock
//   5. status              publishing is written LAST, and only when everything above worked
//   6. storage clean-up    photos that are no longer used anywhere
import { supabase } from '../../supabase';
import { withTimeout } from '../../utils/withTimeout';
import { isAuthExpiredError } from '../../utils/safeFetch';
import { deleteFromStorage, storagePathOf } from '../../utils/supabaseStorage';
import { adminWrite, friendlyDbError, notifyAuthExpired } from '../hooks/adminWrite';
import { applyFilters, applyOrder } from '../hooks/serverList';
import { mapWithConcurrency } from '../lib/pool';
import { fetchAllCapped } from '../lib/queries';
import { generateProductNumber, PRODUCT_COLUMNS, productPayload, statusPlan, VARIANT_COLUMNS } from './productForm';
import { stockErrorMessage } from '../inventory/inventoryLogic';
import { diffVariants } from './variantMatrix';

const chunk = (list, n) => { const out = []; for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n)); return out; };
const uniq = (list) => Array.from(new Set(list));
const lc = (s) => String(s ?? '').trim().toLowerCase();
const step = (ok, text, extra = {}) => ({ ok, text, ...extra });

// ------------------------------------------------------------------------------------------------- reading
export async function fetchBase(productId) {
  const { data: product, error } = await withTimeout(supabase.from('products').select(PRODUCT_COLUMNS).eq('id', productId).maybeSingle(), 15000);
  if (error) throw error;
  if (!product) return null;
  const { rows } = await fetchAllCapped(() => supabase.from('product_variants').select(VARIANT_COLUMNS).eq('product_id', productId).order('position', { ascending: true }).order('id', { ascending: true }), { maxRows: 1000 });
  return { product, variants: rows };
}

// ------------------------------------------------------------------------------------------------- stock RPC
// One admin_adjust_stock call. Exactly one of delta / setTo. Returns { ok, stock, error }.
export async function callAdjustStock({ variantId, delta, setTo, reason = 'adjustment', note = null }) {
  const args = { p_variant_id: variantId, p_reason: reason, p_note: note };
  if (delta !== undefined && delta !== null) args.p_delta = delta; else args.p_set_to = setTo;
  try {
    const { data, error } = await withTimeout(supabase.rpc('admin_adjust_stock', args), 20000);
    if (error) {
      if (isAuthExpiredError(error)) notifyAuthExpired();
      return { ok: false, error: stockErrorMessage(error) };
    }
    return { ok: true, stock: typeof data === 'number' ? data : Number(data) };
  } catch (e) {
    return { ok: false, error: friendlyDbError(e) };
  }
}

// ------------------------------------------------------------------------------------------------ storage
// Deletes uploaded files that NOTHING refers to any more. A duplicated product reuses its original's photo URLs, so a
// file is only removed once no product (photo list, video, cover) and no variant picture still points at it.
// Call it AFTER the row that held the file was updated / deleted. Best-effort: never throws.
export async function safeDeleteMedia(urls) {
  try {
    const list = uniq((urls || []).filter(u => typeof u === 'string' && u && (storagePathOf(u, 'images') || storagePathOf(u, 'videos'))));
    if (!list.length) return { deleted: 0, kept: 0 };
    const used = new Set();
    await mapWithConcurrency(list, 4, async (url) => {
      const head = (q) => withTimeout(q, 15000);
      const [a, b, c, d] = await Promise.all([
        head(supabase.from('products').select('id', { count: 'exact', head: true }).contains('images', JSON.stringify([url]))),
        head(supabase.from('products').select('id', { count: 'exact', head: true }).eq('video_url', url)),
        head(supabase.from('products').select('id', { count: 'exact', head: true }).eq('video_cover_url', url)),
        head(supabase.from('product_variants').select('id', { count: 'exact', head: true }).eq('image_url', url)),
      ]);
      // If we cannot tell (a query failed), keep the file: a leftover file costs nothing, a deleted one breaks a page.
      if ([a, b, c, d].some(r => r.error) || [a, b, c, d].some(r => (r.count || 0) > 0)) used.add(url);
    });
    const gone = list.filter(u => !used.has(u));
    if (gone.length) await deleteFromStorage(gone);
    return { deleted: gone.length, kept: used.size };
  } catch {
    return { deleted: 0, kept: 0 };
  }
}

export function mediaOfBase(base) {
  if (!base) return [];
  const p = base.product || {};
  return [p.images, p.video_url, p.video_cover_url, (base.variants || []).map(v => v.image_url)].flat(2).filter(u => typeof u === 'string' && u);
}

// ------------------------------------------------------------------------------------------------- checks
export async function productNumberOwner(number, exceptId) {
  const n = String(number || '').trim();
  if (!n) return null;
  const { data, error } = await withTimeout(supabase.from('products').select('id, name, product_number').ilike('product_number', n.replace(/[%_\\]/g, m => `\\${m}`)).limit(5), 15000);
  if (error) throw error;
  return (data || []).find(p => p.id !== exceptId && lc(p.product_number) === lc(n)) || null;
}

async function uniqueProductNumber() {
  for (let i = 0; i < 5; i += 1) {
    const n = generateProductNumber();
    // eslint-disable-next-line
    if (!(await productNumberOwner(n, null))) return n;
    await new Promise(r => setTimeout(r, 5));
  }
  return `${generateProductNumber()}${Math.floor(Math.random() * 90 + 10)}`;
}

// SKUs are unique store-wide (case-insensitively). Returns [{ sku, owner: { id, product_id, sku } }] for SKUs that
// another variant already uses.
export async function skuConflicts(skus, ownVariantIds = []) {
  const wanted = uniq(skus.map(s => String(s || '').trim()).filter(Boolean));
  if (!wanted.length) return [];
  const spellings = uniq(wanted.flatMap(s => [s, s.toLowerCase(), s.toUpperCase()]));
  const own = new Set(ownVariantIds);
  const found = [];
  for (const part of chunk(spellings, 60)) {
    const { data, error } = await withTimeout(supabase.from('product_variants').select('id, product_id, sku').in('sku', part), 15000);
    if (error) throw error;
    found.push(...(data || []));
  }
  const byLc = new Map();
  for (const v of found) if (!own.has(v.id)) byLc.set(lc(v.sku), v);
  return wanted.filter(s => byLc.has(lc(s))).map(s => ({ sku: s, owner: byLc.get(lc(s)) }));
}

// ---------------------------------------------------------------------------------------------- variant writes
// Applies a diffVariants() result to the database. Returns { steps, failed, insertedByPosition }.
//   * inserts first (stock 0), then updates, then deletes: the product always has a variant
//   * when two or more variants change their options in one save (a value rename swapping places) the new options are
//     parked on a unique temporary value first, so the (product, options) unique index can never trip mid-save
async function writeVariantDiff({ productId, baseVariants, diff, startPosition = 0 }) {
  const steps = [];
  let failed = 0;
  const insertedByPosition = new Map();

  if (diff.inserts.length) {
    const rows = diff.inserts.map(({ columns }, i) => ({ ...columns, position: columns.position ?? startPosition + i, product_id: productId, stock: 0 }));
    const r = await adminWrite(supabase.from('product_variants').insert(rows), { silent: true });
    if (!r.ok) { failed += diff.inserts.length; steps.push(step(false, `Could not add ${diff.inserts.length} variant${diff.inserts.length === 1 ? '' : 's'}: ${r.error.message}`)); }
    else {
      r.data.forEach(row => insertedByPosition.set(row.position, row));
      steps.push(step(true, `${diff.inserts.length} variant${diff.inserts.length === 1 ? '' : 's'} added`));
    }
  }

  if (diff.updates.length) {
    const byId = new Map((baseVariants || []).map(v => [v.id, v]));
    // A SKU moving onto another variant's current SKU (a swap) would trip the unique index too: clear them first.
    const skuClash = diff.updates.some(u => u.patch.sku && (baseVariants || []).some(v => v.id !== u.id && lc(v.sku) === lc(u.patch.sku) && diff.updates.some(x => x.id === v.id)));
    const optionUpdates = diff.updates.filter(u => u.optionsChanged);
    const parked = new Set();
    if (optionUpdates.length >= 2) {
      await mapWithConcurrency(optionUpdates, 3, async (u) => {
        const r = await adminWrite(supabase.from('product_variants').update({ options: { __parked: u.id } }).eq('id', u.id), { silent: true });
        if (r.ok) parked.add(u.id);
      });
    }
    if (skuClash) {
      await mapWithConcurrency(diff.updates.filter(u => u.patch.sku !== undefined), 3, async (u) => {
        await adminWrite(supabase.from('product_variants').update({ sku: null }).eq('id', u.id), { silent: true });
      });
    }
    let ok = 0;
    const problems = [];
    await mapWithConcurrency(diff.updates, 3, async (u) => {
      const r = await adminWrite(supabase.from('product_variants').update(u.patch).eq('id', u.id), { silent: true });
      if (r.ok) { ok += 1; return; }
      problems.push(`${u.patch.label || byId.get(u.id)?.label || 'A variant'}: ${r.error.message}`);
      // put a parked / cleared variant back the way it was so it never stays half-edited
      const old = byId.get(u.id);
      if (old) {
        const restore = {};
        if (parked.has(u.id)) restore.options = old.options;
        if (skuClash && u.patch.sku !== undefined) restore.sku = old.sku;
        if (Object.keys(restore).length) await adminWrite(supabase.from('product_variants').update(restore).eq('id', u.id), { silent: true });
      }
    });
    failed += problems.length;
    if (ok) steps.push(step(true, `${ok} variant${ok === 1 ? '' : 's'} updated`));
    problems.forEach(p => steps.push(step(false, `Could not update ${p}`)));
  }

  if (diff.deletes.length) {
    const r = await adminWrite(supabase.from('product_variants').delete().in('id', diff.deletes), { silent: true, expectRows: false });
    if (!r.ok) { failed += diff.deletes.length; steps.push(step(false, `Could not remove ${diff.deletes.length} variant${diff.deletes.length === 1 ? '' : 's'}: ${r.error.message}`)); }
    else steps.push(step(true, `${diff.deletes.length} variant${diff.deletes.length === 1 ? '' : 's'} removed`));
  }
  return { steps, failed, insertedByPosition };
}

// Stock edits for existing variants: set_to by default; if a sale landed since the form loaded (the live number is not
// what the form started from) a relative change is applied instead, so that sale is not overwritten.
async function applyStockChanges(changes, { reason, note }) {
  if (!changes.length) return { steps: [], failed: 0 };
  const live = new Map();
  try {
    for (const part of chunk(changes.map(c => c.id), 60)) {
      // eslint-disable-next-line
      const { data } = await withTimeout(supabase.from('product_variants').select('id, stock').in('id', part), 15000);
      (data || []).forEach(v => live.set(v.id, Number(v.stock)));
    }
  } catch { /* without the live numbers the edit is applied as an absolute "set to" */ }
  let ok = 0;
  const problems = [];
  for (const c of changes) {
    const now = live.get(c.id);
    const moved = now !== undefined && now !== c.from;
    if (moved && now === c.to) { ok += 1; continue; }
    // eslint-disable-next-line
    const r = await callAdjustStock(moved ? { variantId: c.id, delta: c.to - c.from, reason, note } : { variantId: c.id, setTo: c.to, reason, note });
    if (r.ok) ok += 1; else problems.push(`${c.label || 'A variant'}: ${r.error}`);
  }
  const steps = [];
  if (ok) steps.push(step(true, `Stock updated on ${ok} variant${ok === 1 ? '' : 's'}`));
  problems.forEach(p => steps.push(step(false, `Stock not changed - ${p}`)));
  return { steps, failed: problems.length };
}

async function applyOpeningStock(inserts, insertedByPosition) {
  const todo = inserts.filter(i => i.opening > 0 && insertedByPosition.get(i.columns.position));
  if (!todo.length) return { steps: [], failed: 0 };
  let ok = 0;
  const problems = [];
  for (const i of todo) {
    const row = insertedByPosition.get(i.columns.position);
    // eslint-disable-next-line
    const r = await callAdjustStock({ variantId: row.id, delta: i.opening, reason: 'restock', note: 'Opening stock' });
    if (r.ok) ok += 1; else problems.push(`${i.columns.label}: ${r.error}`);
  }
  const steps = [];
  if (ok) steps.push(step(true, `Opening stock recorded for ${ok} variant${ok === 1 ? '' : 's'}`));
  problems.forEach(p => steps.push(step(false, `Opening stock not recorded - ${p}`)));
  return { steps, failed: problems.length };
}

// ------------------------------------------------------------------------------------------------ save
// form must already have passed validateForm (mode 'publish' when targetStatus is 'active').
//   base: { product, variants } as last read from the database, or null for a brand-new product.
// Returns { ok, stage, productId, base (re-read from the database, or null), steps, error?, field? }.
export async function saveProduct({ form, base, categories, targetStatus }) {
  const steps = [];
  const isNew = !base?.product;
  let productId = base?.product?.id || null;
  const payload = productPayload(form, categories);
  const { writeLast } = statusPlan(isNew ? 'draft' : base.product.status, targetStatus);
  const rows = form.variants;
  const baseVariants = base?.variants || [];
  const finish = (extra) => ({ steps, productId, ...extra });

  // 1. checks
  try {
    if (payload.product_number) {
      const owner = await productNumberOwner(payload.product_number, productId);
      if (owner) return finish({ ok: false, stage: 'check', base, field: 'product_number', error: `The product number "${payload.product_number}" is already used by "${owner.name}".` });
    } else if (isNew) payload.product_number = await uniqueProductNumber();
    const clashes = await skuConflicts(rows.map(r => r.sku), rows.map(r => r.id).filter(Boolean));
    if (clashes.length) {
      const c = clashes[0];
      return finish({ ok: false, stage: 'check', base, field: 'sku', skus: clashes.map(x => x.sku), error: `The SKU "${c.sku}" is already used by another product's variant.${clashes.length > 1 ? ` (${clashes.length - 1} more SKU${clashes.length === 2 ? '' : 's'} clash too.)` : ''}` });
    }
  } catch (e) {
    return finish({ ok: false, stage: 'check', base, error: friendlyDbError(e) });
  }

  // 2. the product row
  if (isNew) {
    const r = await adminWrite(supabase.from('products').insert({ ...payload, status: 'draft' }), { silent: true });
    if (!r.ok) return finish({ ok: false, stage: 'product', base, error: r.error.message, steps: [step(false, `The product could not be created: ${r.error.message}`)] });
    productId = r.data[0].id;
    steps.push(step(true, 'Product created'));
  } else {
    const patch = { ...payload, ...(writeLast ? {} : { status: targetStatus }) };
    const r = await adminWrite(supabase.from('products').update(patch).eq('id', productId), { silent: true });
    if (!r.ok) return finish({ ok: false, stage: 'product', base, error: r.error.message, steps: [step(false, `The product details were not saved: ${r.error.message}`)] });
    steps.push(step(true, 'Product details saved'));
  }

  let failed = 0;
  try {
    // 3. variants
    const diff = diffVariants(baseVariants, rows);
    const labelOf = new Map(rows.filter(r => r.id).map(r => [r.id, r.label]));
    diff.stockChanges.forEach((c) => { c.label = labelOf.get(c.id); });
    const vw = await writeVariantDiff({ productId, baseVariants, diff });
    steps.push(...vw.steps);

    // 4. stock
    const opening = await applyOpeningStock(diff.inserts, vw.insertedByPosition);
    steps.push(...opening.steps);
    const edits = await applyStockChanges(diff.stockChanges, { reason: 'adjustment', note: 'Edited in product form' });
    steps.push(...edits.steps);

    failed = vw.failed + opening.failed + edits.failed;

    // 5. status last
    if (writeLast) {
      if (failed) steps.push(step(false, `Not ${targetStatus === 'active' ? 'published' : 'changed to ' + targetStatus} because something above failed. It stays ${isNew ? 'a draft' : base.product.status}.`));
      else {
        const { count, error } = await withTimeout(supabase.from('product_variants').select('id', { count: 'exact', head: true }).eq('product_id', productId).eq('active', true), 15000);
        if (error || !count) {
          failed += 1;
          steps.push(step(false, 'Not published: the product has no active variant.'));
        } else {
          const r = await adminWrite(supabase.from('products').update({ status: targetStatus }).eq('id', productId), { silent: true });
          if (!r.ok) { failed += 1; steps.push(step(false, `Could not change the status: ${r.error.message}`)); }
          else steps.push(step(true, targetStatus === 'active' ? 'Published' : `Status set to ${targetStatus}`));
        }
      }
    }

  } catch (e) {
    failed += 1;
    steps.push(step(false, `Something went wrong while saving: ${friendlyDbError(e)}`));
  }

  // 6. what the database holds now (and the photos nobody uses any more)
  let fresh = null;
  try { fresh = await fetchBase(productId); } catch { /* the editor reloads */ }
  if (fresh && base) safeDeleteMedia(mediaOfBase(base).filter(u => !mediaOfBase(fresh).includes(u)));
  return finish({ ok: failed === 0, stage: failed ? 'variants' : 'done', base: fresh, createdId: isNew ? productId : null });
}

// ------------------------------------------------------------------------------------------------ duplicate
// A DRAFT copy: " (copy)" on the name, a fresh product number, blank SKUs, zero stock. Photos are shared by URL
// (safeDeleteMedia knows not to delete a file that is still used). Returns { ok, id, error }.
export async function duplicateProduct(productId) {
  try {
    const base = await fetchBase(productId);
    if (!base) return { ok: false, error: 'That product no longer exists.' };
    const p = base.product;
    const name = `${p.name} (copy)`.slice(0, 150);
    let number = null;
    if (p.product_number) {
      for (let i = 1; i < 50 && !number; i += 1) {
        const cand = `${p.product_number}-COPY${i > 1 ? `-${i}` : ''}`;
        // eslint-disable-next-line
        if (!(await productNumberOwner(cand, null))) number = cand;
      }
    } else number = await uniqueProductNumber();
    const copy = {
      product_number: number, name, brand: p.brand, category_id: p.category_id, subtitle: p.subtitle, description: p.description,
      highlights: p.highlights || [], attributes: p.attributes || {}, option_types: p.option_types || [], tags: p.tags || [],
      status: 'draft', badge: p.badge, featured: false, images: p.images || [], image_position: p.image_position,
      video_url: p.video_url, video_position: p.video_position, video_cover_url: p.video_cover_url, video_cover_position: p.video_cover_position,
      delivery_min_days: p.delivery_min_days, delivery_max_days: p.delivery_max_days, weight_g: p.weight_g, length_cm: p.length_cm,
      width_cm: p.width_cm, height_cm: p.height_cm, free_shipping: p.free_shipping, gst_rate: p.gst_rate, hsn_code: p.hsn_code,
      return_window_days: p.return_window_days, cod_allowed: p.cod_allowed, max_qty_per_order: p.max_qty_per_order,
      low_stock_threshold: p.low_stock_threshold, meta_title: p.meta_title, meta_description: p.meta_description,
    };
    const ins = await adminWrite(supabase.from('products').insert(copy), { silent: true });
    if (!ins.ok) return { ok: false, error: ins.error.message };
    const id = ins.data[0].id;
    if (base.variants.length) {
      const rows = base.variants.map((v, i) => ({
        product_id: id, sku: null, options: v.options, label: v.label, price: v.price, mrp: v.mrp, stock: 0, track_inventory: v.track_inventory,
        weight_g: v.weight_g, image_url: v.image_url, position: v.position ?? i, active: v.active,
      }));
      const vr = await adminWrite(supabase.from('product_variants').insert(rows), { silent: true });
      if (!vr.ok) {
        // never leave an empty shell behind
        await adminWrite(supabase.from('products').delete().eq('id', id), { silent: true });
        return { ok: false, error: `The variants could not be copied: ${vr.error.message}` };
      }
    }
    return { ok: true, id, name };
  } catch (e) {
    return { ok: false, error: friendlyDbError(e) };
  }
}

// ------------------------------------------------------------------------------------------------ delete / bulk
// Products that have been sold cannot be deleted (the order history refers to them): archive them instead. Checked
// against the database right before deleting, not just the row on screen.
export async function checkDeletable(ids) {
  const sold = [];
  for (const part of chunk(ids, 60)) {
    const { data, error } = await withTimeout(supabase.from('products').select('id, name, sales_count').in('id', part), 15000);
    if (error) throw error;
    (data || []).forEach(p => { if (Number(p.sales_count) > 0) sold.push(p); });
  }
  return { sold, deletable: ids.filter(id => !sold.some(s => s.id === id)) };
}

// Deletes products (variants go with them) and then their unused photos. Returns { ok, count, error }.
export async function deleteProducts(ids) {
  let count = 0;
  const media = [];
  for (const part of chunk(ids, 60)) {
    // eslint-disable-next-line
    const r = await adminWrite(supabase.from('products').delete().in('id', part), { silent: true });
    if (!r.ok) return { ok: false, count, error: r.error.message };
    count += r.data.length;
    r.data.forEach(p => media.push(p.images, p.video_url, p.video_cover_url));
  }
  safeDeleteMedia(media.flat(2));
  return { ok: true, count };
}

// Bulk status / featured. Activating needs what a shopper needs; products that lack it are returned in `skipped`.
export async function setProductsStatus(ids, status) {
  let eligible = ids;
  const skipped = [];
  if (status === 'active') {
    eligible = [];
    for (const part of chunk(ids, 60)) {
      // eslint-disable-next-line
      const { data, error } = await withTimeout(supabase.from('products').select('id, name, category_id, images, price, status').in('id', part), 15000);
      if (error) return { ok: false, error: friendlyDbError(error), updated: 0, skipped };
      for (const p of data || []) {
        const why = [!p.category_id && 'no category', !(Array.isArray(p.images) && p.images.length) && 'no photo', (p.price === null || p.price === undefined) && 'no active variant'].filter(Boolean);
        if (why.length) skipped.push({ id: p.id, name: p.name, why: why.join(', ') }); else eligible.push(p.id);
      }
    }
  }
  let updated = 0;
  for (const part of chunk(eligible, 60)) {
    // eslint-disable-next-line
    const r = await adminWrite(supabase.from('products').update({ status }).in('id', part), { silent: true });
    if (!r.ok) return { ok: false, error: r.error.message, updated, skipped };
    updated += r.data.length;
  }
  return { ok: true, updated, skipped };
}

export async function setProductsFeatured(ids, featured) {
  let updated = 0;
  for (const part of chunk(ids, 60)) {
    // eslint-disable-next-line
    const r = await adminWrite(supabase.from('products').update({ featured }).in('id', part), { silent: true });
    if (!r.ok) return { ok: false, error: r.error.message, updated };
    updated += r.data.length;
  }
  return { ok: true, updated };
}

// ---------------------------------------------------------------------------------------------- export paging
// Every product matching a list filter (or the given ids), then their variants: paged, so nothing is cut off at the
// API's 1,000-row limit. onProgress({ stage, done, total }).
export async function fetchCatalogForExport({ filters, orderBy, ids, onProgress, maxProducts = 20000 }) {
  const products = [];
  if (ids) {
    for (const part of chunk(ids, 60)) {
      // eslint-disable-next-line
      const { data, error } = await withTimeout(supabase.from('products').select(PRODUCT_COLUMNS).in('id', part), 30000);
      if (error) throw error;
      products.push(...(data || []));
      onProgress?.({ stage: 'products', done: products.length, total: ids.length });
    }
    const order = new Map(ids.map((id, i) => [id, i]));
    products.sort((a, b) => order.get(a.id) - order.get(b.id));
  } else {
    let total = null;
    for (let from = 0; from < maxProducts; from += 1000) {
      let q = supabase.from('products').select(PRODUCT_COLUMNS, { count: 'exact' });
      q = applyOrder(applyFilters(q, filters), orderBy);
      // eslint-disable-next-line
      const { data, error, count } = await withTimeout(q.range(from, from + 999), 30000);
      if (error) throw error;
      total = count ?? total;
      products.push(...(data || []));
      onProgress?.({ stage: 'products', done: products.length, total: total ?? products.length });
      if (!data || data.length < 1000) break;
    }
  }
  const variantsByProduct = new Map();
  let done = 0;
  for (const part of chunk(products.map(p => p.id), 40)) {
    // eslint-disable-next-line
    const { rows } = await fetchAllCapped(() => supabase.from('product_variants').select(VARIANT_COLUMNS).in('product_id', part).order('product_id').order('position').order('id'), { maxRows: 20000 });
    rows.forEach(v => variantsByProduct.set(v.product_id, [...(variantsByProduct.get(v.product_id) || []), v]));
    done += part.length;
    onProgress?.({ stage: 'variants', done, total: products.length });
  }
  return { products, variantsByProduct };
}

// ------------------------------------------------------------------------------------------------ CSV import
// What the validator needs to know about the database for the products / SKUs in a file.
export async function loadImportContext(records) {
  const numbers = uniq(records.map(r => r.cells.product_number).filter(Boolean));
  const skus = uniq(records.map(r => r.cells.sku).filter(Boolean));
  const existingByNumber = new Map();
  const variantsByProduct = new Map();
  const skuOwners = new Map();

  const spell = (list) => uniq(list.flatMap(s => [s, s.toLowerCase(), s.toUpperCase()]));
  const productRows = [];
  for (const part of chunk(spell(numbers), 50)) {
    // eslint-disable-next-line
    const { data, error } = await withTimeout(supabase.from('products').select(PRODUCT_COLUMNS).in('product_number', part), 30000);
    if (error) throw error;
    productRows.push(...(data || []));
  }
  const seen = new Set();
  for (const p of productRows) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    const k = lc(p.product_number);
    const prev = existingByNumber.get(k);
    if (prev) existingByNumber.set(k, { ambiguous: (prev.ambiguous || 1) + 1 });
    else existingByNumber.set(k, p);
  }
  const ids = Array.from(existingByNumber.values()).filter(p => !p.ambiguous).map(p => p.id);
  for (const part of chunk(ids, 40)) {
    // eslint-disable-next-line
    const { rows } = await fetchAllCapped(() => supabase.from('product_variants').select(VARIANT_COLUMNS).in('product_id', part).order('product_id').order('position').order('id'), { maxRows: 20000 });
    rows.forEach(v => variantsByProduct.set(v.product_id, [...(variantsByProduct.get(v.product_id) || []), v]));
  }
  const owners = [];
  for (const part of chunk(spell(skus), 60)) {
    // eslint-disable-next-line
    const { data, error } = await withTimeout(supabase.from('product_variants').select('id, product_id, sku').in('sku', part), 30000);
    if (error) throw error;
    owners.push(...(data || []));
  }
  const ownerProducts = new Map();
  const missing = uniq(owners.map(o => o.product_id)).filter(id => !seen.has(id));
  for (const part of chunk(missing, 60)) {
    // eslint-disable-next-line
    const { data } = await withTimeout(supabase.from('products').select('id, name, product_number').in('id', part), 30000);
    (data || []).forEach(p => ownerProducts.set(p.id, p));
  }
  for (const p of productRows) ownerProducts.set(p.id, p);
  for (const o of owners) {
    const prod = ownerProducts.get(o.product_id);
    skuOwners.set(lc(o.sku), { id: o.id, product_id: o.product_id, product_number: prod?.product_number || '', product_name: prod?.name || '' });
  }
  return { existingByNumber, variantsByProduct, skuOwners };
}

// The columns for a NEW product from an import plan (only what the file gave; the database defaults the rest).
function createPayload(P, number) {
  const d = P.desired;
  const out = { product_number: number, name: d.name, status: 'draft', option_types: P.optionTypes || [] };
  for (const k of ['brand', 'category_id', 'subtitle', 'description', 'highlights', 'tags', 'attributes', 'images', 'image_position', 'video_url', 'video_position',
    'video_cover_url', 'video_cover_position', 'featured', 'badge', 'free_shipping', 'cod_allowed', 'delivery_min_days', 'delivery_max_days', 'weight_g',
    'length_cm', 'width_cm', 'height_cm', 'return_window_days', 'gst_rate', 'hsn_code', 'max_qty_per_order', 'low_stock_threshold', 'meta_title', 'meta_description']) {
    if (d[k] !== undefined) out[k] = d[k];
  }
  return out;
}

// Runs one product of an import plan. Never throws. -> { ok, action, created, updated, stock, message }
async function importOne(P) {
  const res = { key: P.key, number: P.number, name: P.name, action: P.action, ok: true, created: 0, updated: 0, stock: 0, steps: [] };
  const fail = (message) => { res.ok = false; res.message = message; return res; };
  try {
    let productId = P.existing?.id || null;
    let number = P.number;
    const writeLast = P.status === 'active' && (P.action === 'create' || P.existing.status !== 'active');

    if (P.action === 'create') {
      if (!number) number = await uniqueProductNumber();
      const r = await adminWrite(supabase.from('products').insert(createPayload(P, number)), { silent: true });
      if (!r.ok) return fail(`The product could not be created: ${r.error.message}`);
      productId = r.data[0].id;
    } else {
      const patch = { ...P.patch };
      if (writeLast) delete patch.status; // publishing is written last, once the variants are in
      if (Object.keys(patch).length) {
        const r = await adminWrite(supabase.from('products').update(patch).eq('id', productId), { silent: true });
        if (!r.ok) return fail(`The product could not be updated: ${r.error.message}`);
      }
    }

    // variants
    const existing = P.existingVariants || [];
    const lastPos = existing.reduce((m, v) => Math.max(m, Number(v.position) || 0), -1);
    const inserts = [];
    P.variants.filter(v => v.action === 'create').forEach((v, i) => {
      const tracked = v.track_inventory !== false;
      inserts.push({
        columns: {
          sku: v.sku, options: v.options, label: v.label, price: v.price, mrp: v.mrp, track_inventory: tracked, weight_g: v.weight_g,
          image_url: v.image_url, active: v.active !== false, position: lastPos + 1 + i,
        },
        opening: tracked && v.stock > 0 ? v.stock : 0,
      });
    });
    const updates = P.variants.filter(v => v.action === 'update' && v.patch).map(v => ({ id: v.id, patch: v.patch, optionsChanged: !!v.patch.options }));
    const stockChanges = P.variants.filter(v => v.action === 'update' && v.stockTo !== null).map(v => ({ id: v.id, from: Number(v.existing.stock), to: v.stockTo, label: v.label }));
    const diff = { inserts, updates, deletes: [], stockChanges };
    const vw = await writeVariantDiff({ productId, baseVariants: existing, diff });
    res.created = vw.insertedByPosition.size;
    res.updated = updates.length;
    let failed = vw.failed;
    const opening = await applyOpeningStock(inserts, vw.insertedByPosition);
    failed += opening.failed;
    res.stock += inserts.filter(i => i.opening > 0).length - opening.failed;
    // CSV stock changes are a deliberate "set to": reason 'correction'
    let stockFailed = 0;
    for (const c of stockChanges) {
      // eslint-disable-next-line
      const r = await callAdjustStock({ variantId: c.id, setTo: c.to, reason: 'correction', note: 'CSV import' });
      if (r.ok) res.stock += 1; else { stockFailed += 1; res.steps.push(`${c.label}: ${r.error}`); }
    }
    failed += stockFailed;
    res.steps.push(...vw.steps.filter(s => !s.ok).map(s => s.text), ...opening.steps.filter(s => !s.ok).map(s => s.text));
    if (failed) return fail(`${failed} change${failed === 1 ? '' : 's'} failed. ${res.steps.slice(0, 3).join(' ')}`.trim());

    if (writeLast) {
      const r = await adminWrite(supabase.from('products').update({ status: 'active' }).eq('id', productId), { silent: true });
      if (!r.ok) return fail(`Everything was saved but it could not be published: ${r.error.message}`);
    }
    res.productId = productId;
    return res;
  } catch (e) {
    return fail(friendlyDbError(e));
  }
}

// Runs a plan from planImport(). Only products without errors that actually change something are written (a
// re-imported export writes nothing). onProgress({ done, total, current }). Returns the per-product results.
export async function runImport(plan, { onProgress, shouldCancel } = {}) {
  const todo = plan.products.filter(p => !p.errors.length && p.changed);
  const results = [];
  for (let i = 0; i < todo.length; i += 1) {
    if (shouldCancel?.()) break;
    onProgress?.({ done: i, total: todo.length, current: todo[i].name });
    // eslint-disable-next-line
    results.push(await importOne(todo[i]));
  }
  onProgress?.({ done: results.length, total: todo.length, current: '' });
  return results;
}

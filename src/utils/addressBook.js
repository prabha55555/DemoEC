// The customer's saved addresses (profiles.addresses, a jsonb array). Pure helpers so Checkout and the
// Account page treat the list the same way:
//   * every entry gets a stable `id` (older entries had none and were addressed by array position)
//   * one entry is the default (`isDefault`), shown first and preselected at checkout
//   * the same line1 + pincode is the same address -- saving it again updates it instead of duplicating it
const text = (v) => String(v ?? '').trim();
const clean = (a) => ({
  name: text(a?.name), phone: text(a?.phone), line1: text(a?.line1), line2: text(a?.line2),
  city: text(a?.city), state: text(a?.state), pincode: text(a?.pincode),
});

export const newAddressId = () => {
  try { if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID(); } catch { /* fall through */ }
  return `addr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
};

// line1 + pincode, case/space-insensitive
export const addressKey = (a) => `${text(a?.line1).toLowerCase().replace(/\s+/g, ' ')}|${text(a?.pincode)}`;

// The address as the server wants it for an order (no id / default flag / type).
export const orderAddressOf = (a) => clean(a);

// Add ids to old entries, drop junk, and guarantee exactly one default when the list is not empty.
export function normalizeAddresses(list) {
  const seen = new Set();
  const out = [];
  (Array.isArray(list) ? list : []).forEach((raw, index) => {
    if (!raw || typeof raw !== 'object' || !text(raw.line1)) return;
    // an entry saved before ids existed gets a stable one (its position) until it is saved again
    let id = text(raw.id) || `legacy-${index}`;
    if (seen.has(id)) id = newAddressId();
    seen.add(id);
    out.push({ ...raw, ...clean(raw), id, type: text(raw.type) || undefined, isDefault: !!raw.isDefault });
  });
  if (out.length && !out.some(a => a.isDefault)) out[0].isDefault = true;
  // never more than one default
  let found = false;
  for (const a of out) { if (a.isDefault && found) a.isDefault = false; if (a.isDefault) found = true; }
  return out;
}

// Default first, otherwise the saved order.
export const sortAddresses = (list) => [...list].sort((a, b) => Number(!!b.isDefault) - Number(!!a.isDefault));

export const defaultAddress = (list) => list.find(a => a.isDefault) || list[0] || null;

// Insert a new address or update an existing one. `id` given = edit that entry; otherwise a matching
// line1 + pincode is updated rather than duplicated. `makeDefault` (or the first address ever) becomes default.
export function upsertAddress(list, address, { id = null, makeDefault = false } = {}) {
  const current = normalizeAddresses(list);
  const fields = clean(address);
  const type = text(address?.type) || undefined;
  const editing = id && current.some(a => a.id === id) ? id : null;
  const twin = current.find(a => addressKey(a) === addressKey(fields) && a.id !== editing);

  let next;
  let targetId;
  if (editing) {
    // editing an entry into one that already exists merges the two
    targetId = editing;
    next = current
      .filter(a => !(twin && a.id === twin.id))
      .map(a => (a.id === editing ? { ...a, ...fields, type, isDefault: a.isDefault || !!twin?.isDefault } : a));
  } else if (twin) {
    targetId = twin.id;
    next = current.map(a => (a.id === twin.id ? { ...a, ...fields, type: type ?? a.type } : a));
  } else {
    targetId = newAddressId();
    next = [...current, { ...fields, type, id: targetId, isDefault: current.length === 0 }];
  }
  if (makeDefault) next = next.map(a => ({ ...a, isDefault: a.id === targetId }));
  return { addresses: normalizeAddresses(next), id: targetId };
}

export function setDefaultAddress(list, id) {
  return normalizeAddresses(normalizeAddresses(list).map(a => ({ ...a, isDefault: a.id === id })));
}

export function removeAddress(list, id) {
  return normalizeAddresses(normalizeAddresses(list).filter(a => a.id !== id));
}

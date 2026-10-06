// GST handling for a tax-INCLUSIVE catalogue (every price a customer sees already contains GST).
// Used to record a rate on each order line and to build the invoice breakup. Pure.
//
// The charged amount never changes with these numbers -- they only split an inclusive price into
// taxable value + tax so a GST invoice can be printed.

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const rateOf = (v) => { if (v === null || v === undefined || v === '') return null; const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : null; };

// First defined rate wins: variant -> product -> category (leaf first, then ancestors) -> store default.
export function resolveGstRate({ product, categoryChain = [], defaultRate = 18 }) {
  const candidates = [product?.gst_rate, ...categoryChain.map(c => c?.gst_rate), defaultRate];
  for (const c of candidates) { const r = rateOf(c); if (r !== null) return r; }
  return 18;
}

export function resolveHsn({ product, categoryChain = [] }) {
  for (const v of [product?.hsn_code, ...categoryChain.map(c => c?.hsn_code)]) {
    if (v && String(v).trim()) return String(v).trim();
  }
  return '';
}

const norm = (s) => String(s || '').trim().toLowerCase();

// lines: [{ key, name?, hsn?, qty, price, gstRate }]   (merchandise only -- gift cards carry no GST)
// discount: order-level coupon discount, spread over the lines in proportion to their value -- unless the
// lines carry `lineDiscount` (their own recorded share), which is used as is.
// shipping: delivery + COD fee charged (GST-inclusive); taxed at shippingRate.
// States decide the split: same state -> CGST + SGST halves, different state -> IGST.
export function computeTax({ lines, discount = 0, shipping = 0, shippingRate = 18, sellerState = '', buyerState = '' }) {
  const items = (lines || []).map(l => ({ ...l, gross: round2(Number(l.price) * Number(l.qty)) }));
  const base = items.reduce((s, l) => s + l.gross, 0);
  const disc = Math.min(Math.max(Number(discount) || 0, 0), base);

  // An order records each line's own coupon share (`lineDiscount`) because a coupon may cover only some
  // lines; use it when present. Older orders only have the order total, spread in proportion to value.
  const perLine = items.some(l => l.lineDiscount !== undefined && l.lineDiscount !== null);
  let allocated = 0;
  items.forEach((l, i) => {
    if (perLine) { l.discount = Math.min(round2(Number(l.lineDiscount) || 0), l.gross); return; }
    l.discount = i === items.length - 1 ? round2(disc - allocated) : round2(base > 0 ? (disc * l.gross) / base : 0);
    allocated += l.discount;
  });

  const intraState = !!norm(sellerState) && norm(sellerState) === norm(buyerState);
  const split = (tax) => (intraState ? { cgst: round2(tax / 2), sgst: round2(tax - round2(tax / 2)), igst: 0 } : { cgst: 0, sgst: 0, igst: round2(tax) });

  const out = items.map(l => {
    const net = round2(l.gross - l.discount);
    const rate = rateOf(l.gstRate) ?? 18;
    const taxable = round2(net / (1 + rate / 100));
    const tax = round2(net - taxable);
    return { key: l.key, name: l.name, hsn: l.hsn || '', qty: l.qty, price: Number(l.price), gross: l.gross, discount: l.discount, net, rate, taxable, tax, ...split(tax) };
  });

  const ship = round2(Number(shipping) || 0);
  const shipRate = rateOf(shippingRate) ?? 18;
  const shipTaxable = round2(ship / (1 + shipRate / 100));
  const shipTax = round2(ship - shipTaxable);
  const shippingLine = { gross: ship, rate: shipRate, taxable: shipTaxable, tax: shipTax, ...split(shipTax) };

  const all = [...out, ...(ship > 0 ? [shippingLine] : [])];
  const sum = (k) => round2(all.reduce((s, l) => s + (l[k] || 0), 0));
  return {
    intraState,
    lines: out,
    shipping: shippingLine,
    totals: { taxable: sum('taxable'), tax: sum('tax'), cgst: sum('cgst'), sgst: sum('sgst'), igst: sum('igst') },
  };
}

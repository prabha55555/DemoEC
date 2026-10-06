// GST summary for filing support. Prices in the store are GST-INCLUSIVE, so each order is split into taxable value + tax
// exactly the way its invoice is (src/utils/tax.js computeTax, using each line's stored gstRate, the line's own coupon share,
// and the seller's state against the buyer's to decide CGST + SGST or IGST). Gift cards are vouchers: no GST when sold.
// Delivery and cash-on-delivery charges are taxed at the store's default rate, like on the invoice.
import { computeTax } from '../../utils/tax';
import { num, round2 } from './reportMath';

const norm = (s) => String(s || '').trim().toLowerCase();

// One order -> its tax parts: [{ kind: 'goods' | 'delivery' | 'cod', rate, hsn, qty, taxable, cgst, sgst, igst, tax, value }]
export function orderGst(order, { defaultRate = 18, sellerState = '' } = {}) {
  const items = Array.isArray(order?.items) ? order.items : [];
  const goods = items.filter(i => i && !i.isGiftCard);
  const gifts = items.filter(i => i && i.isGiftCard);
  const common = { shippingRate: defaultRate, sellerState, buyerState: order?.address?.state || '' };
  const main = computeTax({
    lines: goods.map((i, idx) => ({ key: idx, hsn: i.hsn, qty: num(i.qty), price: num(i.price), gstRate: i.gstRate ?? defaultRate, lineDiscount: i.lineDiscount })),
    discount: num(order?.discount), shipping: num(order?.shipping), ...common,
  });
  const parts = main.lines.map(l => ({ kind: 'goods', rate: l.rate, hsn: l.hsn || '', qty: num(l.qty), taxable: l.taxable, cgst: l.cgst, sgst: l.sgst, igst: l.igst, tax: l.tax, value: l.net }));
  const delivery = num(order?.shipping);
  if (delivery > 0) { const s = main.shipping; parts.push({ kind: 'delivery', rate: s.rate, hsn: '', qty: 0, taxable: s.taxable, cgst: s.cgst, sgst: s.sgst, igst: s.igst, tax: s.tax, value: s.gross }); }
  const codFee = num(order?.cod_fee);
  if (codFee > 0) { const s = computeTax({ lines: [], shipping: codFee, ...common }).shipping; parts.push({ kind: 'cod', rate: s.rate, hsn: '', qty: 0, taxable: s.taxable, cgst: s.cgst, sgst: s.sgst, igst: s.igst, tax: s.tax, value: s.gross }); }
  return { parts, giftTotal: round2(gifts.reduce((s, g) => s + num(g.price) * (num(g.qty) || 1), 0)), intra: main.intraState };
}

const SUMS = ['taxable', 'cgst', 'sgst', 'igst', 'tax', 'value'];
const blank = () => ({ taxable: 0, cgst: 0, sgst: 0, igst: 0, tax: 0, value: 0 });
function add(target, part) { for (const k of SUMS) target[k] += num(part[k]); return target; }
const fin = (o) => { for (const k of SUMS) o[k] = round2(o[k]); return o; };

// Many orders -> the report. Orders are the rows the screen read (items, discount, shipping, cod_fee, address, status,
// refunded_amount); cancelled ones are dropped here too, in case a caller forgot.
//   byRate  one line per GST rate (taxable value, CGST, SGST, IGST, total tax, value incl. tax)
//   hsn     one line per HSN code + rate (goods), plus a single line for delivery / COD charges
export function aggregateGst(orders, opts = {}) {
  const byRate = new Map();
  const hsn = new Map();
  const totals = blank();
  let count = 0; let intra = 0; let inter = 0; let gift = 0; let refunded = 0; let returned = 0;
  for (const order of orders || []) {
    if (!order || order.status === 'Cancelled') continue;
    count += 1;
    refunded += num(order.refunded_amount);
    if (order.status === 'Returned') returned += 1;
    const g = orderGst(order, opts);
    gift += g.giftTotal;
    if (g.parts.length) { if (g.intra) intra += 1; else inter += 1; }
    for (const part of g.parts) {
      const r = byRate.get(part.rate) || { rate: part.rate, ...blank() };
      byRate.set(part.rate, add(r, part));
      const hk = part.kind === 'goods' ? `${part.hsn || '—'}|${part.rate}` : `charges|${part.rate}`;
      const h = hsn.get(hk) || { hsn: part.kind === 'goods' ? (part.hsn || '—') : 'Delivery / COD charges', rate: part.rate, qty: 0, ...blank() };
      h.qty += part.qty;
      hsn.set(hk, add(h, part));
      add(totals, part);
    }
  }
  const lines = Array.from(byRate.values()).map(fin).sort((a, b) => a.rate - b.rate);
  const hsnLines = Array.from(hsn.values()).map(h => ({ ...fin(h), qty: h.qty })).sort((a, b) => (a.hsn === 'Delivery / COD charges') - (b.hsn === 'Delivery / COD charges') || String(a.hsn).localeCompare(String(b.hsn)) || a.rate - b.rate);
  return { byRate: lines, hsn: hsnLines, totals: fin(totals), orders: count, intraOrders: intra, interOrders: inter, giftCardSales: round2(gift), refunded: round2(refunded), returnedOrders: returned };
}

export const GST_RATE_CSV_COLUMNS = [
  { label: 'GST rate %', get: l => (l.rate === 'Total' ? 'Total' : l.rate) },
  { label: 'Taxable value', get: l => l.taxable },
  { label: 'CGST', get: l => l.cgst },
  { label: 'SGST', get: l => l.sgst },
  { label: 'IGST', get: l => l.igst },
  { label: 'Total GST', get: l => l.tax },
  { label: 'Invoice value (incl. GST)', get: l => l.value },
];
export const GST_HSN_CSV_COLUMNS = [
  { label: 'HSN', get: l => l.hsn },
  { label: 'GST rate %', get: l => l.rate },
  { label: 'Units', get: l => l.qty },
  { label: 'Taxable value', get: l => l.taxable },
  { label: 'CGST', get: l => l.cgst },
  { label: 'SGST', get: l => l.sgst },
  { label: 'IGST', get: l => l.igst },
  { label: 'Total GST', get: l => l.tax },
  { label: 'Invoice value (incl. GST)', get: l => l.value },
];

// The rows of the by-rate CSV: every rate plus a closing Total row.
export const gstRateRows = (report) => [...report.byRate, { rate: 'Total', ...report.totals }];

// Whether the seller's state is known: without it every order is treated as inter-state (IGST).
export const hasSellerState = (brand) => !!norm(brand?.seller_state);

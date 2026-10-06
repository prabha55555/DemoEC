// Everything a GST invoice shows, computed from an order row + the store settings. Pure (no React) so
// the printed invoice, the admin's copy and the tests all read the same numbers.
//
// Prices on the catalogue are GST-INCLUSIVE, so the invoice splits each line into taxable value + tax
// (src/utils/tax.js). Same state as the seller -> CGST + SGST, otherwise IGST. Gift cards are vouchers:
// listed, but carry no GST. The order discount is spread over the goods; delivery and COD charges are
// taxed at the store's default rate.
import { computeTax } from './tax';
import { amountInWords } from './amountInWords';
import { invoiceNumberOf } from './emailVariables';
import { lineVariantLabel, orderItemsOf } from './orderFormat';

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

export function buildInvoice(order, brand = {}) {
  const items = orderItemsOf(order);
  const goods = items.filter(i => !i.isGiftCard);
  const gifts = items.filter(i => i.isGiftCard);
  const defaultRate = brand.default_gst_rate !== null && brand.default_gst_rate !== undefined && brand.default_gst_rate !== '' ? num(brand.default_gst_rate) : 18;
  const shipping = round2(num(order?.shipping));
  const codFee = round2(num(order?.cod_fee));
  const discount = round2(num(order?.discount));
  const giftCardApplied = round2(num(order?.gift_card_applied));
  const buyerState = order?.address?.state || '';
  const common = { shippingRate: defaultRate, sellerState: brand.seller_state || '', buyerState };

  const goodsTax = computeTax({
    lines: goods.map((i, idx) => ({ key: i.variantId || `${i.id}-${idx}`, name: i.name, hsn: i.hsn, qty: num(i.qty), price: num(i.price), gstRate: i.gstRate ?? defaultRate, lineDiscount: i.lineDiscount })),
    discount, shipping, ...common,
  });
  const codTax = computeTax({ lines: [], discount: 0, shipping: codFee, ...common });

  const lines = goodsTax.lines.map((l, idx) => {
    const item = goods[idx];
    return {
      no: idx + 1, name: item.name || 'Item', variantLabel: lineVariantLabel(item), sku: item.sku || '', brand: item.brand || '',
      hsn: l.hsn || '', qty: l.qty, unitPrice: l.price, gross: l.gross, discount: l.discount, taxable: l.taxable,
      rate: l.rate, cgst: l.cgst, sgst: l.sgst, igst: l.igst, tax: l.tax, amount: l.net,
    };
  });
  const giftLines = gifts.map((g, idx) => ({
    no: lines.length + idx + 1, name: g.name || 'Gift card', qty: num(g.qty) || 1, unitPrice: num(g.price), amount: round2(num(g.price) * (num(g.qty) || 1)),
  }));
  const charge = (label, calc, amount) => (amount > 0 ? {
    label, amount, taxable: calc.taxable, rate: calc.rate, cgst: calc.cgst, sgst: calc.sgst, igst: calc.igst, tax: calc.tax,
  } : null);
  const deliveryLine = charge('Delivery charge', goodsTax.shipping, shipping);
  const codLine = charge('Cash on Delivery fee', codTax.shipping, codFee);

  const parts = [...lines, deliveryLine, codLine].filter(Boolean);
  const sum = (k) => round2(parts.reduce((s, p) => s + num(p[k]), 0));
  const goodsGross = round2(lines.reduce((s, l) => s + l.gross, 0));
  const giftTotal = round2(giftLines.reduce((s, g) => s + g.amount, 0));
  // Invoice value = everything the customer is billed for, before any gift card is used to pay for it.
  const invoiceValue = round2(goodsGross + giftTotal - discount + shipping + codFee);
  const total = round2(num(order?.total));
  const mode = order?.payment_method === 'cod' ? 'cod' : (order?.payment_method === 'free' || total <= 0 ? 'free' : 'online');

  return {
    number: invoiceNumberOf(order),
    intraState: goodsTax.intraState,
    lines, giftLines, deliveryLine, codLine,
    goodsGross, giftTotal, discount, shipping, codFee, giftCardApplied,
    taxable: sum('taxable'), cgst: sum('cgst'), sgst: sum('sgst'), igst: sum('igst'), tax: sum('tax'),
    invoiceValue, total, mode,
    refunded: round2(num(order?.refunded_amount)),
    inWords: amountInWords(total),
    seller: {
      name: brand.seller_legal_name || brand.brand_name || '',
      gstin: brand.seller_gstin || '',
      address: brand.registered_office || '',
      email: brand.support_email || '',
      phone: brand.support_phone || '',
      state: brand.seller_state || '',
    },
  };
}

import React from 'react';
import { useBrand } from '../../context/BrandContext';
import { Card, Field, FieldRow, MoneyInput, NumberInput, Section, Textarea } from '../ui';
import { checkNumber } from '../lib/validate';
import SettingsForm from './SettingsForm';
import useBrandForm from './useBrandForm';
import { draftBrand, shippingExamples } from './shippingPreview';

// Shipping & delivery: what delivery costs, when it is free, which cities count as "metro", and how many extra days
// other places add. The fees and the free-delivery level are applied by the cart, checkout AND the payment server.
export default function ShippingSettings() {
  const { brand } = useBrand();
  const form = useBrandForm({
    initial: (b) => ({
      free_shipping_threshold: String(b.free_shipping_threshold ?? 0), shipping_fee_metro: String(b.shipping_fee_metro ?? 0), shipping_fee_other: String(b.shipping_fee_other ?? 0),
      delivery_metro_cities: b.delivery_metro_cities || '', delivery_extra_days: String(b.delivery_extra_days ?? 0),
    }),
    validate: (v) => ({
      free_shipping_threshold: checkNumber(v.free_shipping_threshold, { required: true, min: 0, label: 'The free-delivery level' }),
      shipping_fee_metro: checkNumber(v.shipping_fee_metro, { required: true, min: 0, label: 'The metro fee' }),
      shipping_fee_other: checkNumber(v.shipping_fee_other, { required: true, min: 0, label: 'The other-cities fee' }),
      delivery_extra_days: checkNumber(v.delivery_extra_days, { required: true, min: 0, max: 30, integer: true, label: 'Extra days' }),
    }),
    toPayload: (v) => ({
      free_shipping_threshold: Number(v.free_shipping_threshold), shipping_fee_metro: Number(v.shipping_fee_metro), shipping_fee_other: Number(v.shipping_fee_other),
      delivery_metro_cities: v.delivery_metro_cities.split(',').map(c => c.trim()).filter(Boolean).join(', '), delivery_extra_days: Number(v.delivery_extra_days),
    }),
    successMessage: 'Shipping settings saved.',
  });
  const { values, set, errors } = form;
  const preview = shippingExamples(draftBrand(values, brand));
  const free = Number(values.free_shipping_threshold) > 0;

  return (
    <SettingsForm form={form}>
      <Section title="Delivery fees" description="A flat fee per order, shown as its own line at checkout. Set both fees to 0 for free delivery on every order.">
        <FieldRow cols={3}>
          <Field label="Free delivery on orders of" error={errors.free_shipping_threshold} hint="Judged on the cart value before any coupon. 0 = no free-delivery level.">
            <MoneyInput value={values.free_shipping_threshold} onChange={v => set('free_shipping_threshold', v)} decimals={0} />
          </Field>
          <Field label="Fee for metro cities" error={errors.shipping_fee_metro}><MoneyInput value={values.shipping_fee_metro} onChange={v => set('shipping_fee_metro', v)} decimals={0} /></Field>
          <Field label="Fee for everywhere else" error={errors.shipping_fee_other}><MoneyInput value={values.shipping_fee_other} onChange={v => set('shipping_fee_other', v)} decimals={0} /></Field>
        </FieldRow>
        <p className="adm-hint">Products marked "free shipping" and gift cards are always delivered free. Cash on Delivery can add its own fee (see Payments).</p>
      </Section>

      <Section title="Delivery times" description="Each product has its own base delivery window. Metro cities get that window as it is; anywhere else gets the extra days on top.">
        <Field label="Metro cities" hint="Comma-separated, e.g. Chennai, Mumbai, Delhi. Also decides which delivery fee applies.">
          <Textarea rows={3} value={values.delivery_metro_cities} onChange={v => set('delivery_metro_cities', v)} placeholder="Chennai, Coimbatore, Bengaluru, Mumbai, Delhi…" />
        </Field>
        <div style={{ maxWidth: 260 }}>
          <Field label="Extra days for other places" error={errors.delivery_extra_days}><NumberInput value={values.delivery_extra_days} onChange={v => set('delivery_extra_days', v)} integer min={0} max={30} suffix="days" /></Field>
        </div>
      </Section>

      <Card title="What shoppers will see" subtitle="Updates as you type, using the same rules as your store.">
        <div className="adm-stack tight">
          <div className="adm-note success"><strong>Shoppers see:</strong> {preview.promise}</div>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }} aria-label="Worked examples">
            {preview.rows.map(r => (
              <li key={r.text} className="adm-row between" style={{ padding: '9px 0', borderBottom: '1px solid var(--adm-border)', flexWrap: 'nowrap' }}>
                <span>{r.text}</span><strong>{r.result}</strong>
              </li>
            ))}
          </ul>
          {!free && <p className="adm-hint">There is no free-delivery level, so every order pays the fee for its city.</p>}
        </div>
      </Card>
    </SettingsForm>
  );
}

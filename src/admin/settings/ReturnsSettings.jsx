import React from 'react';
import { Link } from 'react-router-dom';
import { Field, NumberInput, Section } from '../ui';
import { checkNumber } from '../lib/validate';
import SettingsForm from './SettingsForm';
import useBrandForm from './useBrandForm';

// Returns & stock: the default return window and the level at which an item counts as "low stock". A product can set
// its own return window (0 = not returnable) and its own low-stock level; these are the defaults it falls back to.
export default function ReturnsSettings() {
  const form = useBrandForm({
    initial: (b) => ({ return_window_days: String(b.return_window_days ?? 0), low_stock_threshold: String(b.low_stock_threshold ?? 0) }),
    validate: (v) => ({
      return_window_days: checkNumber(v.return_window_days, { required: true, min: 0, max: 365, integer: true, label: 'The return window' }),
      low_stock_threshold: checkNumber(v.low_stock_threshold, { required: true, min: 0, max: 100000, integer: true, label: 'The low-stock level' }),
    }),
    toPayload: (v) => ({ return_window_days: Number(v.return_window_days), low_stock_threshold: Number(v.low_stock_threshold) }),
    successMessage: 'Returns and stock settings saved.',
  });
  const { values, set, errors } = form;
  const days = Number(values.return_window_days);

  return (
    <SettingsForm form={form}>
      <Section title="Returns" description="How long after delivery a customer can ask to return an item. The window is stamped on each order line when it is placed, so changing it later does not affect existing orders.">
        <div style={{ maxWidth: 280 }}>
          <Field label="Return window" error={errors.return_window_days}
            hint={days > 0 ? `Customers can request a return within ${days} day${days === 1 ? '' : 's'} of delivery. A product can set its own window.` : 'Items are not returnable by default. A product can still set its own window.'}>
            <NumberInput value={values.return_window_days} onChange={v => set('return_window_days', v)} integer min={0} max={365} suffix="days" />
          </Field>
        </div>
        <p className="adm-hint">0 means no returns by default. Review incoming requests on the <Link to="/admin/returns">Returns</Link> screen.</p>
      </Section>

      <Section title="Low stock" description="Items at or below this many units are flagged on the dashboard and the Inventory screen.">
        <div style={{ maxWidth: 280 }}>
          <Field label="Low-stock level" error={errors.low_stock_threshold} hint="A product can set its own level.">
            <NumberInput value={values.low_stock_threshold} onChange={v => set('low_stock_threshold', v)} integer min={0} suffix="units" />
          </Field>
        </div>
      </Section>
    </SettingsForm>
  );
}

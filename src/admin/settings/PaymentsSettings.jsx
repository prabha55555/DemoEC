import React from 'react';
import { Link } from 'react-router-dom';
import { Button, Card, Field, FieldRow, MoneyInput, Section, StatusPill, Toggle } from '../ui';
import { checkNumber } from '../lib/validate';
import SettingsForm from './SettingsForm';
import useBrandForm from './useBrandForm';

// Payments: Cash on Delivery on/off, its fee and ceiling. Online payment is Razorpay and is configured outside the app.
export default function PaymentsSettings() {
  const form = useBrandForm({
    initial: (b) => ({ cod_enabled: !!b.cod_enabled, cod_fee: String(b.cod_fee ?? 0), cod_max_order: String(b.cod_max_order ?? 0) }),
    validate: (v) => ({
      cod_fee: checkNumber(v.cod_fee, { required: true, min: 0, label: 'The COD fee' }),
      cod_max_order: checkNumber(v.cod_max_order, { required: true, min: 0, label: 'The COD limit' }),
    }),
    toPayload: (v) => ({ cod_enabled: v.cod_enabled, cod_fee: Number(v.cod_fee), cod_max_order: Number(v.cod_max_order) }),
    successMessage: 'Payment settings saved.',
  });
  const { values, set, errors } = form;

  return (
    <SettingsForm form={form}>
      <Section title="Cash on Delivery" description="Let shoppers pay the courier when the order arrives. It is off until you switch it on, and each product can opt out.">
        <Toggle checked={values.cod_enabled} onChange={v => set('cod_enabled', v)} label="Accept Cash on Delivery" hint="Shoppers see Cash on Delivery as a payment option at checkout." />
        <FieldRow>
          <Field label="COD fee" error={errors.cod_fee} hint="Added to the order total. 0 = no fee."><MoneyInput value={values.cod_fee} onChange={v => set('cod_fee', v)} decimals={0} disabled={!values.cod_enabled} /></Field>
          <Field label="Largest COD order" error={errors.cod_max_order} hint="Orders above this must be paid online. 0 = no limit."><MoneyInput value={values.cod_max_order} onChange={v => set('cod_max_order', v)} decimals={0} disabled={!values.cod_enabled} /></Field>
        </FieldRow>
      </Section>

      <Card title={<span>Online payments <StatusPill kind="generic" status="active" label="Razorpay" /></span>}
        subtitle="Cards, UPI, net banking and wallets are handled by Razorpay."
        footer={<Button icon="external" href="https://dashboard.razorpay.com/" target="_blank">Open the Razorpay dashboard</Button>}>
        <div className="adm-stack tight">
          <p>Online payments are set up outside this screen. Your Razorpay keys live in your hosting provider's <strong>environment variables</strong> (<span className="adm-mono">RAZORPAY_KEY_ID</span>, <span className="adm-mono">RAZORPAY_KEY_SECRET</span> and <span className="adm-mono">RAZORPAY_WEBHOOK_SECRET</span>), never in the store settings, so they cannot be seen or changed from here.</p>
          <p className="adm-hint">To switch between test and live payments, or to rotate a key, change those variables in your hosting dashboard and redeploy. Refunds, payouts and settlements are in the Razorpay dashboard.</p>
        </div>
      </Card>

      <Card title="Gift cards" subtitle="Shoppers can also pay with a gift card balance."
        footer={<Button to="/admin/gift-cards" iconRight="arrowRight">Gift card settings</Button>}>
        <p className="adm-hint">Turn gift cards on or off, set the amount limits and how long they stay valid on the <Link to="/admin/gift-cards">Gift cards</Link> screen.</p>
      </Card>
    </SettingsForm>
  );
}

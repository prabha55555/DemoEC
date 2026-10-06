import React from 'react';
import { INDIAN_STATES } from '../../utils/indianAddress';
import { Field, FieldRow, Section, Select, Textarea, TextInput } from '../ui';
import { checkEmail, checkPhone } from '../lib/validate';
import { normaliseGstin, validateGstin } from '../lib/gstin';
import SettingsForm from './SettingsForm';
import useBrandForm from './useBrandForm';

// Tax & invoice: the GST rate used when a product / category has none, and the seller details printed on invoices.
// Product prices are GST-INCLUSIVE (the shopper pays the listed price); the invoice shows the tax already inside it.
// A rate set on a category or a product overrides the store default.
const GST_RATES = [0, 3, 5, 12, 18, 28];

export default function TaxSettings() {
  const form = useBrandForm({
    initial: (b) => ({
      default_gst_rate: String(b.default_gst_rate ?? 18), seller_legal_name: b.seller_legal_name || '', seller_gstin: b.seller_gstin || '',
      seller_state: b.seller_state || '', registered_office: b.registered_office || '', support_email: b.support_email || '', support_phone: b.support_phone || '',
    }),
    validate: (v) => {
      const g = validateGstin(v.seller_gstin);
      return { seller_gstin: g.valid ? '' : g.message, support_email: checkEmail(v.support_email, { label: 'The support email' }), support_phone: checkPhone(v.support_phone, { label: 'The support phone' }) };
    },
    toPayload: (v) => ({
      default_gst_rate: Number(v.default_gst_rate), seller_legal_name: v.seller_legal_name.trim(), seller_gstin: validateGstin(v.seller_gstin).value,
      seller_state: v.seller_state, registered_office: v.registered_office.trim(), support_email: v.support_email.trim(), support_phone: v.support_phone.trim(),
    }),
    successMessage: 'Tax and invoice settings saved.',
  });
  const { values, set, errors } = form;
  const gstin = validateGstin(values.seller_gstin);
  const stateHint = gstin.valid && gstin.stateName && values.seller_state && gstin.stateName !== values.seller_state
    ? `This GSTIN belongs to ${gstin.stateName}, but the seller state is ${values.seller_state}. Check both.` : '';

  return (
    <SettingsForm form={form}>
      <Section title="GST" description="Prices on your store include GST, so shoppers pay the listed price. Invoices show the GST already inside it, split into CGST + SGST within your state and IGST for other states.">
        <div style={{ maxWidth: 260 }}>
          <Field label="Default GST rate" hint="Used for products and categories that do not set their own rate. You can override it per category or product.">
            <Select value={values.default_gst_rate} onChange={v => set('default_gst_rate', v)} options={GST_RATES.map(r => ({ value: String(r), label: `${r}%` }))} />
          </Field>
        </div>
      </Section>

      <Section title="Seller details" description="Printed on every invoice. The seller state decides whether an order is taxed as CGST + SGST or IGST.">
        <FieldRow>
          <Field label="Legal name" optional hint="The registered business name."><TextInput value={values.seller_legal_name} onChange={v => set('seller_legal_name', v)} /></Field>
          <Field label="GSTIN" optional error={errors.seller_gstin} hint={stateHint || (gstin.valid && gstin.stateName ? `State code matches ${gstin.stateName}.` : '15 characters, e.g. 33AAAAA0000A1Z5. Leave blank if you are not GST-registered.')}>
            <TextInput value={values.seller_gstin} onChange={v => set('seller_gstin', normaliseGstin(v).slice(0, 15))} placeholder="33AAAAA0000A1Z5" maxLength={15} autoCapitalize="characters" spellCheck={false} className="adm-mono" />
          </Field>
        </FieldRow>
        <Field label="Seller state" hint="The state you ship from.">
          <Select value={values.seller_state} onChange={v => set('seller_state', v)} placeholder="Choose a state…" options={INDIAN_STATES} />
        </Field>
        <Field label="Registered office" optional hint="Also shown in the store footer (General settings).">
          <Textarea rows={2} value={values.registered_office} onChange={v => set('registered_office', v)} placeholder="Street, area, city, state and PIN code" />
        </Field>
      </Section>

      <Section title="Support contact" description="Shown to shoppers on invoices and policy pages.">
        <FieldRow>
          <Field label="Support email" optional error={errors.support_email}><TextInput type="email" value={values.support_email} onChange={v => set('support_email', v)} placeholder="help@yourstore.com" /></Field>
          <Field label="Support phone" optional error={errors.support_phone}><TextInput type="tel" value={values.support_phone} onChange={v => set('support_phone', v)} placeholder="98765 43210" /></Field>
        </FieldRow>
      </Section>
    </SettingsForm>
  );
}

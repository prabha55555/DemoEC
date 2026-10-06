import React from 'react';
import { Link } from 'react-router-dom';
import { safeHref } from '../../utils/safeUrl';
import { Card, Field, FieldRow, Section, Textarea, TextInput } from '../ui';
import SettingsForm from './SettingsForm';
import BrandImageField from './BrandImageField';
import useBrandForm from './useBrandForm';

// General: logo, loading-screen logo, name, tagline, registered office and social links.
const SOCIAL = [['instagram_url', 'Instagram', 'https://instagram.com/your-page'], ['facebook_url', 'Facebook', 'https://facebook.com/your-page'], ['youtube_url', 'YouTube', 'https://youtube.com/@your-channel'], ['pinterest_url', 'Pinterest', 'https://pinterest.com/your-page']];
const KEYS = ['brand_name', 'tagline', 'registered_office', ...SOCIAL.map(s => s[0])];

export default function GeneralSettings() {
  const form = useBrandForm({
    initial: (b) => Object.fromEntries(KEYS.map(k => [k, b[k] || ''])),
    validate: (v) => {
      const e = { brand_name: v.brand_name.trim() ? '' : 'Your store needs a name.' };
      // SEC-XSS-3: these render as real <a href> links in the site footer and in emails -- only links safeHref() accepts are allowed.
      for (const [key, label] of SOCIAL) e[key] = v[key].trim() && !safeHref(v[key].trim()) ? `This ${label} link does not look valid. Use a full https:// address.` : '';
      return e;
    },
    toPayload: (v) => Object.fromEntries(KEYS.map(k => [k, v[k].trim()])),
    successMessage: 'General settings saved.',
  });
  const { values, set, errors } = form;

  return (
    <SettingsForm form={form}>
      <Section title="Logos" description="Images save as soon as you choose them.">
        <BrandImageField field="logo_url" title="Logo" help="Shown in the store header and in emails." previewHeight={48} />
        <BrandImageField field="splash_logo" title="Loading-screen logo" help="Shown full-screen while the store loads. If empty, the main logo is used." previewHeight={64} />
      </Section>

      <Section title="Brand" description="How your store introduces itself.">
        <FieldRow>
          <Field label="Store name" required error={errors.brand_name}><TextInput value={values.brand_name} onChange={v => set('brand_name', v)} /></Field>
          <Field label="Tagline" optional><TextInput value={values.tagline} onChange={v => set('tagline', v)} /></Field>
        </FieldRow>
        <Field label="Registered office" optional hint={<>Shown in the store footer. Also printed on invoices (see <Link to="/admin/settings/tax">Tax &amp; invoice</Link>).</>}>
          <Textarea rows={2} value={values.registered_office} onChange={v => set('registered_office', v)} placeholder="Street, area, city, state and PIN code" />
        </Field>
      </Section>

      <Section title="Social links" description="Shown in the footer and in emails. Leave a link blank to hide it.">
        <FieldRow>
          {SOCIAL.map(([key, label, ph]) => (
            <Field key={key} label={`${label} link`} optional error={errors[key]}><TextInput value={values[key]} onChange={v => set(key, v)} placeholder={ph} type="url" /></Field>
          ))}
        </FieldRow>
      </Section>

      <Card pad={false}>
        <div className="adm-card-body adm-hint">
          Product categories and their attributes live on their own screen. <Link to="/admin/categories">Manage categories →</Link>
        </div>
      </Card>
    </SettingsForm>
  );
}

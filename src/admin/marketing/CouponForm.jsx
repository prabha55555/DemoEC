import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { supabase } from '../../supabase';
import { Button, Card, DataTable, DateTime, EmptyState, ErrorState, Field, FieldRow, Icon, Money, MoneyInput, NumberInput, PageHeader, Pagination, SaveBar, Section, Select, Skeleton, Stat, StatusPill, Textarea, TextInput, Toggle } from '../ui';
import { adminWrite, useRecord, useServerList, useUnsavedChanges } from '../hooks';
import { hasErrors } from '../lib/validate';
import { fetchAllCapped } from '../lib/queries';
import { formatMoney } from '../lib/format';
import useLoad from '../orders/useLoad';
import { CategoryPicker, ProductPicker } from './CouponPickers';
import {
  EMPTY_COUPON_FORM, couponPayload, couponStatus, couponToForm, couponUsageStats, couponWarnings, describeOffer, describeScope, duplicateForm, generateCode,
  normaliseCode, validateCoupon,
} from './couponLogic';
import { COUPON_COLUMNS, STATUS_PILL } from './couponData';
import '../orders/orders.css';

const DUP = 'Another coupon already uses that code. Codes must be unique: pick a different one.';
const SCOPES = [
  { value: 'all', label: 'All products' },
  { value: 'products', label: 'Specific products' },
  { value: 'bundle', label: 'A bundle (needs ALL the chosen products in the cart)' },
  { value: 'categories', label: 'Specific categories' },
];
const SCOPE_HINT = {
  all: 'Every item in the cart counts. Gift cards are never discounted.',
  products: 'Only the chosen products count towards the discount and the minimum order.',
  bundle: 'The coupon only works when every chosen product is in the cart. Only those items are discounted.',
  categories: 'Only items in the chosen categories (or their sub-categories) count.',
};

// Create / edit a coupon: /admin/coupons/new, /admin/coupons/new?from=<id> (duplicate) and /admin/coupons/:id.
export default function CouponForm() {
  const { id } = useParams();
  const [query] = useSearchParams();
  const fromId = query.get('from') || '';
  const navigate = useNavigate();
  const editing = !!id;
  const source = useRecord('coupons', editing ? id : fromId, { select: COUPON_COLUMNS });
  const [form, setForm] = useState(EMPTY_COUPON_FORM);
  const [baseline, setBaseline] = useState(JSON.stringify(EMPTY_COUPON_FORM));
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const seeded = useRef('');

  // Seed the form once the coupon being edited / copied has arrived (and never again, so typing is not overwritten).
  useEffect(() => {
    const key = editing ? `edit:${id}` : fromId ? `from:${fromId}` : 'new';
    if (seeded.current === key) return;
    if ((editing || fromId) && !source.record) return;
    const f = editing ? couponToForm(source.record) : fromId ? duplicateForm(source.record) : EMPTY_COUPON_FORM;
    setForm(f); setBaseline(JSON.stringify(f)); setTried(false); seeded.current = key;
  }, [editing, id, fromId, source.record]);

  const changed = JSON.stringify(form) !== baseline;
  useUnsavedChanges(changed);
  const set = (key, value) => setForm(f => ({ ...f, [key]: value }));
  const errors = useMemo(() => validateCoupon(form), [form]);
  const shown = tried ? errors : {};
  // the "guests must sign in" heads-up already shows next to the limits it belongs to
  const warnings = useMemo(() => couponWarnings(form).filter(w => !/signed in/.test(w)), [form]);
  const record = source.record;

  // What this coupon has done (edit only): its orders, narrow columns, capped.
  const code = record?.code || '';
  const usage = useLoad(async () => {
    const { rows, truncated } = await fetchAllCapped(() => supabase.from('orders').select('discount, total, status').eq('coupon_code', code).is('deleted_at', null).order('created_at', { ascending: false }));
    return { ...couponUsageStats(rows), truncated };
  }, [code], { enabled: editing && !!code });
  const orders = useServerList({
    table: 'orders', select: 'id, order_id, created_at, status, discount, total, user_name, user_email', filters: { coupon_code: code, deleted_at: null },
    orderBy: { column: 'created_at', ascending: false }, pageSize: 10, enabled: editing && !!code,
  });
  const used = record ? (Number(record.times_used) > 0 || (usage.data && usage.data.orders + usage.data.cancelled > 0)) : false;

  async function save() {
    setTried(true);
    if (hasErrors(errors)) { toast.error('Please fix the highlighted fields first.'); return; }
    setSaving(true);
    const payload = couponPayload(form);
    if (editing) {
      const { ok } = await adminWrite(supabase.from('coupons').update(payload).eq('id', id), { success: 'Coupon saved.', errors: { 23505: DUP } });
      if (ok) { setBaseline(JSON.stringify({ ...form, code: payload.code })); setForm(f => ({ ...f, code: payload.code })); source.reload(); }
    } else {
      const { ok, data } = await adminWrite(supabase.from('coupons').insert(payload), { success: 'Coupon created.', errors: { 23505: DUP } });
      if (ok) { setBaseline(JSON.stringify(form)); navigate(`/admin/coupons/${data[0].id}`, { replace: true }); }
    }
    setSaving(false);
  }

  const title = editing ? (record ? record.code : 'Coupon') : fromId ? 'Duplicate coupon' : 'New coupon';
  if ((editing || fromId) && source.loading && !record) return (<><PageHeader title={title} crumbLabel="Coupon" /><Card><Skeleton height={20} width="35%" /><div style={{ height: 12 }} /><Skeleton height={120} /></Card></>);
  if (source.error) return (<><PageHeader title="Coupon" /><Card pad={false}><ErrorState error={source.error} onRetry={source.reload} /></Card></>);
  if ((editing || fromId) && source.notFound) return (<><PageHeader title="Coupon not found" /><Card pad={false}><EmptyState icon="tag" title="That coupon does not exist" hint="It may have been deleted." action={<Button variant="primary" to="/admin/coupons">All coupons</Button>} /></Card></>);

  const pct = form.type === 'percent';
  const status = record ? couponStatus(record) : null;
  const preview = [
    Number(form.value) > 0 ? describeOffer({ type: form.type, value: form.value, max_discount: pct ? form.max_discount : null }) : '',
    Number(form.min_order_value) > 0 ? `on orders of ₹${Number(form.min_order_value).toLocaleString('en-IN')} or more` : '',
  ].filter(Boolean).join(' ');

  return (
    <>
      <PageHeader
        title={title} crumbLabel={editing ? (record?.code || 'Coupon') : title}
        subtitle={status ? <span className="ord-headline"><StatusPill kind="generic" tone={STATUS_PILL[status].tone} status={status} label={STATUS_PILL[status].label} />{record && <span>Used {record.times_used}{Number(record.max_uses) > 0 ? ` of ${record.max_uses}` : ''} time{Number(record.times_used) === 1 ? '' : 's'}</span>}</span> : 'Set up a discount code customers can use at checkout'}
        actions={editing && record ? <Button icon="tag" to={`/admin/coupons/new?from=${record.id}`}>Duplicate</Button> : undefined}
      />

      <div className="adm-stack loose">
        <Card title="How customers see it" subtitle="A live summary of the rules below">
          <div className="cpn-preview">
            <span className="ord-code">{normaliseCode(form.code) || 'YOURCODE'}</span>
            <strong>{preview || 'Choose a discount'}</strong>
            <span className="adm-muted">{form.description || 'Add a description to show customers what this coupon is for.'}</span>
            <span className="adm-cell-sub">Applies to: {describeScope({ applies_to: form.applies_to, product_ids: form.product_ids, category_ids: form.category_ids })}{form.is_public ? '' : ' · private: not listed in customers\' accounts'}</span>
          </div>
        </Card>

        <Section title="Code and description" description="The code customers type at checkout. Codes are not case sensitive and must be unique.">
          <Field label="Coupon code" required error={shown.code} hint={used ? 'The code is locked because this coupon has already been used. Duplicate it to get a new code.' : 'Letters, numbers, dashes and underscores, 3 to 20 characters.'}>
            <div className="cpn-code-row">
              <TextInput value={form.code} onChange={v => set('code', v.toUpperCase().replace(/[^A-Z0-9_-]/g, ''))} maxLength={20} placeholder="e.g. WELCOME10" disabled={used} autoCapitalize="characters" spellCheck={false} />
              <Button icon="refresh" disabled={used} onClick={() => set('code', generateCode('SAVE'))}>Generate</Button>
            </div>
          </Field>
          <Field label="Description" optional hint="Shown to customers next to the code, for example “10% off your first order”.">
            <Textarea rows={2} value={form.description} onChange={v => set('description', v)} maxLength={160} showCount />
          </Field>
        </Section>

        <Section title="Discount" description="What the customer saves. Percentages are worked out on the items the coupon applies to, before delivery.">
          <div className="adm-field">
            <span className="adm-label" id="cpn-type-label">Type</span>
            <div className="adm-seg" role="group" aria-labelledby="cpn-type-label" style={{ alignSelf: 'flex-start' }}>
              <button type="button" aria-pressed={pct} onClick={() => set('type', 'percent')}>Percentage</button>
              <button type="button" aria-pressed={!pct} onClick={() => set('type', 'flat')}>Flat amount</button>
            </div>
          </div>
          <FieldRow cols={pct ? 3 : 2}>
            <Field label={pct ? 'Percentage off' : 'Amount off'} required error={shown.value}>
              {pct ? <NumberInput value={form.value} onChange={v => set('value', v)} min={0} max={100} suffix="%" placeholder="10" /> : <MoneyInput value={form.value} onChange={v => set('value', v)} placeholder="100" />}
            </Field>
            {pct && (
              <Field label="Cap the discount at" optional error={shown.max_discount} hint="e.g. 10% off up to ₹150. Blank = no cap.">
                <MoneyInput value={form.max_discount} onChange={v => set('max_discount', v)} placeholder="No cap" />
              </Field>
            )}
            <Field label="Minimum order value" optional error={shown.min_order_value} hint="Counted on the items the coupon applies to.">
              <MoneyInput value={form.min_order_value} onChange={v => set('min_order_value', v)} placeholder="No minimum" />
            </Field>
          </FieldRow>
        </Section>

        <Section title="Applies to" description="Which items in the cart the coupon covers.">
          <Field label="Items covered" error={shown.applies_to} hint={SCOPE_HINT[form.applies_to]}>
            <Select value={form.applies_to} onChange={v => set('applies_to', v)} options={SCOPES} />
          </Field>
          {(form.applies_to === 'products' || form.applies_to === 'bundle') && <ProductPicker value={form.product_ids} onChange={v => set('product_ids', v)} label={form.applies_to === 'bundle' ? 'Bundle products (all required)' : 'Products'} />}
          {form.applies_to === 'categories' && <CategoryPicker value={form.category_ids} onChange={v => set('category_ids', v)} />}
        </Section>

        <Section title="Limits and schedule" description="When the coupon works and how often it can be used. Times are India time.">
          <FieldRow cols={2}>
            <Field label="Starts" optional error={shown.starts_at} hint="Blank = starts immediately."><TextInput type="datetime-local" value={form.starts_at} onChange={v => set('starts_at', v)} /></Field>
            <Field label="Ends" optional error={shown.expires_at} hint="Blank = never ends."><TextInput type="datetime-local" value={form.expires_at} onChange={v => set('expires_at', v)} /></Field>
          </FieldRow>
          <FieldRow cols={2}>
            <Field label="Total uses" optional error={shown.max_uses} hint="Across all customers. Blank or 0 = unlimited.">
              <NumberInput integer value={form.max_uses} onChange={v => set('max_uses', v)} min={0} placeholder="Unlimited" />
            </Field>
            <Field label="Uses per customer" optional error={shown.per_user_limit} hint="Blank or 0 = unlimited.">
              <NumberInput integer value={form.per_user_limit} onChange={v => set('per_user_limit', v)} min={0} placeholder="Unlimited" />
            </Field>
          </FieldRow>
          <Toggle checked={form.first_order_only} onChange={v => set('first_order_only', v)} label="First order only" hint="Only customers who have never ordered before can use it." />
          {(form.first_order_only || Number(form.per_user_limit) > 0) && (
            <div className="adm-note info" role="note"><Icon name="info" size={15} /> These rules need a signed-in customer: a guest is told “Sign in to use this coupon.”, because “first order” and “per customer” cannot be checked for someone who is not logged in.</div>
          )}
        </Section>

        <Section title="Visibility and status" description="Who can see the coupon, and whether it works right now.">
          <Toggle checked={form.is_public} onChange={v => set('is_public', v)} label="Show it to customers" hint="Public coupons are listed in customers' accounts. A private coupon still works for anyone who has the code, but is not listed." />
          <Toggle checked={form.active} onChange={v => set('active', v)} label="Coupon is switched on" hint="Switch off to stop it working straight away without deleting it." />
        </Section>

        {warnings.length > 0 && !hasErrors(errors) && (
          <div className="adm-stack tight" aria-label="Things to check">
            {warnings.map(w => <div key={w} className="adm-note warning"><Icon name="warning" size={15} /> {w}</div>)}
          </div>
        )}

        {editing && record && (
          <Card title="Usage" subtitle="What this coupon has done so far (cancelled orders give the use back and are not counted)">
            <div className="adm-stack">
              <div className="adm-kpis c4">
                <Stat label="Times used" icon="tag" tone="primary" value={`${record.times_used}${Number(record.max_uses) > 0 ? ` / ${record.max_uses}` : ''}`} hint={Number(record.max_uses) > 0 ? 'The coupon counter' : 'No limit set'} />
                <Stat label="Orders" icon="cart" tone="info" value={usage.data ? usage.data.orders.toLocaleString('en-IN') : ''} loading={usage.loading && !usage.data} error={!!usage.error} onRetry={usage.reload} hint={usage.data && usage.data.cancelled ? `${usage.data.cancelled} cancelled` : undefined} />
                <Stat label="Discount given" icon="receipt" tone="warning" value={usage.data ? (formatMoney(usage.data.discount) || '₹0') : ''} loading={usage.loading && !usage.data} error={!!usage.error} onRetry={usage.reload} />
                <Stat label="Order value" icon="card" tone="success" value={usage.data ? (formatMoney(usage.data.revenue) || '₹0') : ''} loading={usage.loading && !usage.data} error={!!usage.error} onRetry={usage.reload} hint="Total charged on those orders" />
              </div>
              <DataTable
                caption="Orders that used this coupon" stickyHeader={false} rowKey="id" rowHref={o => `/admin/orders/${encodeURIComponent(o.order_id)}`} className="ord-bare"
                columns={[
                  { key: 'order_id', header: 'Order', className: 'ord-nowrap', render: o => <strong>{o.order_id}</strong> },
                  { key: 'created_at', header: 'Placed', className: 'ord-nowrap', render: o => <DateTime value={o.created_at} dateOnly /> },
                  { key: 'customer', header: 'Customer', render: o => o.user_name || o.user_email || 'Guest' },
                  { key: 'discount', header: 'Discount', align: 'right', render: o => <Money value={o.discount} /> },
                  { key: 'total', header: 'Total', align: 'right', render: o => <Money value={o.total} /> },
                  { key: 'status', header: 'Status', render: o => <StatusPill status={o.status} kind="order" /> },
                ]}
                rows={orders.rows} loading={orders.loading} error={orders.error} onRetry={orders.reload}
                empty={{ icon: 'cart', title: 'No orders yet', hint: 'Orders that use this coupon will be listed here.' }}
                footer={<Pagination page={orders.page} pageSize={orders.pageSize} total={orders.count} onPage={orders.setPage} />}
              />
              <p className="adm-hint" style={{ margin: 0 }}>Editing the rules affects future orders only. <Link to="/admin/coupons">Back to all coupons</Link></p>
            </div>
          </Card>
        )}
      </div>

      <SaveBar dirty={changed || !editing} saving={saving} onSave={save} onDiscard={changed ? () => { setForm(JSON.parse(baseline)); setTried(false); } : undefined}
        saveLabel={editing ? 'Save changes' : 'Create coupon'} message={editing ? undefined : 'This coupon is not saved yet.'} />
    </>
  );
}

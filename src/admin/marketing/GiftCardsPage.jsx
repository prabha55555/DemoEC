import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../supabase';
import { DEFAULT_GIFTCARD_MIN } from '../../utils/pricing';
import { Button, Card, DataTable, DateTime, FilterBar, Money, NumberInput, MoneyInput, PageHeader, Pagination, Field, FieldRow, Stat, StatusPill, Textarea, Toggle } from '../ui';
import { useServerList, useUrlFilters } from '../hooks';
import useBrandForm from '../settings/useBrandForm';
import { checkNumber } from '../lib/validate';
import { fetchAllCapped } from '../lib/queries';
import { formatMoney } from '../lib/format';

// Gift cards: the store-wide settings (on/off, amount limits, validity, page text) and the list of cards issued.
// Customers buy a card at /gift-card; each purchase creates a real balance under a unique code.
export default function GiftCardsPage() {
  const form = useBrandForm({
    initial: (b) => ({
      enabled: b.giftcard_enabled !== false,
      min: String(b.giftcard_min ?? DEFAULT_GIFTCARD_MIN),
      max: b.giftcard_max === null || b.giftcard_max === undefined ? '' : String(b.giftcard_max), // blank = no upper limit
      months: String(b.gift_card_validity_months ?? 6),
      description: b.giftcard_description || '',
    }),
    validate: (v) => {
      const e = {
        min: checkNumber(v.min, { required: true, min: 1, label: 'The minimum' }),
        max: checkNumber(v.max, { min: 0, label: 'The maximum' }),
        months: checkNumber(v.months, { required: true, min: 1, max: 60, integer: true, label: 'Validity' }),
      };
      if (!e.min && !e.max && v.max !== '' && Number(v.max) <= Number(v.min)) e.max = 'The maximum must be higher than the minimum, or left blank for no limit.';
      return e;
    },
    toPayload: (v) => ({
      giftcard_enabled: v.enabled, giftcard_min: Number(v.min), giftcard_max: v.max === '' ? null : Number(v.max),
      gift_card_validity_months: Number(v.months), giftcard_description: v.description,
    }),
    successMessage: 'Gift card settings saved.',
  });
  const { values, set, errors } = form;

  const { values: f, set: setF, reset, active } = useUrlFilters({ q: '', page: 1 });
  const list = useServerList({
    table: 'gift_cards', search: f.q, searchColumns: ['code', 'recipient_name', 'recipient_email', 'purchaser_email'],
    orderBy: { column: 'created_at', ascending: false }, pageSize: 20, page: f.page, onPageChange: p => setF({ page: p }),
  });

  // Totals over the whole table, from two narrow columns (capped read -- see fetchAllCapped).
  const [totals, setTotals] = useState({ loading: true, error: false, outstanding: 0, redeemed: 0, truncated: false });
  useEffect(() => {
    let cancelled = false;
    fetchAllCapped(() => supabase.from('gift_cards').select('balance, initial_value').order('created_at', { ascending: false }))
      .then(({ rows, truncated }) => {
        if (cancelled) return;
        const outstanding = rows.reduce((s, g) => s + (Number(g.balance) || 0), 0);
        const issued = rows.reduce((s, g) => s + (Number(g.initial_value) || 0), 0);
        setTotals({ loading: false, error: false, outstanding, redeemed: issued - outstanding, truncated });
      })
      .catch(() => { if (!cancelled) setTotals(t => ({ ...t, loading: false, error: true })); });
    return () => { cancelled = true; };
  }, []);

  const expired = (g) => g.expires_at && new Date(g.expires_at) < new Date();

  return (
    <>
      <PageHeader title="Gift cards" subtitle="Settings for the gift card page, and every card issued" />
      <div className="adm-stack loose">
        <Card title="Settings"
          subtitle="Customers pick their own amount at /gift-card and buy it like a product. Each purchase creates a spendable balance under a unique code that is applied at checkout."
          footer={(
            <>
              <Button variant="primary" loading={form.saving} disabled={!form.canSave} onClick={form.save}>Save settings</Button>
              <Button disabled={!form.dirty || form.saving} onClick={form.reset}>Discard</Button>
              {form.dirty && <span className="adm-hint">You have unsaved changes.</span>}
            </>
          )}>
          <div className="adm-stack">
            <Toggle checked={values.enabled} onChange={v => set('enabled', v)} disabled={!form.loaded} label="Gift cards are on" hint="Turn off to hide the Gift Cards page and stop sales." />
            <FieldRow cols={3}>
              <Field label="Minimum amount" error={errors.min}><MoneyInput value={values.min} onChange={v => set('min', v)} decimals={0} disabled={!form.loaded} /></Field>
              <Field label="Maximum amount" optional error={errors.max} hint="Blank = no upper limit."><MoneyInput value={values.max} onChange={v => set('max', v)} decimals={0} disabled={!form.loaded} placeholder="No limit" /></Field>
              <Field label="Valid for" error={errors.months} hint="From the purchase date."><NumberInput value={values.months} onChange={v => set('months', v)} integer min={1} max={60} suffix="months" disabled={!form.loaded} /></Field>
            </FieldRow>
            <Field label="Page description" hint="Shown at the top of the gift card page."><Textarea rows={2} value={values.description} onChange={v => set('description', v)} disabled={!form.loaded} /></Field>
          </div>
        </Card>

        <div>
          <div className="adm-kpis" style={{ marginBottom: 14 }}>
            <Stat label="Outstanding balance" icon="gift" tone="primary" value={formatMoney(totals.outstanding) || '₹0'} loading={totals.loading} error={totals.error} hint="Unspent on issued cards" />
            <Stat label="Redeemed to date" icon="receipt" tone="success" value={formatMoney(totals.redeemed) || '₹0'} loading={totals.loading} error={totals.error} hint={totals.truncated ? 'First 5,000 cards' : 'Spent by customers'} />
            <Stat label="Cards issued" icon="card" tone="info" value={list.count.toLocaleString('en-IN')} loading={list.loading && list.rows.length === 0} />
          </div>
          <FilterBar search={f.q} onSearch={q => setF({ q })} searchPlaceholder="Search code, recipient or purchaser…" showClear={active} onClear={reset} />
          <DataTable
            caption="Issued gift cards"
            columns={[
              { key: 'code', header: 'Code', render: g => <span className="adm-mono"><strong>{g.code}</strong></span> },
              { key: 'balance', header: 'Balance', align: 'right', render: g => <Money value={g.balance} /> },
              { key: 'initial_value', header: 'Value', align: 'right', hideOnMobile: true, render: g => <Money value={g.initial_value} muted /> },
              { key: 'status', header: 'Status', render: g => (expired(g) ? <StatusPill kind="generic" status="expired" /> : Number(g.balance) > 0 ? <StatusPill kind="generic" status="active" /> : <StatusPill kind="generic" tone="neutral" status="inactive" label="Used up" />) },
              { key: 'recipient', header: 'Recipient', render: g => (g.recipient_name || g.recipient_email ? <span>{g.recipient_name}{g.recipient_email && <span className="adm-cell-sub" style={{ display: 'block' }}>{g.recipient_email}</span>}</span> : <span className="adm-muted">—</span>) },
              { key: 'created_at', header: 'Purchased', hideOnMobile: true, render: g => <DateTime value={g.created_at} dateOnly /> },
              { key: 'order', header: 'Order', hideOnMobile: true, render: g => (g.order_id ? <Link to={`/admin/orders/${g.order_id}`}>{g.order_id}</Link> : <span className="adm-muted">—</span>) },
            ]}
            rows={list.rows} loading={list.loading} error={list.error} onRetry={list.reload}
            empty={active ? { icon: 'search', title: 'No gift cards match your search' } : { icon: 'gift', title: 'No gift cards yet', hint: 'Cards appear here once customers buy them.', action: <Button href="/gift-card" target="_blank" icon="external">View the gift card page</Button> }}
            footer={<Pagination page={list.page} pageSize={list.pageSize} total={list.count} onPage={list.setPage} />}
          />
        </div>
      </div>
    </>
  );
}

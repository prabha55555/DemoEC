import React from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../../supabase';
import { withTimeout } from '../../utils/withTimeout';
import { isPlaceholderEmail } from '../../utils/orderFormat';
import StarRating from '../../components/StarRating';
import { Button, Card, CopyButton, DataTable, DateTime, EmptyState, ErrorState, Money, PageHeader, Pagination, Skeleton, Stat, StatusPill } from '../ui';
import { useRecord, useServerList } from '../hooks';
import { fetchAllCapped } from '../lib/queries';
import { formatMoney, relativeTime } from '../lib/format';
import useLoad, { rowsOf } from '../orders/useLoad';
import { itemsSummaryText, shortReturnId, waNumber } from '../orders/orderLogic';
import { addressText, customerStats } from './customerLogic';
import '../orders/orders.css';

const PROFILE_COLUMNS = 'id, name, phone, marketing_opt_in, addresses, created_at';

// /admin/customers/:id -- one customer (read only). Their profile, what they have spent, every order, their returns and
// reviews. The id is the account id; the sign-in email is not stored on the profile, so it is found through
// admin_customers() (matching on phone or name) and, failing that, on their latest order.
export default function CustomerDetail() {
  const { id = '' } = useParams();
  const { record: profile, loading, error, notFound, reload } = useRecord('profiles', id, { select: PROFILE_COLUMNS });
  const ready = !!profile;

  const contact = useLoad(async () => {
    const term = profile.phone || profile.name;
    if (term) {
      const { data } = await withTimeout(supabase.rpc('admin_customers', { p_search: String(term).replace(/[%,()"'\\*]/g, ' ').trim(), p_limit: 50, p_offset: 0 }), 15000);
      const hit = (data || []).find(r => r.id === id);
      if (hit && hit.email) return { email: hit.email };
    }
    const last = await rowsOf(supabase.from('orders').select('user_email').eq('user_id', id).not('user_email', 'is', null).order('created_at', { ascending: false }).limit(1));
    return { email: last[0]?.user_email || '' };
  }, [id, profile?.phone, profile?.name], { enabled: ready, initial: { email: '' } });

  // Lifetime figures: a bounded read of three narrow columns across all of this customer's orders.
  const stats = useLoad(async () => {
    const { rows, truncated } = await fetchAllCapped(() => supabase.from('orders').select('total, refunded_amount, status, created_at').eq('user_id', id).is('deleted_at', null).order('created_at', { ascending: false }));
    return { ...customerStats(rows), truncated };
  }, [id], { enabled: ready });

  const orders = useServerList({
    table: 'orders', select: 'id, order_id, created_at, status, payment_method, payment_status, total, refunded_amount, items',
    filters: { user_id: id, deleted_at: null }, orderBy: { column: 'created_at', ascending: false }, pageSize: 10, enabled: ready,
  });
  const returns = useLoad(() => rowsOf(supabase.from('order_returns').select('id, order_id, type, status, refund_amount, items, created_at').eq('user_id', id).order('created_at', { ascending: false }).limit(10)), [id], { enabled: ready, initial: [] });
  const reviews = useLoad(async () => {
    const rows = await rowsOf(supabase.from('reviews').select('id, product_id, rating, title, status, created_at').eq('user_id', id).order('created_at', { ascending: false }).limit(10));
    const pids = Array.from(new Set(rows.map(r => r.product_id)));
    const names = pids.length ? await rowsOf(supabase.from('products').select('id, name').in('id', pids)) : [];
    const byId = Object.fromEntries(names.map(p => [p.id, p.name]));
    return rows.map(r => ({ ...r, product_name: byId[r.product_id] || 'Product' }));
  }, [id], { enabled: ready, initial: [] });

  if (loading && !profile) return (<><PageHeader title="Customer" crumbLabel={id} /><Card><Skeleton height={20} width="35%" /><div style={{ height: 12 }} /><Skeleton height={90} /></Card></>);
  if (error) return (<><PageHeader title="Customer" crumbLabel={id} /><Card pad={false}><ErrorState error={error} onRetry={reload} /></Card></>);
  if (notFound || !profile) return (<><PageHeader title="Customer not found" crumbLabel={id} /><Card pad={false}><EmptyState icon="users" title="No customer with that id" hint="The account may have been deleted." action={<Button variant="primary" to="/admin/customers">All customers</Button>} /></Card></>);

  const email = contact.data?.email && !isPlaceholderEmail(contact.data.email) ? contact.data.email : '';
  const s = stats.data;
  const addresses = Array.isArray(profile.addresses) ? profile.addresses : [];
  const name = profile.name || email || 'Customer';

  return (
    <>
      <PageHeader title={name} crumbLabel={name}
        subtitle={<span className="ord-headline">{profile.marketing_opt_in ? <StatusPill kind="generic" tone="success" status="yes" label="Opted in to marketing" /> : <StatusPill kind="generic" tone="neutral" status="no" label="Not opted in to marketing" />}<span>Joined <DateTime value={profile.created_at} dateOnly /></span></span>}
        actions={(
          <>
            {profile.phone && <Button icon="wa" href={`https://wa.me/${waNumber(profile.phone)}`} target="_blank">WhatsApp</Button>}
            {email && <Button icon="mail" href={`mailto:${email}`}>Email</Button>}
            <Button icon="cart" to={`/admin/orders?q=${encodeURIComponent(email || profile.phone || name)}`}>Find in orders</Button>
          </>
        )} />

      <div className="adm-stack loose">
        <div className="adm-kpis c4">
          <Stat label="Orders" icon="cart" tone="primary" value={s ? s.orders.toLocaleString('en-IN') : ''} loading={stats.loading && !s} error={!!stats.error} onRetry={stats.reload} hint={s && s.cancelled ? `${s.cancelled} cancelled not counted` : 'Cancelled orders are not counted'} />
          <Stat label="Lifetime value" icon="receipt" tone="success" value={s ? (formatMoney(s.lifetime) || '₹0') : ''} loading={stats.loading && !s} error={!!stats.error} onRetry={stats.reload} hint={s && s.refunded ? `After ${formatMoney(s.refunded)} refunded` : 'What they paid, after refunds'} />
          <Stat label="Average order value" icon="card" tone="info" value={s ? (s.orders ? formatMoney(s.average) : '—') : ''} loading={stats.loading && !s} error={!!stats.error} onRetry={stats.reload} hint="Lifetime value ÷ orders" />
          <Stat label="Last order" icon="clock" tone="neutral" value={s ? (s.lastAt ? relativeTime(s.lastAt) : 'Never') : ''} loading={stats.loading && !s} error={!!stats.error} onRetry={stats.reload} hint={s && s.lastAt ? <>On <DateTime value={s.lastAt} dateOnly />{s.firstAt ? <> · first order <DateTime value={s.firstAt} dateOnly /></> : null}</> : undefined} />
        </div>
        {s && s.truncated && <p className="adm-hint" style={{ margin: '-12px 0 0' }}>Figures cover the most recent 5,000 orders.</p>}

        <div className="ord-detail">
          <div className="ord-main">
            <Card title="Orders" subtitle={orders.count ? `${orders.count.toLocaleString('en-IN')} order${orders.count === 1 ? '' : 's'}` : undefined} pad={false}>
              <DataTable
                caption="This customer's orders" stickyHeader={false} rowKey="id" rowHref={o => `/admin/orders/${encodeURIComponent(o.order_id)}`} className="ord-bare"
                columns={[
                  { key: 'order_id', header: 'Order', className: 'ord-nowrap', render: o => <strong>{o.order_id}</strong> },
                  { key: 'created_at', header: 'Placed', className: 'ord-nowrap', render: o => <DateTime value={o.created_at} dateOnly /> },
                  { key: 'items', header: 'Items', render: o => <span className="ord-clamp">{itemsSummaryText(o.items) || '—'}</span> },
                  { key: 'total', header: 'Total', align: 'right', className: 'ord-nowrap', render: o => <Money value={o.total} /> },
                  { key: 'status', header: 'Status', render: o => <StatusPill status={o.status} kind="order" /> },
                ]}
                rows={orders.rows} loading={orders.loading} error={orders.error} onRetry={orders.reload}
                empty={{ icon: 'cart', title: 'No orders yet', hint: 'Their orders will be listed here.' }}
                footer={<Pagination page={orders.page} pageSize={orders.pageSize} total={orders.count} onPage={orders.setPage} />}
              />
            </Card>

            <Card title="Returns" subtitle="The latest ten" pad={false}>
              {returns.error ? <ErrorState compact error={returns.error} onRetry={returns.reload} />
                : (returns.data || []).length === 0 ? <EmptyState compact icon="undo" title={returns.loading ? 'Loading…' : 'No returns'} />
                  : (
                    <ul className="ord-returns" style={{ padding: 16 }}>
                      {returns.data.map(r => (
                        <li key={r.id} className="ord-return">
                          <span style={{ minWidth: 0 }}>
                            <Link to={`/admin/returns/${r.id}`}><strong>{r.type === 'replacement' ? 'Replacement' : 'Return'} {shortReturnId(r.id)}</strong></Link> · <Link to={`/admin/orders/${encodeURIComponent(r.order_id)}`}>{r.order_id}</Link>
                            <span className="adm-cell-sub" style={{ display: 'block', overflowWrap: 'anywhere' }}>{itemsSummaryText(r.items)}</span>
                            <span className="adm-cell-sub" style={{ display: 'block' }}><DateTime value={r.created_at} dateOnly /> · <Money value={r.refund_amount} /></span>
                          </span>
                          <StatusPill status={r.status} kind="return" />
                        </li>
                      ))}
                    </ul>
                  )}
            </Card>

            <Card title="Reviews" subtitle="The latest ten" pad={false}>
              {reviews.error ? <ErrorState compact error={reviews.error} onRetry={reviews.reload} />
                : (reviews.data || []).length === 0 ? <EmptyState compact icon="star" title={reviews.loading ? 'Loading…' : 'No reviews'} />
                  : (
                    <ul className="ord-returns" style={{ padding: 16 }}>
                      {reviews.data.map(r => (
                        <li key={r.id} className="ord-return">
                          <span style={{ minWidth: 0 }}>
                            <Link to={`/admin/products/${r.product_id}`}><strong>{r.product_name}</strong></Link>
                            <span className="adm-cell-sub" style={{ display: 'block' }}><StarRating value={r.rating} size={13} /> {r.title ? `“${r.title}”` : ''}</span>
                          </span>
                          <StatusPill status={r.status} kind="review" />
                        </li>
                      ))}
                    </ul>
                  )}
              <div style={{ padding: '0 16px 16px' }}><Button size="sm" to="/admin/reviews">Open the review queue</Button></div>
            </Card>
          </div>

          <div className="ord-side">
            <Card title="Profile">
              <dl className="ord-kv">
                <div><dt>Name</dt><dd>{profile.name || '—'}</dd></div>
                <div><dt>Email</dt><dd>{email ? <span className="ord-payid"><a href={`mailto:${email}`}>{email}</a><CopyButton text={email} /></span> : (contact.loading ? '…' : '—')}</dd></div>
                <div><dt>Phone</dt><dd>{profile.phone ? <span className="ord-payid"><a href={`tel:${profile.phone}`}>{profile.phone}</a><CopyButton text={profile.phone} /></span> : '—'}</dd></div>
                <div><dt>Marketing</dt><dd>{profile.marketing_opt_in ? 'Opted in' : 'Not opted in'}</dd></div>
                <div><dt>Customer id</dt><dd><span className="ord-payid">{String(profile.id).slice(0, 8)}…<CopyButton text={profile.id} /></span></dd></div>
              </dl>
            </Card>
            <Card title="Saved addresses" subtitle={addresses.length ? `${addresses.length} saved` : undefined}>
              {addresses.length === 0 ? <p className="adm-muted" style={{ margin: 0 }}>No saved addresses.</p> : addresses.map((a, i) => (
                <div className="ord-addr" key={i}>
                  <div className="ord-addr-head"><span>{a.isDefault ? 'Default address' : `Address ${i + 1}`}</span><CopyButton text={addressText(a)} label="Copy" /></div>
                  <div className="ord-addr-body">{addressText(a)}</div>
                </div>
              ))}
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}

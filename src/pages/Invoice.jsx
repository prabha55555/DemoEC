import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { supabase } from '../supabase';
import { useBrand } from '../context/BrandContext';
import { safeQuery, isAuthExpiredError } from '../utils/safeFetch';
import { usePageMeta } from '../utils/usePageMeta';
import InvoiceDocument from '../components/InvoiceDocument';
import { EmptyState, LoadError, Loading } from '../components/AccountParts';

// Everything the invoice prints and nothing internal (no payment ids, inventory flags, package photo).
const INVOICE_COLUMNS = 'id, order_id, user_email, user_name, user_phone, address, items, subtotal, shipping, cod_fee, discount, coupon_code, gift_card_code, gift_card_applied, tax_total, total, payment_method, payment_status, status, refunded_amount, created_at';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// /invoice/:orderId -- a printable A4 GST invoice. Row-level security means only the order's owner (or
// the admin) can load it. "Print / Save as PDF" uses the browser's print dialog, with the site chrome
// hidden by the @media print rules below.
export default function Invoice() {
  const { orderId: ref } = useParams();
  const { brand } = useBrand();
  const navigate = useNavigate();
  const [state, setState] = useState({ order: null, loading: true, error: '', notFound: false });
  usePageMeta({ title: ref ? `Invoice ${ref}` : 'Invoice', description: 'Tax invoice for your order.' });

  const load = useCallback(async () => {
    setState(s => ({ ...s, loading: true, error: '', notFound: false }));
    const col = UUID.test(ref || '') ? 'id' : 'order_id';
    const res = await safeQuery(supabase.from('orders').select(INVOICE_COLUMNS).eq(col, ref).is('deleted_at', null).maybeSingle());
    if (isAuthExpiredError(res.error)) { toast.error('Your session has expired — please sign in again.'); navigate('/login'); return; }
    if (res.error) { setState({ order: null, loading: false, error: 'Please check your connection and try again.', notFound: false }); return; }
    setState({ order: res.data || null, loading: false, error: '', notFound: !res.data });
  }, [ref, navigate]);
  useEffect(() => { load(); }, [load]);

  const { order } = state;
  return (
    <div className="inv-page">
      <div className="inv-toolbar">
        <Link to={order ? `/account/orders/${encodeURIComponent(order.order_id)}` : '/account?tab=orders'} className="inv-back">← Back to order</Link>
        {order && <button type="button" className="btn btn-gold btn-sm" onClick={() => window.print()}>Print / Save as PDF</button>}
      </div>

      <div className="inv-body">
        {state.loading ? <Loading label="Loading your invoice" />
          : state.error ? <LoadError message={state.error} onRetry={load} />
          : state.notFound ? <EmptyState art="orders" title="Invoice not found" text="It may belong to a different account, or the order number may be wrong." cta="Go to my orders" onCta={() => navigate('/account?tab=orders')} />
          : <InvoiceDocument order={order} brand={brand} />}
      </div>

      <style>{`
        .inv-page { padding-top: var(--hdr-h); min-height: 80vh; background: var(--bg); padding-bottom: 40px; }
        .inv-toolbar { max-width: 210mm; margin: 0 auto; padding: 12px 14px; display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
        .inv-back { font-size: 13.5px; font-weight: 500; color: var(--primary); }
        .inv-back:hover { text-decoration: underline; }
        .inv-body { padding: 0 8px; }
        @media print {
          /* print only the invoice: hide the site header, footer, bottom bar, chat button and this page's toolbar */
          .bl-header, .bl-footer, .bl-bottom-nav, .bl-drawer, .skip-link, .tt-progress, .floating-wa-btn, .inv-toolbar { display: none !important; }
          html, body { background: #fff !important; height: auto !important; }
          .inv-page { padding: 0 !important; min-height: 0 !important; background: #fff !important; }
          .inv-body { padding: 0 !important; }
        }
      `}</style>
    </div>
  );
}

import React, { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { formatMoney } from '../utils/catalog';
import { addressLines } from '../utils/orderFormat';
import { whatsappLink } from '../config/company';
import { usePageMeta } from '../utils/usePageMeta';
import OrderItemsList from '../components/OrderItemsList';
import PriceSummary from '../components/PriceSummary';

// tt_last_order is never cleared after checkout -- a bookmark, the back button,
// or just typing /confirmation directly could re-show a real order from days
// earlier as if it had just been placed. Only trust it within a short window of
// actually being written; older entries (or ones from before this fix, with no
// ts at all) fall through to the "no active order" state below instead.
const RECENT_ORDER_WINDOW_MS = 30 * 60 * 1000;

const ico = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true };

function readRecentOrder() {
  let stored = {};
  try { stored = JSON.parse(localStorage.getItem('tt_last_order') || '{}') || {}; } catch { /* corrupted value -- treated as no recent order */ }
  const isRecent = typeof stored.ts === 'number' && (Date.now() - stored.ts) < RECENT_ORDER_WINDOW_MS;
  return isRecent && stored.orderId ? stored : null;
}

const PAYMENT_NOTE = {
  online: 'Paid online',
  cod: 'Cash on Delivery',
  free: 'Covered by your coupon / gift card',
};

export default function Confirmation() {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const order = useMemo(readRecentOrder, []);
  usePageMeta({ title: order ? 'Order placed' : 'Order confirmation', description: 'Your order confirmation.' });

  const mode = order?.paymentMethod || 'online';
  const total = Number(order?.total) || 0;
  const rows = order ? [
    { key: 'items', label: 'Items total', value: formatMoney(order.subtotal ?? total) },
    ...(Number(order.discount) > 0 ? [{ key: 'disc', label: order.couponCode ? `Coupon (${order.couponCode})` : 'Discount', value: `− ${formatMoney(order.discount)}`, tone: 'minus' }] : []),
    ...(order.digital ? [] : [{ key: 'ship', label: 'Delivery', value: Number(order.shipping) > 0 ? formatMoney(order.shipping) : 'Free', tone: Number(order.shipping) > 0 ? undefined : 'free' }]),
    ...(Number(order.codFee) > 0 ? [{ key: 'cod', label: 'Cash on Delivery fee', value: formatMoney(order.codFee) }] : []),
    ...(Number(order.giftCard) > 0 ? [{ key: 'gc', label: 'Gift card', value: `− ${formatMoney(order.giftCard)}`, tone: 'minus' }] : []),
  ] : [];
  const totalLabel = mode === 'cod' ? 'Amount to pay on delivery' : mode === 'free' ? 'Total' : 'Total paid';
  const addrText = order?.addr ? addressLines(order.addr) : [];

  return (
    <div className="conf-page" style={{ paddingTop: 'var(--hdr-h)', minHeight: '80vh', background: 'var(--bg)' }}>
      <div className="bl-wrap conf-wrap">
        <div className="conf-card">
          {/* STATUS */}
          <div className="conf-top">
            {order ? (
              <div className="conf-check" aria-hidden="true">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
              </div>
            ) : (
              <div className="conf-check idle" aria-hidden="true">
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" /><line x1="3" y1="6" x2="21" y2="6" /><path d="M16 10a4 4 0 0 1-8 0" /></svg>
              </div>
            )}

            <h1 className="conf-title">{order ? 'Order placed successfully' : 'Nothing to confirm'}</h1>
            <p className="conf-sub">
              {order
                ? mode === 'cod'
                  ? `Thank you for your order. Please keep ${formatMoney(total)} ready — you pay when it is delivered.`
                  : order.digital
                    ? 'Thank you for your order. Your gift card is on its way to the email address you gave us.'
                    : 'Thank you for your order. We will email you as soon as it ships.'
                : "We don't have a recent order to show here. If you're looking for a past order, check My Orders."}
            </p>

            {order && (
              <div className="conf-id">
                <span>Order number</span>
                <strong>{order.orderId}</strong>
              </div>
            )}
          </div>

          {order && (
            <>
              {/* ITEMS */}
              {Array.isArray(order.items) && order.items.length > 0 && (
                <section className="conf-sec" aria-label="Items ordered">
                  <h2 className="conf-label">Items ordered</h2>
                  <OrderItemsList items={order.items} compact />
                </section>
              )}

              {/* PAYMENT SUMMARY */}
              <section className="conf-sec" aria-label="Payment summary">
                <h2 className="conf-label">Payment summary</h2>
                <span className="conf-paytag">{PAYMENT_NOTE[mode]}</span>
                <PriceSummary
                  className="conf-sum"
                  title="Price details"
                  rows={rows}
                  total={{ label: totalLabel, value: formatMoney(total) }}
                  note={mode === 'cod' ? 'Inclusive of all taxes. Pay the delivery agent when your order arrives.' : 'Inclusive of all taxes'}
                />
              </section>

              {/* DELIVERY */}
              <section className="conf-sec conf-two" aria-label="Delivery details">
                {!order.digital && addrText.length > 0 && (
                  <div>
                    <h2 className="conf-label">Delivering to</h2>
                    <div className="conf-addr">
                      {addrText.map((l, i) => (i === 0 ? <strong key={i}>{l}<br /></strong> : <React.Fragment key={i}>{l}<br /></React.Fragment>))}
                    </div>
                  </div>
                )}
                <div>
                  <h2 className="conf-label">{order.digital ? 'Delivery' : 'Estimated delivery'}</h2>
                  <div className="conf-addr">
                    {order.digital ? 'Emailed to you once your payment is confirmed.' : (order.estimatedDelivery || 'We will email you the delivery date once it ships.')}
                    {order.email && <><br /><span style={{ color: 'var(--text-muted)' }}>Confirmation sent to {order.email}</span></>}
                  </div>
                </div>
              </section>
            </>
          )}

          {/* ACTIONS */}
          <div className="conf-sec conf-actions">
            {order ? (
              <>
                {currentUser && (
                  <button type="button" className="btn btn-gold" onClick={() => navigate(`/account/orders/${encodeURIComponent(order.orderId)}`)}>
                    <svg {...ico}><path d="M1 3h15v13H1zM16 8h4l3 3v5h-7z" /><circle cx="5.5" cy="18.5" r="2" /><circle cx="18.5" cy="18.5" r="2" /></svg>
                    View order
                  </button>
                )}
                <button type="button" className={`btn ${currentUser ? 'btn-outline' : 'btn-gold'}`} onClick={() => navigate('/shop')}>Continue shopping</button>
                <a href={whatsappLink(`Hi, I need help with my order ${order.orderId}.`)} target="_blank" rel="noreferrer" className="btn btn-wa" style={{ textDecoration: 'none' }}>
                  <svg {...ico}><path d="M21 11.5a8.4 8.4 0 0 1-12.4 7.4L3 20.5l1.7-5.4A8.4 8.4 0 1 1 21 11.5z" /></svg>
                  Need help?
                </a>
              </>
            ) : (
              <>
                {currentUser
                  ? <button type="button" className="btn btn-gold" onClick={() => navigate('/account?tab=orders')}>View my orders</button>
                  : <Link to="/login" state={{ from: { pathname: '/account', search: '?tab=orders' } }} className="btn btn-gold" style={{ textDecoration: 'none' }}>Sign in to see your orders</Link>}
                <button type="button" className="btn btn-outline" onClick={() => navigate('/shop')}>Continue shopping</button>
              </>
            )}
          </div>
        </div>
      </div>

      <style>{`
        .conf-wrap { padding-top: 16px; padding-bottom: 40px; }
        @media (min-width: 768px) { .conf-wrap { padding-top: 24px; } }
        .conf-card { max-width: 720px; margin: 0 auto; background: #fff; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }

        .conf-top { text-align: center; padding: 28px 20px 24px; }
        .conf-check { width: 56px; height: 56px; margin: 0 auto 14px; border-radius: 50%; background: var(--success); display: flex; align-items: center; justify-content: center; }
        .conf-check.idle { background: var(--primary-tint); border: 1px solid var(--primary-border); }
        .conf-title { font-family: var(--font-head); font-weight: 500; font-size: 20px; line-height: 1.3; color: var(--text); margin: 0 0 6px; }
        .conf-sub { font-size: 14px; line-height: 1.6; color: var(--text-muted); margin: 0 auto; max-width: 460px; }
        .conf-id { display: inline-flex; align-items: center; gap: 8px; max-width: 100%; margin-top: 16px; padding: 7px 12px; background: var(--bg); border: 1px solid var(--border); border-radius: 4px; font-size: 13px; color: var(--text-muted); }
        .conf-id strong { min-width: 0; font-size: 14px; font-weight: 600; color: var(--text); overflow-wrap: anywhere; }

        .conf-sec { padding: 16px 20px; border-top: 1px solid var(--border); }
        .conf-label { font-family: var(--font-head); font-size: 14px; font-weight: 500; color: var(--text-muted); margin: 0 0 10px; }
        .conf-sum.pst { border: none; }
        .conf-sum .pst-head { display: none; }
        .conf-sum .pst-body { padding: 0; }
        .conf-paytag { display: inline-block; margin-bottom: 12px; padding: 3px 10px; border-radius: 999px; background: var(--primary-tint); color: var(--primary-dark); font-size: 12px; font-weight: 600; }
        .conf-two { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
        .conf-two > div:only-child { grid-column: 1 / -1; }
        .conf-addr { font-size: 14px; line-height: 1.65; color: var(--text); overflow-wrap: anywhere; }
        .conf-addr strong { font-weight: 500; }

        .conf-actions { display: flex; flex-direction: column; gap: 10px; background: #FAFBFB; }
        .conf-actions .btn { width: 100%; text-align: center; }
        @media (min-width: 640px) {
          .conf-actions { flex-direction: row; }
          .conf-actions .btn { flex: 1; width: auto; padding-left: 16px; padding-right: 16px; }
        }
        @media (max-width: 560px) { .conf-two { grid-template-columns: 1fr; } }
        @media (max-width: 520px) {
          .conf-top { padding: 24px 16px 20px; }
          .conf-sec { padding: 14px 16px; }
        }
      `}</style>
    </div>
  );
}

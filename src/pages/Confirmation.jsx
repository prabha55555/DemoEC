import React from 'react';
import { useNavigate } from 'react-router-dom';
import { fmt } from '../data/products';
import { thumb } from '../utils/thumbnail';
import { whatsappLink } from '../config/company';

// tt_last_order is never cleared after checkout -- a bookmark, the back button,
// or just typing /confirmation directly could re-show a real order from days
// earlier as if it had just been placed. Only trust it within a short window of
// actually being written; older entries (or ones from before this fix, with no
// ts at all) fall through to the "no active order" state below instead.
const RECENT_ORDER_WINDOW_MS = 30 * 60 * 1000;

const ico = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true };

export default function Confirmation() {
  const navigate = useNavigate();
  let stored = {};
  try { stored = JSON.parse(localStorage.getItem('tt_last_order') || '{}') || {}; } catch { /* corrupted value -- treated as no recent order */ }
  const isRecent = typeof stored.ts === 'number' && (Date.now() - stored.ts) < RECENT_ORDER_WINDOW_MS;
  const order = isRecent ? stored : {};
  const placed = !!order.orderId;
  const hasItems = !!order.items;
  const hasAddr = !!order.addr;

  return (
    <div className="conf-page" style={{ paddingTop: 'var(--hdr-h)', minHeight: '80vh', background: 'var(--bg)' }}>
      <div className="bl-wrap conf-wrap">
        <div className="conf-card">
          {/* STATUS */}
          <div className="conf-top">
            {placed ? (
              <div className="conf-check" aria-hidden="true">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
              </div>
            ) : (
              <div className="conf-check idle" aria-hidden="true">
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" /><line x1="3" y1="6" x2="21" y2="6" /><path d="M16 10a4 4 0 0 1-8 0" /></svg>
              </div>
            )}

            <h1 className="conf-title">{placed ? 'Order placed successfully' : 'Nothing to confirm'}</h1>
            <p className="conf-sub">
              {placed
                ? 'Thank you for your order. We will reach out within 24 hours to confirm the details and arrange delivery.'
                : "We don't have a recent order to show here. If you're looking for a past order, check My Orders."}
            </p>

            {placed && (
              <div className="conf-id">
                <span>Order ID</span>
                <strong>{order.orderId}</strong>
              </div>
            )}
          </div>

          {/* ITEMS */}
          {placed && hasItems && (
            <section className="conf-sec" aria-label="Items ordered">
              <h2 className="conf-label">Items ordered</h2>
              <div className="conf-items">
                {order.items.map((item, i) => (
                  <div key={i} className="conf-item">
                    <div className="conf-item-img" style={{ background: item.bg || 'var(--bg-hover)' }}>
                      {item.images?.[0] && <img src={thumb(item.images[0], 100)} alt="" loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                    </div>
                    <span className="conf-item-name">{item.name}{item.size ? ` — ${item.size}` : ''}</span>
                    <span className="conf-item-qty">Qty {item.qty}</span>
                  </div>
                ))}
              </div>
              {typeof order.total === 'number' && (
                <div className="conf-total">
                  <span>Total paid</span>
                  <strong>{fmt(order.total)}</strong>
                </div>
              )}
            </section>
          )}

          {/* ADDRESS */}
          {placed && hasAddr && (
            <section className="conf-sec" aria-label="Delivery address">
              <h2 className="conf-label">Delivery to</h2>
              <div className="conf-addr">
                <strong>{order.addr.name}</strong><br />
                {order.addr.line1}{order.addr.line2 ? ', ' + order.addr.line2 : ''}<br />
                {order.addr.city}, {order.addr.state}, {order.addr.pincode}
              </div>
            </section>
          )}

          {/* ACTIONS */}
          <div className="conf-sec conf-actions">
            {placed ? (
              <>
                <button className="btn btn-gold" onClick={() => navigate('/account?tab=orders')}>
                  <svg {...ico}><path d="M1 3h15v13H1zM16 8h4l3 3v5h-7z" /><circle cx="5.5" cy="18.5" r="2" /><circle cx="18.5" cy="18.5" r="2" /></svg>
                  Track Order
                </button>
                <button className="btn btn-outline" onClick={() => navigate('/shop')}>Continue Shopping</button>
                <a
                  href={whatsappLink(`Hi, I'd like to confirm my order ${order.orderId}. Could you please share the delivery timeline?`)}
                  target="_blank" rel="noreferrer"
                  className="btn btn-wa"
                  style={{ textDecoration: 'none' }}
                >
                  <svg {...ico}><path d="M21 11.5a8.4 8.4 0 0 1-12.4 7.4L3 20.5l1.7-5.4A8.4 8.4 0 1 1 21 11.5z" /></svg>
                  Ask on WhatsApp
                </a>
              </>
            ) : (
              <>
                <button className="btn btn-gold" onClick={() => navigate('/account?tab=orders')}>View My Orders</button>
                <button className="btn btn-outline" onClick={() => navigate('/shop')}>Continue Shopping</button>
                <a
                  href={whatsappLink()}
                  target="_blank" rel="noreferrer"
                  className="btn btn-wa"
                  style={{ textDecoration: 'none' }}
                >
                  <svg {...ico}><path d="M21 11.5a8.4 8.4 0 0 1-12.4 7.4L3 20.5l1.7-5.4A8.4 8.4 0 1 1 21 11.5z" /></svg>
                  Chat on WhatsApp
                </a>
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
        .conf-label { font-family: var(--font-head); font-size: 14px; font-weight: 500; color: var(--text-muted); margin: 0 0 12px; }
        .conf-items { display: flex; flex-direction: column; gap: 12px; }
        .conf-item { display: flex; align-items: center; gap: 12px; }
        .conf-item-img { width: 48px; height: 48px; border: 1px solid var(--border); border-radius: 4px; overflow: hidden; flex-shrink: 0; }
        .conf-item-name { flex: 1; min-width: 0; font-size: 14px; font-weight: 500; color: var(--text); line-height: 1.4; overflow-wrap: anywhere; }
        .conf-item-qty { flex-shrink: 0; font-size: 13px; color: var(--text-muted); }
        .conf-total { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; margin-top: 14px; padding-top: 14px; border-top: 1px dashed #C9D3D1; font-size: 15px; font-weight: 600; color: var(--text); }
        .conf-total strong { font-size: 18px; font-weight: 600; }
        .conf-addr { font-size: 14px; line-height: 1.65; color: var(--text); overflow-wrap: anywhere; }
        .conf-addr strong { font-weight: 500; }

        .conf-actions { display: flex; flex-direction: column; gap: 10px; background: #FAFBFB; }
        .conf-actions .btn { width: 100%; text-align: center; }
        @media (min-width: 640px) {
          .conf-actions { flex-direction: row; }
          .conf-actions .btn { flex: 1; width: auto; padding-left: 16px; padding-right: 16px; }
        }
        @media (max-width: 520px) {
          .conf-top { padding: 24px 16px 20px; }
          .conf-sec { padding: 14px 16px; }
        }
      `}</style>
    </div>
  );
}
